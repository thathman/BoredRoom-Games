// LudoRoom — server-authoritative Colyseus room for Ludo (Nigerian 2-dice variant).
//
// Whot used to live inside this file as a sibling game type; it now has its own
// WhotRoom.ts. This file is Ludo-only and the host:set_game_type intent is no
// longer accepted (rooms are per-game; the host picks the game at room
// creation time).
//
// State machine: lobby -> playing -> finished.
// Authority rules:
//   - Host is NEVER a playable seat. host appears in roomState.hostId only.
//   - Clients send Intents; server validates and projects state.
//   - Public state is broadcast to everyone in the room.
//   - Private state is sent ONLY to its owning seat (never to display).
//   - Bots run on a server-side setTimeout loop driven by the rules adapter.

import { Client, Room } from '@colyseus/core';
import {
  DEFAULT_REACTION_POLICY,
  DEFAULT_TAUNT_POLICY,
  GameType,
  Intent,
  JoinAuth,
  PROTOCOL_VERSION,
  PublicRoomState,
  PrivateSeatState,
  PendingJoinRequest,
  ReactionPolicy,
  RoomMember,
  ServerEvent,
  AIStatus,
  RoomPolicy,
  RoomSettings,
  TauntPolicy,
} from '../../../shared/src/contracts/index.js';
import {
  applyMoveToken,
  applyRollDice,
  createInitialLudoState,
  pickBotMove,
} from '../../../shared/src/rules/index.js';
import { createReactionStats } from '../../../shared/src/reactions/policy.js';
import { ReactionSubsystem } from './reactions.js';
import { hostTokenStore } from '../auth/hostTokens.js';
import { buildMatchKey, persistFinishedMatch } from '../matchPersistence.js';
import { log } from '../logger.js';
import { projectCanonicalPhaseFromStatus } from './_base.js';
import { removeRoom, upsertRoom } from '../roomDirectory.js';
import { clampNum, markPresence, sanitizeText, uuid, clearPauseRequests, clearPauseState, pauseGameIfPlaying } from './_shared.js';

const LUDO_MAX_SEATS = 4;
const BOT_TICK_MS = 900;
const SEAT_COLORS = ['red', 'green', 'yellow', 'blue'] as const;

interface AttachedClient {
  deviceId: string;
  role: 'host' | 'player';
  displayName: string;
}

export class LudoRoom extends Room {
  private public!: PublicRoomState;
  private privateBySeat = new Map<string, PrivateSeatState>();
  private attached = new Map<string, AttachedClient>();
  private sessionByDevice = new Map<string, string>();

  private botTimer: NodeJS.Timeout | null = null;
  private reactions!: ReactionSubsystem;

  private matchStartedAt = 0;
  private persistedMatchKeys = new Set<string>();
  private hostPartyId: string | null = null;

  override onCreate(options: { code?: string; gameType?: GameType; partyId?: string }) {
    const code = (options?.code ?? 'TEMP').toUpperCase();
    this.roomId = code;
    this.hostPartyId = typeof options?.partyId === 'string' && options.partyId.length > 0
      ? options.partyId
      : null;
    this.public = {
      protocolVersion: PROTOCOL_VERSION,
      code,
      hostId: '',
      status: 'lobby',
      members: [],
      gameState: null,
      reactions: [],
      pendingJoinRequests: [],
      aiStatus: 'active',
      roomPolicy: 'open',
      reactionPolicy: { ...DEFAULT_REACTION_POLICY },
      tauntPolicy: { ...DEFAULT_TAUNT_POLICY },
      reactionStats: createReactionStats(),
      reactionMoments: [],
      pauseState: { paused: false, reason: null, requestedBy: null, since: null, message: null },
      presenceBySeat: {},
      maxPlayers: LUDO_MAX_SEATS,
      roomSettings: {
        aiAssistance: true,
        maxPlayers: LUDO_MAX_SEATS,
        whotPenaltyStreaks: false,
        reactionBursts: true,
      },
      gameType: 'ludo',
      whotState: null,
    };

    this.reactions = new ReactionSubsystem({
      sendToClient: (sessionId, evt) => {
        const c = this.clients.find((x) => x.sessionId === sessionId);
        c?.send('event', evt);
      },
      broadcastPublic: () => this.broadcastPublic(),
    });

    this.onMessage('intent', (client, intent: Intent) => this.handleIntent(client, intent));
    this.syncRoomDirectory();
    log('info', 'room_instance_created', { room: code, gameType: 'ludo' });
  }

