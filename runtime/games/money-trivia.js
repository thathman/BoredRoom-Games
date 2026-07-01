// Money Trivia — original BoredRoom hot-seat cash-ladder game (internal id: 'trivia').
//
// Flow: a synchronized Fastest Finger round picks ONE contestant, who then plays a 15-question
// hot-seat ladder for a host-funded cash prize. BoredRoom only calculates/records the payout —
// it never collects or transfers money. No bots (real money). Live AI questions are forbidden;
// only pre-approved questions reach the runtime.
//
// Settings (all optional):
//   seed                number   — deterministic RNG
//   questions           array    — APPROVED questions injected by the server (required for play)
//   startingPrize       number   — ladder[0], default 100
//   topPrize            number   — ladder[14], default 5000
//   safetyNets          number[] — 1-based ladder levels that bank, default [5, 10]
//   fastestFingerSeconds number  — 8 | 10 | 15, default 10
//   questionSeconds     number   — 0 (none) | 30 | 45 | 60 | 90, default 0
//   timeoutOutcome      string   — 'walk_away' (default) | 'wrong_answer'
//   lifelines           object   — { fifty_fifty, ask_room, ask_player, ask_host } booleans
//   currency            string   — default 'NGN'

import { RuntimeBase, makeRng, shuffleInPlace, clone } from '../helpers.js';

const LADDER_LEVELS = 15;
const FF_TIE_WINDOW_MS = 100;
const DEFAULT_5000_LADDER = [100, 200, 300, 400, 500, 700, 900, 1200, 1600, 2000, 2500, 3100, 3600, 4300, 5000];
const ALL_LIFELINES = ['fifty_fifty', 'ask_room', 'ask_player', 'ask_host'];

// Round to an adaptive "nice" denomination so arbitrary ladders read cleanly.
function niceDenomination(value) {
  if (value < 1000) return 50;
  if (value < 5000) return 100;
  if (value < 20000) return 250;
  if (value < 100000) return 1000;
  return 5000;
}
function roundNice(value) {
  const d = niceDenomination(value);
  return Math.round(value / d) * d;
}

// Build the 15-step ladder. The canonical ₦100→₦5,000 ladder is used verbatim; any other
// endpoints use start + (top-start)·(i/14)^2.1, rounded nice, then forced strictly increasing
// with the exact configured endpoints preserved.
export function generateLadder(startingPrize, topPrize) {
  const start = Math.max(1, Math.round(Number(startingPrize) || 100));
  const top = Math.max(start + LADDER_LEVELS, Math.round(Number(topPrize) || 5000));
  if (start === 100 && top === 5000) return [...DEFAULT_5000_LADDER];
  const ladder = [];
  for (let i = 0; i < LADDER_LEVELS; i += 1) {
    const t = i / (LADDER_LEVELS - 1);
    ladder.push(roundNice(start + (top - start) * Math.pow(t, 2.1)));
  }
  ladder[0] = start;
  ladder[LADDER_LEVELS - 1] = top;
  // Force strictly increasing without breaking the fixed endpoints.
  for (let i = 1; i < LADDER_LEVELS - 1; i += 1) {
    if (ladder[i] <= ladder[i - 1]) ladder[i] = ladder[i - 1] + niceDenomination(ladder[i - 1]);
  }
  // If the climb overshot the top, pull the tail back down below it, staying increasing.
  for (let i = LADDER_LEVELS - 2; i >= 1; i -= 1) {
    if (ladder[i] >= top) ladder[i] = ladder[i + 1] - niceDenomination(ladder[i + 1]);
    if (ladder[i] <= ladder[i - 1]) ladder[i] = ladder[i - 1] + 1;
  }
  return ladder;
}

export class MoneyTriviaRuntime extends RuntimeBase {
  // Injectable clock so tests are deterministic; defaults to wall time on the server.
  nowMs() {
    return this._now != null ? this._now : Date.now();
  }

