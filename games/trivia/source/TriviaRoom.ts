// TriviaRoom — server-authoritative WWTBAM-style room.
//
// Phase loop: lobby -> intro -> question -> options -> reveal -> [next q | leaderboard | finished]
// Lock-in scoring: tiered (100/70/50/30) with streak multiplier (×1.25@3, ×1.5@5).
// Per-seat option order is shuffled and sent only over the private channel
// to defeat screen-peeking from neighbouring controllers.
//
// Mirrors LudoRoom's auth/presence/reactions/host-moderation patterns but is
// a separate Colyseus room so its tick loop and intent surface stay focused.

import { Client, Room } from '@colyseus/core';
import {
  DEFAULT_REACTION_POLICY,
  DEFAULT_TAUNT_POLICY,
  DEFAULT_TRIVIA_SETTINGS,
  GameType,
  Intent,
  JoinAuth,
  PROTOCOL_VERSION,
  PrivateSeatState,
  PendingJoinRequest,
  PublicRoomState,
  RoomMember,
  ServerEvent,
  TriviaPlayerState,
  TriviaPublicState,
  TriviaQuestion,
  TriviaSettings,
} from '../../../shared/src/contracts/index.js';
import {
  canonicalIndexFromPick,
  categoryForRound,
  createInitialTriviaState,
  LockedAnswer,
  pickQuestionsForRound,
  resolveQuestion,
  shuffleOptionOrder,
} from '../../../shared/src/games/trivia/engine.js';
import { createReactionStats } from '../../../shared/src/reactions/policy.js';
import { ReactionSubsystem } from './reactions.js';
import { hostTokenStore } from '../auth/hostTokens.js';
import { buildMatchKey, persistFinishedMatch } from '../matchPersistence.js';
import { log } from '../logger.js';
import { projectCanonicalPhaseFromStatus, setCanonicalPhase } from './_base.js';
import { removeRoom, upsertRoom } from '../roomDirectory.js';
import { clearPauseRequests, clearPauseState, markPresence, uuid } from './_shared.js';

const TRIVIA_MAX_SEATS = 8;
const SEAT_COLORS = ['red', 'green', 'yellow', 'blue', 'pink', 'cyan', 'orange', 'lime'] as const;

interface AttachedClient {
  deviceId: string;
  role: 'host' | 'player';
  /** Effective platform role (player vs crowd) — set after seat assignment. */
  effectiveRole: 'host' | 'player' | 'crowd';
  displayName: string;
}

interface RoundPlan {
  questions: TriviaQuestion[];
  servedIndex: number; // next question to serve
}

export class TriviaRoom extends Room {
  private public!: PublicRoomState;
  private privateBySeat = new Map<string, PrivateSeatState>();
  private attached = new Map<string, AttachedClient>();
  private sessionByDevice = new Map<string, string>();

  private reactions!: ReactionSubsystem;

  // Trivia internal state — never broadcast directly.
  private trivia!: TriviaPublicState;
  private currentRoundPlan: RoundPlan | null = null;
  private locks = new Map<string, LockedAnswer>(); // playerId -> LockedAnswer for current question
  private optionOrderBySeat = new Map<string, [number, number, number, number]>();
  private servedQuestionIds = new Set<string>();
  private currentCanonicalQuestion: TriviaQuestion | null = null;
  private phaseTimer: NodeJS.Timeout | null = null;
  private rngSeed = 0;
  private hostPartyId: string | null = null;
  private matchStartedAt = 0;
  private persistedMatchKeys = new Set<string>();
  /** Crowd-mode votes for the current question. deviceId -> canonical index. */
  private crowdVotes = new Map<string, 0 | 1 | 2 | 3>();

