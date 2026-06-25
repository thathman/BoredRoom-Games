// Pure Logo Guesser engine. Server-authoritative; no I/O, no timers.
// Round = one brand. Players answer via either:
//   - Multiple Choice (host setting): server emits 4 names, player picks an index.
//   - Free-text: player submits text; server normalizes + fuzzy-matches.
// Scoring: tiered fastest-finger (100/70/50/30) × streak multiplier, with
//          full points for exact / close fuzzy match and 50% for partial.

import type { LogoBrand } from './brands.js';
import { LOGO_BRANDS, brandById } from './brands.js';

export type LogoInputMode = 'multiple_choice' | 'free_text';
export type LogoRevealStyle = 'unblur';
export type LogoRegionFilter = 'naija' | 'global' | 'mixed';

export type LogoPhase =
  | 'lobby'
  | 'intro'      // round banner
  | 'question'   // silhouette/blurred logo shown, no input yet
  | 'options'    // input enabled (MC options visible OR text input enabled)
  | 'reveal'     // correct answer shown
  | 'leaderboard'
  | 'finished';

export interface LogoPlayerState {
  id: string;
  displayName: string;
  color?: string;
  score: number;
  streak: number;
  correctCount: number;
  isBot?: boolean;
}

export interface LogoSettings {
  rounds: number;
  /** ms players see the silhouette before input opens. */
  questionRevealMs: number;
  /** ms input window. */
  answerWindowMs: number;
  /** ms reveal hold before next round. */
  revealHoldMs: number;
  inputMode: LogoInputMode;
  /** Whether to mix Naija + global, or pull from a single bucket. */
  regionFilter: LogoRegionFilter;
}

export const DEFAULT_LOGO_SETTINGS: LogoSettings = {
  rounds: 10,
  questionRevealMs: 2000,
  answerWindowMs: 20000,
  revealHoldMs: 4000,
  inputMode: 'multiple_choice',
  regionFilter: 'mixed',
};

/** Public-safe brand payload — never includes the domain raw, but we DO
 *  include it because logo.dev URLs are non-secret and the client needs it
 *  to render the image. The answer name is omitted until reveal. */
export interface LogoPublicQuestion {
  id: string;
  /** logo.dev domain — used to construct the image URL on the client. */
  domain: string;
  /** When inputMode === 'multiple_choice', four shuffled brand names. */
  options?: [string, string, string, string];
  difficulty: 'easy' | 'medium' | 'hard';
  region: 'naija' | 'africa' | 'global';
}

export interface LogoPlayerResult {
  playerId: string;
  /** Free-text guess as submitted (truncated). */
  guessText: string | null;
  /** MC pick index if used. */
  pickedIndex: number | null;
  correct: boolean;
  /** 'exact' | 'close' (fuzzy ≤2 edits) | 'wrong' | 'none'. */
  matchKind: 'exact' | 'close' | 'wrong' | 'none';
  pointsAwarded: number;
  speedRank: number | null;
}

export interface LogoPublicState {
  phase: LogoPhase;
  settings: LogoSettings;
  players: LogoPlayerState[];
  round: number;
  currentQuestion: LogoPublicQuestion | null;
  phaseEndsAt: number | null;
  /** Revealed only during 'reveal'. */
  revealedAnswer: { name: string; domain: string } | null;
  lastQuestionResults: LogoPlayerResult[];
  lockedInCount: number;
  winnerId: string | null;
  lastAction: string;
}

export interface LogoPrivateState {
  /** Per-seat shuffled MC option order — indexes into canonical `options`.
   *  Null when inputMode === 'free_text'. */
  optionOrder: [number, number, number, number] | null;
  hasLockedIn: boolean;
  lockedPick: number | null;
  /** Last submitted text (for echo). */
  lastGuess: string | null;
}

export function createInitialLogoState(
  players: LogoPlayerState[],
  settings: LogoSettings,
): LogoPublicState {
  return {
    phase: 'lobby',
    settings,
    players,
    round: 0,
    currentQuestion: null,
    phaseEndsAt: null,
    revealedAnswer: null,
    lastQuestionResults: [],
    lockedInCount: 0,
    winnerId: null,
    lastAction: 'Logo Guesser ready.',
  };
}