  override async onAuth(_client: Client, options: JoinAuth) {
    if (!options || options.protocolVersion !== PROTOCOL_VERSION) {
      log('warn', 'protocol_mismatch', {
        room: this.public.code,
        expected: PROTOCOL_VERSION,
        received: options?.protocolVersion ?? null,
      });
      throw new Error('protocol_mismatch');
    }
    if (!options.deviceId || typeof options.deviceId !== 'string') {
      throw new Error('deviceId_required');
    }
    if (options.role === 'host') {
      const ok = hostTokenStore.verify(this.public.code, options.deviceId, options.hostToken);
      if (!ok) throw new Error('host_token_invalid');
    }
    return options;
  }

  override onJoin(client: Client, options: JoinAuth) {
    const att: AttachedClient = {
      deviceId: options.deviceId,
      role: options.role,
      displayName: options.displayName || 'Player',
    };
    this.attached.set(client.sessionId, att);

    const prevSession = this.sessionByDevice.get(options.deviceId);
    const wasKnownPlayer = this.public.members.some((m) => m.id === options.deviceId);
    if (prevSession && prevSession !== client.sessionId) {
      const prev = this.clients.find((c) => c.sessionId === prevSession);
      prev?.leave(4000, 'replaced_by_new_session');
    }
    this.sessionByDevice.set(options.deviceId, client.sessionId);

    if (att.role === 'host') {
      this.public.hostId = att.deviceId;
      this.hostPartyId = typeof options.partyId === 'string' && options.partyId.length > 0
        ? options.partyId
        : this.hostPartyId;
    } else {
      this.handlePlayerArrival(att, client);
      markPresence(this.public, att.deviceId, { connected: true, hidden: false, pauseRequested: false });
    }

    this.broadcastPublic();
    this.sendPrivateTo(client, att.deviceId);
    log('info', wasKnownPlayer ? 'player_reconnected' : 'player_joined', {
      room: this.public.code,
      role: att.role,
      gameType: 'ludo',
      status: this.public.status,
    });
  }

  override onLeave(client: Client) {
    const att = this.attached.get(client.sessionId);
    this.attached.delete(client.sessionId);
    if (!att) return;
    if (this.sessionByDevice.get(att.deviceId) === client.sessionId) {
      this.sessionByDevice.delete(att.deviceId);
    }
    if (att.role === 'player') {
      markPresence(this.public, att.deviceId, { connected: false });
    }
    log('info', 'player_left', { room: this.public.code, role: att.role, status: this.public.status });
  }

  override onDispose() {
    if (this.botTimer) clearInterval(this.botTimer);
    hostTokenStore.release(this.public.code);
    removeRoom(this.public.code);
  }

  // ────────────────────────────────────────────────────────────────────
  // Player arrival
  // ────────────────────────────────────────────────────────────────────

  private handlePlayerArrival(att: AttachedClient, client: Client) {
    const existing = this.public.members.find((m) => m.id === att.deviceId);
    if (existing) {
      existing.displayName = att.displayName;
      return;
    }
    if (this.public.status === 'lobby') {
      if (this.public.roomPolicy === 'locked') {
        this.error(client, 'room_locked', 'Room is locked');
        return;
      }
      if (this.public.roomPolicy === 'approval') {
        this.enqueueJoinRequest(att.deviceId, att.displayName);
        this.error(client, 'pending_approval', 'Waiting for host approval');
        return;
      }
      if (this.activeSeats().length < this.maxSeatsForCurrentGame()) {
        this.public.members.push(this.makeSeat(att.deviceId, att.displayName));
        return;
      }
      this.error(client, 'room_full', 'Room is full');
      return;
    }
    if (this.public.roomPolicy === 'locked') {
      this.error(client, 'room_locked', 'Room is locked');
      return;
    }
    this.enqueueJoinRequest(att.deviceId, att.displayName);
    this.error(client, 'pending_approval', 'Waiting for host approval');
  }

