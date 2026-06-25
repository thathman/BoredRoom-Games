// Pure Color Wahala engine. Stroop-effect speed game.
// No I/O, no timers — server runs the loop and calls into these helpers.

import { COLOR_IDS, COLOR_PALETTE, ColorEntry, ColorId, colorById } from './palette.js';

export type ColorWahalaPhase =
  | 'lobby'
  | 'intro'
  | 'prompt'    // 1s "get ready" countdown
  | 'answer'   // tap window open
  | 'reveal'   // correct answer + per-player deltas
  | 'finished';

export type ColorWahalaMode = 'say_word' | 'say_color' | 'say_heard';

export interface ColorWahalaSettings {
  rounds: number;
  /** Initial answer (lock) window in ms. */
  startLockMs: number;
  /** Final answer window in ms (ramps linearly to this on the last round). */
  endLockMs: number;
  /** Hold ms before next prompt. */
  revealHoldMs: number;
  /** Mode mix probabilities (must sum to 1). */
  modeMix: { say_word: number; say_color: number; say_heard: number };
  /** First-correct bonus points. */
  firstCorrectBonus: number;
  /** Whether the say_heard mode is enabled (host can disable if no TTS). */
  audioEnabled: boolean;
}

export const DEFAULT_COLORWAHALA_SETTINGS: ColorWahalaSettings = {
  rounds: 15,
  startLockMs: 6000,
  endLockMs: 2500,
  revealHoldMs: 2500,
  modeMix: { say_word: 0.6, say_color: 0.25, say_heard: 0.15 },
  firstCorrectBonus: 250,
  audioEnabled: false,
};

export interface ColorWahalaPrompt {
  /** Round index (1-based for UI). */
  round: number;
  mode: ColorWahalaMode;
  /** Word printed. */
  word: ColorEntry;
  /** Ink color the word is rendered in. */
  ink: ColorEntry;
  /** For say_heard: the spoken color (TTS source). null otherwise. */
  heard: ColorEntry | null;
  /** Correct answer for this prompt. */
  answer: ColorId;
  /** Lock window in ms for this prompt. */
  lockMs: number;
}

export interface ColorWahalaPlayerState {
  id: string;
  displayName: string;
  color?: string;
  score: number;
  correctCount: number;
  /** Best (longest) consecutive correct streak. */
  bestStreak: number;
  /** Current consecutive correct streak (in-progress). */
  currentStreak: number;
  /** Sum of latencies (ms) of correct taps, for "fastest avg" recap. */
  totalLatencyMs: number;
  isBot?: boolean;
}

export interface ColorWahalaTap {
  playerId: string;
  pickedColor: ColorId;
  /** Server-side ms when the tap arrived. */
  serverTs: number;
  /** Latency from prompt start in ms. */
  latencyMs: number;
  correct: boolean;
}

export interface ColorWahalaPlayerResult {
  playerId: string;
  pickedColor: ColorId | null;
  correct: boolean;
  pointsAwarded: number;
  latencyMs: number | null;
  speedRank: number | null;
  lockedOut: boolean;
}

export interface ColorWahalaPublicState {
  phase: ColorWahalaPhase;
  settings: ColorWahalaSettings;
  players: ColorWahalaPlayerState[];
  round: number;
  /** Public-safe prompt — `answer` is omitted until reveal. */
  currentPrompt: {
    mode: ColorWahalaMode;
    word: ColorId;
    ink: ColorId;
    /** When mode === 'say_heard' the TTS color is sent. Otherwise null. */
    heard: ColorId | null;
    lockMs: number;
  } | null;
  phaseEndsAt: number | null;
  /** Revealed only during 'reveal' phase. */
  revealedAnswer: ColorId | null;
  lastRoundResults: ColorWahalaPlayerResult[];
  /** Number of seats that locked-out wrong this round. */
  wrongCount: number;
  winnerId: string | null;
  lastAction: string;
}

export interface ColorWahalaPrivateState {
  /** Has this seat already tapped this round (right or wrong). */
  hasTapped: boolean;
  /** Color they tapped, or null. */
  tappedColor: ColorId | null;
  /** True when their tap was wrong → controller renders lockout overlay. */
  lockedOut: boolean;
}

export function createInitialColorWahalaState(
  players: ColorWahalaPlayerState[],
  settings: ColorWahalaSettings,
): ColorWahalaPublicState {
  return {
    phase: 'lobby',
    settings,
    players,
    round: 0,
    currentPrompt: null,
    phaseEndsAt: null,
    revealedAnswer: null,
    lastRoundResults: [],
    wrongCount: 0,
    winnerId: null,
    lastAction: 'Color Wahala ready.',
  };
}

// ── PRNG (mulberry32) ──────────────────────────────────────────────────
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

function pickWeighted<T>(items: T[], weights: number[], rand: () => number): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/** Pick a random color id from the palette using the provided rng. */
function pickColor(rand: () => number, exclude?: ColorId): ColorEntry {
  const pool = exclude ? COLOR_PALETTE.filter((c) => c.id !== exclude) : COLOR_PALETTE;
  return pool[Math.floor(rand() * pool.length)];
}