  override onCreate(options: { code?: string; gameType?: GameType; partyId?: string }) {
    const code = (options?.code ?? 'TEMP').toUpperCase();
    this.roomId = code;
    this.hostPartyId = typeof options?.partyId === 'string' && options.partyId.length > 0
      ? options.partyId
      : null;
    this.rngSeed = Math.floor(Math.random() * 0xffffffff);

    this.trivia = createInitialTriviaState([], { ...DEFAULT_TRIVIA_SETTINGS });

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
      maxPlayers: TRIVIA_MAX_SEATS,
      roomSettings: {
        aiAssistance: true,
        maxPlayers: TRIVIA_MAX_SEATS,
        whotPenaltyStreaks: false,
        reactionBursts: true,
      },
      gameType: 'trivia',
      whotState: null,
      triviaState: this.trivia,
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
    log('info', 'room_instance_created', { room: code, gameType: 'trivia' });
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

  // ── player arrival ────────────────────────────────────────────────────
  private handlePlayerArrival(att: AttachedClient, client: Client) {
    const existing = this.public.members.find((m) => m.id === att.deviceId);
    if (existing) {
      existing.displayName = att.displayName;
      this.syncTriviaPlayerName(att.deviceId, att.displayName);
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
    const seatsFull = playerSeats >= TRIVIA_MAX_SEATS;
    const midGame = this.public.status !== 'lobby';

    // Crowd auto-assignment: room full OR mid-game (no approval flow).
    if (seatsFull || midGame) {
      const crowdSeat = this.makeSeat(att.deviceId, att.displayName, 'crowd');
      this.public.members.push(crowdSeat);
      att.effectiveRole = 'crowd';
      return;
    }

    this.public.members.push(this.makeSeat(att.deviceId, att.displayName, 'player'));
    this.trivia.players.push(this.makeTriviaPlayer(att.deviceId, att.displayName));
    att.effectiveRole = 'player';
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

    if (intent.type === 'trivia:lock_answer') {
      if (att.effectiveRole === 'crowd') return this.error(client, 'forbidden', 'crowd_cannot_play');
      this.handleLockAnswer(client, att.deviceId, intent.pickedIndex);
      return;
    }

    if (intent.type === 'crowd:vote_trivia') {
      if (att.effectiveRole !== 'crowd') return this.error(client, 'forbidden', 'players_only_lock');
      this.handleCrowdVote(att.deviceId, intent.pickedIndex);
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
        if (this.trivia.players.length < 2) return;
        this.public.status = 'playing';
        this.matchStartedAt = Date.now();
        this.beginRound(1);
        return;
      }
      case 'host:end_game': {
        this.endMatchEarly();
        return;
      }
      case 'host:play_again': {
        this.resetForRematch();
        return;
      }
      case 'host:set_trivia_settings': {
        if (this.public.status !== 'lobby') return;
        const s = intent.settings ?? {};
        this.trivia.settings = {
          ...this.trivia.settings,
          rounds: clampInt(s.rounds, 1, 10, this.trivia.settings.rounds),
          questionsPerRound: clampInt(s.questionsPerRound, 3, 15, this.trivia.settings.questionsPerRound),
          questionRevealMs: clampInt(s.questionRevealMs, 500, 5000, this.trivia.settings.questionRevealMs),
          answerWindowMs: clampInt(s.answerWindowMs, 5000, 60000, this.trivia.settings.answerWindowMs),
          revealHoldMs: clampInt(s.revealHoldMs, 1000, 8000, this.trivia.settings.revealHoldMs),
          topicMode: s.topicMode ?? this.trivia.settings.topicMode,
          topics: s.topics ?? this.trivia.settings.topics,
        };
        return;
      }
      case 'host:kick': {
        const idx = this.public.members.findIndex((m) => m.id === intent.playerId);
        if (idx < 0) return;
        this.public.members.splice(idx, 1);
        this.trivia.players = this.trivia.players.filter((p) => p.id !== intent.playerId);
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

  private handleLockAnswer(client: Client, deviceId: string, pickedShuffledIndex: number) {
    if (this.trivia.phase !== 'options') {
      return this.error(client, 'illegal', 'not_accepting_answers');
    }
    if (this.locks.has(deviceId)) {
      return this.error(client, 'illegal', 'already_locked');
    }
    if (!this.currentCanonicalQuestion) return;
    const order = this.optionOrderBySeat.get(deviceId) ?? null;
    const canonical = canonicalIndexFromPick(order, pickedShuffledIndex);
    if (canonical === null) {
      return this.error(client, 'illegal', 'invalid_pick');
    }
    this.locks.set(deviceId, {
      playerId: deviceId,
      pickedCanonicalIndex: canonical,
      lockedAtMs: Date.now(),
    });
    this.trivia.lockedInCount = this.locks.size;

    // Mark the seat's private state as locked-in.
    const priv = this.privateBySeat.get(deviceId) ?? { seatId: deviceId };
    this.privateBySeat.set(deviceId, {
      ...priv,
      triviaState: {
        optionOrder: order,
        hasLockedIn: true,
        lockedPick: pickedShuffledIndex,
      },
    });
    this.sendPrivateTo(client, deviceId);
    this.broadcastPublic();

    // Auto-advance if every active player has locked in.
    if (this.locks.size >= this.trivia.players.length) {
      this.transitionToReveal();
    }
  }

  private handleCrowdVote(deviceId: string, pickedIndex: 0 | 1 | 2 | 3) {
    if (this.trivia.phase !== 'options') return;
    if (!this.currentCanonicalQuestion) return;
    this.crowdVotes.set(deviceId, pickedIndex);
    this.refreshCrowdConsensus();
    this.broadcastPublic();
  }

  private refreshCrowdConsensus() {
    if (!this.currentCanonicalQuestion) {
      this.trivia.crowdConsensus = null;
      return;
    }
    const tally: Record<string, number> = { '0': 0, '1': 0, '2': 0, '3': 0 };
    for (const v of this.crowdVotes.values()) tally[String(v)] = (tally[String(v)] ?? 0) + 1;
    this.trivia.crowdConsensus = {
      questionId: this.currentCanonicalQuestion.id,
      tally,
      total: this.crowdVotes.size,
    };
  }

  // ── phase loop ────────────────────────────────────────────────────────
  private beginRound(round: number) {
    this.trivia.round = round;
    this.trivia.questionIndex = 0;
    const cat = categoryForRound(round, this.trivia.settings);
    this.trivia.activeCategory = cat;
    this.currentRoundPlan = {
      questions: pickQuestionsForRound(round, this.trivia.settings, this.rngSeed, this.servedQuestionIds),
      servedIndex: 0,
    };
    for (const q of this.currentRoundPlan.questions) this.servedQuestionIds.add(q.id);
    this.trivia.phase = 'intro';
    this.trivia.lastAction = `Round ${round}: ${prettyCategory(cat)}`;
    this.scheduleNext(2000, () => this.serveNextQuestion());
    this.broadcastPublic();
  }

  private serveNextQuestion() {
    if (!this.currentRoundPlan) return;
    if (this.currentRoundPlan.servedIndex >= this.currentRoundPlan.questions.length) {
      this.transitionToLeaderboard();
      return;
    }
    const q = this.currentRoundPlan.questions[this.currentRoundPlan.servedIndex];
    this.currentRoundPlan.servedIndex += 1;
    this.trivia.questionIndex = this.currentRoundPlan.servedIndex;
    this.currentCanonicalQuestion = q;
    this.locks.clear();
    this.crowdVotes.clear();
    this.trivia.crowdConsensus = null;
    this.trivia.lockedInCount = 0;
    this.trivia.lastQuestionResults = [];
    this.trivia.revealedCorrectIndex = null;

    // Public payload omits correctIndex.
    this.trivia.currentQuestion = {
      id: q.id,
      question: q.question,
      options: q.options,
      category: q.category,
      difficulty: q.difficulty,
    };
    this.trivia.phase = 'question';
    this.trivia.lastAction = 'Question incoming…';

    // Generate a shuffled option order per seat, send via private state.
    const baseSeed = hashString(q.id) + this.rngSeed;
    for (const p of this.trivia.players) {
      const rng = mulberry32(baseSeed ^ hashString(p.id));
      const order = shuffleOptionOrder(rng);
      this.optionOrderBySeat.set(p.id, order);
      this.privateBySeat.set(p.id, {
        seatId: p.id,
        triviaState: { optionOrder: order, hasLockedIn: false, lockedPick: null },
      });
    }

    const revealMs = this.trivia.settings.questionRevealMs;
    this.trivia.phaseEndsAt = Date.now() + revealMs;
    this.scheduleNext(revealMs, () => this.transitionToOptions());
    this.broadcastPublic();
    this.broadcastAllPrivates();
  }

  private transitionToOptions() {
    this.trivia.phase = 'options';
    this.trivia.lastAction = 'Lock in your answer!';
    const window = this.trivia.settings.answerWindowMs;
    this.trivia.phaseEndsAt = Date.now() + window;
    this.scheduleNext(window, () => this.transitionToReveal());
    this.broadcastPublic();
  }

  private transitionToReveal() {
    if (!this.currentCanonicalQuestion) return;
    const { results, updatedPlayers } = resolveQuestion(
      this.currentCanonicalQuestion,
      this.trivia.players,
      this.locks,
    );
    this.trivia.players = updatedPlayers;
    this.trivia.lastQuestionResults = results;
    this.trivia.revealedCorrectIndex = this.currentCanonicalQuestion.correctIndex;
    this.trivia.phase = 'reveal';
    this.trivia.lastAction = 'Answer revealed.';

    const hold = this.trivia.settings.revealHoldMs;
    this.trivia.phaseEndsAt = Date.now() + hold;
    this.scheduleNext(hold, () => {
      const plan = this.currentRoundPlan;
      if (plan && plan.servedIndex < plan.questions.length) {
        this.serveNextQuestion();
      } else {
        this.transitionToLeaderboard();
      }
    });
    this.broadcastPublic();
  }

  private transitionToLeaderboard() {
    this.trivia.phase = 'leaderboard';
    this.trivia.lastAction = `End of round ${this.trivia.round}`;
    this.trivia.phaseEndsAt = Date.now() + 5000;
    this.scheduleNext(5000, () => {
      if (this.trivia.round >= this.trivia.settings.rounds) {
        this.finishMatch();
      } else {
        this.beginRound(this.trivia.round + 1);
      }
    });
    this.broadcastPublic();
  }

  private finishMatch() {
    const sorted = [...this.trivia.players].sort((a, b) => b.score - a.score);
    this.trivia.winnerId = sorted[0]?.id ?? null;
    this.trivia.phase = 'finished';
    this.trivia.phaseEndsAt = null;
    this.trivia.lastAction = 'Match complete.';
    this.public.status = 'finished';
    this.persistFinishedMatchOnce();
    this.broadcastPublic();
  }

  private persistFinishedMatchOnce() {
    const record = this.buildFinishedMatchRecord();
    if (!record) return;
    if (this.persistedMatchKeys.has(record.matchKey)) {
      log('info', 'persistence_duplicate_suppressed', { room: this.public.code, gameType: 'trivia' });
      return;
    }
    this.persistedMatchKeys.add(record.matchKey);
    log('info', 'game_finished', { room: this.public.code, gameType: 'trivia', players: record.playerDeviceIds.length });
    void persistFinishedMatch(record)
      .then((status) => log('info', 'persistence_result', { room: this.public.code, gameType: 'trivia', status }))
      .catch((err) => log('error', 'persistence_failed', { room: this.public.code, gameType: 'trivia', error: err?.message ?? String(err) }));
  }

  private buildFinishedMatchRecord() {
    const players = this.trivia.players.map((p) => ({ id: p.id, displayName: p.displayName }));
    const winnerDeviceId = this.trivia.winnerId ?? null;
    if (players.length === 0) return null;
    const playerDeviceIds = players.map((p) => p.id);
    const playerNames = Object.fromEntries(players.map((p) => [p.id, p.displayName]));
    const matchKey = buildMatchKey({ roomCode: this.public.code, gameType: 'trivia', winnerDeviceId, playerDeviceIds });
    return {
      roomCode: this.public.code,
      gameType: 'trivia' as GameType,
      winnerDeviceId,
      playerDeviceIds,
      playerNames,
      turnCount: this.trivia.round,
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
    this.servedQuestionIds.clear();
    this.locks.clear();
    this.optionOrderBySeat.clear();
    this.currentCanonicalQuestion = null;
    this.currentRoundPlan = null;
    this.trivia.players = this.trivia.players.map((p) => ({ ...p, score: 0, streak: 0, correctCount: 0 }));
    this.trivia.round = 0;
    this.trivia.questionIndex = 0;
    this.trivia.phase = 'lobby';
    this.trivia.activeCategory = null;
    this.trivia.currentQuestion = null;
    this.trivia.phaseEndsAt = null;
    this.trivia.revealedCorrectIndex = null;
    this.trivia.lastQuestionResults = [];
    this.trivia.lockedInCount = 0;
    this.trivia.winnerId = null;
    this.trivia.lastAction = 'Lobby — waiting for host.';
    this.public.status = 'lobby';
    clearPauseState(this.public);
    clearPauseRequests(this.public);
    this.broadcastPublic();
  }

  private scheduleNext(ms: number, fn: () => void) {
    if (this.phaseTimer) clearTimeout(this.phaseTimer);
    this.phaseTimer = setTimeout(() => {
      this.phaseTimer = null;
      try {
        fn();
      } catch (err) {
        log('error', 'trivia_tick_error', { room: this.public.code, error: (err as Error)?.message });
      }
    }, ms);
  }

  // ── projection helpers ───────────────────────────────────────────────
  private broadcastPublic() {
    this.public.triviaState = this.trivia;
    this.applyCanonicalPhase();
    this.syncRoomDirectory();
    const evt: ServerEvent = { type: 'public_state', state: this.public };
    this.broadcast('event', evt);
  }

  private sendPublicTo(client: Client) {
    this.public.triviaState = this.trivia;
    this.applyCanonicalPhase();
    const evt: ServerEvent = { type: 'public_state', state: this.public };
    client.send('event', evt);
  }

  /** Map detailed Trivia phase -> canonical platform phase. */
  private applyCanonicalPhase() {
    const p = this.trivia.phase;
    let next: 'lobby' | 'game_intro' | 'round_active' | 'round_resolution' | 'game_over';
    if (this.public.status === 'finished' || p === 'finished') next = 'game_over';
    else if (p === 'lobby') next = 'lobby';
    else if (p === 'intro') next = 'game_intro';
    else if (p === 'reveal' || p === 'leaderboard') next = 'round_resolution';
    else next = 'round_active'; // 'question' | 'options'
    setCanonicalPhase(this.public, next);
  }

  private sendPrivateTo(client: Client, seatId: string) {
    const base = this.privateBySeat.get(seatId) ?? { seatId };
    const priv: PrivateSeatState = { ...base };
    const evt: ServerEvent = { type: 'private_state', state: priv };
    client.send('event', evt);
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

  // ── small helpers ────────────────────────────────────────────────────
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

  private makeTriviaPlayer(id: string, displayName: string): TriviaPlayerState {
    const color = SEAT_COLORS[this.public.members.length % SEAT_COLORS.length];
    return { id, displayName, color, score: 0, streak: 0, correctCount: 0 };
  }

  private syncTriviaPlayerName(id: string, displayName: string) {
    const p = this.trivia.players.find((x) => x.id === id);
    if (p) p.displayName = displayName;
  }

  private syncRoomDirectory() {
    upsertRoom({
      code: this.public.code,
      gameType: 'trivia',
      status: this.public.status,
      roomPolicy: this.public.roomPolicy,
      players: this.public.members.length,
      maxPlayers: TRIVIA_MAX_SEATS,
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

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
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

function prettyCategory(c: string): string {
  return c.charAt(0).toUpperCase() + c.slice(1);
}