  start() {
    const s = this.context?.settings ?? {};
    this.seed = Number(s.seed) || (Date.now() & 0xffffffff);
    this.rng = makeRng(this.seed);
    this.currency = String(s.currency || 'NGN');
    this.ladder = generateLadder(s.startingPrize, s.topPrize);
    this.startingPrize = this.ladder[0];
    this.topPrize = this.ladder[LADDER_LEVELS - 1];
    this.safetyNets = (Array.isArray(s.safetyNets) && s.safetyNets.length
      ? s.safetyNets : [5, 10])
      .map((n) => Math.min(LADDER_LEVELS, Math.max(1, Math.trunc(Number(n)))))
      .filter((n, i, arr) => arr.indexOf(n) === i)
      .sort((a, b) => a - b);
    this.ffSeconds = [8, 10, 15].includes(Number(s.fastestFingerSeconds)) ? Number(s.fastestFingerSeconds) : 10;
    this.questionSeconds = [30, 45, 60, 90].includes(Number(s.questionSeconds)) ? Number(s.questionSeconds) : 0;
    this.timeoutOutcome = s.timeoutOutcome === 'wrong_answer' ? 'wrong_answer' : 'walk_away';
    this.lifelinesEnabled = {};
    for (const l of ALL_LIFELINES) this.lifelinesEnabled[l] = s.lifelines?.[l] !== false;

    // APPROVED questions only. The server pre-validates and injects them; live AI is forbidden.
    const supplied = Array.isArray(s.questions) ? s.questions : [];
    const valid = supplied.filter((q) => q && typeof q.prompt === 'string' && Array.isArray(q.options)
      && q.options.length === 4 && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 4);
    // Shuffle each hot-seat question's options so the correct index isn't a fixed position.
    this.hotSeatQuestions = valid.slice(0, LADDER_LEVELS).map((q) => this.shuffleOptions(q));
    // Fastest-finger questions keep their option order; a separate `order` array (default [0,1,2,3])
    // gives the correct sequence players must restore. Any leftover questions feed the FF pool.
    this.fastestFingerPool = valid.slice(LADDER_LEVELS).map((q) => this.ffQuestionFrom(q));
    if (this.fastestFingerPool.length === 0 && valid.length) this.fastestFingerPool = [this.ffQuestionFrom(valid[0])];

    this.lifelineState = { fifty_fifty: false, ask_room: false, ask_player: false, ask_host: false };
    this.contestantId = null;
    this.result = null;

    this.beginFastestFinger();
  }

  shuffleOptions(q) {
    const correctText = q.options[q.answer];
    const options = shuffleInPlace([...q.options], this.rng);
    return { prompt: q.prompt, options, answer: options.indexOf(correctText), explanation: q.explanation ?? '' };
  }

  // Fastest-finger question: present options in a shuffled display order, but remember the
  // correct sequence so a player who restores it (fastest) wins. `order` indexes the ORIGINAL
  // options; default ascending if the question doesn't define an ordering.
  ffQuestionFrom(q) {
    const order = Array.isArray(q.order) && q.order.length === 4 ? q.order.map(Number) : [0, 1, 2, 3];
    const correctSequence = order.map((i) => q.options[i]); // option texts in correct order
    const display = shuffleInPlace([...q.options], this.rng);
    return {
      prompt: q.ffPrompt ?? q.prompt,
      options: display,
      correctOrder: correctSequence.map((text) => display.indexOf(text)),
      explanation: q.explanation ?? '',
    };
  }

  eligibleContestants() {
    // Real-money game: humans only, never bots, never late audience joiners.
    return this.players.filter((p) => !p.bot);
  }

  // ── Fastest Finger ─────────────────────────────────────────────────────────
  beginFastestFinger(tiedIds = null) {
    const q = this.fastestFingerPool.length
      ? this.fastestFingerPool[this.ffIndex = ((this.ffIndex ?? -1) + 1) % this.fastestFingerPool.length]
      : null;
    this.ffQuestion = {
      prompt: q?.prompt ?? 'Put these in the correct order',
      options: q?.options ?? ['A', 'B', 'C', 'D'],
      correctOrder: q?.correctOrder ?? [0, 1, 2, 3],
    };
    this.ffEligible = (tiedIds ?? this.eligibleContestants().map((p) => p.id));
    this.ffSubmissions = {};
    this.ffStartedAt = this.nowMs();
    this.state = {
      gameType: this.gameType,
      name: this.manifest.name,
      emoji: this.manifest.emoji,
      mode: 'money-trivia',
      phase: 'fastest_finger',
      currency: this.currency,
      ladder: this.ladder,
      safetyNets: this.safetyNets,
      fastestFinger: {
        prompt: this.ffQuestion.prompt,
        options: this.ffQuestion.options,
        deadline: this.questionSecondsDeadline(this.ffSeconds),
        submittedCount: 0,
        eligibleCount: this.ffEligible.length,
        tieBreak: Boolean(tiedIds),
      },
      players: clone(this.players.map((p) => ({ id: p.id, name: p.name, score: p.score ?? 0 }))),
      contestant: null,
      lastAction: tiedIds ? 'Tie-breaker! Order them again, fastest correct wins.' : 'Fastest Finger First — order the answers!',
      winnerPlayerIds: [],
    };
  }