/**
 * Generate a single Color Wahala prompt. Always guarantees the word ink
 * mismatches the word text (otherwise no Stroop interference).
 *
 * Lock window ramps linearly from `startLockMs` to `endLockMs` across
 * `totalRounds` (round 1 → start, totalRounds → end).
 */
export function generatePrompt(
  round: number,
  totalRounds: number,
  settings: ColorWahalaSettings,
  seed: number,
): ColorWahalaPrompt {
  const rand = mulberry32(seed ^ (round * 2654435761));

  const modes: ColorWahalaMode[] = settings.audioEnabled
    ? ['say_word', 'say_color', 'say_heard']
    : ['say_word', 'say_color'];
  const weights = settings.audioEnabled
    ? [settings.modeMix.say_word, settings.modeMix.say_color, settings.modeMix.say_heard]
    : [settings.modeMix.say_word, settings.modeMix.say_color];
  const mode = pickWeighted(modes, weights, rand);

  const word = pickColor(rand);
  const ink = pickColor(rand, word.id); // always mismatched

  let heard: ColorEntry | null = null;
  let answer: ColorId;
  if (mode === 'say_word') {
    answer = word.id;
  } else if (mode === 'say_color') {
    answer = ink.id;
  } else {
    // say_heard: heard color must differ from BOTH word and ink for max chaos.
    let h = pickColor(rand);
    let guard = 0;
    while ((h.id === word.id || h.id === ink.id) && guard < 8) {
      h = pickColor(rand);
      guard++;
    }
    heard = h;
    answer = h.id;
  }

  // Lock window ramp.
  const t = totalRounds <= 1 ? 1 : (round - 1) / (totalRounds - 1);
  const lockMs = Math.round(settings.startLockMs + t * (settings.endLockMs - settings.startLockMs));

  return { round, mode, word, ink, heard, answer, lockMs };
}

/** Score a single tap.
 *   correct → round(1000 * (1 - latency/lockMs)) clamped ≥ 0
 *   wrong   → 0 (lockout enforced by caller)
 *   first correct gets +bonus
 */
export function scoreTap(
  latencyMs: number,
  lockMs: number,
  correct: boolean,
  isFirstCorrect: boolean,
  bonus: number,
): number {
  if (!correct) return 0;
  const t = Math.max(0, Math.min(1, latencyMs / lockMs));
  const base = Math.round(1000 * (1 - t));
  return Math.max(0, base) + (isFirstCorrect ? bonus : 0);
}

export interface ColorWahalaRoundResolution {
  results: ColorWahalaPlayerResult[];
  updatedPlayers: ColorWahalaPlayerState[];
  firstCorrectPlayerId: string | null;
}

export function resolveColorWahalaRound(
  prompt: ColorWahalaPrompt,
  players: ColorWahalaPlayerState[],
  taps: Map<string, ColorWahalaTap>,
  settings: ColorWahalaSettings,
): ColorWahalaRoundResolution {
  // Sort correct taps by latency to assign speed rank + first bonus.
  const correctTaps = [...taps.values()]
    .filter((t) => t.correct)
    .sort((a, b) => a.latencyMs - b.latencyMs);
  const firstCorrectId = correctTaps[0]?.playerId ?? null;
  const speedRankOf = new Map<string, number>();
  correctTaps.forEach((t, i) => speedRankOf.set(t.playerId, i + 1));

  const results: ColorWahalaPlayerResult[] = players.map((p) => {
    const tap = taps.get(p.id);
    if (!tap) {
      return {
        playerId: p.id,
        pickedColor: null,
        correct: false,
        pointsAwarded: 0,
        latencyMs: null,
        speedRank: null,
        lockedOut: false,
      };
    }
    const isFirst = tap.correct && firstCorrectId === p.id;
    const points = scoreTap(tap.latencyMs, prompt.lockMs, tap.correct, isFirst, settings.firstCorrectBonus);
    return {
      playerId: p.id,
      pickedColor: tap.pickedColor,
      correct: tap.correct,
      pointsAwarded: points,
      latencyMs: tap.latencyMs,
      speedRank: tap.correct ? speedRankOf.get(p.id) ?? null : null,
      lockedOut: !tap.correct,
    };
  });

  const updatedPlayers = players.map((p) => {
    const r = results.find((x) => x.playerId === p.id)!;
    if (!r.correct) {
      return {
        ...p,
        score: p.score + r.pointsAwarded,
        currentStreak: 0,
      };
    }
    const nextStreak = p.currentStreak + 1;
    return {
      ...p,
      score: p.score + r.pointsAwarded,
      correctCount: p.correctCount + 1,
      currentStreak: nextStreak,
      bestStreak: Math.max(p.bestStreak, nextStreak),
      totalLatencyMs: p.totalLatencyMs + (r.latencyMs ?? 0),
    };
  });

  return { results, updatedPlayers, firstCorrectPlayerId: firstCorrectId };
}

export { COLOR_IDS, COLOR_PALETTE, colorById };
export type { ColorEntry, ColorId };
