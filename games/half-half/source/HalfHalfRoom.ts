// HalfHalfRoom — server-authoritative Half & Half room.
//
// Phase loop: lobby → intro → reveal_object → lock_in → reveal_truth → next | finished
// Players submit a normalized 0..1 cut position; server scores after lock_in window
// (or when all players have locked in early).

import { Client, Room } from '@colyseus/core';
import {
  DEFAULT_HALFHALF_SETTINGS,
  DEFAULT_REACTION_POLICY,
  DEFAULT_TAUNT_POLICY,
  GameType,
  Intent,
  JoinAuth,
  PROTOCOL_VERSION,
  PrivateSeatState,
  PendingJoinRequest,
  PublicRoomState,
  RoomMember,
  ServerEvent,
} from '../../../shared/src/contracts/index.js';
import {
  HALFHALF_OBJECTS,
  HalfHalfObject,
} from '../../../shared/src/games/halfhalf/objects.js';
import {
  HalfHalfPlayerGuess,
  HalfHalfPlayerState,
  HalfHalfPublicState,
  HalfHalfSettings,
  createInitialHalfHalfState,
  resolveHalfHalfRound,
  sanitizePosition,
  toPublicObject,
} from '../../../shared/src/games/halfhalf/engine.js';
import { createReactionStats } from '../../../shared/src/reactions/policy.js';
import { ReactionSubsystem } from './reactions.js';
import { hostTokenStore } from '../auth/hostTokens.js';
import { buildMatchKey, persistFinishedMatch } from '../matchPersistence.js';
import { log } from '../logger.js';
import { setCanonicalPhase } from './_base.js';
import { removeRoom, upsertRoom } from '../roomDirectory.js';
import { clearPauseRequests, clearPauseState, markPresence, uuid } from './_shared.js';

const HALFHALF_MAX_SEATS = 8;
const SEAT_COLORS = ['red', 'green', 'yellow', 'blue', 'pink', 'cyan', 'orange', 'lime'] as const;

interface AttachedClient {
  deviceId: string;
  role: 'host' | 'player';
  effectiveRole: 'host' | 'player' | 'crowd';
  displayName: string;
}

export class HalfHalfRoom extends Room {
  private public!: PublicRoomState;
  private privateBySeat = new Map<string, PrivateSeatState>();
  private attached = new Map<string, AttachedClient>();
  private sessionByDevice = new Map<string, string>();

  private reactions!: ReactionSubsystem;

  private hh!: HalfHalfPublicState;
  private objectPlan: HalfHalfObject[] = [];
  private servedIndex = 0;
  private currentObject: HalfHalfObject | null = null;
  private guesses = new Map<string, HalfHalfPlayerGuess>();
  private phaseTimer: NodeJS.Timeout | null = null;
  private rngSeed = 0;
  private hostPartyId: string | null = null;
  private matchStartedAt = 0;
  private persistedMatchKeys = new Set<string>();

  override onCreate(options: { code?: string; gameType?: GameType; partyId?: string }) {
    const code = (options?.code ?? 'TEMP').toUpperCase();
    this.roomId = code;
    this.hostPartyId = typeof options?.partyId === 'string' && options.partyId.length > 0 ? options.partyId : null;
    this.rngSeed = Math.floor(Math.random() * 0xffffffff);

    this.hh = createInitialHalfHalfState([], { ...DEFAULT_HALFHALF_SETTINGS });

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
      maxPlayers: HALFHALF_MAX_SEATS,
      roomSettings: {
        aiAssistance: true,
        maxPlayers: HALFHALF_MAX_SEATS,
        whotPenaltyStreaks: false,
        reactionBursts: true,
      },
      gameType: 'half-half',
      halfHalfState: this.hh,
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
    log('info', 'room_instance_created', { room: code, gameType: 'half-half' });
  }

  override async onAuth(_client: Client, options: JoinAuth) {
    if (!options || options.protocolVersion !== PROTOCOL_VERSION) throw new Error('protocol_mismatch');
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
      effectiveRole: options.role === 'host' ? 'host' : 'player',
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
      markPresence(this.public, att.deviceId, { connected: true, hidden: false, pauseRequested: false });
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
    if (att.role === 'player') markPresence(this.public, att.deviceId, { connected: false });
  }

  override onDispose() {
    if (this.phaseTimer) clearTimeout(this.phaseTimer);
    hostTokenStore.release(this.public.code);
    removeRoom(this.public.code);
  }

