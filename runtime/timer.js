// Server-authoritative timer system for BoredRoom games.
//
// Server owns timing. Client timers are visual only.
// Speed is decided by server submission timestamp, not client time, AI time,
// or transcription completion time.
//
// Usage:
//   import { createTimer } from './timer.js';
//   const timer = createTimer({ roundMs: 30000 });
//   timer.start('round-1');
//   timer.submit('player-1');            // record server-time submission
//   const results = timer.close();        // lock, compute speed rankings
//   timer.snapshot() / timer.restore(s)   // reconnect-safe

import { clone } from './helpers.js';

export const TIMER_PHASES = {
  PRE_COUNTDOWN: 'pre_countdown',
  ACCEPTING_ANSWERS: 'accepting_answers',
  LOCKED: 'locked',
  REVEAL: 'reveal',
  COUNTDOWN_TO_NEXT: 'countdown_to_next',
  COMPLETE: 'complete',
};

export const SCORING_MODES = {
  CORRECTNESS_ONLY: 'correctness_only',
  CORRECTNESS_PLUS_SPEED_BONUS: 'correctness_plus_speed_bonus',
  FASTEST_CORRECT_WINS: 'fastest_correct_wins',
  RANKED_SPEED_POINTS: 'ranked_speed_points',
  CLOSEST_ANSWER_PLUS_SPEED_BONUS: 'closest_answer_plus_speed_bonus',
};

/**
 * Create a server-authoritative timer.
 *
 * @param {object} options
 * @param {number} options.roundMs       - Max ms for answer phase (default 30000)
 * @param {number} options.preCountdownMs - Pre-round countdown ms (default 5000)
 * @param {number} options.revealMs      - Reveal phase duration ms (default 8000)
 * @param {number} options.nextRoundMs   - Countdown to next round ms (default 5000)
 * @param {number} options.speedBonusWeight - How much speed matters (0-1, default 0.3)
 * @param {string} options.scoringMode   - One of SCORING_MODES (default CORRECTNESS_PLUS_SPEED_BONUS)
 * @param {boolean} options.autoAdvance  - Auto advance after reveal (default false)
 * @param {boolean} options.overtime     - Allow a brief overtime window (default false)
 * @param {number}  options.overtimeMs   - Overtime window ms (default 2000)
 * @param {number}  options.earlyRevealThreshold - Reveal early when this many submit (0 = disabled)
 */
