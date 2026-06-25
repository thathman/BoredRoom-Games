// Connect4Room — server-authoritative 2-player party-game room.
//
// Mirrors TriviaRoom/LudoRoom for: auth (host token), join policy, presence,
// reactions, host moderation. Game-specific surface is just the connect4:drop
// intent and the Connect4PublicState in the room snapshot.

import { Client, Room } from '@colyseus/core';
import {
  Connect4Disc,
  Connect4Player,
  Connect4PublicState,
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
  applyConnect4Drop,
  createInitialConnect4State,
} from '../../../shared/src/games/connect4/engine.js';
import { createReactionStats } from '../../../shared/src/reactions/policy.js';
import { ReactionSubsystem } from './reactions.js';
import { hostTokenStore } from '../auth/hostTokens.js';
import { buildMatchKey, persistFinishedMatch } from '../matchPersistence.js';
import { log } from '../logger.js';
import { projectCanonicalPhaseFromStatus, setCanonicalPhase } from './_base.js';
import { removeRoom, upsertRoom } from '../roomDirectory.js';

// Tag-team Connect 4 — 2v2. Up to 4 seats; 1v1 still works as a degenerate case.
const CONNECT4_MAX_SEATS = 4;
// Seat colour palette per join slot (visual only — disc colour is team-driven).
const SEAT_COLORS = ['red', 'yellow', 'red', 'yellow'] as const;
// Even seat indexes → Team A (red), odd → Team B (yellow). Join order interleaves
// the teams so default turn rotation (P0 → P1 → P2 → P3) becomes A→B→A→B.
const TEAM_BY_SEAT: Array<'A' | 'B'> = ['A', 'B', 'A', 'B'];
const DISC_BY_SEAT: Connect4Disc[] = ['red', 'yellow', 'red', 'yellow'];

interface AttachedClient {
  deviceId: string;
  role: 'host' | 'player';
  displayName: string;
}

export class Connect4Room extends Room {
  private public!: PublicRoomState;
  private privateBySeat = new Map<string, PrivateSeatState>();
  private attached = new Map<string, AttachedClient>();
  private sessionByDevice = new Map<string, string>();

  private reactions!: ReactionSubsystem;

  private connect4!: Connect4PublicState;
  private hostPartyId: string | null = null;
  private matchStartedAt = 0;
  private persistedMatchKeys = new Set<string>();

  override onCreate(options: { code?: string; gameType?: GameType; partyId?: string }) {
    const code = (options?.code ?? 'TEMP').toUpperCase();
    this.roomId = code;
    this.hostPartyId = typeof options?.partyId === 'string' && options.partyId.length > 0
      ? options.partyId
      : null;

    this.connect4 = createInitialConnect4State([]);

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
      maxPlayers: CONNECT4_MAX_SEATS,
      roomSettings: {
        aiAssistance: true,
        maxPlayers: CONNECT4_MAX_SEATS,
        whotPenaltyStreaks: false,
        reactionBursts: true,
      },
      gameType: 'connect-4',
      whotState: null,
      triviaState: null,
      connect4State: this.connect4,
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
    log('info', 'room_instance_created', { room: code, gameType: 'connect-4' });
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

  // ── player arrival ────────────────────────────────────────────────────
  private handlePlayerArrival(att: AttachedClient, client: Client) {
    const existing = this.public.members.find((m) => m.id === att.deviceId);
    if (existing) {
      existing.displayName = att.displayName;
      this.syncConnect4PlayerName(att.deviceId, att.displayName);
      return;
    }
    if (this.public.status !== 'lobby') {
      if (this.public.roomPolicy === 'locked') {
        this.error(client, 'room_locked', 'Room is locked');
        return;
      }
      this.enqueueJoinRequest(att.deviceId, att.displayName);
      this.error(client, 'pending_approval', 'Waiting for host approval');
      return;
    }
    if (this.public.roomPolicy === 'locked') {
      this.error(client, 'room_locked', 'Room is locked');
      return;
    }
    if (this.public.roomPolicy === 'approval') {
      this.enqueueJoinRequest(att.deviceId, att.displayName);
      this.error(client, 'pending_approval', 'Waiting for host approval');
      return;
    }
    if (this.public.members.length >= CONNECT4_MAX_SEATS) {
      this.error(client, 'room_full', 'Room is full (4 players max — 2v2 tag team)');
      return;
    }
    this.public.members.push(this.makeSeat(att.deviceId, att.displayName));
    this.connect4.players.push(this.makeConnect4Player(att.deviceId, att.displayName));
  }

  // ── intent dispatch ───────────────────────────────────────────────────
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

    if (intent.type === 'connect4:drop') {
      this.handleDrop(client, att.deviceId, intent.column);
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
        if (this.connect4.players.length < 2) return;
        this.public.status = 'playing';
        log('info', 'game_started', { room: this.public.code, gameType: 'connect-4', players: this.connect4.players.length });
        this.matchStartedAt = Date.now();
        // Auto-balance teams across the seated players. Even seat → A, odd → B.
        // This keeps the default rotation A→B→A→B and works for 2/3/4 players.
        const balanced = this.connect4.players.map((p, idx) => ({
          ...p,
          team: TEAM_BY_SEAT[idx % TEAM_BY_SEAT.length],
          disc: DISC_BY_SEAT[idx % DISC_BY_SEAT.length],
        }));
        this.connect4 = createInitialConnect4State(balanced);
        return;
      }
      case 'host:end_game': {
        this.public.status = 'finished';
        this.connect4.phase = 'finished';
        this.connect4.lastAction = 'Host ended the match.';
        this.persistFinishedMatchOnce();
        return;
      }
      case 'host:play_again': {
        this.connect4 = createInitialConnect4State(this.connect4.players.map((p) => ({ ...p })));
        this.public.status = 'lobby';
        for (const m of this.public.members) m.isReady = false;
        return;
      }
      case 'host:kick': {
        const idx = this.public.members.findIndex((m) => m.id === intent.playerId);
        if (idx < 0) return;
        this.public.members.splice(idx, 1);
        this.connect4.players = this.connect4.players.filter((p) => p.id !== intent.playerId);
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
      default:
        return;
    }
  }

