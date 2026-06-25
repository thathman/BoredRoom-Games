// Authentic Nigerian Whot deck + scaffold state.
//
// Composition (54 cards total):
//   - Circles    : 1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14         (12 cards)
//   - Triangles  : 1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14         (12 cards)
//   - Crosses    : 1, 2, 3, 5, 7, 10, 11, 13, 14                   (9 cards)
//   - Squares    : 1, 2, 3, 5, 7, 10, 11, 13, 14                   (9 cards)
//   - Stars      : 1, 2, 3, 4, 5, 7, 8                             (7 cards)
//   - Whots      : 20, 20, 20, 20, 20                              (5 cards)
// Total: 54.
//
// Step 4 scope is intentionally limited: we deal a hand, flip a top card,
// hold a turn pointer. Special card actions, captures, blockades, and
// win-condition resolution are NOT applied here — those land in the full
// Whot rules pass.

import { WhotCard, WhotPlayerState, WhotPublicState, WhotShape } from '../contracts/index.js';

const CIRCLE_VALUES = [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14];
const TRIANGLE_VALUES = [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14];
const CROSS_VALUES = [1, 2, 3, 5, 7, 10, 11, 13, 14];
const SQUARE_VALUES = [1, 2, 3, 5, 7, 10, 11, 13, 14];
const STAR_VALUES = [1, 2, 3, 4, 5, 7, 8];
const WHOT_COUNT = 5;

const INITIAL_HAND_SIZE = 4;

/** Build a fresh, ordered Nigerian Whot deck (54 cards). */
export function buildWhotDeck(): WhotCard[] {
  const deck: WhotCard[] = [];
  const push = (shape: WhotShape, values: number[]) => {
    for (const v of values) deck.push({ id: `${shape}-${v}`, shape, value: v, isWhot: false });
  };
  push('circle', CIRCLE_VALUES);
  push('triangle', TRIANGLE_VALUES);
  push('cross', CROSS_VALUES);
  push('square', SQUARE_VALUES);
  push('star', STAR_VALUES);
  // Whots — 5 wildcards, suffix to keep ids unique.
  for (let i = 0; i < WHOT_COUNT; i++) {
    deck.push({ id: `whot-20-${String.fromCharCode(97 + i)}`, shape: 'whot', value: 20, isWhot: true });
  }
  return deck;
}

/**
 * Mulberry32 — small deterministic PRNG. Used for shuffles so tests can
 * pin a seed and assert exact deals.
 */
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

export function shuffleDeck(deck: WhotCard[], seed?: number): WhotCard[] {
  const rng = typeof seed === 'number' ? mulberry32(seed) : Math.random;
  const out = deck.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface WhotInitInput {
  players: { id: string; displayName: string; color?: string; isBot?: boolean }[];
  /** Optional deterministic seed (tests). */
  seed?: number;
}

export interface WhotInitResult {
  publicState: WhotPublicState;
  /** seatId → starting hand. The room is responsible for delivering each
   *  hand only to its owning client. */
  privateHands: Record<string, WhotCard[]>;
  /** Remaining draw pile, kept private to the server. */
  drawPile: WhotCard[];
}

/**
  * Build an initial Whot game state. Deals INITIAL_HAND_SIZE to each seat,
 * flips a non-Whot card as the starting discard (re-flips if a Whot lands
 * face-up, since wildcards as the opening face-up card would force an
 * immediate suit-call we don't implement yet).
 */
export function createInitialWhotState(input: WhotInitInput): WhotInitResult {
  const order = shuffleDeck(buildWhotDeck(), input.seed);
  const privateHands: Record<string, WhotCard[]> = {};
  let cursor = 0;

  for (const p of input.players) {
    privateHands[p.id] = order.slice(cursor, cursor + INITIAL_HAND_SIZE);
    cursor += INITIAL_HAND_SIZE;
  }

  // Flip first non-Whot card from remaining draw pile.
  let topDiscard: WhotCard | null = null;
  while (cursor < order.length) {
    const candidate = order[cursor++];
    if (!candidate.isWhot) {
      topDiscard = candidate;
      break;
    }
  }
  // Pathological fallback (statistically impossible at 54 cards but defensive).
  if (!topDiscard && cursor < order.length) {
    topDiscard = order[cursor++];
  }

  const drawPile = order.slice(cursor);

  const players: WhotPlayerState[] = input.players.map((p) => ({
    id: p.id,
    displayName: p.displayName,
    color: p.color,
    handCount: privateHands[p.id]?.length ?? 0,
    isBot: p.isBot,
  }));

  const publicState: WhotPublicState = {
    phase: 'playing',
    players,
    currentPlayerIndex: 0,
    currentPlayerId: players[0]?.id ?? '',
    topDiscard,
    activeShape: topDiscard?.shape ?? 'circle',
    drawPileCount: drawPile.length,
    turnNumber: 1,
    winnerId: null,
    lastAction: 'Game started — Whot scaffold (rules in progress)',
  };

  return { publicState, privateHands, drawPile };
}

export const WHOT_INITIAL_HAND_SIZE = INITIAL_HAND_SIZE;