  questionSecondsDeadline(seconds) {
    return seconds > 0 ? this.nowMs() + seconds * 1000 : null;
  }

  submitFastestFinger(playerId, order) {
    if (this.state?.phase !== 'fastest_finger') return false;
    if (!this.ffEligible.includes(playerId) || this.ffSubmissions[playerId]) return false;
    if (!Array.isArray(order) || order.length !== 4) return false;
    const norm = order.map((n) => Number(n));
    if (new Set(norm).size !== 4 || norm.some((n) => !Number.isInteger(n) || n < 0 || n > 3)) return false;
    // Server-received elapsed time — client-supplied timestamps are ignored (anti-cheat).
    const elapsed = this.nowMs() - this.ffStartedAt;
    const correct = norm.every((v, i) => v === this.ffQuestion.correctOrder[i]);
    this.ffSubmissions[playerId] = { order: norm, elapsed, correct };
    this.state.fastestFinger.submittedCount = Object.keys(this.ffSubmissions).length;
    this.state.lastAction = `${this.playerName(playerId)} locked in their order.`;
    if (this.state.fastestFinger.submittedCount >= this.ffEligible.length) this.resolveFastestFinger();
    return true;
  }

  resolveFastestFinger() {
    const correct = Object.entries(this.ffSubmissions)
      .filter(([, v]) => v.correct)
      .map(([id, v]) => ({ id, elapsed: v.elapsed }))
      .sort((a, b) => a.elapsed - b.elapsed);
    if (correct.length === 0) {
      // Nobody correct — load another fastest-finger question.
      this.beginFastestFinger(this.ffEligible);
      this.state.lastAction = 'Nobody had it right — new question!';
      return;
    }
    const fastest = correct[0];
    const tied = correct.filter((c) => c.elapsed - fastest.elapsed <= FF_TIE_WINDOW_MS);
    if (tied.length > 1) {
      this.beginFastestFinger(tied.map((c) => c.id));
      return;
    }
    this.contestantId = fastest.id;
    this.beginHotSeat();
  }

  // ── Hot Seat ───────────────────────────────────────────────────────────────
  beginHotSeat() {
    this.level = 0; // 0-based index of the current ladder question
    this.selectedOption = null;
    this.lockedOption = null;
    this.lifelineActive = null; // { type, deadline, votes/answer }
    this.activeFifty = null; // removed option indexes
    this.setHotSeatQuestionState('reveal_pending_none');
    this.state.lastAction = `${this.playerName(this.contestantId)} takes the hot seat!`;
  }

  setHotSeatQuestionState() {
    const q = this.hotSeatQuestions[this.level];
    this.state = {
      ...this.state,
      phase: q ? 'hot_seat' : this.state.phase,
      contestant: this.contestantId
        ? { id: this.contestantId, name: this.playerName(this.contestantId) } : null,
      level: this.level,
      currentPrize: this.level > 0 ? this.ladder[this.level - 1] : 0,
      nextPrize: this.ladder[this.level] ?? this.topPrize,
      guaranteedPrize: this.guaranteedAmount(this.level),
      question: q ? { prompt: q.prompt, options: this.visibleOptions(q) } : null,
      selectedOption: this.selectedOption,
      lockedOption: this.lockedOption,
      questionDeadline: this.questionSeconds ? this.questionSecondsDeadline(this.questionSeconds) : null,
      lifelines: this.lifelineSummary(),
      lifeline: this.lifelinePublic(),
      reveal: null,
    };
    this.state.questionDeadlineAt = this.state.questionDeadline;
  }

  visibleOptions(q) {
    // After a 50:50 two wrong options are blanked (kept positional, shown as removed).
    if (!this.activeFifty) return q.options.map((label, i) => ({ label, index: i, removed: false }));
    return q.options.map((label, i) => ({ label, index: i, removed: this.activeFifty.includes(i) }));
  }