  // ────────────────────────────────────────────────────────────────────
  // Intent dispatch
  // ────────────────────────────────────────────────────────────────────

  private handleIntent(client: Client, intent: Intent) {
    const att = this.attached.get(client.sessionId);
    if (!att) return;
    const isHost = att.role === 'host' && att.deviceId === this.public.hostId;

    if (intent.type.startsWith('host:')) {
      if (!isHost) return this.error(client, 'forbidden', 'host_only');
      this.handleHostIntent(intent as Extract<Intent, { type: `host:${string}` }>);
      this.broadcastPublic();
      return;
    }

    switch (intent.type) {
      case 'request_state':
        this.sendPublicTo(client);
        this.sendPrivateTo(client, att.deviceId);
        return;

      case 'player:set_visibility': {
        markPresence(this.public, att.deviceId, { connected: true, hidden: Boolean(intent.hidden) });
        if (
          intent.hidden &&
          this.public.status === 'playing' &&
          this.activeSeats().some((m) => m.id === att.deviceId)
        ) {
          this.pauseGame('player_visibility', att.deviceId, `${att.displayName} stepped away`);
        }
        this.broadcastPublic();
        return;
      }

      case 'player:pause_request': {
        markPresence(this.public, att.deviceId, { connected: true, pauseRequested: true });
        this.pauseGame('player_request', att.deviceId, `${att.displayName} requested a pause`);
        this.broadcastPublic();
        return;
      }

      case 'player:leave_request': {
        this.enqueueJoinRequest(att.deviceId, `${att.displayName} wants to leave`);
        this.error(client, 'leave_requested', 'Host notified');
        this.broadcastPublic();
        return;
      }

      case 'controller:transfer_start':
      case 'controller:transfer_accept':
        this.error(client, 'not_implemented', 'Transfer handoff is queued for the host');
        return;

      case 'toggle_ready': {
        if (this.public.status !== 'lobby') return;
        const m = this.public.members.find((x) => x.id === att.deviceId);
        if (!m) return;
        m.isReady = !m.isReady;
        this.broadcastPublic();
        return;
      }

      case 'send_reaction': {
        this.reactions.handleSendReaction(
          this.public,
          client.sessionId,
          att.deviceId,
          intent.emoji,
          intent.clientNonce,
        );
        return;
      }

      case 'roll_dice': {
        if (this.public.pauseState?.paused) return this.error(client, 'paused', 'game_paused');
        if (!this.public.gameState) return;
        const cur = this.public.gameState.players[this.public.gameState.currentPlayerIndex];
        if (cur.id !== att.deviceId) return this.error(client, 'forbidden', 'not_your_turn');
        const r = applyRollDice(this.public.gameState);
        if (!r.ok) return this.error(client, 'illegal', r.reason ?? 'roll_failed');
        this.public.gameState = r.state;
        this.checkFinished();
        this.broadcastPublic();
        return;
      }

      case 'move_token': {
        if (this.public.pauseState?.paused) return this.error(client, 'paused', 'game_paused');
        if (!this.public.gameState) return;
        const cur = this.public.gameState.players[this.public.gameState.currentPlayerIndex];
        if (cur.id !== att.deviceId) return this.error(client, 'forbidden', 'not_your_turn');
        const r = applyMoveToken(this.public.gameState, intent.tokenId, intent.dieChoice);
        if (!r.ok) return this.error(client, 'illegal', r.reason ?? 'move_failed');
        this.public.gameState = r.state;
        this.checkFinished();
        this.broadcastPublic();
        return;
      }

      // Whot intents are handled by WhotRoom; reject here so misrouted
      // clients get a clear error rather than a silent no-op.
      case 'whot:draw_card':
      case 'whot:play_card':
      case 'whot:call_suit':
      case 'whot:announce_last_card':
        return this.error(client, 'illegal', 'wrong_room_for_whot');
    }
  }