  // ── arrival ───────────────────────────────────────────────────────────
  private handlePlayerArrival(att: AttachedClient, client: Client) {
    const existing = this.public.members.find((m) => m.id === att.deviceId);
    if (existing) {
      existing.displayName = att.displayName;
      this.syncPlayerName(att.deviceId, att.displayName);
      att.effectiveRole = (existing.role ?? (existing.isSpectator ? 'crowd' : 'player')) as
        | 'host'
        | 'player'
        | 'crowd';
      return;
    }
    if (this.public.roomPolicy === 'locked') {
      this.error(client, 'room_locked', 'Room is locked');
      return;
    }
    if (this.public.roomPolicy === 'approval' && this.public.status === 'lobby') {
      this.enqueueJoinRequest(att.deviceId, att.displayName);
      this.error(client, 'pending_approval', 'Waiting for host approval');
      return;
    }

    const playerSeats = this.public.members.filter((m) => (m.role ?? 'player') === 'player').length;
    const seatsFull = playerSeats >= HALFHALF_MAX_SEATS;
    const midGame = this.public.status !== 'lobby';

    if (seatsFull || midGame) {
      this.public.members.push(this.makeSeat(att.deviceId, att.displayName, 'crowd'));
      att.effectiveRole = 'crowd';
      return;
    }

    this.public.members.push(this.makeSeat(att.deviceId, att.displayName, 'player'));
    this.hh.players.push(this.makeHalfHalfPlayer(att.deviceId, att.displayName));
    att.effectiveRole = 'player';
  }

