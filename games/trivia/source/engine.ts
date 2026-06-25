// Pure trivia engine — phase transitions, fastest-finger scoring, streak bonuses.
// All time-based effects are driven by the room (setTimeout); this module only
// computes deterministic state transitions so it's trivially testable.

import type {
  TriviaCategory,
  TriviaPlayerState,
  TriviaPublicState,
  TriviaQuestion,
  TriviaSettings,
} from '../../contracts/index.js';
import { availableCategories, questionsByCategory, TRIVIA_BANK } from './questions.js';

// ── Scoring ───────────────────────────────────────────────────────────────
// Tiered fastest-finger: 1st=100, 2nd=70, 3rd=50, 4th+=30 base points.
// Streak multiplier: ×1.25 at 3-in-a-row, ×1.5 at 5-in-a-row.
// Wrong / no-answer = 0 points and resets streak.

export const SPEED_TIER_POINTS = [100, 70, 50, 30] as const;

export function streakMultiplier(streakAfterAnswer: number): number {
  if (streakAfterAnswer >= 5) return 1.5;
  if (streakAfterAnswer >= 3) return 1.25;
  return 1.0;
}

export function pointsForRank(rank: number, streakAfterAnswer: number): number {
  const base =
    rank <= 0
      ? 0
      : rank > SPEED_TIER_POINTS.length
        ? SPEED_TIER_POINTS[SPEED_TIER_POINTS.length - 1]
        : SPEED_TIER_POINTS[rank - 1];
  return Math.round(base * streakMultiplier(streakAfterAnswer));
}

// ── Mulberry32 PRNG (mirrors whot for deterministic tests) ────────────────
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

export function shuffleOptionOrder(rng: () => number): [number, number, number, number] {
  const a: [number, number, number, number] = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Round / question selection ────────────────────────────────────────────

/** Pick the category for round N (1-indexed) given settings. */
export function categoryForRound(round: number, settings: TriviaSettings): TriviaCategory {
  const cats = availableCategories();
  if (cats.length === 0) return 'general';
  if (settings.topicMode === 'host_pick' && settings.topics && settings.topics.length > 0) {
    return settings.topics[(round - 1) % settings.topics.length];
  }
  if (settings.topicMode === 'mixed') {
    // Mixed = pull from the entire bank; we still tag a category for UI.
    return 'general';
  }
  // rotate
  return cats[(round - 1) % cats.length];
}

/** Pick `count` questions for a round. Uses a seeded RNG so tests are deterministic. */
export function pickQuestionsForRound(
  round: number,
  settings: TriviaSettings,
  rngSeed: number,
  excludeIds: Set<string> = new Set(),
): TriviaQuestion[] {
  const rng = mulberry32(rngSeed + round);
  const category = categoryForRound(round, settings);
  const pool =
    settings.topicMode === 'mixed' || category === 'general'
      ? TRIVIA_BANK.slice()
      : questionsByCategory(category).slice();

  const eligible = pool.filter((q) => !excludeIds.has(q.id));
  const source = eligible.length >= settings.questionsPerRound ? eligible : pool;

  // Fisher-Yates with seeded rng.
  for (let i = source.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [source[i], source[j]] = [source[j], source[i]];
  }
  return source.slice(0, settings.questionsPerRound);
}

// ── Initial public state ──────────────────────────────────────────────────

export function createInitialTriviaState(
  players: TriviaPlayerState[],
  settings: TriviaSettings,
): TriviaPublicState {
  return {
    phase: 'lobby',
    settings,
    players,
    round: 0,
    questionIndex: 0,
    activeCategory: null,
    currentQuestion: null,
    phaseEndsAt: null,
    revealedCorrectIndex: null,
    lastQuestionResults: [],
    lockedInCount: 0,
    winnerId: null,
    lastAction: 'Trivia ready.',
  };
}

// ── Score resolution helpers ──────────────────────────────────────────────

export interface LockedAnswer {
  playerId: string;
  /** Canonical (unshuffled) option index they picked. */
  pickedCanonicalIndex: 0 | 1 | 2 | 3;
  /** Server epoch ms when their lock arrived. */
  lockedAtMs: number;
}

export interface QuestionResolution {
  results: TriviaPublicState['lastQuestionResults'];
  /** Updated player snapshots (score, streak, correctCount). */
  updatedPlayers: TriviaPlayerState[];
}

/** Resolve scoring for one question given everyone's locks. */
export function resolveQuestion(
  question: TriviaQuestion,
  players: TriviaPlayerState[],
  locks: Map<string, LockedAnswer>,
): QuestionResolution {
  // Order correct answers by lockedAtMs ascending.
  const correctEntries = [...locks.entries()]
    .filter(([, l]) => l.pickedCanonicalIndex === question.correctIndex)
    .sort((a, b) => a[1].lockedAtMs - b[1].lockedAtMs);

  const speedRankByPlayer = new Map<string, number>();
  correctEntries.forEach(([playerId], idx) => speedRankByPlayer.set(playerId, idx + 1));

  const updatedPlayers = players.map((p) => {
    const lock = locks.get(p.id) ?? null;
    const wasCorrect = lock?.pickedCanonicalIndex === question.correctIndex;
    const newStreak = wasCorrect ? p.streak + 1 : 0;
    const rank = speedRankByPlayer.get(p.id) ?? 0;
    const points = wasCorrect ? pointsForRank(rank, newStreak) : 0;
    return {
      ...p,
      score: p.score + points,
      streak: newStreak,
      correctCount: p.correctCount + (wasCorrect ? 1 : 0),
    };
  });

  const results: TriviaPublicState['lastQuestionResults'] = players.map((p) => {
    const lock = locks.get(p.id) ?? null;
    const wasCorrect = lock?.pickedCanonicalIndex === question.correctIndex;
    const rank = speedRankByPlayer.get(p.id) ?? null;
    const newStreak = wasCorrect ? p.streak + 1 : 0;
    return {
      playerId: p.id,
      pickedIndex: lock?.pickedCanonicalIndex ?? null,
      correct: !!wasCorrect,
      pointsAwarded: wasCorrect && rank ? pointsForRank(rank, newStreak) : 0,
      speedRank: wasCorrect ? rank : null,
    };
  });

  return { results, updatedPlayers };
}

/** Translate a per-seat shuffled pick back to canonical index. */
export function canonicalIndexFromPick(
  optionOrder: [number, number, number, number] | null,
  pickedShuffledIndex: number,
): 0 | 1 | 2 | 3 | null {
  if (!optionOrder) return null;
  const v = optionOrder[pickedShuffledIndex];
  if (v === 0 || v === 1 || v === 2 || v === 3) return v;
  return null;
}