  lifelineSummary() {
    const out = {};
    for (const l of ALL_LIFELINES) out[l] = { enabled: this.lifelinesEnabled[l], used: this.lifelineState[l] };
    return out;
  }

  lifelinePublic() {
    if (!this.lifelineActive) return null;
    const base = { type: this.lifelineActive.type, deadline: this.lifelineActive.deadline };
    if (this.lifelineActive.type === 'ask_room') {
      const total = this.lifelineActive.votes.size;
      const tally = [0, 0, 0, 0];
      for (const idx of this.lifelineActive.votes.values()) tally[idx] += 1;
      base.percentages = tally.map((n) => (total ? Math.round((n / total) * 100) : 0));
      base.votesCast = total;
    }
    if (this.lifelineActive.type === 'ask_player') {
      base.helperId = this.lifelineActive.helperId;
      base.helperName = this.playerName(this.lifelineActive.helperId);
      base.recommendation = this.lifelineActive.recommendation ?? null;
    }
    if (this.lifelineActive.type === 'ask_host') {
      base.recommendation = this.lifelineActive.recommendation ?? null;
    }
    return base;
  }

  guaranteedAmount(level) {
    // Highest passed safety net at or below the number of completed questions (=level).
    let banked = 0;
    for (const net of this.safetyNets) if (level >= net) banked = this.ladder[net - 1];
    return banked;
  }

  // ── Intents ──────────────────────────────────────────────────────────────
  handleIntent(playerId, intent, isHost) {
    if (!this.state || this.state.phase === 'finished') return false;
    const type = intent?.type;

    if (type === 'fastest_finger_submit') return this.submitFastestFinger(playerId, intent.order);

    // Host/companion controls.
    if (isHost && type === 'reveal_answer') return this.revealAnswer();
    if (isHost && type === 'advance') return this.advance();
    if (isHost && type === 'host_answer') return this.recordHostAnswer(intent);
    if (isHost && type === 'resolve_timeout') return this.resolveTimeout();
    // System/host deadline tick — resolves whatever is due (FF expiry, auto-reveal, timeout,
    // lifeline expiry). The server schedules this at nextDeadline(); also safe to call directly.
    if (isHost && type === 'resolve_deadline') return this.resolveDueDeadlines();

    if (this.state.phase !== 'hot_seat') {
      // Audience votes are only meaningful during an ask_room lifeline (handled below).
      if (type === 'audience_vote') return this.recordAudienceVote(playerId, intent);
      if (type === 'friend_answer') return this.recordFriendAnswer(playerId, intent);
      return false;
    }

    // Contestant-only controls.
    const isContestant = playerId === this.contestantId;
    if (type === 'audience_vote') return this.recordAudienceVote(playerId, intent);
    if (type === 'friend_answer') return this.recordFriendAnswer(playerId, intent);
    if (!isContestant) return false;
    if (this.lockedOption != null) return false; // answer already committed

    if (type === 'select_answer') {
      const idx = Number(intent.optionIndex);
      if (!Number.isInteger(idx) || idx < 0 || idx > 3) return false;
      if (this.activeFifty?.includes(idx)) return false;
      this.selectedOption = idx;
      this.state.selectedOption = idx;
      this.state.lastAction = 'Answer selected — confirm Final answer to lock it in.';
      return true;
    }
    if (type === 'lock_answer') {
      if (this.selectedOption == null) return false;
      this.lockedOption = this.selectedOption;
      this.state.lockedOption = this.lockedOption;
      this.state.lastAction = `Final answer locked. ${this.playerName(this.contestantId)} is going for ₦${this.ladder[this.level]}.`;
      // Auto-reveal fallback is scheduled by the server (4s); host may reveal sooner.
      this.state.reveal = { pending: true, autoRevealDeadline: this.nowMs() + 4000 };
      return true;
    }
    if (type === 'walk_away') return this.walkAway();
    if (type === 'use_lifeline') return this.useLifeline(intent);
    return false;
  }