  private handleHostIntent(intent: Extract<Intent, { type: `host:${string}` }>) {
    switch (intent.type) {
      case 'host:start_game': {
        if (this.public.status !== 'lobby') return;
        const activeSeats = this.activeSeats();
        if (activeSeats.length < 2) return;
        if (!activeSeats.every((m) => m.isReady || m.isBot)) return;
        this.public.status = 'playing';
        clearPauseState(this.public);

        this.matchStartedAt = Date.now();
        log('info', 'game_started', { room: this.public.code, gameType: 'ludo', players: activeSeats.length });
        this.public.gameState = createInitialLudoState(
          activeSeats.map((m) => ({
            id: m.id,
            displayName: m.displayName,
            isBot: m.isBot,
            botDifficulty: activeSeats.find((x) => x.id === m.id)?.isBot ? 'smart' : undefined,
          })),
        );
        this.startBotLoop();
        return;
      }

      case 'host:play_again': {
        if (this.public.status !== 'finished') return;
        this.public.status = 'lobby';
        this.public.gameState = null;
        this.public.pendingJoinRequests = [];
        clearPauseState(this.public);
        this.public.members = this.public.members.map((m) => ({
          ...m,
          isReady: Boolean(m.isBot),
        }));
        return;
      }

      case 'host:pause_game': {
        this.pauseGame('host', this.public.hostId, 'Host paused the game');
        return;
      }

      case 'host:resume_game': {
        clearPauseState(this.public);
        clearPauseRequests(this.public);
        return;
      }

      case 'host:end_game': {
        if (this.public.status !== 'playing') return;
        this.public.status = 'finished';
        this.public.pauseState = {
          paused: true,
          reason: 'ended',
          requestedBy: this.public.hostId,
          since: Date.now(),
          message: sanitizeText(intent.reason ?? 'Host ended the game', 180),
        };
        if (this.public.gameState) {
          this.public.gameState.phase = 'finished';
          this.public.gameState.lastAction = this.public.pauseState.message ?? 'Host ended the game';
        }
        if (this.botTimer) { clearInterval(this.botTimer); this.botTimer = null; }
        this.persistFinishedMatchOnce();
        return;
      }

      case 'host:kick': {
        if (this.public.status !== 'lobby') return;
        this.public.members = this.public.members.filter((m) => m.id !== intent.playerId);
        const sid = this.sessionByDevice.get(intent.playerId);
        if (sid) {
          const c = this.clients.find((x) => x.sessionId === sid);
          c?.send('event', { type: 'kicked', reason: 'host_removed' } satisfies ServerEvent);
          c?.leave(4001, 'kicked');
        }
        return;
      }

      case 'host:approve_join': {
        const idx = this.public.pendingJoinRequests.findIndex((r) => r.id === intent.requestId);
        if (idx === -1) return;
        const req = this.public.pendingJoinRequests[idx];
        this.public.pendingJoinRequests.splice(idx, 1);
        if (intent.mode === 'spectator') {
          this.public.members.push({
            id: req.deviceId,
            displayName: req.displayName,
            color: '#888',
            isReady: false,
            isHost: false,
            isSpectator: true,
          });
        } else if (intent.mode === 'transfer' && intent.targetSeatId) {
          const seat = this.public.members.find((m) => m.id === intent.targetSeatId);
          if (!seat) return;
          if (this.public.gameState) {
            const p = this.public.gameState.players.find((p) => p.id === seat.id);
            if (p) p.id = req.deviceId;
          }
          seat.id = req.deviceId;
          seat.displayName = req.displayName;
          seat.isBot = false;
        } else if (intent.mode === 'spawn') {
          if (this.activeSeats().length >= this.maxSeatsForCurrentGame()) return;
          const seat = this.makeSeat(req.deviceId, req.displayName);
          this.public.members.push(seat);
          if (this.public.gameState) {
            this.public.gameState.players.push({
              id: req.deviceId,
              color: ['red', 'green', 'yellow', 'blue'][this.public.gameState.players.length] as
                | 'red' | 'green' | 'yellow' | 'blue',
              displayName: req.displayName,
              tokens: Array.from({ length: 4 }, (_, j) => ({
                id: j,
                position: -1,
                color: ['red', 'green', 'yellow', 'blue'][this.public.gameState!.players.length] as
                  | 'red' | 'green' | 'yellow' | 'blue',
              })),
              finishedTokens: 0,
            });
          }
        }
        return;
      }

      case 'host:reject_join': {
        this.public.pendingJoinRequests = this.public.pendingJoinRequests.filter(
          (r) => r.id !== intent.requestId,
        );
        return;
      }

      case 'host:add_bot': {
        if (this.public.status !== 'lobby') return;
        if (this.activeSeats().length >= this.maxSeatsForCurrentGame()) return;
        const id = `bot-${uuid().slice(0, 6)}`;
        this.public.members.push({
          id,
          displayName: `Bot ${this.public.members.filter((m) => m.isBot).length + 1}`,
          color: SEAT_COLORS[this.activeSeats().length % SEAT_COLORS.length],
          isReady: true,
          isHost: false,
          isBot: true,
        });
        return;
      }

      case 'host:remove_bot': {
        this.public.members = this.public.members.filter((m) => !(m.isBot && m.id === intent.botId));
        return;
      }

      case 'host:replace_bot_with_human': {
        const seat = this.public.members.find((m) => m.id === intent.botId && m.isBot);
        if (!seat) return;
        if (this.public.gameState) {
          const p = this.public.gameState.players.find((p) => p.id === seat.id);
          if (p) {
            p.id = intent.humanDeviceId;
            p.isBot = false;
          }
        }
        seat.id = intent.humanDeviceId;
        seat.isBot = false;
        return;
      }

      case 'host:autofill_bots': {
        if (this.public.status !== 'lobby') return;
        const target = Math.min(this.maxSeatsForCurrentGame(), intent.targetCount);
        while (this.activeSeats().length < target) {
          const id = `bot-${uuid().slice(0, 6)}`;
          this.public.members.push({
            id,
            displayName: `Bot ${this.public.members.filter((m) => m.isBot).length + 1}`,
            color: SEAT_COLORS[this.activeSeats().length % SEAT_COLORS.length],
            isReady: true,
            isHost: false,
            isBot: true,
          });
        }
        return;
      }

      case 'host:set_room_policy': {
        const nextPolicy: RoomPolicy = intent.policy;
        this.public.roomPolicy = nextPolicy;
        return;
      }

      case 'host:set_reaction_policy': {
        const merged: ReactionPolicy = { ...this.public.reactionPolicy, ...intent.policy };
        merged.cooldownMs = clampNum(merged.cooldownMs, 0, 5000);
        merged.burstMax = clampNum(merged.burstMax, 1, 50);
        merged.burstWindowMs = clampNum(merged.burstWindowMs, 500, 30000);
        merged.duplicateWindowMs = clampNum(merged.duplicateWindowMs, 0, 5000);
        merged.maxBufferedReactions = clampNum(merged.maxBufferedReactions, 8, 200);
        this.public.reactionPolicy = merged;
        return;
      }

      case 'host:set_taunt_policy': {
        const next: TauntPolicy = { ...this.public.tauntPolicy, ...intent.policy };
        this.public.tauntPolicy = next;
        return;
      }

      case 'host:clear_reactions': {
        this.reactions.clearAll(this.public);
        return;
      }

      case 'host:set_ai_status': {
        if (!['active', 'fallback', 'degraded', 'offline'].includes(intent.status)) return;
        this.public.aiStatus = intent.status;
        return;
      }

      case 'host:set_ai_assistance': {
        this.public.roomSettings = {
          ...this.defaultRoomSettings(),
          ...(this.public.roomSettings ?? {}),
          aiAssistance: Boolean(intent.enabled),
        };
        return;
      }

      case 'host:set_game_settings': {
        const current = { ...this.defaultRoomSettings(), ...(this.public.roomSettings ?? {}) };
        const next: RoomSettings = { ...current, ...intent.settings };
        const minPlayers = Math.max(2, this.activeSeats().length);
        next.maxPlayers = clampNum(next.maxPlayers, minPlayers, LUDO_MAX_SEATS);
        this.public.roomSettings = next;
        this.public.maxPlayers = next.maxPlayers;
        return;
      }

      case 'host:broadcast_commentary': {
        const line = sanitizeText(intent.line, 280);
        if (!line) return;
        console.info('[ai] emit commentary', { room: this.public.code, gameType: 'ludo' });
        log('info', 'ai_commentary_broadcast', { room: this.public.code, gameType: 'ludo' });
        const evt: ServerEvent = { type: 'ai_commentary', line, timestamp: Date.now() };
        this.broadcast('event', evt);
        return;
      }

      case 'host:broadcast_recap': {
        const r = intent.recap ?? { headline: '', paragraph: '', mvp: '' };
        const recap = {
          headline: sanitizeText(r.headline, 200),
          paragraph: sanitizeText(r.paragraph, 1200),
          mvp: sanitizeText(r.mvp, 120),
        };
        if (!recap.headline && !recap.paragraph) return;
        console.info('[ai] emit recap', { room: this.public.code, gameType: 'ludo' });
        log('info', 'ai_recap_broadcast', { room: this.public.code, gameType: 'ludo' });
        const evt: ServerEvent = { type: 'ai_recap', recap, timestamp: Date.now() };
        this.broadcast('event', evt);
        return;
      }

      // host:set_game_type intentionally not handled — rooms are per-game now.
      // Legacy clients sending it get a silent no-op (forward-compat).
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // Bot loop
  // ────────────────────────────────────────────────────────────────────

  private startBotLoop() {
    if (this.botTimer) return;
    this.botTimer = setInterval(() => this.botTick(), BOT_TICK_MS);
  }

  private botTick() {
    if (this.public.status !== 'playing') return;
    const gs = this.public.gameState;
    if (!gs) return;
    const cur = gs.players[gs.currentPlayerIndex];
    const seat = this.public.members.find((m) => m.id === cur.id);
    if (!seat?.isBot) return;
    const difficulty = (cur.botDifficulty ?? 'easy') as 'easy' | 'smart';

    if (gs.phase === 'rolling' && !gs.diceRolled) {
      const r = applyRollDice(gs);
      if (r.ok) this.public.gameState = r.state;
    } else if (gs.phase === 'moving') {
      const move = pickBotMove(gs, difficulty);
      if (move != null) {
        const r = applyMoveToken(gs, move.tokenId, move.dieChoice);
        if (r.ok) this.public.gameState = r.state;
      }
    }
    this.checkFinished();
    this.broadcastPublic();
  }

  // ────────────────────────────────────────────────────────────────────
  // Projection / send helpers
  // ────────────────────────────────────────────────────────────────────

  private broadcastPublic() {
    this.public.canonicalPhase = projectCanonicalPhaseFromStatus(this.public);
    this.syncRoomDirectory();
    const evt: ServerEvent = { type: 'public_state', state: this.public };
    this.broadcast('event', evt);
  }

  private sendPublicTo(client: Client) {
    this.public.canonicalPhase = projectCanonicalPhaseFromStatus(this.public);
    const evt: ServerEvent = { type: 'public_state', state: this.public };
    client.send('event', evt);
  }

  private sendPrivateTo(client: Client, seatId: string) {
    const base = this.privateBySeat.get(seatId) ?? { seatId, hint: null };
    const priv: PrivateSeatState = { ...base, whotState: null };
    const evt: ServerEvent = { type: 'private_state', state: priv };
    client.send('event', evt);
  }

  private error(client: Client, code: string, message: string) {
    const att = this.attached.get(client.sessionId);
    log('warn', 'client_error', {
      room: this.public.code,
      code,
      message,
      role: att?.role ?? null,
      gameType: 'ludo',
    });
    const evt: ServerEvent = { type: 'error', code, message };
    client.send('event', evt);
  }

  setAIStatus(s: AIStatus) {
    this.public.aiStatus = s;
    this.broadcastPublic();
  }

  // ────────────────────────────────────────────────────────────────────

  private checkFinished() {
    if (this.public.gameState?.phase === 'finished') {
      this.public.status = 'finished';
      if (this.botTimer) {
        clearInterval(this.botTimer);
        this.botTimer = null;
      }
      this.persistFinishedMatchOnce();
    }
  }

  private persistFinishedMatchOnce() {
    const record = this.buildFinishedMatchRecord();
    if (!record) return;
    if (this.persistedMatchKeys.has(record.matchKey)) {
      log('info', 'persistence_duplicate_suppressed', { room: this.public.code, gameType: 'ludo' });
      return;
    }
    this.persistedMatchKeys.add(record.matchKey);
    log('info', 'game_finished', { room: this.public.code, gameType: 'ludo', players: record.playerDeviceIds.length });
    void persistFinishedMatch(record)
      .then((status) => log('info', 'persistence_result', { room: this.public.code, gameType: 'ludo', status }))
      .catch((err) => log('error', 'persistence_failed', { room: this.public.code, gameType: 'ludo', error: err?.message ?? String(err) }));
  }

  private buildFinishedMatchRecord() {
    const players = this.public.gameState?.players.map((p) => ({ id: p.id, displayName: p.displayName })) ?? [];
    const winnerDeviceId = this.public.gameState?.winner ?? null;
    if (players.length === 0) return null;
    const playerDeviceIds = players.map((p) => p.id);
    const playerNames = Object.fromEntries(players.map((p) => [p.id, p.displayName]));
    const matchKey = buildMatchKey({ roomCode: this.public.code, gameType: 'ludo', winnerDeviceId, playerDeviceIds });
    return {
      roomCode: this.public.code,
      gameType: 'ludo' as GameType,
      winnerDeviceId,
      playerDeviceIds,
      playerNames,
      turnCount: this.public.gameState?.turnNumber,
      durationMs: this.matchStartedAt ? Date.now() - this.matchStartedAt : undefined,
      matchKey,
      hostDisplayId: this.public.hostId || null,
      partyId: this.hostPartyId || this.public.hostId || null,
    };
  }

  private makeSeat(id: string, displayName: string): RoomMember {
    return {
      id,
      displayName,
      color: SEAT_COLORS[this.activeSeats().length % SEAT_COLORS.length],
      isReady: false,
      isHost: false,
    };
  }

  private activeSeats() {
    return this.public.members.filter((m) => !m.isSpectator);
  }

  private maxSeatsForCurrentGame() {
    const configured = this.public.roomSettings?.maxPlayers ?? this.public.maxPlayers;
    return clampNum(configured ?? LUDO_MAX_SEATS, 2, LUDO_MAX_SEATS);
  }

  private defaultRoomSettings(): RoomSettings {
    return {
      aiAssistance: true,
      maxPlayers: LUDO_MAX_SEATS,
      whotPenaltyStreaks: false,
      reactionBursts: true,
    };
  }

  private pauseGame(reason: 'host' | 'player_visibility' | 'player_request', requestedBy: string, message: string) {
    pauseGameIfPlaying(this.public, reason, requestedBy, message);
  }

  private syncRoomDirectory() {
    upsertRoom({
      code: this.public.code,
      gameType: 'ludo',
      status: this.public.status,
      roomPolicy: this.public.roomPolicy,
      players: this.activeSeats().length,
      maxPlayers: this.maxSeatsForCurrentGame(),
    });
  }

  private enqueueJoinRequest(deviceId: string, displayName: string) {
    if (!this.public.pendingJoinRequests.find((r) => r.deviceId === deviceId)) {
      const req: PendingJoinRequest = {
        id: uuid(),
        deviceId,
        displayName,
        requestedAt: Date.now(),
      };
      this.public.pendingJoinRequests.push(req);
    }
  }
}