export function createTimer(options = {}) {
  const {
    roundMs = 30000,
    preCountdownMs = 5000,
    revealMs = 8000,
    nextRoundMs = 5000,
    speedBonusWeight = 0.3,
    scoringMode = SCORING_MODES.CORRECTNESS_PLUS_SPEED_BONUS,
    autoAdvance = false,
    overtime = false,
    overtimeMs = 2000,
    earlyRevealThreshold = 0,
  } = options;

  /** @type {Record<string, TimerState>} */
  const rounds = {};
  const timerHandles = [];
  let disposed = false;

  /**
   * @typedef {object} TimerRound
   * @property {string} roundId
   * @property {string} phase
   * @property {number} openedAtServer
   * @property {number} closesAtServer
   * @property {number|null} pausedAtServer
   * @property {number|null} resumedAtServer
   * @property {number|null} remainingMsAtPause
   * @property {number|null} revealAtServer
   * @property {number|null} nextRoundAtServer
   * @property {Record<string,number>} submittedAtServerByPlayer
   * @property {Record<string,number>} timeTakenMsByPlayer
   * @property {string[]} lockedPlayerIds
   * @property {string[]} latePlayerIds
   * @property {string[]} fastestCorrectPlayerIds
   * @property {object} timerSettings
   */

  function _schedule(fn, ms) {
    if (ms > 0 && ms < 1e9) {
      const handle = setTimeout(() => {
        if (!disposed) fn();
      }, ms);
      timerHandles.push(handle);
    }
  }

  function _clearAllTimers() {
    for (const handle of timerHandles) {
      clearTimeout(handle);
    }
    timerHandles.length = 0;
  }

  function _now() {
    return Date.now();
  }

  const api = {
    /**
     * Start a new round timer.
     * @param {string} roundId
     * @param {object} [overrides] - Override any timer settings for this round
     */
    start(roundId, overrides = {}) {
      const cfg = { roundMs, preCountdownMs, revealMs, nextRoundMs, overtime, overtimeMs, earlyRevealThreshold, ...overrides };
      const now = _now();

      /** @type {TimerRound} */
      const round = {
        roundId,
        phase: TIMER_PHASES.PRE_COUNTDOWN,
        openedAtServer: now,
        closesAtServer: now + cfg.preCountdownMs + cfg.roundMs,
        pausedAtServer: null,
        resumedAtServer: null,
        remainingMsAtPause: null,
        revealAtServer: null,
        nextRoundAtServer: null,
        submittedAtServerByPlayer: {},
        timeTakenMsByPlayer: {},
        lockedPlayerIds: [],
        latePlayerIds: [],
        fastestCorrectPlayerIds: [],
        timerSettings: cfg,
      };
      rounds[roundId] = round;

      // Schedule transition to accepting answers after pre-countdown
      _schedule(() => {
        if (rounds[roundId]?.phase === TIMER_PHASES.PRE_COUNTDOWN) {
          round.phase = TIMER_PHASES.ACCEPTING_ANSWERS;
          round.closesAtServer = _now() + cfg.roundMs;
          // Schedule lock
          _schedule(() => api.lock(roundId), cfg.roundMs);
        }
      }, cfg.preCountdownMs);

      return round;
    },

    /**
     * Get current round state.
     * @param {string} roundId
     * @returns {TimerRound|undefined}
     */
    round(roundId) {
      return rounds[roundId];
    },

    /**
     * Record a player's submission at server time.
     * Returns the time taken in ms.
     * @param {string} roundId
     * @param {string} playerId
     * @returns {{ accepted: boolean, timeTakenMs: number, message: string }}
     */
    submit(roundId, playerId) {
      const round = rounds[roundId];
      if (!round) return { accepted: false, timeTakenMs: 0, message: 'Round not found' };

      // Already submitted
      if (round.submittedAtServerByPlayer[playerId] !== undefined) {
        return { accepted: false, timeTakenMs: 0, message: 'Already submitted' };
      }

      // Already locked
      if (round.lockedPlayerIds.includes(playerId)) {
        return { accepted: false, timeTakenMs: 0, message: 'Player is locked' };
      }

      // Late? (after close, or in locked phase)
      const now = _now();
      if (round.phase === TIMER_PHASES.LOCKED || now > round.closesAtServer + (round.timerSettings.overtime ? round.timerSettings.overtimeMs : 0)) {
        round.latePlayerIds.push(playerId);
        round.lockedPlayerIds.push(playerId);
        return { accepted: false, timeTakenMs: 0, message: 'Too late' };
      }

      const opened = round.pausedAtServer ?? round.resumedAtServer ?? round.openedAtServer;
      const timeTakenMs = now - opened;
      round.submittedAtServerByPlayer[playerId] = now;
      round.timeTakenMsByPlayer[playerId] = timeTakenMs;
      round.lockedPlayerIds.push(playerId);

      // Early reveal check — if earlyRevealThreshold > 0 and enough players submitted
      const submittedCount = Object.keys(round.submittedAtServerByPlayer).length;
      if (round.timerSettings.earlyRevealThreshold > 0 && submittedCount >= round.timerSettings.earlyRevealThreshold) {
        _clearAllTimers();
        round.phase = TIMER_PHASES.LOCKED;
        return { accepted: true, timeTakenMs, message: 'Accepted (early reveal)' };
      }

      return { accepted: true, timeTakenMs, message: 'Accepted' };
    },

    /**
     * Lock the current round — stop accepting submissions.
     * @param {string} roundId
     * @returns {TimerRound|undefined}
     */
    lock(roundId) {
      const round = rounds[roundId];
      if (!round) return undefined;
      _clearAllTimers();
      round.phase = TIMER_PHASES.LOCKED;
      // Mark any unsubmitted players as late
      for (const player of (api._players ?? [])) {
        if (round.submittedAtServerByPlayer[player.id] === undefined && !round.lockedPlayerIds.includes(player.id)) {
          round.latePlayerIds.push(player.id);
          round.lockedPlayerIds.push(player.id);
        }
      }
      return round;
    },

    /**
     * Advance to reveal phase.
     * @param {string} roundId
     * @returns {TimerRound|undefined}
     */
    reveal(roundId) {
      const round = rounds[roundId];
      if (!round) return undefined;
      round.phase = TIMER_PHASES.REVEAL;
      round.revealAtServer = _now();
      _schedule(() => {
        const r = rounds[roundId];
        if (r && r.phase === TIMER_PHASES.REVEAL) {
          r.phase = TIMER_PHASES.COUNTDOWN_TO_NEXT;
          r.nextRoundAtServer = _now();
          _schedule(() => {
            const r2 = rounds[roundId];
            if (r2) r2.phase = TIMER_PHASES.COMPLETE;
          }, r.timerSettings.nextRoundMs);
        }
      }, round.timerSettings.revealMs);
      return round;
    },

    /**
     * Compute speed rankings for correct submissions.
     * Must be called after lock, before or during reveal.
     *
     * @param {string} roundId
     * @param {function(string): boolean} isCorrectFn - (playerId) => boolean
     * @returns {{ fastestCorrectPlayerIds: string[], speedPoints: Record<string,number>, ranked: Array<{playerId:string,timeTakenMs:number,fastest:boolean}> }}
     */
    speedRank(roundId, isCorrectFn) {
      const round = rounds[roundId];
      if (!round) return { fastestCorrectPlayerIds: [], speedPoints: {}, ranked: [] };

      const submitted = Object.entries(round.submittedAtServerByPlayer)
        .filter(([playerId]) => isCorrectFn(playerId))
        .sort(([, a], [, b]) => a - b);

      const fastestCorrectPlayerIds = submitted.length > 0 ? [submitted[0][0]] : [];
      round.fastestCorrectPlayerIds = fastestCorrectPlayerIds;

      const speedPoints = {};
      const ranked = submitted.map(([playerId, timestamp], index) => {
        const timeTakenMs = round.timeTakenMsByPlayer[playerId] ?? 0;
        const isFastest = index === 0;
        const rank = index + 1;

        let points = 0;
        switch (scoringMode) {
          case SCORING_MODES.FASTEST_CORRECT_WINS:
            points = isFastest ? 100 : 0;
            break;
          case SCORING_MODES.RANKED_SPEED_POINTS: {
            const total = submitted.length;
            points = total > 0 ? Math.round(100 * (1 - (rank - 1) / total)) : 0;
            break;
          }
          case SCORING_MODES.CORRECTNESS_PLUS_SPEED_BONUS:
            points = Math.round(100 * speedBonusWeight * (1 - index / Math.max(1, submitted.length)));
            break;
          case SCORING_MODES.CLOSEST_ANSWER_PLUS_SPEED_BONUS:
            points = Math.round(100 * speedBonusWeight * (1 - index / Math.max(1, submitted.length)));
            break;
          case SCORING_MODES.CORRECTNESS_ONLY:
          default:
            points = 0;
            break;
        }

        speedPoints[playerId] = points;
        return { playerId, timeTakenMs, fastest: isFastest, rank, points };
      });

      return { fastestCorrectPlayerIds, speedPoints, ranked };
    },

    /**
     * Pause the timer — preserve remaining time.
     * @param {string} roundId
     */
    pause(roundId) {
      const round = rounds[roundId];
      if (!round || round.phase !== TIMER_PHASES.ACCEPTING_ANSWERS) return;
      _clearAllTimers();
      round.pausedAtServer = _now();
      round.remainingMsAtPause = Math.max(0, round.closesAtServer - _now());
      round.phase = TIMER_PHASES.ACCEPTING_ANSWERS;
    },

    /**
     * Resume the timer — restore remaining time.
     * @param {string} roundId
     */
    resume(roundId) {
      const round = rounds[roundId];
      if (!round || round.phase !== TIMER_PHASES.ACCEPTING_ANSWERS || round.remainingMsAtPause == null) return;
      round.resumedAtServer = _now();
      round.closesAtServer = _now() + round.remainingMsAtPause;
      round.remainingMsAtPause = null;

      _schedule(() => api.lock(roundId), round.closesAtServer - _now());
    },

    /**
     * Extend the current round timer by additional ms.
     * @param {string} roundId
     * @param {number} extraMs
     */
    extend(roundId, extraMs) {
      const round = rounds[roundId];
      if (!round || round.phase !== TIMER_PHASES.ACCEPTING_ANSWERS) return;
      round.closesAtServer += extraMs;
      _schedule(() => api.lock(roundId), round.closesAtServer - _now());
    },

    /**
     * Remaining milliseconds for the current phase (server time, not client).
     * @param {string} roundId
     * @returns {number}
     */
    remainingMs(roundId) {
      const round = rounds[roundId];
      if (!round) return 0;
      if (round.remainingMsAtPause != null) return round.remainingMsAtPause;
      if (round.phase === TIMER_PHASES.LOCKED || round.phase === TIMER_PHASES.COMPLETE) return 0;
      return Math.max(0, round.closesAtServer - _now());
    },

    /**
     * The current phase for a round.
     * @param {string} roundId
     * @returns {string}
     */
    phase(roundId) {
      return rounds[roundId]?.phase ?? TIMER_PHASES.COMPLETE;
    },

    /**
     * Snapshot the timer state for reconnect safety.
     * @returns {object}
     */
    snapshot() {
      return clone({ rounds, options });
    },

    /**
     * Restore timer state from a snapshot.
     * @param {object} snap
     */
    restore(snap) {
      if (!snap) return;
      Object.keys(rounds).forEach((k) => delete rounds[k]);
      if (snap.rounds) {
        Object.entries(snap.rounds).forEach(([id, round]) => {
          rounds[id] = clone(round);
        });
      }
    },

    /**
     * Skip the current phase and advance to the next.
     * @param {string} roundId
     */
    skip(roundId) {
      const round = rounds[roundId];
      if (!round) return;
      _clearAllTimers();
      switch (round.phase) {
        case TIMER_PHASES.PRE_COUNTDOWN:
          round.phase = TIMER_PHASES.ACCEPTING_ANSWERS;
          round.closesAtServer = _now() + (round.timerSettings?.roundMs ?? roundMs);
          _schedule(() => api.lock(roundId), round.timerSettings?.roundMs ?? roundMs);
          break;
        case TIMER_PHASES.ACCEPTING_ANSWERS:
          api.lock(roundId);
          break;
        case TIMER_PHASES.REVEAL:
          round.phase = TIMER_PHASES.COUNTDOWN_TO_NEXT;
          round.nextRoundAtServer = _now();
          break;
        case TIMER_PHASES.COUNTDOWN_TO_NEXT:
          round.phase = TIMER_PHASES.COMPLETE;
          break;
        default:
          break;
      }
    },

    /**
     * Force reveal now.
     * @param {string} roundId
     */
    forceReveal(roundId) {
      const round = rounds[roundId];
      if (!round) return;
      api.lock(roundId);
      this.reveal(roundId);
    },

    /**
     * Clean up all timers.
     */
    dispose() {
      disposed = true;
      _clearAllTimers();
      Object.keys(rounds).forEach((k) => delete rounds[k]);
    },

    /**
     * Register player list for late detection.
     * @param {Array<{id:string}>} players
     */
    setPlayers(players) {
      api._players = players;
    },
  };

  return api;
}