  // ── Lifelines ──────────────────────────────────────────────────────────────
  useLifeline(intent) {
    const l = String(intent?.lifeline ?? '');
    if (!ALL_LIFELINES.includes(l) || !this.lifelinesEnabled[l] || this.lifelineState[l]) return false;
    if (this.lockedOption != null || this.lifelineActive) return false;
    const q = this.hotSeatQuestions[this.level];
    if (!q) return false;
    this.lifelineState[l] = true;

    if (l === 'fifty_fifty') {
      const wrong = q.options.map((_, i) => i).filter((i) => i !== q.answer);
      shuffleInPlace(wrong, this.rng);
      this.activeFifty = wrong.slice(0, 2).sort((a, b) => a - b);
      this.state.lastAction = '50:50 — two wrong answers removed.';
      this.refreshHotSeat();
      return true;
    }
    // The three interactive lifelines pause the question timer for their duration.
    this.pauseQuestionTimer();
    if (l === 'ask_room') {
      this.lifelineActive = { type: 'ask_room', deadline: this.nowMs() + 15000, votes: new Map() };
      this.state.lastAction = 'Ask the Room — audience, vote now!';
      this.refreshHotSeat();
      return true;
    }
    if (l === 'ask_player') {
      const helperId = String(intent?.targetPlayerId ?? '');
      const valid = this.players.some((p) => p.id === helperId && p.id !== this.contestantId && !p.bot);
      if (!valid) { this.lifelineState[l] = false; return false; }
      this.lifelineActive = { type: 'ask_player', deadline: this.nowMs() + 30000, helperId, recommendation: null };
      this.state.lastAction = `Ask a Player — ${this.playerName(helperId)}, what do you think?`;
      this.refreshHotSeat();
      return true;
    }
    if (l === 'ask_host') {
      this.lifelineActive = { type: 'ask_host', deadline: this.nowMs() + 30000, recommendation: null };
      this.state.lastAction = 'Ask the Host for a recommendation.';
      this.refreshHotSeat();
      return true;
    }
    return false;
  }

  recordAudienceVote(playerId, intent) {
    if (this.lifelineActive?.type !== 'ask_room') return false;
    if (playerId === this.contestantId) return false; // contestant can't vote
    if (this.lifelineActive.votes.has(playerId)) return false; // one vote per device
    const idx = Number(intent?.optionIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx > 3) return false;
    if (this.activeFifty?.includes(idx)) return false;
    this.lifelineActive.votes.set(playerId, idx);
    this.refreshHotSeat();
    return true;
  }

  recordFriendAnswer(playerId, intent) {
    if (this.lifelineActive?.type !== 'ask_player' || playerId !== this.lifelineActive.helperId) return false;
    const idx = Number(intent?.optionIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx > 3) return false;
    const confidence = Math.min(100, Math.max(0, Math.trunc(Number(intent?.confidence) || 50)));
    this.lifelineActive.recommendation = { optionIndex: idx, confidence };
    // The lifeline period ends as soon as the helper answers — close it and resume the timer.
    this.closeLifeline();
    return true;
  }

  recordHostAnswer(intent) {
    if (this.lifelineActive?.type !== 'ask_host') return false;
    const idx = Number(intent?.optionIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx > 3) return false;
    const confidence = Math.min(100, Math.max(0, Math.trunc(Number(intent?.confidence) || 50)));
    this.lifelineActive.recommendation = { optionIndex: idx, confidence };
    this.closeLifeline();
    return true;
  }

  // ── Question-timer pause/resume + lifeline close ────────────────────────────
  pauseQuestionTimer() {
    if (this.state?.questionDeadline) {
      this.state.questionRemainingMs = Math.max(0, this.state.questionDeadline - this.nowMs());
      this.state.questionDeadline = null;
      this.state.questionDeadlineAt = null;
    }
  }

  // End the active lifeline: preserve its hint so the contestant can still see it, then resume the
  // question timer with the remaining time, guaranteed at least 15 seconds.
  closeLifeline() {
    const la = this.lifelineActive;
    if (la) {
      if (la.type === 'ask_room') {
        const total = la.votes.size;
        const tally = [0, 0, 0, 0];
        for (const idx of la.votes.values()) tally[idx] += 1;
        this.state.lastLifelineHint = { type: 'ask_room', percentages: tally.map((n) => (total ? Math.round((n / total) * 100) : 0)), votesCast: total };
      } else if (la.recommendation) {
        this.state.lastLifelineHint = { type: la.type, recommendation: la.recommendation, helperName: la.helperId ? this.playerName(la.helperId) : undefined };
      }
      this.lifelineActive = null;
    }
    // Resume the question timer with >= 15s remaining if a timer is configured.
    if (this.state.questionRemainingMs != null) {
      const resume = Math.max(this.state.questionRemainingMs, 15000);
      this.state.questionDeadline = this.nowMs() + resume;
      this.state.questionDeadlineAt = this.state.questionDeadline;
      this.state.questionRemainingMs = null;
    }
    this.refreshHotSeat();
  }

