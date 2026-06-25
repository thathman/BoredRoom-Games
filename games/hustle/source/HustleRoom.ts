// HustleRoom — Naija snakes & ladders + Hustle cards.
// Server-authoritative. Mirrors EtttRoom / Connect4Room structure.

import { Client, Room } from '@colyseus/core';
import {
  DEFAULT_REACTION_POLICY,
  DEFAULT_TAUNT_POLICY,
  GameType,
  Intent,
  JoinAuth,
  PROTOCOL_VERSION,
  PendingJoinRequest,
  PrivateSeatState,
  PublicRoomState,
  RoomMember,
  ServerEvent,
} from '../../../shared/src/contracts/index.js';
import {
  DEFAULT_HUSTLE_SETTINGS,
  HustlePlayerState,
  HustlePublicState,
  HustleSettings,
  advanceTurn,
  applyRoll,
  claimJapa,
  createInitialHustleState,
  declineJapa,
  makeInitialPlayer,
  playCard,
  rollDie,
} from '../../../shared/src/games/hustle/engine.js';
import { createReactionStats } from '../../../shared/src/reactions/policy.js';
import { ReactionSubsystem } from './reactions.js';
import { hostTokenStore } from '../auth/hostTokens.js';
import { buildMatchKey, persistFinishedMatch } from '../matchPersistence.js';
import { log } from '../logger.js';
import { projectCanonicalPhaseFromStatus } from './_base.js';
import { removeRoom, upsertRoom } from '../roomDirectory.js';

const HUSTLE_MAX_SEATS = 4;
const SEAT_COLORS = ['emerald', 'amber', 'rose', 'sky'] as const;

interface AttachedClient {
  deviceId: string;
  role: 'host' | 'player';
  displayName: string;
}

export class HustleRoom extends Room {
  private public!: PublicRoomState;
  private privateBySeat = new Map<string, PrivateSeatState>();
  private attached = new Map<string, AttachedClient>();
  private sessionByDevice = new Map<string, string>();

  private reactions!: ReactionSubsystem;
  private hustle!: HustlePublicState;
  private settings: HustleSettings = { ...DEFAULT_HUSTLE_SETTINGS };
  private hostPartyId: string | null = null;
  private matchStartedAt = 0;
  private persistedMatchKeys = new Set<string>();

  override onCreate(options: { code?: string; gameType?: GameType; partyId?: string }) {
    const code = (options?.code ?? 'TEMP').toUpperCase();
    this.roomId = code;
    this.hostPartyId = typeof options?.partyId === 'string' && options.partyId.length > 0
      ? options.partyId
      : null;

    this.hustle = createInitialHustleState([], this.settings);

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
      maxPlayers: HUSTLE_MAX_SEATS,
      roomSettings: {
        aiAssistance: true,
        maxPlayers: HUSTLE_MAX_SEATS,
        whotPenaltyStreaks: false,
        reactionBursts: true,
      },
      gameType: 'hustle',
      whotState: null,
      triviaState: null,
      connect4State: null,
      etttState: null,
      hustleState: this.hustle,
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
    log('info', 'room_instance_created', { room: code, gameType: 'hustle' });
  }

  override async onAuth(_client: Client, options: JoinAuth) {
    if (!options || options.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error('protocol_mismatch');
    }
    if (!options.deviceId) throw new Error('deviceId_required');
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
    if (prevSession && prevSession !== client.sessionId) {
      this.clients.find((c) => c.sessionId === prevSession)?.leave(4000, 'replaced_by_new_session');
    }
    this.sessionByDevice.set(options.deviceId, client.sessionId);

    if (att.role === 'host') {
      this.public.hostId = att.deviceId;
      this.hostPartyId = options.partyId || this.hostPartyId;
    } else {
      this.handlePlayerArrival(att, client);
      this.markPresence(att.deviceId, { connected: true, hidden: false, pauseRequested: false });
    }

    this.broadcastPublic();
    this.sendPrivateTo(client, att.deviceId);
  }

  override onLeave(client: Client) {
    const att = this.attached.get(client.sessionId);
    this.attached.delete(client.sessionId);
    if (!att) return;
    if (this.sessionByDevice.get(att.deviceId) === client.sessionId) {
      this.sessionByDevice.delete(att.deviceId);
    }
    if (att.role === 'player') this.markPresence(att.deviceId, { connected: false });
  }

  override onDispose() {
    hostTokenStore.release(this.public.code);
    removeRoom(this.public.code);
  }

