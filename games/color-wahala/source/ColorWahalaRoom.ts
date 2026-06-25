// ColorWahalaRoom — server-authoritative Stroop-effect speed game.
//
// Phase loop: lobby → intro → prompt (1s "get ready") → answer (lock window)
//             → reveal (hold) → next prompt | finished

import { Client, Room } from '@colyseus/core';
import {
  DEFAULT_COLORWAHALA_SETTINGS,
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
  ColorId,
  COLOR_IDS,
  isColorId,
} from '../../../shared/src/games/colorwahala/palette.js';
import {
  ColorWahalaPlayerState,
  ColorWahalaPrompt,
  ColorWahalaPublicState,
  ColorWahalaTap,
  createInitialColorWahalaState,
  generatePrompt,
  resolveColorWahalaRound,
} from '../../../shared/src/games/colorwahala/engine.js';
import { createReactionStats } from '../../../shared/src/reactions/policy.js';
import { ReactionSubsystem } from './reactions.js';
import { hostTokenStore } from '../auth/hostTokens.js';
import { buildMatchKey, persistFinishedMatch } from '../matchPersistence.js';
import { log } from '../logger.js';
import { setCanonicalPhase } from './_base.js';
import { removeRoom, upsertRoom } from '../roomDirectory.js';
import { clearPauseRequests, clearPauseState, markPresence, uuid } from './_shared.js';

const CW_MAX_SEATS = 8;
const SEAT_COLORS = ['red', 'green', 'yellow', 'blue', 'pink', 'cyan', 'orange', 'lime'] as const;
const PROMPT_INTRO_MS = 1000;

interface AttachedClient {
  deviceId: string;
  role: 'host' | 'player';
  effectiveRole: 'host' | 'player' | 'crowd';
  displayName: string;
}

export class ColorWahalaRoom extends Room {
  private public!: PublicRoomState;
  private privateBySeat = new Map<string, PrivateSeatState>();
  private attached = new Map<string, AttachedClient>();
  private sessionByDevice = new Map<string, string>();

  private reactions!: ReactionSubsystem;

  private cw!: ColorWahalaPublicState;
  private currentPrompt: ColorWahalaPrompt | null = null;
  private promptStartTs = 0;
  private taps = new Map<string, ColorWahalaTap>();
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

    this.cw = createInitialColorWahalaState([], { ...DEFAULT_COLORWAHALA_SETTINGS });

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
      maxPlayers: CW_MAX_SEATS,
      roomSettings: {
        aiAssistance: true,
        maxPlayers: CW_MAX_SEATS,
        whotPenaltyStreaks: false,
        reactionBursts: true,
      },
      gameType: 'color-wahala',
      colorWahalaState: this.cw,
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
    log('info', 'room_instance_created', { room: code, gameType: 'color-wahala' });
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
    const seatsFull = playerSeats >= CW_MAX_SEATS;
    const midGame = this.public.status !== 'lobby';

    if (seatsFull || midGame) {
      this.public.members.push(this.makeSeat(att.deviceId, att.displayName, 'crowd'));
      att.effectiveRole = 'crowd';
      return;
    }