  // ── intents ───────────────────────────────────────────────────────────
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
    if (intent.type === 'halfhalf:lock_guess') {
      if (att.effectiveRole === 'crowd') return this.error(client, 'forbidden', 'crowd_cannot_play');
      this.handleLockGuess(client, att.deviceId, intent.position);
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
        if (this.hh.players.length < 1) return;
        this.public.status = 'playing';
        log('info', 'game_started', { room: this.public.code, gameType: 'half-half', players: this.hh.players.length });
        clearPauseState(this.public);
        clearPauseRequests(this.public);
        this.matchStartedAt = Date.now();
        this.beginMatch();
        return;
      }
      case 'host:end_game':
        this.endMatchEarly();
        return;
      case 'host:play_again':
        this.resetForRematch();
        return;
      case 'host:set_halfhalf_settings': {
        if (this.public.status !== 'lobby') return;
        const s = intent.settings ?? {};
        this.hh.settings = {
          ...this.hh.settings,
          rounds: clampInt(s.rounds, 3, Math.min(20, HALFHALF_OBJECTS.length), this.hh.settings.rounds),
          revealMs: clampInt(s.revealMs, 500, 5000, this.hh.settings.revealMs),
          lockInMs: clampInt(s.lockInMs, 5000, 30000, this.hh.settings.lockInMs),
          truthHoldMs: clampInt(s.truthHoldMs, 2000, 10000, this.hh.settings.truthHoldMs),
          closestBonus: clampInt(s.closestBonus, 0, 500, this.hh.settings.closestBonus),
        };
        return;
      }
      case 'host:kick': {
        const idx = this.public.members.findIndex((m) => m.id === intent.playerId);
        if (idx < 0) return;
        this.public.members.splice(idx, 1);
        this.hh.players = this.hh.players.filter((p) => p.id !== intent.playerId);
        return;
      }
      case 'host:set_room_policy':
        this.public.roomPolicy = intent.policy;
        return;
      case 'host:clear_reactions':
        this.public.reactions = [];
        return;
      default:
        return;
    }
  }

  private handleLockGuess(client: Client, deviceId: string, rawPosition: number) {
    if (this.hh.phase !== 'lock_in') return this.error(client, 'illegal', 'not_accepting_guesses');
    if (this.guesses.has(deviceId)) return this.error(client, 'illegal', 'already_locked');
    const position = sanitizePosition(rawPosition);
    if (position === null) return this.error(client, 'illegal', 'invalid_position');
    this.guesses.set(deviceId, { playerId: deviceId, position, lockedAtMs: Date.now() });
    this.hh.lockedInCount = this.guesses.size;
    this.hh.lockedGuesses = [...this.guesses.values()];
    this.privateBySeat.set(deviceId, {
      seatId: deviceId,
      halfHalfState: { lockedPosition: position, hasLockedIn: true },
    });
    this.sendPrivateTo(client, deviceId);
    this.broadcastPublic();
    if (this.guesses.size >= this.hh.players.length) this.transitionToReveal();
  }

  // ── phase loop ────────────────────────────────────────────────────────
  private beginMatch() {
    // Inline pickObjectsForMatch (avoid extra import — we already have HALFHALF_OBJECTS).
    const rounds = Math.min(this.hh.settings.rounds, HALFHALF_OBJECTS.length);
    this.objectPlan = shuffleSeeded(HALFHALF_OBJECTS.slice(), this.rngSeed).slice(0, rounds);
    this.servedIndex = 0;
    this.hh.round = 0;
    this.hh.phase = 'intro';
    this.hh.lastAction = 'Half & Half starting…';
    this.scheduleNext(1500, () => this.serveNextRound());
    this.broadcastPublic();
  }

  private serveNextRound() {
    if (this.servedIndex >= this.objectPlan.length) {
      this.finishMatch();
      return;
    }
    const obj = this.objectPlan[this.servedIndex];
    this.servedIndex += 1;
    this.hh.round = this.servedIndex;
    this.currentObject = obj;
    this.guesses.clear();
    this.hh.lockedInCount = 0;
    this.hh.lockedGuesses = [];
    this.hh.lastRoundResults = [];
    this.hh.revealedTruth = null;
    this.hh.currentObject = toPublicObject(obj);

    for (const p of this.hh.players) {
      this.privateBySeat.set(p.id, {
        seatId: p.id,
        halfHalfState: { lockedPosition: null, hasLockedIn: false },
      });
    }

    this.hh.phase = 'reveal_object';
    this.hh.lastAction = `Round ${this.servedIndex} — find the midpoint!`;
    const revealMs = this.hh.settings.revealMs;
    this.hh.phaseEndsAt = Date.now() + revealMs;
    this.scheduleNext(revealMs, () => this.transitionToLockIn());
    this.broadcastPublic();
    this.broadcastAllPrivates();
  }

  private transitionToLockIn() {
    this.hh.phase = 'lock_in';
    this.hh.lastAction = 'Slide to your perfect cut!';
    const window = this.hh.settings.lockInMs;
    this.hh.phaseEndsAt = Date.now() + window;
    this.scheduleNext(window, () => this.transitionToReveal());
    this.broadcastPublic();
  }

  private transitionToReveal() {
    if (!this.currentObject) return;
    const { results, updatedPlayers } = resolveHalfHalfRound(
      this.currentObject,
      this.hh.players,
      this.guesses,
      this.hh.settings.closestBonus,
    );
    this.hh.players = updatedPlayers;
    this.hh.lastRoundResults = results;
    this.hh.revealedTruth = this.currentObject.truth;
    this.hh.lockedGuesses = [...this.guesses.values()];
    this.hh.phase = 'reveal_truth';
    this.hh.lastAction = `Truth: ${(this.currentObject.truth * 100).toFixed(0)}% — ${this.currentObject.name}`;
    const hold = this.hh.settings.truthHoldMs;
    this.hh.phaseEndsAt = Date.now() + hold;
    this.scheduleNext(hold, () => this.serveNextRound());
    this.broadcastPublic();
  }

  private finishMatch() {
    const sorted = [...this.hh.players].sort((a, b) => b.score - a.score);
    this.hh.winnerId = sorted[0]?.id ?? null;
    this.hh.phase = 'finished';
    this.hh.phaseEndsAt = null;
    this.hh.lastAction = 'Match complete.';
    this.public.status = 'finished';
    this.persistFinishedMatchOnce();
    this.broadcastPublic();
  }

  private persistFinishedMatchOnce() {
    const record = this.buildFinishedMatchRecord();
    if (!record) return;
    if (this.persistedMatchKeys.has(record.matchKey)) {
      log('info', 'persistence_duplicate_suppressed', { room: this.public.code, gameType: 'halfhalf' });
      return;
    }
    this.persistedMatchKeys.add(record.matchKey);
    log('info', 'game_finished', { room: this.public.code, gameType: 'halfhalf', players: record.playerDeviceIds.length });
    void persistFinishedMatch(record)
      .then((status) => log('info', 'persistence_result', { room: this.public.code, gameType: 'halfhalf', status }))
      .catch((err) => log('error', 'persistence_failed', { room: this.public.code, gameType: 'halfhalf', error: err?.message ?? String(err) }));
  }

  private buildFinishedMatchRecord() {
    const players = this.hh.players.map((p) => ({ id: p.id, displayName: p.displayName }));
    const winnerDeviceId = this.hh.winnerId ?? null;
    if (players.length === 0) return null;
    const playerDeviceIds = players.map((p) => p.id);
    const playerNames = Object.fromEntries(players.map((p) => [p.id, p.displayName]));
    const matchKey = buildMatchKey({ roomCode: this.public.code, gameType: 'half-half', winnerDeviceId, playerDeviceIds });
    return {
      roomCode: this.public.code,
      gameType: 'half-half' as GameType,
      winnerDeviceId,
      playerDeviceIds,
      playerNames,
      turnCount: this.hh.round,
      durationMs: this.matchStartedAt ? Date.now() - this.matchStartedAt : undefined,
      matchKey,
      hostDisplayId: this.public.hostId || null,
      partyId: this.hostPartyId || this.public.hostId || null,
    };
  }

  private endMatchEarly() {
    if (this.phaseTimer) clearTimeout(this.phaseTimer);
    this.finishMatch();
  }

  private resetForRematch() {
    if (this.phaseTimer) clearTimeout(this.phaseTimer);
    this.objectPlan = [];
    this.servedIndex = 0;
    this.currentObject = null;
    this.guesses.clear();
    this.hh.players = this.hh.players.map((p) => ({ ...p, score: 0, bullseyes: 0, lastAccuracy: undefined }));
    this.hh.round = 0;
    this.hh.phase = 'lobby';
    this.hh.currentObject = null;
    this.hh.phaseEndsAt = null;
    this.hh.revealedTruth = null;
    this.hh.lastRoundResults = [];
    this.hh.lockedGuesses = [];
    this.hh.lockedInCount = 0;
    this.hh.winnerId = null;
    this.hh.lastAction = 'Lobby — waiting for host.';
    this.public.status = 'lobby';
    clearPauseState(this.public);
    clearPauseRequests(this.public);
    this.broadcastPublic();
  }

  private scheduleNext(ms: number, fn: () => void) {
    if (this.phaseTimer) clearTimeout(this.phaseTimer);
    this.phaseTimer = setTimeout(() => {
      this.phaseTimer = null;
      try { fn(); } catch (err) {
        log('error', 'halfhalf_tick_error', { room: this.public.code, error: (err as Error)?.message });
      }
    }, ms);
  }

  // ── projection ────────────────────────────────────────────────────────
  private broadcastPublic() {
    this.public.halfHalfState = this.hh;
    this.applyCanonicalPhase();
    this.syncRoomDirectory();
    const evt: ServerEvent = { type: 'public_state', state: this.public };
    this.broadcast('event', evt);
  }
  private sendPublicTo(client: Client) {
    this.public.halfHalfState = this.hh;
    this.applyCanonicalPhase();
    client.send('event', { type: 'public_state', state: this.public } satisfies ServerEvent);
  }
  private applyCanonicalPhase() {
    const p = this.hh.phase;
    let next: 'lobby' | 'game_intro' | 'round_active' | 'round_resolution' | 'game_over';
    if (this.public.status === 'finished' || p === 'finished') next = 'game_over';
    else if (p === 'lobby') next = 'lobby';
    else if (p === 'intro') next = 'game_intro';
    else if (p === 'reveal_truth' || p === 'leaderboard') next = 'round_resolution';
    else next = 'round_active';
    setCanonicalPhase(this.public, next);
  }
  private sendPrivateTo(client: Client, seatId: string) {
    const base = this.privateBySeat.get(seatId) ?? { seatId };
    client.send('event', { type: 'private_state', state: { ...base } } satisfies ServerEvent);
  }
  private broadcastAllPrivates() {
    for (const c of this.clients) {
      const att = this.attached.get(c.sessionId);
      if (!att) continue;
      this.sendPrivateTo(c, att.deviceId);
    }
  }
  private error(client: Client, code: string, message: string) {
    client.send('event', { type: 'error', code, message } satisfies ServerEvent);
  }

  // ── helpers ───────────────────────────────────────────────────────────
  private makeSeat(id: string, displayName: string, role: 'player' | 'crowd' = 'player'): RoomMember {
    return {
      id,
      displayName,
      color: SEAT_COLORS[this.public.members.length % SEAT_COLORS.length],
      isReady: false,
      isHost: false,
      isSpectator: role === 'crowd',
      role,
    };
  }
  private makeHalfHalfPlayer(id: string, displayName: string): HalfHalfPlayerState {
    const color = SEAT_COLORS[this.public.members.length % SEAT_COLORS.length];
    return { id, displayName, color, score: 0, bullseyes: 0 };
  }
  private syncPlayerName(id: string, displayName: string) {
    const p = this.hh.players.find((x) => x.id === id);
    if (p) p.displayName = displayName;
  }
  private syncRoomDirectory() {
    upsertRoom({
      code: this.public.code,
      gameType: 'half-half',
      status: this.public.status,
      roomPolicy: this.public.roomPolicy,
      players: this.public.members.length,
      maxPlayers: HALFHALF_MAX_SEATS,
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

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function shuffleSeeded<T>(arr: T[], seed: number): T[] {
  let s = seed >>> 0;
  const rng = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