  private handlePlayerArrival(att: AttachedClient, client: Client) {
    const existing = this.public.members.find((m) => m.id === att.deviceId);
    if (existing) {
      existing.displayName = att.displayName;
      const p = this.hustle.players.find((x) => x.id === att.deviceId);
      if (p) p.displayName = att.displayName;
      return;
    }
    if (this.public.status !== 'lobby') {
      if (this.public.roomPolicy === 'locked') return this.error(client, 'room_locked', 'Room is locked');
      this.enqueueJoinRequest(att.deviceId, att.displayName);
      return this.error(client, 'pending_approval', 'Waiting for host approval');
    }
    if (this.public.roomPolicy === 'locked') return this.error(client, 'room_locked', 'Room is locked');
    if (this.public.roomPolicy === 'approval') {
      this.enqueueJoinRequest(att.deviceId, att.displayName);
      return this.error(client, 'pending_approval', 'Waiting for host approval');
    }
    if (this.public.members.length >= HUSTLE_MAX_SEATS) {
      return this.error(client, 'room_full', `Room is full (${HUSTLE_MAX_SEATS} players max)`);
    }
    this.public.members.push(this.makeSeat(att.deviceId, att.displayName));
    this.hustle.players.push(this.makeHustlePlayer(att.deviceId, att.displayName));
  }

  private handleIntent(client: Client, intent: Intent) {
    const att = this.attached.get(client.sessionId);
    if (!att) return;
    const isHost = att.role === 'host' && att.deviceId === this.public.hostId;

    if (intent.type === 'request_state') {
      this.sendPublicTo(client);
      this.sendPrivateTo(client, att.deviceId);
      return;
    }

    if (intent.type === 'send_reaction') {
      this.reactions.handleSendReaction(this.public, client.sessionId, att.deviceId, intent.emoji, intent.clientNonce);
      return;
    }

    if (intent.type === 'toggle_ready') {
      if (this.public.status !== 'lobby') return;
      const m = this.public.members.find((x) => x.id === att.deviceId);
      if (!m) return;
      m.isReady = !m.isReady;
      this.broadcastPublic();
      return;
    }

    if (intent.type === 'hustle:roll') {
      this.handleRoll(client, att.deviceId);
      return;
    }

    if (intent.type === 'hustle:play_card') {
      this.handlePlayCard(client, att.deviceId, intent.instanceId, intent.targetPlayerId ?? null);
      return;
    }

    if (intent.type === 'hustle:claim_japa') {
      this.handleClaimJapa(client, att.deviceId);
      return;
    }

    if (intent.type === 'hustle:decline_japa') {
      this.handleDeclineJapa(client, att.deviceId);
      return;
    }

    if (intent.type.startsWith('host:')) {
      if (!isHost) return this.error(client, 'forbidden', 'host_only');
      this.handleHostIntent(intent as Extract<Intent, { type: `host:${string}` }>);
      this.broadcastPublic();
      return;
    }
  }

  private handleHostIntent(intent: Extract<Intent, { type: `host:${string}` }>) {
    switch (intent.type) {
      case 'host:start_game': {
        if (this.public.status !== 'lobby') return;
        if (this.hustle.players.length < 2) return;
        this.public.status = 'playing';
        log('info', 'game_started', { room: this.public.code, gameType: 'hustle', players: this.hustle.players.length });
        this.matchStartedAt = Date.now();
        // Re-seed players with starting hands per current settings.
        const seated = this.hustle.players.map((p) =>
          makeInitialPlayer(p.id, p.displayName, p.color ?? 'emerald', this.settings.startingCards),
        );
        this.hustle = createInitialHustleState(seated, this.settings);
        this.hustle.phase = 'rolling';
        this.hustle.lastAction = 'Hustle is on. Roll the dice.';
        return;
      }
      case 'host:end_game': {
        this.public.status = 'finished';
        this.hustle.phase = 'finished';
        this.hustle.lastAction = 'Host ended the match.';
        this.persistFinishedMatchOnce();
        return;
      }
      case 'host:play_again': {
        this.hustle = createInitialHustleState(
          this.hustle.players.map((p) =>
            makeInitialPlayer(
              p.id,
              p.displayName,
              p.color ?? 'emerald',
              this.settings.startingCards,
              Math.random,
              this.settings.startingMoney,
              p.isBot,
            ),
          ),
          this.settings,
        );
        this.public.status = 'lobby';
        for (const m of this.public.members) m.isReady = false;
        return;
      }
      case 'host:kick': {
        const idx = this.public.members.findIndex((m) => m.id === intent.playerId);
        if (idx < 0) return;
        this.public.members.splice(idx, 1);
        this.hustle.players = this.hustle.players.filter((p) => p.id !== intent.playerId);
        return;
      }
      case 'host:set_room_policy': {
        this.public.roomPolicy = intent.policy;
        return;
      }
      case 'host:clear_reactions': {
        this.public.reactions = [];
        return;
      }
      case 'host:set_hustle_settings': {
        this.settings = { ...this.settings, ...intent.settings };
        if (this.public.status === 'lobby') {
          this.hustle = { ...this.hustle, settings: this.settings };
        }
        return;
      }
      default:
        return;
    }
  }

