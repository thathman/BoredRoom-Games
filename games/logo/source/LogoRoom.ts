// LogoRoom — server-authoritative Logo Guesser room.
//
// Phase loop: lobby -> intro -> question -> options -> reveal -> [next | finished]
// Two input modes (host setting): multiple_choice (4 options) or free_text (typed
// guess + fuzzy match). Scoring is tiered fastest-finger × streak multiplier.

import { Client, Room } from '@colyseus/core';
import {
  DEFAULT_LOGO_SETTINGS,
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
  canonicalIndexFromPick,
  createInitialLogoState,
  fuzzyMatchBrand,
  hashString,
  LogoLockedAnswer,
  LogoPlayerState,
  LogoPublicState,
  LogoSettings,
  pickBrandsForMatch,
  pickDistractors,
  resolveLogoRound,
  shuffleOptionOrder,
} from '../../../shared/src/games/logo/engine.js';
import type { LogoBrand } from '../../../shared/src/games/logo/brands.js';
import { createReactionStats } from '../../../shared/src/reactions/policy.js';
import { ReactionSubsystem } from './reactions.js';
import { hostTokenStore } from '../auth/hostTokens.js';
import { log } from '../logger.js';
import { setCanonicalPhase } from './_base.js';
import { removeRoom, upsertRoom } from '../roomDirectory.js';
import { clearPauseRequests, clearPauseState, markPresence, uuid } from './_shared.js';

const LOGO_MAX_SEATS = 8;
const SEAT_COLORS = ['red', 'green', 'yellow', 'blue', 'pink', 'cyan', 'orange', 'lime'] as const;

interface AttachedClient {
  deviceId: string;
  role: 'host' | 'player';
  effectiveRole: 'host' | 'player' | 'crowd';
  displayName: string;
}

export class LogoRoom extends Room {
  private public!: PublicRoomState;
  private privateBySeat = new Map<string, PrivateSeatState>();
  private attached = new Map<string, AttachedClient>();
  private sessionByDevice = new Map<string, string>();

  private reactions!: ReactionSubsystem;

  private logo!: LogoPublicState;
  private brandPlan: LogoBrand[] = [];
  private servedIndex = 0;
  private currentBrand: LogoBrand | null = null;
  private currentCanonicalOptions: [string, string, string, string] | null = null;
  private optionOrderBySeat = new Map<string, [number, number, number, number]>();
  private locks = new Map<string, LogoLockedAnswer>();
  private phaseTimer: NodeJS.Timeout | null = null;
  private rngSeed = 0;
  private hostPartyId: string | null = null;