// ── Mulberry32 PRNG ─────────────────────────────────────────────────────
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

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ── Round / brand selection ─────────────────────────────────────────────

export function brandPoolFor(region: LogoRegionFilter): LogoBrand[] {
  if (region === 'naija') return LOGO_BRANDS.filter((b) => b.region === 'naija' || b.region === 'africa');
  if (region === 'global') return LOGO_BRANDS.filter((b) => b.region === 'global');
  return LOGO_BRANDS.slice();
}

/** Pick `count` distinct brands for the match. Seeded for determinism in tests. */
export function pickBrandsForMatch(
  count: number,
  region: LogoRegionFilter,
  rngSeed: number,
  excludeIds: Set<string> = new Set(),
): LogoBrand[] {
  const rng = mulberry32(rngSeed);
  const pool = brandPoolFor(region).filter((b) => !excludeIds.has(b.id));
  const source = pool.length >= count ? pool : brandPoolFor(region).slice();
  for (let i = source.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [source[i], source[j]] = [source[j], source[i]];
  }
  return source.slice(0, count);
}

/** Pick 3 distractor brand names for an MC round. */
export function pickDistractors(
  answer: LogoBrand,
  region: LogoRegionFilter,
  rngSeed: number,
): [string, string, string] {
  const rng = mulberry32(rngSeed ^ hashString(answer.id));
  const pool = brandPoolFor(region).filter((b) => b.id !== answer.id);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  // Prefer same-difficulty bucket for fairness.
  const sameDiff = pool.filter((b) => b.difficulty === answer.difficulty);
  const picks = (sameDiff.length >= 3 ? sameDiff : pool).slice(0, 3);
  return [picks[0].name, picks[1].name, picks[2].name];
}

// ── Scoring ─────────────────────────────────────────────────────────────

export const SPEED_TIER_POINTS = [100, 70, 50, 30] as const;

export function streakMultiplier(streakAfterAnswer: number): number {
  if (streakAfterAnswer >= 5) return 1.5;
  if (streakAfterAnswer >= 3) return 1.25;
  return 1.0;
}

export function pointsForRank(rank: number, streakAfterAnswer: number, partial: boolean): number {
  const base =
    rank <= 0
      ? 0
      : rank > SPEED_TIER_POINTS.length
        ? SPEED_TIER_POINTS[SPEED_TIER_POINTS.length - 1]
        : SPEED_TIER_POINTS[rank - 1];
  const raw = Math.round(base * streakMultiplier(streakAfterAnswer));
  return partial ? Math.round(raw * 0.5) : raw;
}

// ── Fuzzy matching ──────────────────────────────────────────────────────

/** Normalize a guess: lowercase, strip diacritics, collapse whitespace, drop
 *  most punctuation, trim common suffixes ("inc", "ltd", "the "). */
export function normalizeGuess(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(the|a|an|inc|incorporated|ltd|limited|plc|corp|corporation|company|co|group)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Levenshtein distance, capped for speed. */
export function levenshtein(a: string, b: string, cap = 4): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > cap) return cap + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

export type FuzzyMatch = 'exact' | 'close' | 'partial' | 'wrong';

/** Score a free-text guess against a brand. */
export function fuzzyMatchBrand(rawGuess: string, brand: LogoBrand): FuzzyMatch {
  const guess = normalizeGuess(rawGuess);
  if (!guess) return 'wrong';
  const candidates = [brand.name, ...brand.aliases].map(normalizeGuess);
  // Exact normalized match.
  if (candidates.some((c) => c === guess)) return 'exact';
  // Close match: Levenshtein ≤ 2 against any candidate (length-aware).
  for (const c of candidates) {
    const cap = c.length <= 4 ? 1 : c.length <= 8 ? 2 : 3;
    const d = levenshtein(guess, c, cap);
    if (d <= cap) return 'close';
  }
  // Partial: guess is a substring of a candidate (or vice versa) and length ≥ 3.
  if (guess.length >= 3) {
    for (const c of candidates) {
      if (c.length >= 3 && (c.includes(guess) || guess.includes(c))) return 'partial';
    }
  }
  return 'wrong';
}