    this.public.members.push(this.makeSeat(att.deviceId, att.displayName, 'player'));
    this.cw.players.push(this.makePlayer(att.deviceId, att.displayName));
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
    if (intent.type === 'colorwahala:tap') {
      if (att.effectiveRole === 'crowd') return this.error(client, 'forbidden', 'crowd_cannot_play');
      this.handleTap(client, att.deviceId, intent.colorId);
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
        if (this.cw.players.length < 1) return;
        this.public.status = 'playing';
        log('info', 'game_started', { room: this.public.code, gameType: 'color-wahala', players: this.cw.players.length });
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
      case 'host:set_colorwahala_settings': {
        if (this.public.status !== 'lobby') return;
        const s = intent.settings ?? {};
        this.cw.settings = {
          ...this.cw.settings,
          rounds: clampInt(s.rounds, 5, 30, this.cw.settings.rounds),
          startLockMs: clampInt(s.startLockMs, 2000, 10000, this.cw.settings.startLockMs),
          endLockMs: clampInt(s.endLockMs, 1000, 8000, this.cw.settings.endLockMs),
          revealHoldMs: clampInt(s.revealHoldMs, 1000, 6000, this.cw.settings.revealHoldMs),
          firstCorrectBonus: clampInt(s.firstCorrectBonus, 0, 1000, this.cw.settings.firstCorrectBonus),
          audioEnabled: typeof s.audioEnabled === 'boolean' ? s.audioEnabled : this.cw.settings.audioEnabled,
          modeMix: s.modeMix && typeof s.modeMix === 'object'
            ? {
                say_word: clampNum(s.modeMix.say_word, 0, 1, this.cw.settings.modeMix.say_word),
                say_color: clampNum(s.modeMix.say_color, 0, 1, this.cw.settings.modeMix.say_color),
                say_heard: clampNum(s.modeMix.say_heard, 0, 1, this.cw.settings.modeMix.say_heard),
              }
            : this.cw.settings.modeMix,
        };
        return;
      }
      case 'host:kick': {
        const idx = this.public.members.findIndex((m) => m.id === intent.playerId);
        if (idx < 0) return;
        this.public.members.splice(idx, 1);
        this.cw.players = this.cw.players.filter((p) => p.id !== intent.playerId);
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

  private handleTap(client: Client, deviceId: string, rawColorId: string) {
    if (this.cw.phase !== 'answer' || !this.currentPrompt) {
      return this.error(client, 'illegal', 'not_accepting_taps');
    }
    if (this.taps.has(deviceId)) return this.error(client, 'illegal', 'already_tapped');
    if (!isColorId(rawColorId)) return this.error(client, 'illegal', 'invalid_color');
    const colorId = rawColorId as ColorId;
    const now = Date.now();
    const latencyMs = Math.max(0, now - this.promptStartTs);
    const correct = colorId === this.currentPrompt.answer;
    this.taps.set(deviceId, {
      playerId: deviceId,
      pickedColor: colorId,
      serverTs: now,
      latencyMs,
      correct,
    });
    if (!correct) this.cw.wrongCount = (this.cw.wrongCount ?? 0) + 1;
    this.privateBySeat.set(deviceId, {
      seatId: deviceId,
      colorWahalaState: { hasTapped: true, tappedColor: colorId, lockedOut: !correct },
    });
    this.sendPrivateTo(client, deviceId);
    this.broadcastPublic();
    if (this.taps.size >= this.cw.players.length) this.transitionToReveal();
  }

  // ── phase loop ────────────────────────────────────────────────────────
  private beginMatch() {
    this.cw.round = 0;
    this.cw.phase = 'intro';
    this.cw.lastAction = 'Color Wahala starting…';
    this.cw.phaseEndsAt = Date.now() + 1500;
    this.scheduleNext(1500, () => this.serveNextRound());
    this.broadcastPublic();
  }

  private serveNextRound() {
    if (this.cw.round >= this.cw.settings.rounds) {
      this.finishMatch();
      return;
    }
    const nextRound = this.cw.round + 1;
    this.cw.round = nextRound;
    this.taps.clear();
    this.cw.lastRoundResults = [];
    this.cw.revealedAnswer = null;
    this.cw.wrongCount = 0;

    const prompt = generatePrompt(nextRound, this.cw.settings.rounds, this.cw.settings, this.rngSeed);
    this.currentPrompt = prompt;
    this.cw.currentPrompt = {
      mode: prompt.mode,
      word: prompt.word.id,
      ink: prompt.ink.id,
      heard: prompt.heard?.id ?? null,
      lockMs: prompt.lockMs,
    };

    for (const p of this.cw.players) {
      this.privateBySeat.set(p.id, {
        seatId: p.id,
        colorWahalaState: { hasTapped: false, tappedColor: null, lockedOut: false },
      });
    }

    this.cw.phase = 'prompt';
    this.cw.lastAction = `Round ${nextRound} — get ready!`;
    this.cw.phaseEndsAt = Date.now() + PROMPT_INTRO_MS;
    this.scheduleNext(PROMPT_INTRO_MS, () => this.transitionToAnswer());
    this.broadcastPublic();
    this.broadcastAllPrivates();
  }

  private transitionToAnswer() {
    if (!this.currentPrompt) return;
    this.cw.phase = 'answer';
    this.cw.lastAction = 'TAP NOW!';
    this.promptStartTs = Date.now();
    const lockMs = this.currentPrompt.lockMs;
    this.cw.phaseEndsAt = this.promptStartTs + lockMs;
    this.scheduleNext(lockMs, () => this.transitionToReveal());
    this.broadcastPublic();
  }

  private transitionToReveal() {
    if (!this.currentPrompt) return;
    const { results, updatedPlayers } = resolveColorWahalaRound(
      this.currentPrompt,
      this.cw.players,
      this.taps,
      this.cw.settings,
    );
    this.cw.players = updatedPlayers;
    this.cw.lastRoundResults = results;
    this.cw.revealedAnswer = this.currentPrompt.answer;
    this.cw.phase = 'reveal';
    this.cw.lastAction = `Answer: ${this.currentPrompt.answer.toUpperCase()}`;
    const hold = this.cw.settings.revealHoldMs;
    this.cw.phaseEndsAt = Date.now() + hold;
    this.scheduleNext(hold, () => this.serveNextRound());
    this.broadcastPublic();
  }

  private finishMatch() {
    const sorted = [...this.cw.players].sort((a, b) => b.score - a.score);
    this.cw.winnerId = sorted[0]?.id ?? null;
    this.cw.phase = 'finished';
    this.cw.phaseEndsAt = null;
    this.cw.currentPrompt = null;
    this.cw.lastAction = 'Match complete.';
    this.public.status = 'finished';
    this.persistFinishedMatchOnce();
    this.broadcastPublic();
  }

  private persistFinishedMatchOnce() {
    const record = this.buildFinishedMatchRecord();
    if (!record) return;
    if (this.persistedMatchKeys.has(record.matchKey)) {
      log('info', 'persistence_duplicate_suppressed', { room: this.public.code, gameType: 'colorwahala' });
      return;
    }
    this.persistedMatchKeys.add(record.matchKey);
    log('info', 'game_finished', { room: this.public.code, gameType: 'colorwahala', players: record.playerDeviceIds.length });
    void persistFinishedMatch(record)
      .then((status) => log('info', 'persistence_result', { room: this.public.code, gameType: 'colorwahala', status }))
      .catch((err) => log('error', 'persistence_failed', { room: this.public.code, gameType: 'colorwahala', error: err?.message ?? String(err) }));
  }

  private buildFinishedMatchRecord() {
    const players = this.cw.players.map((p) => ({ id: p.id, displayName: p.displayName }));
    const winnerDeviceId = this.cw.winnerId ?? null;
    if (players.length === 0) return null;
    const playerDeviceIds = players.map((p) => p.id);
    const playerNames = Object.fromEntries(players.map((p) => [p.id, p.displayName]));
    const matchKey = buildMatchKey({ roomCode: this.public.code, gameType: 'color-wahala', winnerDeviceId, playerDeviceIds });
    return {
      roomCode: this.public.code,
      gameType: 'color-wahala' as GameType,
      winnerDeviceId,
      playerDeviceIds,
      playerNames,
      turnCount: this.cw.round,
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
    this.currentPrompt = null;
    this.taps.clear();
    this.cw.players = this.cw.players.map((p) => ({
      ...p,
      score: 0,
      correctCount: 0,
      bestStreak: 0,
      currentStreak: 0,
      totalLatencyMs: 0,
    }));
    this.cw.round = 0;
    this.cw.phase = 'lobby';
    this.cw.currentPrompt = null;
    this.cw.phaseEndsAt = null;
    this.cw.revealedAnswer = null;
    this.cw.lastRoundResults = [];
    this.cw.wrongCount = 0;
    this.cw.winnerId = null;
    this.cw.lastAction = 'Lobby — waiting for host.';
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
        log('error', 'colorwahala_tick_error', { room: this.public.code, error: (err as Error)?.message });
      }
    }, ms);
  }