  override onCreate(options: { code?: string; gameType?: GameType; partyId?: string }) {
    const code = (options?.code ?? 'TEMP').toUpperCase();
    this.roomId = code;
    this.hostPartyId = typeof options?.partyId === 'string' && options.partyId.length > 0 ? options.partyId : null;
    this.rngSeed = Math.floor(Math.random() * 0xffffffff);

    this.logo = createInitialLogoState([], { ...DEFAULT_LOGO_SETTINGS });

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
      maxPlayers: LOGO_MAX_SEATS,
      roomSettings: {
        aiAssistance: true,
        maxPlayers: LOGO_MAX_SEATS,
        whotPenaltyStreaks: false,
        reactionBursts: true,
      },
      gameType: 'logo',
      logoState: this.logo,
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
    log('info', 'room_instance_created', { room: code, gameType: 'logo' });
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
    const seatsFull = playerSeats >= LOGO_MAX_SEATS;
    const midGame = this.public.status !== 'lobby';

    if (seatsFull || midGame) {
      this.public.members.push(this.makeSeat(att.deviceId, att.displayName, 'crowd'));
      att.effectiveRole = 'crowd';
      return;
    }

    this.public.members.push(this.makeSeat(att.deviceId, att.displayName, 'player'));
    this.logo.players.push(this.makeLogoPlayer(att.deviceId, att.displayName));
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
    if (intent.type === 'logo:lock_pick') {
      if (att.effectiveRole === 'crowd') return this.error(client, 'forbidden', 'crowd_cannot_play');
      this.handleLockPick(client, att.deviceId, intent.pickedIndex);
      return;
    }
    if (intent.type === 'logo:lock_text') {
      if (att.effectiveRole === 'crowd') return this.error(client, 'forbidden', 'crowd_cannot_play');
      this.handleLockText(client, att.deviceId, intent.guess);
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
        if (this.logo.players.length < 1) return;
        this.public.status = 'playing';
        log('info', 'game_started', { room: this.public.code, gameType: 'logo', players: this.logo.players.length });
        this.beginMatch();
        return;
      }
      case 'host:end_game':
        this.endMatchEarly();
        return;
      case 'host:play_again':
        this.resetForRematch();
        return;
      case 'host:set_logo_settings': {
        if (this.public.status !== 'lobby') return;
        const s = intent.settings ?? {};
        this.logo.settings = {
          ...this.logo.settings,
          rounds: clampInt(s.rounds, 5, 20, this.logo.settings.rounds),
          questionRevealMs: clampInt(s.questionRevealMs, 500, 5000, this.logo.settings.questionRevealMs),
          answerWindowMs: clampInt(s.answerWindowMs, 5000, 60000, this.logo.settings.answerWindowMs),
          revealHoldMs: clampInt(s.revealHoldMs, 1000, 10000, this.logo.settings.revealHoldMs),
          inputMode: s.inputMode ?? this.logo.settings.inputMode,
          regionFilter: s.regionFilter ?? this.logo.settings.regionFilter,
        };
        return;
      }
      case 'host:kick': {
        const idx = this.public.members.findIndex((m) => m.id === intent.playerId);
        if (idx < 0) return;
        this.public.members.splice(idx, 1);
        this.logo.players = this.logo.players.filter((p) => p.id !== intent.playerId);
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

  private handleLockPick(client: Client, deviceId: string, pickedShuffledIndex: number) {
    if (this.logo.phase !== 'options') return this.error(client, 'illegal', 'not_accepting_answers');
    if (this.locks.has(deviceId)) return this.error(client, 'illegal', 'already_locked');
    if (!this.currentBrand || this.logo.settings.inputMode !== 'multiple_choice') {
      return this.error(client, 'illegal', 'wrong_mode');
    }
    const order = this.optionOrderBySeat.get(deviceId) ?? null;
    const canonical = canonicalIndexFromPick(order, pickedShuffledIndex);
    if (canonical === null) return this.error(client, 'illegal', 'invalid_pick');
    this.locks.set(deviceId, {
      playerId: deviceId,
      guessText: null,
      pickedCanonicalIndex: canonical,
      lockedAtMs: Date.now(),
      matchKind: 'wrong', // unused for MC scoring — canonical compare wins
    });
    this.commitLock(client, deviceId, { pickedShuffled: pickedShuffledIndex });
  }

  private handleLockText(client: Client, deviceId: string, guess: string) {
    if (this.logo.phase !== 'options') return this.error(client, 'illegal', 'not_accepting_answers');
    if (this.locks.has(deviceId)) return this.error(client, 'illegal', 'already_locked');
    if (!this.currentBrand || this.logo.settings.inputMode !== 'free_text') {
      return this.error(client, 'illegal', 'wrong_mode');
    }
    const trimmed = String(guess ?? '').slice(0, 80);
    const matchKind = fuzzyMatchBrand(trimmed, this.currentBrand);
    this.locks.set(deviceId, {
      playerId: deviceId,
      guessText: trimmed,
      pickedCanonicalIndex: null,
      lockedAtMs: Date.now(),
      matchKind,
    });
    this.commitLock(client, deviceId, { guess: trimmed });
  }

  private commitLock(client: Client, deviceId: string, payload: { pickedShuffled?: number; guess?: string }) {
    this.logo.lockedInCount = this.locks.size;
    const order = this.optionOrderBySeat.get(deviceId) ?? null;
    this.privateBySeat.set(deviceId, {
      seatId: deviceId,
      logoState: {
        optionOrder: order,
        hasLockedIn: true,
        lockedPick: payload.pickedShuffled ?? null,
        lastGuess: payload.guess ?? null,
      },
    });
    this.sendPrivateTo(client, deviceId);
    this.broadcastPublic();
    if (this.locks.size >= this.logo.players.length) this.transitionToReveal();
  }

  // ── phase loop ────────────────────────────────────────────────────────
  private beginMatch() {
    this.brandPlan = pickBrandsForMatch(this.logo.settings.rounds, this.logo.settings.regionFilter, this.rngSeed);
    this.servedIndex = 0;
    this.logo.round = 0;
    this.logo.phase = 'intro';
    this.logo.lastAction = 'Logo Guesser starting…';
    this.scheduleNext(1500, () => this.serveNextRound());
    this.broadcastPublic();
  }

  private serveNextRound() {
    if (this.servedIndex >= this.brandPlan.length) {
      this.finishMatch();
      return;
    }
    const brand = this.brandPlan[this.servedIndex];
    this.servedIndex += 1;
    this.logo.round = this.servedIndex;
    this.currentBrand = brand;
    this.locks.clear();
    this.logo.lockedInCount = 0;
    this.logo.lastQuestionResults = [];
    this.logo.revealedAnswer = null;

    if (this.logo.settings.inputMode === 'multiple_choice') {
      const distractors = pickDistractors(brand, this.logo.settings.regionFilter, this.rngSeed + this.servedIndex);
      // Canonical options always have answer at index 0 — per-seat shuffling masks it.
      this.currentCanonicalOptions = [brand.name, distractors[0], distractors[1], distractors[2]];
      const baseSeed = hashString(brand.id) + this.rngSeed;
      for (const p of this.logo.players) {
        const rng = mulberry32(baseSeed ^ hashString(p.id));
        const order = shuffleOptionOrder(rng);
        this.optionOrderBySeat.set(p.id, order);
        this.privateBySeat.set(p.id, {
          seatId: p.id,
          logoState: { optionOrder: order, hasLockedIn: false, lockedPick: null, lastGuess: null },
        });
      }
      this.logo.currentQuestion = {
        id: brand.id,
        domain: brand.domain,
        options: this.currentCanonicalOptions,
        difficulty: brand.difficulty,
        region: brand.region,
      };
    } else {
      this.currentCanonicalOptions = null;
      this.optionOrderBySeat.clear();
      for (const p of this.logo.players) {
        this.privateBySeat.set(p.id, {
          seatId: p.id,
          logoState: { optionOrder: null, hasLockedIn: false, lockedPick: null, lastGuess: null },
        });
      }
      this.logo.currentQuestion = {
        id: brand.id,
        domain: brand.domain,
        difficulty: brand.difficulty,
        region: brand.region,
      };
    }

    this.logo.phase = 'question';
    this.logo.lastAction = `Round ${this.servedIndex} — guess the logo!`;
    const revealMs = this.logo.settings.questionRevealMs;
    this.logo.phaseEndsAt = Date.now() + revealMs;
    this.scheduleNext(revealMs, () => this.transitionToOptions());
    this.broadcastPublic();
    this.broadcastAllPrivates();
  }

  private transitionToOptions() {
    this.logo.phase = 'options';
    this.logo.lastAction = 'Lock in your guess!';
    const window = this.logo.settings.answerWindowMs;
    this.logo.phaseEndsAt = Date.now() + window;
    this.scheduleNext(window, () => this.transitionToReveal());
    this.broadcastPublic();
  }

  private transitionToReveal() {
    if (!this.currentBrand) return;
    const { results, updatedPlayers } = resolveLogoRound(
      this.currentBrand,
      this.currentCanonicalOptions,
      this.logo.players,
      this.locks,
    );
    this.logo.players = updatedPlayers;
    this.logo.lastQuestionResults = results;
    this.logo.revealedAnswer = { name: this.currentBrand.name, domain: this.currentBrand.domain };
    this.logo.phase = 'reveal';
    this.logo.lastAction = `Answer: ${this.currentBrand.name}`;
    const hold = this.logo.settings.revealHoldMs;
    this.logo.phaseEndsAt = Date.now() + hold;
    this.scheduleNext(hold, () => this.serveNextRound());
    this.broadcastPublic();
  }

  private finishMatch() {
    const sorted = [...this.logo.players].sort((a, b) => b.score - a.score);
    this.logo.winnerId = sorted[0]?.id ?? null;
    this.logo.phase = 'finished';
    this.logo.phaseEndsAt = null;
    this.logo.lastAction = 'Match complete.';
    this.public.status = 'finished';
    this.broadcastPublic();
  }

  private endMatchEarly() {
    if (this.phaseTimer) clearTimeout(this.phaseTimer);
    this.finishMatch();
  }

  private resetForRematch() {
    if (this.phaseTimer) clearTimeout(this.phaseTimer);
    this.brandPlan = [];
    this.servedIndex = 0;
    this.currentBrand = null;
    this.currentCanonicalOptions = null;
    this.locks.clear();
    this.optionOrderBySeat.clear();
    this.logo.players = this.logo.players.map((p) => ({ ...p, score: 0, streak: 0, correctCount: 0 }));
    this.logo.round = 0;
    this.logo.phase = 'lobby';
    this.logo.currentQuestion = null;
    this.logo.phaseEndsAt = null;
    this.logo.revealedAnswer = null;
    this.logo.lastQuestionResults = [];
    this.logo.lockedInCount = 0;
    this.logo.winnerId = null;
    this.logo.lastAction = 'Lobby — waiting for host.';
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
        log('error', 'logo_tick_error', { room: this.public.code, error: (err as Error)?.message });
      }
    }, ms);
  }

  // ── projection ────────────────────────────────────────────────────────
  private broadcastPublic() {
    this.public.logoState = this.logo;
    this.applyCanonicalPhase();
    this.syncRoomDirectory();
    const evt: ServerEvent = { type: 'public_state', state: this.public };
    this.broadcast('event', evt);
  }
  private sendPublicTo(client: Client) {
    this.public.logoState = this.logo;
    this.applyCanonicalPhase();
    client.send('event', { type: 'public_state', state: this.public } satisfies ServerEvent);
  }
  private applyCanonicalPhase() {
    const p = this.logo.phase;
    let next: 'lobby' | 'game_intro' | 'round_active' | 'round_resolution' | 'game_over';
    if (this.public.status === 'finished' || p === 'finished') next = 'game_over';
    else if (p === 'lobby') next = 'lobby';
    else if (p === 'intro') next = 'game_intro';
    else if (p === 'reveal' || p === 'leaderboard') next = 'round_resolution';
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
  private makeLogoPlayer(id: string, displayName: string): LogoPlayerState {
    const color = SEAT_COLORS[this.public.members.length % SEAT_COLORS.length];
    return { id, displayName, color, score: 0, streak: 0, correctCount: 0 };
  }
  private syncPlayerName(id: string, displayName: string) {
    const p = this.logo.players.find((x) => x.id === id);
    if (p) p.displayName = displayName;
  }
  private syncRoomDirectory() {
    upsertRoom({
      code: this.public.code,
      gameType: 'logo',
      status: this.public.status,
      roomPolicy: this.public.roomPolicy,
      players: this.public.members.length,
      maxPlayers: LOGO_MAX_SEATS,
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

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