  private handleDrop(client: Client, deviceId: string, column: number) {
    if (this.public.status !== 'playing') {
      return this.error(client, 'illegal', 'not_playing');
    }
    const result = applyConnect4Drop(this.connect4, deviceId, column);
    if (!result.ok) {
      return this.error(client, 'illegal', result.reason);
    }
    this.connect4 = result.state;
    if (this.connect4.phase === 'finished') {
      this.public.status = 'finished';
      this.persistFinishedMatchOnce();
    }
    this.broadcastPublic();
  }

  // ── projection helpers ───────────────────────────────────────────────
  private broadcastPublic() {
    this.public.connect4State = this.connect4;
    this.public.canonicalPhase = projectCanonicalPhaseFromStatus(this.public);
    this.syncRoomDirectory();
    const evt: ServerEvent = { type: 'public_state', state: this.public };
    this.broadcast('event', evt);
  }

  private sendPublicTo(client: Client) {
    this.public.connect4State = this.connect4;
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

  // ── small helpers ────────────────────────────────────────────────────
  private makeSeat(id: string, displayName: string): RoomMember {
    return {
      id,
      displayName,
      color: SEAT_COLORS[this.public.members.length % SEAT_COLORS.length],
      isReady: false,
      isHost: false,
    };
  }

  private makeConnect4Player(id: string, displayName: string): Connect4Player {
    const seatIdx = this.connect4.players.length;
    return {
      id,
      displayName,
      disc: DISC_BY_SEAT[seatIdx % DISC_BY_SEAT.length],
      team: TEAM_BY_SEAT[seatIdx % TEAM_BY_SEAT.length],
      color: SEAT_COLORS[seatIdx % SEAT_COLORS.length],
    };
  }

  private syncConnect4PlayerName(id: string, displayName: string) {
    const p = this.connect4.players.find((x) => x.id === id);
    if (p) p.displayName = displayName;
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
      gameType: 'connect-4',
      status: this.public.status,
      roomPolicy: this.public.roomPolicy,
      players: this.public.members.length,
      maxPlayers: CONNECT4_MAX_SEATS,
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
      log('info', 'persistence_duplicate_suppressed', { room: this.public.code, gameType: 'connect-4' });
      return;
    }
    this.persistedMatchKeys.add(record.matchKey);
    log('info', 'game_finished', { room: this.public.code, gameType: 'connect-4', players: record.playerDeviceIds.length });
    void persistFinishedMatch(record)
      .then((status) => log('info', 'persistence_result', { room: this.public.code, gameType: 'connect-4', status }))
      .catch((err) => log('error', 'persistence_failed', { room: this.public.code, gameType: 'connect-4', error: err?.message ?? String(err) }));
  }

  private buildFinishedMatchRecord() {
    const players = this.connect4.players.map((p) => ({ id: p.id, displayName: p.displayName }));
    const winnerDeviceId = this.connect4.winnerId ?? null;
    if (players.length === 0) return null;
    const playerDeviceIds = players.map((p) => p.id);
    const playerNames = Object.fromEntries(players.map((p) => [p.id, p.displayName]));
    const matchKey = buildMatchKey({ roomCode: this.public.code, gameType: 'connect-4', winnerDeviceId, playerDeviceIds });
    return {
      roomCode: this.public.code,
      gameType: 'connect-4' as GameType,
      winnerDeviceId,
      playerDeviceIds,
      playerNames,
      turnCount: this.connect4.turnNumber,
      durationMs: this.matchStartedAt ? Date.now() - this.matchStartedAt : undefined,
      matchKey,
      hostDisplayId: this.public.hostId || null,
      partyId: this.hostPartyId || this.public.hostId || null,
    };
  }
}