  // Earliest active runtime deadline (epoch ms) the server should schedule a resolver for.
  nextDeadline() {
    if (!this.state) return null;
    const candidates = [];
    if (this.state.phase === 'fastest_finger') candidates.push(this.state.fastestFinger?.deadline);
    if (this.state.phase === 'hot_seat') {
      if (this.lifelineActive) candidates.push(this.lifelineActive.deadline);
      else {
        if (this.state.reveal?.pending) candidates.push(this.state.reveal.autoRevealDeadline);
        if (this.state.questionDeadline) candidates.push(this.state.questionDeadline);
      }
    }
    const active = candidates.filter((d) => typeof d === 'number');
    return active.length ? Math.min(...active) : null;
  }

  // Resolve whatever deadline(s) are due at `now`. Returns true if state changed. Idempotent.
  resolveDueDeadlines(now = this.nowMs()) {
    if (!this.state || this.state.phase === 'finished') return false;
    let changed = false;
    if (this.state.phase === 'fastest_finger' && this.state.fastestFinger?.deadline && now >= this.state.fastestFinger.deadline) {
      this.resolveFastestFinger(); // resolve with whatever submissions were received
      return true;
    }
    if (this.state.phase === 'hot_seat') {
      if (this.lifelineActive && now >= this.lifelineActive.deadline) { this.closeLifeline(); changed = true; }
      else if (this.state.reveal?.pending && this.state.reveal.autoRevealDeadline && now >= this.state.reveal.autoRevealDeadline && this.lockedOption != null) {
        this.revealAnswer(); changed = true;
      } else if (this.state.questionDeadline && now >= this.state.questionDeadline && this.lockedOption == null && !this.lifelineActive) {
        this.resolveTimeout(); changed = true;
      }
    }
    return changed;
  }

  // Game-level pause/resume (player disconnect): freeze and shift every deadline so nothing fires
  // while paused. Lifeline question-timer pause is separate (handled above).
  pauseTimers(now = this.nowMs()) {
    if (this.state?.pausedAt) return;
    if (this.state) this.state.pausedAt = now;
  }

  resumeTimers(now = this.nowMs()) {
    if (!this.state?.pausedAt) return;
    const delta = now - this.state.pausedAt;
    const shift = (v) => (typeof v === 'number' ? v + delta : v);
    if (this.state.fastestFinger?.deadline) this.state.fastestFinger.deadline = shift(this.state.fastestFinger.deadline);
    if (this.state.questionDeadline) { this.state.questionDeadline = shift(this.state.questionDeadline); this.state.questionDeadlineAt = this.state.questionDeadline; }
    if (this.state.reveal?.autoRevealDeadline) this.state.reveal.autoRevealDeadline = shift(this.state.reveal.autoRevealDeadline);
    if (this.lifelineActive) this.lifelineActive.deadline = shift(this.lifelineActive.deadline);
    this.state.pausedAt = null;
  }

  refreshHotSeat() {
    this.state.question = this.hotSeatQuestions[this.level]
      ? { prompt: this.hotSeatQuestions[this.level].prompt, options: this.visibleOptions(this.hotSeatQuestions[this.level]) }
      : null;
    this.state.lifelines = this.lifelineSummary();
    this.state.lifeline = this.lifelinePublic();
  }

  // ── Resolution ───────────────────────────────────────────────────────────
  revealAnswer() {
    if (this.state.phase !== 'hot_seat' || this.lockedOption == null) return false;
    const q = this.hotSeatQuestions[this.level];
    const correct = this.lockedOption === q.answer;
    this.lifelineActive = null;
    this.state.reveal = {
      pending: false,
      correctIndex: q.answer,
      chosenIndex: this.lockedOption,
      correct,
      explanation: q.explanation,
    };
    if (correct) {
      const player = this.players.find((p) => p.id === this.contestantId);
      if (player) player.score = this.ladder[this.level];
      this.state.lastAction = `Correct! ${this.playerName(this.contestantId)} is on ₦${this.ladder[this.level]}.`;
      if (this.level >= LADDER_LEVELS - 1) {
        this.finishRun('top_prize', this.topPrize);
      }
    } else {
      const earned = this.guaranteedAmount(this.level);
      this.finishRun('wrong_answer', earned);
      this.state.lastAction = `Wrong answer — the answer was ${q.options[q.answer]}. ${this.playerName(this.contestantId)} leaves with ₦${earned}.`;
    }
    return true;
  }