  private handleRoll(client: Client, deviceId: string) {
    if (this.public.status !== 'playing') return this.error(client, 'illegal', 'not_playing');
    if (this.hustle.phase === 'finished') return this.error(client, 'illegal', 'match_finished');
    const current = this.hustle.players[this.hustle.currentPlayerIndex];
    if (!current || current.id !== deviceId) {
      return this.error(client, 'illegal', 'not_your_turn');
    }
    if (this.hustle.lastDie != null) {
      // Already rolled this turn (without a side_hustle re-roll). Block dupes.
      return this.error(client, 'illegal', 'already_rolled');
    }
    const die = rollDie(Math.random);
    const result = applyRoll(this.hustle, die);
    this.hustle = result.state;
    this.broadcastPublic();
    if (result.isWin) {
      this.public.status = 'finished';
      this.persistFinishedMatchOnce();
      this.broadcastPublic();
      return;
    }
    // If we're now in japaPrompt, wait for the player's claim/decline intent.
    if (this.hustle.phase === 'japaPrompt') return;
    // Simple cadence: hold the banner, then advance to the next player.
    this.clock.setTimeout(() => {
      this.hustle = advanceTurn(this.hustle);
      this.broadcastPublic();
    }, this.settings.resolveHoldMs);
  }

  private handlePlayCard(
    client: Client,
    deviceId: string,
    instanceId: string,
    targetPlayerId: string | null,
  ) {
    if (this.public.status !== 'playing') return this.error(client, 'illegal', 'not_playing');
    const result = playCard(this.hustle, deviceId, instanceId, targetPlayerId);
    if (!result.ok) return this.error(client, 'illegal', result.rejection ?? 'card_rejected');
    this.hustle = result.state;
    this.broadcastPublic();
    if (result.shouldReroll) {
      // Side-hustle: clear lastDie so the player can roll again immediately.
      this.hustle = { ...this.hustle, lastDie: null };
      this.broadcastPublic();
    }
  }

  private handleClaimJapa(client: Client, deviceId: string) {
    if (this.public.status !== 'playing') return this.error(client, 'illegal', 'not_playing');
    if (this.hustle.phase !== 'japaPrompt') return this.error(client, 'illegal', 'wrong_phase');
    const current = this.hustle.players[this.hustle.currentPlayerIndex];
    if (!current || current.id !== deviceId) return this.error(client, 'illegal', 'not_your_turn');
    const result = claimJapa(this.hustle);
    if (!result.ok) return this.error(client, 'illegal', result.rejection ?? 'japa_rejected');
    this.hustle = result.state;
    this.public.status = 'finished';
    this.persistFinishedMatchOnce();
    this.broadcastPublic();
  }

  private handleDeclineJapa(client: Client, deviceId: string) {
    if (this.public.status !== 'playing') return this.error(client, 'illegal', 'not_playing');
    if (this.hustle.phase !== 'japaPrompt') return this.error(client, 'illegal', 'wrong_phase');
    const current = this.hustle.players[this.hustle.currentPlayerIndex];
    if (!current || current.id !== deviceId) return this.error(client, 'illegal', 'not_your_turn');
    this.hustle = declineJapa(this.hustle);
    this.broadcastPublic();
    // Hold banner briefly then advance turn.
    this.clock.setTimeout(() => {
      this.hustle = advanceTurn(this.hustle);
      this.broadcastPublic();
    }, this.settings.resolveHoldMs);
  }

  private broadcastPublic() {
    this.public.hustleState = this.hustle;
    this.public.canonicalPhase = projectCanonicalPhaseFromStatus(this.public);
    this.syncRoomDirectory();
    const evt: ServerEvent = { type: 'public_state', state: this.public };
    this.broadcast('event', evt);
  }

