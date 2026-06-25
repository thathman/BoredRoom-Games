// Pure Bible Timeline Rush engine (Phase 8). Players are dealt event cards and must arrange them in
// chronological order; scoring rewards correct adjacent orderings (Kendall-style). No I/O, no
// timers — the server runs the loop and calls these helpers. Deterministic given the dealt order.

export type TimelinePhase = 'lobby' | 'arranging' | 'reveal' | 'finished';

export interface TimelineEvent {
  id: string;
  label: string;
  /** Chronological sort key (e.g. approximate year; negative = BC). Lower = earlier. */
  order: number;
}

export interface BibleTimelineSettings {
  rounds: number;
  /** Points per correctly-ordered adjacent pair. */
  pointsPerPair: number;
  /** Bonus for a fully-correct arrangement. */
  perfectBonus: number;
}

export const DEFAULT_BIBLETIMELINE_SETTINGS: BibleTimelineSettings = {
  rounds: 5,
  pointsPerPair: 100,
  perfectBonus: 200,
};

export interface TimelinePlayerState {
  id: string;
  name: string;
  score: number;
}

export interface BibleTimelineState {
  phase: TimelinePhase;
  round: number;
  settings: BibleTimelineSettings;
  players: TimelinePlayerState[];
  // events dealt this round (presentation order)
  deal: TimelineEvent[];
  // each player's submitted ordering (array of event ids)
  submissions: Record<string, string[]>;
  lastDeltas: Record<string, number>;
}

export function createInitialBibleTimelineState(
  players: { id: string; name: string }[],
  settings: BibleTimelineSettings = DEFAULT_BIBLETIMELINE_SETTINGS,
): BibleTimelineState {
  return {
    phase: 'lobby',
    round: 0,
    settings,
    players: players.map((p) => ({ id: p.id, name: p.name, score: 0 })),
    deal: [],
    submissions: {},
    lastDeltas: {},
  };
}

export function startRound(state: BibleTimelineState, deal: TimelineEvent[]): BibleTimelineState {
  if (state.phase === 'finished') return state;
  return {
    ...state,
    phase: 'arranging',
    round: state.round + 1,
    deal,
    submissions: {},
    lastDeltas: {},
  };
}

export function submitOrder(state: BibleTimelineState, playerId: string, orderedIds: string[]): BibleTimelineState {
  if (state.phase !== 'arranging') return state;
  if (!state.players.some((p) => p.id === playerId)) return state;
  const dealIds = state.deal.map((e) => e.id).sort();
  const given = [...orderedIds].sort();
  // must be a permutation of the dealt events
  if (dealIds.length !== given.length || dealIds.some((id, i) => id !== given[i])) return state;
  return { ...state, submissions: { ...state.submissions, [playerId]: orderedIds } };
}

// Score an ordering: count adjacent pairs that are in correct chronological order.
export function scoreOrder(
  orderedIds: string[],
  deal: TimelineEvent[],
  settings: BibleTimelineSettings,
): number {
  const orderOf = new Map(deal.map((e) => [e.id, e.order]));
  let correctPairs = 0;
  for (let i = 0; i < orderedIds.length - 1; i += 1) {
    const a = orderOf.get(orderedIds[i]);
    const b = orderOf.get(orderedIds[i + 1]);
    if (a === undefined || b === undefined) continue;
    if (a <= b) correctPairs += 1;
  }
  let points = correctPairs * settings.pointsPerPair;
  if (orderedIds.length > 1 && correctPairs === orderedIds.length - 1) {
    points += settings.perfectBonus;
  }
  return points;
}

export function resolveRound(state: BibleTimelineState): BibleTimelineState {
  if (state.phase !== 'arranging') return state;
  const deltas: Record<string, number> = {};
  const players = state.players.map((p) => {
    const sub = state.submissions[p.id];
    const delta = sub ? scoreOrder(sub, state.deal, state.settings) : 0;
    deltas[p.id] = delta;
    return { ...p, score: p.score + delta };
  });
  const isLast = state.round >= state.settings.rounds;
  return { ...state, phase: isLast ? 'finished' : 'reveal', players, lastDeltas: deltas };
}

export function leaderboard(state: BibleTimelineState): TimelinePlayerState[] {
  return [...state.players].sort((a, b) => b.score - a.score);
}
