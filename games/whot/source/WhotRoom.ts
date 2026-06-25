// WhotRoom — server-authoritative Colyseus room for Whot (Nigerian).
//
// Extracted from LudoRoom in the per-game-room refactor. Whot lived inside
// LudoRoom historically because both shared seat-management/bot-tick scaffolding;
// keeping them together meant every change to either game risked breaking the
// other. WhotRoom now owns the full Whot intent surface, deck management, and
// bot loop on its own.
//
// State machine: lobby -> playing -> finished.
// Authority rules (same as every other game room):
//   - Host is NEVER a playable seat. host appears in roomState.hostId only.
//   - Clients send Intents; server validates and projects state.
//   - Public state is broadcast room-wide. Private hands go ONLY to their seat.
//   - Bots run on a server-side setInterval driven by the rules adapter.

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
  WhotCard,
} from '../../../shared/src/contracts/index.js';
import { createReactionStats } from '../../../shared/src/reactions/policy.js';
import { createInitialWhotState } from '../../../shared/src/games/whot.js';
import {
  applyAnnounceSemiLastCard,
  applyAnnounceLastCard,
  applyCallSuit,
  applyDraw,
  applyPlay,
  pickWhotBotMove,
  validatePlay,
} from '../../../shared/src/games/whotEngine.js';
import { ReactionSubsystem } from './reactions.js';
import { hostTokenStore } from '../auth/hostTokens.js';
import { buildMatchKey, persistFinishedMatch } from '../matchPersistence.js';
import { log } from '../logger.js';
import { projectCanonicalPhaseFromStatus } from './_base.js';
import { removeRoom, upsertRoom } from '../roomDirectory.js';
import { clampNum, markPresence, sanitizeText, uuid, clearPauseRequests, clearPauseState, pauseGameIfPlaying } from './_shared.js';

const WHOT_MAX_SEATS = 8;
const BOT_TICK_MS = 900;
const WHOT_TURN_TIME_LIMIT_MS = 10_000;
const WHOT_TARGET_SCORE = 100;
const WHOT_SEAT_COLORS = ['red', 'green', 'yellow', 'blue', 'pink', 'cyan', 'orange', 'lime'] as const;

interface AttachedClient {
  deviceId: string;
  role: 'host' | 'player';
  displayName: string;
}

export class WhotRoom extends Room {
  private public!: PublicRoomState;
  private privateBySeat = new Map<string, PrivateSeatState>();
  private attached = new Map<string, AttachedClient>();
  private sessionByDevice = new Map<string, string>();

  private botTimer: NodeJS.Timeout | null = null;
  private reactions!: ReactionSubsystem;

  /** Hidden Whot deck state. Never broadcast. */
  private whotHands = new Map<string, WhotCard[]>();
  private whotDrawPile: WhotCard[] = [];
  private whotDiscardPile: WhotCard[] = [];
  private whotScoreBySeat: Record<string, number> = {};

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
      maxPlayers: WHOT_MAX_SEATS,
      roomSettings: {
        aiAssistance: true,
        maxPlayers: WHOT_MAX_SEATS,
        whotPenaltyStreaks: true,
        reactionBursts: true,
        whotDirectionOnPickTwo: false,
      },
      gameType: 'whot',
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
    log('info', 'room_instance_created', { room: code, gameType: 'whot' });
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
      this.clients.find((c) => c.sessionId === prevSession)?.leave(4000, 'replaced_by_new_session');
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
      gameType: 'whot',
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
    // Mid-game: locked blocks; otherwise queue for moderation.
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

