// Pure Market Price engine (Phase 8). "Guess the Naija market price" — players estimate the price
// of an item; closer guesses score more. No I/O, no timers — the server runs the loop and calls
// these helpers. Deterministic given inputs (item order is supplied by the caller).

export type MarketPricePhase = 'lobby' | 'reveal_item' | 'guessing' | 'scoring' | 'finished';

export interface MarketPriceItem {
  id: string;
  name: string;
  price: number; // canonical price in Naira
  region?: string;
}

export interface MarketPriceSettings {
  rounds: number;
  /** Points awarded for a perfect guess; scales down with percent error. */
  maxPoints: number;
  /** Percent error (0..1) at which a guess scores zero. */
  zeroAtError: number;
  /** Bonus for an exact (or within 1%) guess. */
  exactBonus: number;
}

export const DEFAULT_MARKETPRICE_SETTINGS: MarketPriceSettings = {
  rounds: 7,
  maxPoints: 1000,
  zeroAtError: 1, // 100% off => 0 points
  exactBonus: 250,
};

export interface MarketPricePlayerState {
  id: string;
  name: string;
  score: number;
}

export interface MarketPriceState {
  phase: MarketPricePhase;
  round: number; // 1-based; 0 in lobby
  settings: MarketPriceSettings;
  players: MarketPricePlayerState[];
  currentItem: MarketPriceItem | null;
  // Guesses for the current round, keyed by player id.
  guesses: Record<string, number>;
  // Per-round scored deltas, for the reveal screen.
  lastDeltas: Record<string, number>;
}

export function createInitialMarketPriceState(
  players: { id: string; name: string }[],
  settings: MarketPriceSettings = DEFAULT_MARKETPRICE_SETTINGS,
): MarketPriceState {
  return {
    phase: 'lobby',
    round: 0,
    settings,
    players: players.map((p) => ({ id: p.id, name: p.name, score: 0 })),
    currentItem: null,
    guesses: {},
    lastDeltas: {},
  };
}

// Start a round with a supplied item (caller controls item selection / order).
export function startRound(state: MarketPriceState, item: MarketPriceItem): MarketPriceState {
  if (state.phase === 'finished') return state;
  return {
    ...state,
    phase: 'guessing',
    round: state.round + 1,
    currentItem: item,
    guesses: {},
    lastDeltas: {},
  };
}

export function submitGuess(state: MarketPriceState, playerId: string, amount: number): MarketPriceState {
  if (state.phase !== 'guessing') return state;
  if (!state.players.some((p) => p.id === playerId)) return state;
  if (!Number.isFinite(amount) || amount < 0) return state;
  return { ...state, guesses: { ...state.guesses, [playerId]: amount } };
}

// Pure scoring: closer to the true price scores more, linearly down to zero at `zeroAtError`.
export function scoreGuess(guess: number, price: number, settings: MarketPriceSettings): number {
  if (price <= 0) return 0;
  const error = Math.abs(guess - price) / price; // fractional error
  if (error <= 0.01) return settings.maxPoints + settings.exactBonus;
  if (error >= settings.zeroAtError) return 0;
  const ratio = 1 - error / settings.zeroAtError;
  return Math.round(settings.maxPoints * ratio);
}

// Resolve the current round: score every guess, apply deltas, move to scoring/finished.
export function resolveRound(state: MarketPriceState): MarketPriceState {
  if (state.phase !== 'guessing' || !state.currentItem) return state;
  const price = state.currentItem.price;
  const deltas: Record<string, number> = {};
  const players = state.players.map((p) => {
    const guess = state.guesses[p.id];
    const delta = guess === undefined ? 0 : scoreGuess(guess, price, state.settings);
    deltas[p.id] = delta;
    return { ...p, score: p.score + delta };
  });
  const isLast = state.round >= state.settings.rounds;
  return {
    ...state,
    phase: isLast ? 'finished' : 'scoring',
    players,
    lastDeltas: deltas,
  };
}

export function leaderboard(state: MarketPriceState): MarketPricePlayerState[] {
  return [...state.players].sort((a, b) => b.score - a.score);
}

export function winner(state: MarketPriceState): MarketPricePlayerState | null {
  if (state.phase !== 'finished') return null;
  const ranked = leaderboard(state);
  if (ranked.length === 0) return null;
  // No winner on a tie at the top.
  if (ranked.length > 1 && ranked[0].score === ranked[1].score) return null;
  return ranked[0];
}
