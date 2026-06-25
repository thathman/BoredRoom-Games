// Pure Half & Half engine. Server-authoritative; no I/O, no timers.
// Round = one object. Players submit a normalized cut position 0..1 along
// the object's axis. Closest-to-truth wins the round.

import { HALFHALF_OBJECTS, HalfHalfObject, objectById } from './objects.js';

export type HalfHalfPhase =
  | 'lobby'
  | 'intro'        // round banner
  | 'reveal_object' // object shown, no input yet
  | 'lock_in'      // slider input enabled
  | 'reveal_truth' // true cut revealed + per-player deltas
  | 'leaderboard'
  | 'finished';

export interface HalfHalfPlayerState {
  id: string;
  displayName: string;
  color?: string;
  score: number;
  /** Number of rounds where this player was closest. */
  bullseyes: number;
  /** Last round's accuracy 0..1 (1 = perfect). Undefined before first round. */
  lastAccuracy?: number;
  isBot?: boolean;
}

export interface HalfHalfSettings {
  rounds: number;
  /** ms object is shown before slider input opens. */
  revealMs: number;
  /** ms input window. */
  lockInMs: number;
  /** ms hold on truth reveal before next round. */
  truthHoldMs: number;
  /** Bonus points awarded to the closest guess. */
  closestBonus: number;
}

export const DEFAULT_HALFHALF_SETTINGS: HalfHalfSettings = {
  rounds: 8,
  revealMs: 1500,
  lockInMs: 12000,
  truthHoldMs: 5000,
  closestBonus: 200,
};

/** Public-safe object payload — truth is omitted until reveal_truth phase. */
export interface HalfHalfPublicObject {
  id: string;
  name: string;
  shape: string;
  axis: 'horizontal' | 'vertical';
  category: string;
}

export interface HalfHalfPlayerGuess {
  playerId: string;
  position: number; // 0..1 along axis
  lockedAtMs: number;
}

export interface HalfHalfPlayerResult {
  playerId: string;
  position: number | null; // null if didn't lock in
  /** |position - truth|, null if no guess. */
  delta: number | null;
  /** Round score (base + bonus). */
  pointsAwarded: number;
  /** True if this player was the round's closest (only awarded once). */
  closest: boolean;
}

export interface HalfHalfPublicState {
  phase: HalfHalfPhase;
  settings: HalfHalfSettings;
  players: HalfHalfPlayerState[];
  round: number;
  currentObject: HalfHalfPublicObject | null;
  phaseEndsAt: number | null;
  /** Truth is null until phase === 'reveal_truth'. */
  revealedTruth: number | null;
  lastRoundResults: HalfHalfPlayerResult[];
  /** All locked-in guesses for current/last round (visible in reveal). */
  lockedGuesses: HalfHalfPlayerGuess[];
  lockedInCount: number;
  winnerId: string | null;
  lastAction: string;
}

export interface HalfHalfPrivateState {
  /** Last position the player locked in this round (or null). */
  lockedPosition: number | null;
  hasLockedIn: boolean;
}

export function createInitialHalfHalfState(
  players: HalfHalfPlayerState[],
  settings: HalfHalfSettings,
): HalfHalfPublicState {
  return {
    phase: 'lobby',
    settings,
    players,
    round: 0,
    currentObject: null,
    phaseEndsAt: null,
    revealedTruth: null,
    lastRoundResults: [],
    lockedGuesses: [],
    lockedInCount: 0,
    winnerId: null,
    lastAction: 'Half & Half ready.',
  };
}

// ── PRNG ────────────────────────────────────────────────────────────────
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

/** Pick `count` distinct objects for the match. Seeded for determinism. */
export function pickObjectsForMatch(count: number, rngSeed: number): HalfHalfObject[] {
  const rng = mulberry32(rngSeed);
  const pool = HALFHALF_OBJECTS.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  if (count >= pool.length) return pool;
  return pool.slice(0, count);
}

export function toPublicObject(o: HalfHalfObject): HalfHalfPublicObject {
  return { id: o.id, name: o.name, shape: o.shape, axis: o.axis, category: o.category };
}

// ── Scoring ─────────────────────────────────────────────────────────────

/** Clamp a guess to [0,1]; reject NaN/non-finite. */
export function sanitizePosition(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Per-round score from a guess.
 *   base = round(1000 * (1 - delta))
 * (delta 0 → 1000pts; delta 0.5 → 500pts; delta 1 → 0pts)
 */
export function pointsForGuess(position: number, truth: number): number {
  const delta = Math.abs(position - truth);
  const base = Math.round(1000 * (1 - delta));
  return Math.max(0, base);
}

export interface HalfHalfRoundResolution {
  results: HalfHalfPlayerResult[];
  updatedPlayers: HalfHalfPlayerState[];
  closestPlayerId: string | null;
}

export function resolveHalfHalfRound(
  object: HalfHalfObject,
  players: HalfHalfPlayerState[],
  guesses: Map<string, HalfHalfPlayerGuess>,
  closestBonus: number,
): HalfHalfRoundResolution {
  // Find closest among players who locked in. Ties → no bonus to anyone
  // (cleaner than awarding bonus to multiple).
  let closestDelta = Infinity;
  let closestPlayerId: string | null = null;
  let tied = false;
  for (const p of players) {
    const g = guesses.get(p.id);
    if (!g) continue;
    const d = Math.abs(g.position - object.truth);
    if (d < closestDelta - 1e-9) {
      closestDelta = d;
      closestPlayerId = p.id;
      tied = false;
    } else if (Math.abs(d - closestDelta) < 1e-9) {
      tied = true;
    }
  }
  if (tied) closestPlayerId = null;

  const results: HalfHalfPlayerResult[] = players.map((p) => {
    const g = guesses.get(p.id);
    if (!g) {
      return {
        playerId: p.id,
        position: null,
        delta: null,
        pointsAwarded: 0,
        closest: false,
      };
    }
    const delta = Math.abs(g.position - object.truth);
    const isClosest = closestPlayerId === p.id;
    const points = pointsForGuess(g.position, object.truth) + (isClosest ? closestBonus : 0);
    return {
      playerId: p.id,
      position: g.position,
      delta,
      pointsAwarded: points,
      closest: isClosest,
    };
  });

  const updatedPlayers = players.map((p) => {
    const r = results.find((x) => x.playerId === p.id);
    if (!r) return p;
    return {
      ...p,
      score: p.score + r.pointsAwarded,
      bullseyes: p.bullseyes + (r.closest ? 1 : 0),
      lastAccuracy: r.delta == null ? undefined : Math.max(0, 1 - r.delta),
    };
  });

  return { results, updatedPlayers, closestPlayerId };
}

export { objectById };