  advance() {
    if (this.state.phase !== 'hot_seat') return false;
    if (!this.state.reveal || this.state.reveal.pending || this.state.reveal.correctIndex == null) return false;
    if (!this.state.reveal.correct) return false; // wrong answer already finished the run
    this.level += 1;
    this.selectedOption = null;
    this.lockedOption = null;
    this.activeFifty = null;
    this.lifelineActive = null;
    if (this.level >= LADDER_LEVELS || !this.hotSeatQuestions[this.level]) {
      this.finishRun('top_prize', this.topPrize);
      return true;
    }
    this.setHotSeatQuestionState();
    this.state.lastAction = `Question ${this.level + 1} for ₦${this.ladder[this.level]}.`;
    return true;
  }

  walkAway() {
    if (this.state.phase !== 'hot_seat') return false;
    const earned = this.level > 0 ? this.ladder[this.level - 1] : 0;
    this.finishRun('walked_away', earned);
    this.state.lastAction = `${this.playerName(this.contestantId)} walks away with ₦${earned}.`;
    return true;
  }

  resolveTimeout() {
    if (this.state.phase !== 'hot_seat') return false;
    if (this.timeoutOutcome === 'wrong_answer') {
      const earned = this.guaranteedAmount(this.level);
      this.finishRun('timeout_wrong', earned);
      this.state.lastAction = `Time up — counted as wrong. ${this.playerName(this.contestantId)} leaves with ₦${earned}.`;
    } else {
      const earned = this.level > 0 ? this.ladder[this.level - 1] : 0;
      this.finishRun('timeout_walk', earned);
      this.state.lastAction = `Time up — walking away with ₦${earned}.`;
    }
    return true;
  }

  finishRun(outcome, earnedAmount) {
    this.state.phase = 'finished';
    this.state.reveal = this.state.reveal ?? null;
    this.result = {
      contestantId: this.contestantId,
      contestantName: this.playerName(this.contestantId),
      pledgedPrize: this.topPrize,
      earnedAmount,
      outcome,
      currency: this.currency,
      settlementStatus: 'unsettled',
    };
    // A contestant who leaves with > ₦0 counts as the game winner (no score multiplication).
    this.state.winnerPlayerIds = earnedAmount > 0 && this.contestantId ? [this.contestantId] : [];
    this.state.result = clone(this.result);
    this.state.contestant = this.contestantId
      ? { id: this.contestantId, name: this.playerName(this.contestantId) } : null;
  }

  playerName(playerId) {
    return this.players.find((p) => p.id === playerId)?.name ?? 'A player';
  }

  // ── Projections (correct answer NEVER leaks pre-reveal) ─────────────────────
  publicState() {
    return clone(this.state);
  }

  privateState(playerId) {
    const isContestant = playerId === this.contestantId;
    return {
      seated: this.seated(playerId),
      isContestant,
      role: isContestant ? 'contestant' : (this.contestantId ? 'audience' : 'fastest_finger'),
      fastestFingerSubmitted: this.ffSubmissions?.[playerId] != null,
      isHelper: this.lifelineActive?.type === 'ask_player' && this.lifelineActive.helperId === playerId,
      legalIntents: this.legalIntents(playerId),
    };
  }

  companionState() {
    // Host gets reveal/advance/ask-host context but never the correct index before reveal.
    return clone(this.state);
  }

  crowdState() {
    return clone(this.state);
  }