  private sendPublicTo(client: Client) {
    this.public.hustleState = this.hustle;
    this.public.canonicalPhase = projectCanonicalPhaseFromStatus(this.public);
    const evt: ServerEvent = { type: 'public_state', state: this.public };
    client.send('event', evt);
  }

  private sendPrivateTo(client: Client, seatId: string) {
    const base = this.privateBySeat.get(seatId) ?? { seatId };
    const priv: PrivateSeatState = { ...base };
    const evt: ServerEvent = { type: 'private_state', state: priv };
    client.send('event', evt);
  }

  private error(client: Client, code: string, message: string) {
    client.send('event', { type: 'error', code, message } satisfies ServerEvent);
  }

  private makeSeat(id: string, displayName: string): RoomMember {
    return {
      id,
      displayName,
      color: SEAT_COLORS[this.public.members.length % SEAT_COLORS.length],
      isReady: false,
      isHost: false,
    };
  }

  private makeHustlePlayer(id: string, displayName: string): HustlePlayerState {
    const seatIdx = this.hustle.players.length;
    return makeInitialPlayer(
      id,
      displayName,
      SEAT_COLORS[seatIdx % SEAT_COLORS.length],
      this.settings.startingCards,
    );
  }

  private markPresence(seatId: string, patch: Partial<{ connected: boolean; hidden: boolean; pauseRequested: boolean }>) {
    const now = Date.now();
    const current = this.public.presenceBySeat?.[seatId] ?? {
      connected: false,
      hidden: false,
      lastSeenAt: now,
      pauseRequested: false,
    };
    this.public.presenceBySeat = {
      ...(this.public.presenceBySeat ?? {}),
      [seatId]: { ...current, ...patch, lastSeenAt: now },
    };
  }

  private syncRoomDirectory() {
    upsertRoom({
      code: this.public.code,
      gameType: 'hustle',
      status: this.public.status,
      roomPolicy: this.public.roomPolicy,
      players: this.public.members.length,
      maxPlayers: HUSTLE_MAX_SEATS,
    });
  }

  private enqueueJoinRequest(deviceId: string, displayName: string) {
    if (!this.public.pendingJoinRequests.find((r) => r.deviceId === deviceId)) {
      const req: PendingJoinRequest = {
        id: this.uuid(),
        deviceId,
        displayName,
        requestedAt: Date.now(),
      };
      this.public.pendingJoinRequests.push(req);
    }
  }

  private uuid(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return (crypto as { randomUUID(): string }).randomUUID();
    }
    return `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }

  private persistFinishedMatchOnce() {
    const record = this.buildFinishedMatchRecord();
    if (!record) return;
    if (this.persistedMatchKeys.has(record.matchKey)) {
      log('info', 'persistence_duplicate_suppressed', { room: this.public.code, gameType: 'hustle' });
      return;
    }
    this.persistedMatchKeys.add(record.matchKey);
    log('info', 'game_finished', { room: this.public.code, gameType: 'hustle', players: record.playerDeviceIds.length });
    void persistFinishedMatch(record)
      .then((status) => log('info', 'persistence_result', { room: this.public.code, gameType: 'hustle', status }))
      .catch((err) => log('error', 'persistence_failed', { room: this.public.code, gameType: 'hustle', error: err?.message ?? String(err) }));
  }

  private buildFinishedMatchRecord() {
    const players = this.hustle.players.map((p) => ({ id: p.id, displayName: p.displayName }));
    const winnerDeviceId = this.hustle.winnerId ?? null;
    if (players.length === 0) return null;
    const playerDeviceIds = players.map((p) => p.id);
    const playerNames = Object.fromEntries(players.map((p) => [p.id, p.displayName]));
    const matchKey = buildMatchKey({ roomCode: this.public.code, gameType: 'hustle', winnerDeviceId, playerDeviceIds });
    return {
      roomCode: this.public.code,
      gameType: 'hustle' as GameType,
      winnerDeviceId,
      playerDeviceIds,
      playerNames,
      turnCount: this.hustle.turnNumber,
      durationMs: this.matchStartedAt ? Date.now() - this.matchStartedAt : undefined,
      matchKey,
      hostDisplayId: this.public.hostId || null,
      partyId: this.hostPartyId || this.public.hostId || null,
    };
  }
}