      case 'whot:draw_card':
      case 'whot:play_card':
      case 'whot:call_suit':
      case 'whot:announce_last_card':
      case 'whot:announce_semi_last_card':
      case 'whot:check_up': {
        if (this.public.pauseState?.paused) return this.error(client, 'paused', 'game_paused');
        if (!this.public.whotState) {
          return this.error(client, 'illegal', 'whot_not_active');
        }
        if (this.public.whotState.phase !== 'playing') {
          return this.error(client, 'illegal', 'whot_phase_invalid');
        }
        if (this.public.whotState.currentPlayerId !== att.deviceId) {
          return this.error(client, 'forbidden', 'not_your_turn');
        }

        if (intent.type === 'whot:play_card') {
          if (!intent.cardId || typeof intent.cardId !== 'string') {
            return this.error(client, 'illegal', 'whot_invalid_card');
          }
          const hand = this.whotHands.get(att.deviceId) ?? [];
          const v = validatePlay(hand, intent.cardId, this.public.whotState, att.deviceId, intent.calledShape);
          if (!v.ok) return this.error(client, 'illegal', v.reason);
          const result = applyPlay(
            this.public.whotState,
            hand,
            intent.cardId,
            intent.calledShape,
            { reverseOnPickTwo: Boolean(this.public.roomSettings?.whotDirectionOnPickTwo) },
          );
          this.public.whotState = result.state;
          this.whotHands.set(att.deviceId, result.newHand);
          this.recordWhotDiscard(result.state.topDiscard);
          this.public.whotState.lastAction = result.narration;
          this.refreshWhotTurnDeadline();

          for (const d of result.draws) {
            this.drawCardsForSeat(d.seatId, d.count);
          }

          if (result.winnerId) this.handleWhotRoundWin(result.winnerId);
          this.broadcastPublic();
          this.broadcastWhotPrivates();
          return;
        }

        if (intent.type === 'whot:draw_card') {
          const result = applyDraw(this.public.whotState);
          this.public.whotState = result.state;
          this.drawCardsForSeat(att.deviceId, result.drawCount);
          for (const d of result.draws ?? []) this.drawCardsForSeat(d.seatId, d.count);
          this.public.whotState.lastAction = result.narration;
          this.refreshWhotTurnDeadline();
          this.broadcastPublic();
          this.broadcastWhotPrivates();
          return;
        }

        if (intent.type === 'whot:call_suit') {
          const result = applyCallSuit(this.public.whotState, intent.shape);
          if (!result.ok) return this.error(client, 'illegal', result.reason);
          this.public.whotState = result.state;
          this.public.whotState.lastAction = result.narration;
          this.refreshWhotTurnDeadline();
          this.broadcastPublic();
          return;
        }

        if (intent.type === 'whot:announce_last_card') {
          const hand = this.whotHands.get(att.deviceId) ?? [];
          const result = applyAnnounceLastCard(this.public.whotState, hand, att.deviceId);
          if (!result.ok) return this.error(client, 'illegal', result.reason);
          this.public.whotState = result.state;
          this.public.whotState.lastAction = result.narration;
          this.refreshWhotTurnDeadline();
          this.broadcastPublic();
          return;
        }

        if (intent.type === 'whot:announce_semi_last_card') {
          const hand = this.whotHands.get(att.deviceId) ?? [];
          const result = applyAnnounceSemiLastCard(this.public.whotState, hand, att.deviceId);
          if (!result.ok) return this.error(client, 'illegal', result.reason);
          this.public.whotState = result.state;
          this.public.whotState.lastAction = result.narration;
          this.refreshWhotTurnDeadline();
          this.broadcastPublic();
          return;
        }

        if (intent.type === 'whot:check_up') {
          const target = intent.targetSeatId;
          if (!target || target === att.deviceId) return this.error(client, 'illegal', 'whot_invalid_check_up_target');
          const targetHand = this.whotHands.get(target) ?? [];
          const isLastViolation = targetHand.length === 1 && !(this.public.whotState.lastCardAnnounced ?? []).includes(target);
          const isSemiViolation = targetHand.length === 2 && !(this.public.whotState.semiLastCardAnnounced ?? []).includes(target);
          if (!isLastViolation && !isSemiViolation) return this.error(client, 'illegal', 'whot_check_up_not_valid');
          this.drawCardsForSeat(target, 2);
          this.public.whotState.lastCardAnnounced = (this.public.whotState.lastCardAnnounced ?? []).filter((id) => id !== target);
          this.public.whotState.semiLastCardAnnounced = (this.public.whotState.semiLastCardAnnounced ?? []).filter((id) => id !== target);
          const who = this.public.whotState.players.find((p) => p.id === target)?.displayName ?? 'Player';
          this.public.whotState.lastAction = `${att.displayName} checked up ${who}; ${who} draws 2.`;
          this.refreshWhotTurnDeadline();
          this.broadcastPublic();
          this.broadcastWhotPrivates();
          return;
        }
        return;
      }
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
        log('info', 'game_started', { room: this.public.code, gameType: 'whot', players: activeSeats.length });
        const init = createInitialWhotState({
          players: activeSeats.map((m) => ({
            id: m.id,
            displayName: m.displayName,
            color: m.color,
            isBot: m.isBot,
          })),
        });
        this.public.whotState = {
          ...init.publicState,
          turnDirection: 1,
          turnDeadlineAt: Date.now() + WHOT_TURN_TIME_LIMIT_MS,
          turnTimeLimitMs: WHOT_TURN_TIME_LIMIT_MS,
          pendingDrawCount: 0,
          pendingDrawRank: null,
          mustCallSuit: false,
          lastCardAnnounced: [],
          semiLastCardAnnounced: [],
          matchScoreBySeat: this.whotScoreBySeat,
          targetScore: WHOT_TARGET_SCORE,
          roundIndex: 1,
          penaltyContinuation: null,
        };
        this.public.gameState = null;
        this.whotHands = new Map(Object.entries(init.privateHands));
        this.whotDrawPile = init.drawPile;
        this.whotDiscardPile = init.publicState.topDiscard ? [init.publicState.topDiscard] : [];
        this.whotScoreBySeat = Object.fromEntries(activeSeats.map((m) => [m.id, 0]));
        this.public.whotState.matchScoreBySeat = { ...this.whotScoreBySeat };