  legalIntents(playerId) {
    if (!this.state) return [];
    if (this.state.phase === 'fastest_finger') {
      if (this.ffEligible?.includes(playerId) && !this.ffSubmissions[playerId]) {
        return [{ type: 'fastest_finger_submit' }];
      }
      return [];
    }
    if (this.state.phase !== 'hot_seat') return [];
    const out = [];
    if (this.lifelineActive?.type === 'ask_room' && playerId !== this.contestantId
      && !this.lifelineActive.votes.has(playerId)) out.push({ type: 'audience_vote' });
    if (this.lifelineActive?.type === 'ask_player' && playerId === this.lifelineActive.helperId
      && !this.lifelineActive.recommendation) out.push({ type: 'friend_answer' });
    if (playerId === this.contestantId && this.lockedOption == null) {
      out.push({ type: 'select_answer' });
      if (this.selectedOption != null) out.push({ type: 'lock_answer' });
      out.push({ type: 'walk_away' });
      for (const l of ALL_LIFELINES) {
        if (this.lifelinesEnabled[l] && !this.lifelineState[l] && !this.lifelineActive) out.push({ type: 'use_lifeline', lifeline: l });
      }
    }
    return out;
  }

  // No bots in a real-money game.
  rankBotIntent() {
    return null;
  }

  finish() {
    if (this.state && this.state.phase !== 'finished') {
      // Host-forced end before a natural finish: treat as walk-away at the current floor.
      this.walkAway?.();
    }
    return { winnerPlayerIds: clone(this.state?.winnerPlayerIds ?? []), result: clone(this.result) };
  }

  recapSignals() {
    return {
      mode: 'money-trivia',
      result: clone(this.result),
      ladder: this.ladder,
      scores: this.players.map(({ id, score }) => ({ playerId: id, score: score ?? 0 })),
    };
  }

  extraSnapshot() {
    return {
      seed: this.seed,
      ladder: this.ladder,
      safetyNets: this.safetyNets,
      hotSeatQuestions: this.hotSeatQuestions,
      fastestFingerPool: this.fastestFingerPool,
      ffIndex: this.ffIndex,
      contestantId: this.contestantId,
      level: this.level,
      selectedOption: this.selectedOption,
      lockedOption: this.lockedOption,
      activeFifty: this.activeFifty,
      lifelineState: this.lifelineState,
      lifelineActive: this.lifelineActive
        ? { ...this.lifelineActive, votes: this.lifelineActive.votes ? [...this.lifelineActive.votes] : undefined }
        : null,
      ffQuestion: this.ffQuestion,
      ffEligible: this.ffEligible,
      ffSubmissions: this.ffSubmissions,
      ffStartedAt: this.ffStartedAt,
      result: this.result,
      currency: this.currency,
      startingPrize: this.startingPrize,
      topPrize: this.topPrize,
      timeoutOutcome: this.timeoutOutcome,
      questionSeconds: this.questionSeconds,
      ffSeconds: this.ffSeconds,
      lifelinesEnabled: this.lifelinesEnabled,
    };
  }

  restoreExtra(extra) {
    if (!extra) return;
    this.seed = extra.seed;
    this.rng = makeRng((extra.seed ?? 1) >>> 0);
    this.ladder = extra.ladder;
    this.safetyNets = extra.safetyNets;
    this.hotSeatQuestions = extra.hotSeatQuestions ?? [];
    this.fastestFingerPool = extra.fastestFingerPool ?? [];
    this.ffIndex = extra.ffIndex;
    this.contestantId = extra.contestantId;
    this.level = extra.level ?? 0;
    this.selectedOption = extra.selectedOption ?? null;
    this.lockedOption = extra.lockedOption ?? null;
    this.activeFifty = extra.activeFifty ?? null;
    this.lifelineState = extra.lifelineState ?? { fifty_fifty: false, ask_room: false, ask_player: false, ask_host: false };
    this.lifelineActive = extra.lifelineActive
      ? { ...extra.lifelineActive, votes: extra.lifelineActive.votes ? new Map(extra.lifelineActive.votes) : undefined }
      : null;
    this.ffQuestion = extra.ffQuestion;
    this.ffEligible = extra.ffEligible ?? [];
    this.ffSubmissions = extra.ffSubmissions ?? {};
    this.ffStartedAt = extra.ffStartedAt ?? this.nowMs();
    this.result = extra.result ?? null;
    this.currency = extra.currency ?? 'NGN';
    this.startingPrize = extra.startingPrize;
    this.topPrize = extra.topPrize;
    this.timeoutOutcome = extra.timeoutOutcome ?? 'walk_away';
    this.questionSeconds = extra.questionSeconds ?? 0;
    this.ffSeconds = extra.ffSeconds ?? 10;
    this.lifelinesEnabled = extra.lifelinesEnabled ?? { fifty_fifty: true, ask_room: true, ask_player: true, ask_host: true };
  }
}