// ── Round resolution ────────────────────────────────────────────────────

export interface LogoLockedAnswer {
  playerId: string;
  /** Free-text guess if free_text mode. */
  guessText: string | null;
  /** Canonical option index if MC mode. */
  pickedCanonicalIndex: 0 | 1 | 2 | 3 | null;
  lockedAtMs: number;
  /** Pre-computed by the room when the lock arrives. */
  matchKind: FuzzyMatch;
}

export interface LogoQuestionResolution {
  results: LogoPlayerResult[];
  updatedPlayers: LogoPlayerState[];
}

export function resolveLogoRound(
  brand: LogoBrand,
  /** For MC mode: the canonical options array (in shuffled-broadcast order is fine,
   *  as long as `pickedCanonicalIndex` indexes into the SAME array used to score). */
  canonicalOptions: [string, string, string, string] | null,
  players: LogoPlayerState[],
  locks: Map<string, LogoLockedAnswer>,
): LogoQuestionResolution {
  // For MC: correct iff canonicalOptions[pickedCanonicalIndex] === brand.name.
  // For free-text: correct iff matchKind === 'exact' | 'close'; partial scores half.
  const correctEntries = [...locks.entries()]
    .filter(([, l]) => isCorrect(l, brand, canonicalOptions))
    .sort((a, b) => a[1].lockedAtMs - b[1].lockedAtMs);

  const speedRankByPlayer = new Map<string, number>();
  correctEntries.forEach(([playerId], idx) => speedRankByPlayer.set(playerId, idx + 1));

  const updatedPlayers = players.map((p) => {
    const lock = locks.get(p.id) ?? null;
    const correct = lock ? isCorrect(lock, brand, canonicalOptions) : false;
    const partial = lock?.matchKind === 'partial' && !correct;
    const newStreak = correct ? p.streak + 1 : 0;
    const rank = speedRankByPlayer.get(p.id) ?? 0;
    const points = correct ? pointsForRank(rank, newStreak, false) : partial ? pointsForRank(1, 1, true) : 0;
    return {
      ...p,
      score: p.score + points,
      streak: newStreak,
      correctCount: p.correctCount + (correct ? 1 : 0),
    };
  });

  const results: LogoPlayerResult[] = players.map((p) => {
    const lock = locks.get(p.id) ?? null;
    const correct = lock ? isCorrect(lock, brand, canonicalOptions) : false;
    const partial = lock?.matchKind === 'partial' && !correct;
    const rank = correct ? speedRankByPlayer.get(p.id) ?? null : null;
    const newStreak = correct ? p.streak + 1 : 0;
    return {
      playerId: p.id,
      guessText: lock?.guessText ?? null,
      pickedIndex: lock?.pickedCanonicalIndex ?? null,
      correct,
      matchKind: !lock ? 'none' : correct ? (lock.matchKind === 'exact' ? 'exact' : 'close') : partial ? 'wrong' : 'wrong',
      pointsAwarded: correct ? pointsForRank(rank ?? 0, newStreak, false) : partial ? pointsForRank(1, 1, true) : 0,
      speedRank: rank,
    };
  });

  return { results, updatedPlayers };
}

function isCorrect(
  lock: LogoLockedAnswer,
  brand: LogoBrand,
  canonicalOptions: [string, string, string, string] | null,
): boolean {
  if (canonicalOptions && lock.pickedCanonicalIndex !== null) {
    return canonicalOptions[lock.pickedCanonicalIndex] === brand.name;
  }
  return lock.matchKind === 'exact' || lock.matchKind === 'close';
}

export function canonicalIndexFromPick(
  optionOrder: [number, number, number, number] | null,
  pickedShuffledIndex: number,
): 0 | 1 | 2 | 3 | null {
  if (!optionOrder) return null;
  const v = optionOrder[pickedShuffledIndex];
  if (v === 0 || v === 1 || v === 2 || v === 3) return v;
  return null;
}

export { brandById };