        for (const c of this.clients) {
          const att = this.attached.get(c.sessionId);
          if (!att) continue;
          this.sendPrivateTo(c, att.deviceId);
        }
        this.startBotLoop();
        return;
      }

      case 'host:play_again': {
        if (this.public.status !== 'finished') return;
        this.public.status = 'lobby';
        this.public.gameState = null;
        this.public.whotState = null;
        this.whotHands.clear();
        this.whotDrawPile = [];
        this.whotDiscardPile = [];
        this.whotScoreBySeat = {};
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
        this.refreshWhotTurnDeadline();
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
        if (this.public.whotState) {
          this.public.whotState.phase = 'finished';
          this.public.whotState.lastAction = this.public.pauseState.message ?? 'Host ended the game';
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
          // Whot mid-game id transfer: update the public Whot players list too.
          if (this.public.whotState) {
            const p = this.public.whotState.players.find((p) => p.id === seat.id);
            if (p) p.id = req.deviceId;
            if (this.public.whotState.currentPlayerId === seat.id) {
              this.public.whotState.currentPlayerId = req.deviceId;
            }
          }
          // Move the hidden hand too.
          const hand = this.whotHands.get(seat.id);
          if (hand) {
            this.whotHands.delete(seat.id);
            this.whotHands.set(req.deviceId, hand);
          }
          seat.id = req.deviceId;
          seat.displayName = req.displayName;
          seat.isBot = false;
        } else if (intent.mode === 'spawn') {
          if (this.activeSeats().length >= this.maxSeatsForCurrentGame()) return;
          const seat = this.makeSeat(req.deviceId, req.displayName);
          this.public.members.push(seat);
          // Spawning a player into a live Whot match isn't gracefully handled
          // by the engine (deck was dealt at start); they sit at the table but
          // won't receive cards until the next round. Documented limitation.
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
          color: WHOT_SEAT_COLORS[this.activeSeats().length % WHOT_SEAT_COLORS.length],
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
        if (this.public.whotState) {
          const p = this.public.whotState.players.find((p) => p.id === seat.id);
          if (p) {
            p.id = intent.humanDeviceId;
            p.isBot = false;
          }
          if (this.public.whotState.currentPlayerId === seat.id) {
            this.public.whotState.currentPlayerId = intent.humanDeviceId;
          }
        }
        const hand = this.whotHands.get(seat.id);
        if (hand) {
          this.whotHands.delete(seat.id);
          this.whotHands.set(intent.humanDeviceId, hand);
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
            color: WHOT_SEAT_COLORS[this.activeSeats().length % WHOT_SEAT_COLORS.length],
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
        next.maxPlayers = clampNum(next.maxPlayers, minPlayers, WHOT_MAX_SEATS);
        this.public.roomSettings = next;
        this.public.maxPlayers = next.maxPlayers;
        return;
      }

      case 'host:broadcast_commentary': {
        const line = sanitizeText(intent.line, 280);
        if (!line) return;
        log('info', 'ai_commentary_broadcast', { room: this.public.code, gameType: 'whot' });
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
        log('info', 'ai_recap_broadcast', { room: this.public.code, gameType: 'whot' });
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
    if (!this.public.whotState) return;
    this.enforceWhotTurnTimeout();
    const ws = this.public.whotState;
    if (ws.phase !== 'playing') return;
    const cur = ws.players[ws.currentPlayerIndex];
    const seat = this.public.members.find((m) => m.id === cur.id);
    if (!seat?.isBot) return;
    const hand = this.whotHands.get(cur.id) ?? [];
    const move = pickWhotBotMove(hand, ws);
    if (move.kind === 'play') {
      const v = validatePlay(hand, move.cardId, ws, cur.id, move.calledShape);
      if (!v.ok) return;
      const result = applyPlay(
        ws,
        hand,
        move.cardId,
        move.calledShape,
        { reverseOnPickTwo: Boolean(this.public.roomSettings?.whotDirectionOnPickTwo) },
      );
      this.public.whotState = result.state;
      this.whotHands.set(cur.id, result.newHand);
      this.recordWhotDiscard(result.state.topDiscard);
      this.public.whotState.lastAction = result.narration;
      this.refreshWhotTurnDeadline();
      for (const d of result.draws) this.drawCardsForSeat(d.seatId, d.count);
      if (result.winnerId) this.handleWhotRoundWin(result.winnerId);
    } else if (move.kind === 'draw') {
      const result = applyDraw(ws);
      this.public.whotState = result.state;
      this.drawCardsForSeat(cur.id, result.drawCount);
      for (const d of result.draws ?? []) this.drawCardsForSeat(d.seatId, d.count);
      this.public.whotState.lastAction = result.narration;
      this.refreshWhotTurnDeadline();
    } else if (move.kind === 'call_suit') {
      const result = applyCallSuit(ws, move.shape);
      if (result.ok) {
        this.public.whotState = result.state;
        this.public.whotState.lastAction = result.narration;
        this.refreshWhotTurnDeadline();
      }
    } else if (move.kind === 'announce_last_card') {
      const result = applyAnnounceLastCard(ws, hand, cur.id);
      if (result.ok) {
        this.public.whotState = result.state;
        this.public.whotState.lastAction = result.narration;
        this.refreshWhotTurnDeadline();
      }
    } else if (move.kind === 'announce_semi_last_card') {
      const result = applyAnnounceSemiLastCard(ws, hand, cur.id);
      if (result.ok) {
        this.public.whotState = result.state;
        this.public.whotState.lastAction = result.narration;
        this.refreshWhotTurnDeadline();
      }
    }
    this.broadcastPublic();
    this.broadcastWhotPrivates();
  }

  // ────────────────────────────────────────────────────────────────────
  // Whot deck helpers
  // ────────────────────────────────────────────────────────────────────

  /** Draw N cards for a seat from the draw pile, refilling from a shuffled
   *  discard if the pile runs dry. Updates the public hand count + private hand. */
  private drawCardsForSeat(seatId: string, count: number) {
    if (count <= 0) return;
    const hand = this.whotHands.get(seatId) ?? [];
    for (let i = 0; i < count; i++) {
      if (this.whotDrawPile.length === 0) this.recycleWhotDiscardIntoDrawPile();
      if (this.whotDrawPile.length === 0) break;
      const card = this.whotDrawPile.shift()!;
      hand.push(card);
    }
    this.whotHands.set(seatId, hand);
    if (this.public.whotState) {
      this.public.whotState.drawPileCount = this.whotDrawPile.length;
      const p = this.public.whotState.players.find((x) => x.id === seatId);
      if (p) p.handCount = hand.length;
    }
  }

  private recordWhotDiscard(card: WhotCard | null) {
    if (!card) return;
    const last = this.whotDiscardPile[this.whotDiscardPile.length - 1];
    if (last?.id === card.id) return;
    this.whotDiscardPile.push(card);
  }

  private recycleWhotDiscardIntoDrawPile() {
    if (this.whotDiscardPile.length <= 1) return;
    const currentTop = this.whotDiscardPile[this.whotDiscardPile.length - 1];
    const recyclable = this.whotDiscardPile.slice(0, -1);
    this.shuffleWhotCardsInPlace(recyclable);
    this.whotDrawPile.push(...recyclable);
    this.whotDiscardPile = [currentTop];
    if (this.public.whotState) {
      this.public.whotState.drawPileCount = this.whotDrawPile.length;
    }
  }

  private shuffleWhotCardsInPlace(cards: WhotCard[]) {
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
  }

  private broadcastWhotPrivates() {
    for (const c of this.clients) {
      const att = this.attached.get(c.sessionId);
      if (!att) continue;
      this.sendPrivateTo(c, att.deviceId);
    }
  }

  private handleWhotRoundWin(winnerId: string) {
    const ws = this.public.whotState;
    if (!ws) return;
    const roundScore = this.computeRoundPenaltyPoints(winnerId);
    this.whotScoreBySeat[winnerId] = (this.whotScoreBySeat[winnerId] ?? 0) + roundScore;
    ws.matchScoreBySeat = { ...this.whotScoreBySeat };
    ws.winnerId = winnerId;
    ws.phase = 'finished';
    ws.lastAction = `${this.nameOf(winnerId)} won round ${ws.roundIndex ?? 1} (+${roundScore} points).`;

    if ((this.whotScoreBySeat[winnerId] ?? 0) >= (ws.targetScore ?? WHOT_TARGET_SCORE)) {
      this.public.status = 'finished';
      if (this.botTimer) { clearInterval(this.botTimer); this.botTimer = null; }
      this.persistFinishedMatchOnce();
      return;
    }

    this.startNextWhotRound();
  }

  private startNextWhotRound() {
    const seats = this.activeSeats();
    const prev = this.public.whotState;
    if (!prev || seats.length < 2) return;
    const init = createInitialWhotState({
      players: seats.map((m) => ({
        id: m.id,
        displayName: m.displayName,
        color: m.color,
        isBot: m.isBot,
      })),
    });
    this.public.whotState = {
      ...init.publicState,
      turnDirection: prev.turnDirection ?? 1,
      turnDeadlineAt: Date.now() + WHOT_TURN_TIME_LIMIT_MS,
      turnTimeLimitMs: WHOT_TURN_TIME_LIMIT_MS,
      pendingDrawCount: 0,
      pendingDrawRank: null,
      mustCallSuit: false,
      lastCardAnnounced: [],
      semiLastCardAnnounced: [],
      matchScoreBySeat: { ...this.whotScoreBySeat },
      targetScore: prev.targetScore ?? WHOT_TARGET_SCORE,
      roundIndex: (prev.roundIndex ?? 1) + 1,
      penaltyContinuation: null,
      lastAction: `Round ${(prev.roundIndex ?? 1) + 1} started.`,
    };
    this.whotHands = new Map(Object.entries(init.privateHands));
    this.whotDrawPile = init.drawPile;
    this.whotDiscardPile = init.publicState.topDiscard ? [init.publicState.topDiscard] : [];
  }

  private computeRoundPenaltyPoints(winnerId: string): number {
    let total = 0;
    for (const [seatId, hand] of this.whotHands.entries()) {
      if (seatId === winnerId) continue;
      for (const c of hand) total += this.cardPenaltyValue(c);
    }
    return total;
  }

  private cardPenaltyValue(card: WhotCard): number {
    if (card.isWhot) return 20;
    if (card.shape === 'star') return card.value * 2;
    return card.value;
  }

  private nameOf(seatId: string): string {
    return this.public.whotState?.players.find((p) => p.id === seatId)?.displayName ?? 'Player';
  }

  /** Nigerian timing rule: if a player exceeds 10 seconds, they draw and lose turn. */
  private enforceWhotTurnTimeout() {
    const ws = this.public.whotState;
    if (!ws || ws.phase !== 'playing') return;
    if (this.public.pauseState?.paused) return;
    const deadline = ws.turnDeadlineAt ?? 0;
    if (deadline <= 0 || Date.now() < deadline) return;

    const current = ws.players[ws.currentPlayerIndex];
    if (!current) return;
    const seat = this.public.members.find((m) => m.id === current.id);
    if (seat?.isBot) return;

    const result = applyDraw(ws);
    this.public.whotState = result.state;
    this.drawCardsForSeat(current.id, result.drawCount);
    for (const d of result.draws ?? []) this.drawCardsForSeat(d.seatId, d.count);
    this.public.whotState.lastAction = `${current.displayName} timed out (10s) and drew from market.`;
    this.refreshWhotTurnDeadline();
    this.broadcastPublic();
    this.broadcastWhotPrivates();
  }

  private refreshWhotTurnDeadline() {
    if (!this.public.whotState || this.public.whotState.phase !== 'playing') return;
    this.public.whotState.turnTimeLimitMs = WHOT_TURN_TIME_LIMIT_MS;
    this.public.whotState.turnDeadlineAt = Date.now() + WHOT_TURN_TIME_LIMIT_MS;
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
    const whotHand = this.whotHands.get(seatId);
    const priv: PrivateSeatState = {
      ...base,
      whotState: whotHand ? { hand: whotHand } : null,
    };
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
      gameType: 'whot',
    });
    const evt: ServerEvent = { type: 'error', code, message };
    client.send('event', evt);
  }

  setAIStatus(s: AIStatus) {
    this.public.aiStatus = s;
    this.broadcastPublic();
  }

  // ────────────────────────────────────────────────────────────────────
  // Match persistence + small helpers
  // ────────────────────────────────────────────────────────────────────

  private persistFinishedMatchOnce() {
    const record = this.buildFinishedMatchRecord();
    if (!record) return;
    if (this.persistedMatchKeys.has(record.matchKey)) {
      log('info', 'persistence_duplicate_suppressed', { room: this.public.code, gameType: 'whot' });
      return;
    }
    this.persistedMatchKeys.add(record.matchKey);
    log('info', 'game_finished', { room: this.public.code, gameType: 'whot', players: record.playerDeviceIds.length });
    void persistFinishedMatch(record)
      .then((status) => log('info', 'persistence_result', { room: this.public.code, gameType: 'whot', status }))
      .catch((err) => log('error', 'persistence_failed', { room: this.public.code, gameType: 'whot', error: err?.message ?? String(err) }));
  }

  private buildFinishedMatchRecord() {
    const players = this.public.whotState?.players.map((p) => ({ id: p.id, displayName: p.displayName })) ?? [];
    const winnerDeviceId = this.public.whotState?.winnerId ?? null;
    if (players.length === 0) return null;
    const playerDeviceIds = players.map((p) => p.id);
    const playerNames = Object.fromEntries(players.map((p) => [p.id, p.displayName]));
    const matchKey = buildMatchKey({ roomCode: this.public.code, gameType: 'whot', winnerDeviceId, playerDeviceIds });
    return {
      roomCode: this.public.code,
      gameType: 'whot' as GameType,
      winnerDeviceId,
      playerDeviceIds,
      playerNames,
      turnCount: this.public.whotState?.turnNumber,
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
      color: WHOT_SEAT_COLORS[this.activeSeats().length % WHOT_SEAT_COLORS.length],
      isReady: false,
      isHost: false,
    };
  }

  private activeSeats() {
    return this.public.members.filter((m) => !m.isSpectator);
  }

  private maxSeatsForCurrentGame() {
    const configured = this.public.roomSettings?.maxPlayers ?? this.public.maxPlayers;
    return clampNum(configured ?? WHOT_MAX_SEATS, 2, WHOT_MAX_SEATS);
  }

  private defaultRoomSettings(): RoomSettings {
    return {
      aiAssistance: true,
      maxPlayers: WHOT_MAX_SEATS,
      whotPenaltyStreaks: true,
      reactionBursts: true,
      whotDirectionOnPickTwo: false,
    };
  }

  private pauseGame(reason: 'host' | 'player_visibility' | 'player_request', requestedBy: string, message: string) {
    pauseGameIfPlaying(this.public, reason, requestedBy, message);
  }

  private syncRoomDirectory() {
    upsertRoom({
      code: this.public.code,
      gameType: 'whot',
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