  // ── projection ────────────────────────────────────────────────────────
  private broadcastPublic() {
    this.public.colorWahalaState = this.cw;
    this.applyCanonicalPhase();
    this.syncRoomDirectory();
    const evt: ServerEvent = { type: 'public_state', state: this.public };
    this.broadcast('event', evt);
  }
  private sendPublicTo(client: Client) {
    this.public.colorWahalaState = this.cw;
    this.applyCanonicalPhase();
    client.send('event', { type: 'public_state', state: this.public } satisfies ServerEvent);
  }
  private applyCanonicalPhase() {
    const p = this.cw.phase;
    let next: 'lobby' | 'game_intro' | 'round_active' | 'round_resolution' | 'game_over';
    if (this.public.status === 'finished' || p === 'finished') next = 'game_over';
    else if (p === 'lobby') next = 'lobby';
    else if (p === 'intro') next = 'game_intro';
    else if (p === 'reveal') next = 'round_resolution';
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
  private makePlayer(id: string, displayName: string): ColorWahalaPlayerState {
    const color = SEAT_COLORS[this.public.members.length % SEAT_COLORS.length];
    return {
      id,
      displayName,
      color,
      score: 0,
      correctCount: 0,
      bestStreak: 0,
      currentStreak: 0,
      totalLatencyMs: 0,
    };
  }
  private syncPlayerName(id: string, displayName: string) {
    const p = this.cw.players.find((x) => x.id === id);
    if (p) p.displayName = displayName;
  }
  private syncRoomDirectory() {
    upsertRoom({
      code: this.public.code,
      gameType: 'color-wahala',
      status: this.public.status,
      roomPolicy: this.public.roomPolicy,
      players: this.public.members.length,
      maxPlayers: CW_MAX_SEATS,
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
function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

// silence unused import warning if tree-shaker complains (kept for future use)
void COLOR_IDS;
