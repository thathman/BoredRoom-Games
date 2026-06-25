// Authentic Nigerian Whot rule engine — server-authoritative, pure functions.
//
// Core rules:
// - Match by shape OR value, or play Whot 20 wildcard.
// - Whot 20 changes suit via call_suit (inline or follow-up intent).
// - 1  (Hold On): player plays again.
// - 2  (Pick Two): next player must defend with 2 or draw stack.
// - 5  (Pick Three): next player must defend with 5 or draw stack.
// - 8  (Suspension): skip next player (STAR 8 skips next two players).
// - 14 (General Market): all other players draw 1 immediately; player plays again.
// - Last-card announce required before final play.
// - Semi-last announce at hand size 2 is tracked for check-up penalties.
// - Winning on final Whot 20 is allowed.
//
// Notes:
// - Timing rule (10s) and check-up penalties are enforced by WhotRoom.ts.

import { WhotCard, WhotPublicState, WhotShape } from '../contracts/index.js';

export const PICK_TWO_VALUE = 2;
export const PICK_THREE_VALUE = 5;
export const HOLD_ON_VALUE = 1;
export const SUSPENSION_VALUE = 8;
export const GENERAL_MARKET_VALUE = 14;
export const WHOT_VALUE = 20;

export type WhotIntentResult =
  | { ok: true; reason?: never }
  | { ok: false; reason: WhotInvalidReason };

export type WhotInvalidReason =
  | 'not_your_turn'
  | 'must_call_suit'
  | 'must_announce_last_card'
  | 'card_not_in_hand'
  | 'shape_mismatch'
  | 'value_mismatch'
  | 'must_counter_pick'
  | 'invalid_shape'
  | 'no_pending_draw'
  | 'draw_pile_empty'
  | 'phase_invalid';

const VALID_SHAPES: ReadonlyArray<WhotShape> = [
  'circle', 'triangle', 'cross', 'square', 'star',
];

export function isCardLegal(card: WhotCard, state: WhotPublicState): boolean {
  if (state.mustCallSuit) return false;

  if ((state.pendingDrawCount ?? 0) > 0) {
    if (state.pendingDrawRank === '2') return card.value === PICK_TWO_VALUE;
    if (state.pendingDrawRank === '3') return card.value === PICK_THREE_VALUE;
    return false;
  }

  return matchesActiveCard(card, state);
}

export function getLegalCardIds(hand: WhotCard[], state: WhotPublicState): string[] {
  return hand.filter((c) => isCardLegal(c, state)).map((c) => c.id);
}

export function wouldWin(_card: WhotCard, handSize: number): boolean {
  return handSize === 1;
}

export function validatePlay(
  hand: WhotCard[],
  cardId: string,
  state: WhotPublicState,
  seatId: string,
  calledShape: WhotShape | undefined,
): WhotIntentResult {
  if (state.phase !== 'playing') return { ok: false, reason: 'phase_invalid' };
  if (state.currentPlayerId !== seatId) return { ok: false, reason: 'not_your_turn' };
  if (state.mustCallSuit) return { ok: false, reason: 'must_call_suit' };

  const card = hand.find((c) => c.id === cardId);
  if (!card) return { ok: false, reason: 'card_not_in_hand' };

  if (hand.length === 1 && !(state.lastCardAnnounced ?? []).includes(seatId)) {
    return { ok: false, reason: 'must_announce_last_card' };
  }

  if ((state.pendingDrawCount ?? 0) > 0) {
    if (state.pendingDrawRank === '2' && card.value !== PICK_TWO_VALUE) {
      return { ok: false, reason: 'must_counter_pick' };
    }
    if (state.pendingDrawRank === '3' && card.value !== PICK_THREE_VALUE) {
      return { ok: false, reason: 'must_counter_pick' };
    }
  } else if (!isCardLegal(card, state)) {
    if (card.shape !== state.activeShape) return { ok: false, reason: 'shape_mismatch' };
    return { ok: false, reason: 'value_mismatch' };
  }

  if (card.isWhot && calledShape && !VALID_SHAPES.includes(calledShape)) {
    return { ok: false, reason: 'invalid_shape' };
  }

  return { ok: true };
}

export interface ApplyPlayResult {
  state: WhotPublicState;
  newHand: WhotCard[];
  draws: { seatId: string; count: number }[];
  winnerId: string | null;
  narration: string;
}

export function applyPlay(
  state: WhotPublicState,
  hand: WhotCard[],
  cardId: string,
  calledShape: WhotShape | undefined,
  options?: { reverseOnPickTwo?: boolean },
): ApplyPlayResult {
  const card = hand.find((c) => c.id === cardId)!;
  const seatId = state.currentPlayerId;
  const newHand = hand.filter((c) => c.id !== cardId);
  const next = cloneState(state);

  next.topDiscard = card;
  next.turnNumber = state.turnNumber + 1;

  const me = next.players.find((p) => p.id === seatId);
  if (me) me.handCount = newHand.length;

  clearAnnounceIfNeeded(next, seatId, newHand.length);

  let narration = `${me?.displayName ?? 'Player'} played ${cardLabel(card)}.`;
  const draws: { seatId: string; count: number }[] = [];

  if (newHand.length === 0) {
    next.phase = 'finished';
    next.winnerId = seatId;
    next.activeShape = card.isWhot ? (calledShape ?? next.activeShape) : card.shape;
    next.pendingDrawCount = 0;
    next.pendingDrawRank = null;
    next.mustCallSuit = false;
    return {
      state: next,
      newHand,
      draws,
      winnerId: seatId,
      narration: `${me?.displayName ?? 'Player'} wins!`,
    };
  }

  if (card.isWhot) {
    next.pendingDrawCount = 0;
    next.pendingDrawRank = null;
    next.activeShape = card.shape;
    next.mustCallSuit = true;

    if (calledShape && VALID_SHAPES.includes(calledShape)) {
      next.activeShape = calledShape;
      next.mustCallSuit = false;
      advanceTurn(next, 1);
      narration += ` Called ${calledShape}.`;
    } else {
      narration += ' Awaiting suit call.';
    }
    return { state: next, newHand, draws, winnerId: null, narration };
  }

  next.activeShape = card.shape;

  switch (card.value) {
    case HOLD_ON_VALUE: {
      next.pendingDrawCount = 0;
      next.pendingDrawRank = null;
      narration += ' Hold-on — plays again.';
      return { state: next, newHand, draws, winnerId: null, narration };
    }

    case PICK_TWO_VALUE: {
      const stack = (state.pendingDrawRank === '2' ? (state.pendingDrawCount ?? 0) : 0) + 2;
      next.pendingDrawCount = stack;
      next.pendingDrawRank = '2';
      if (options?.reverseOnPickTwo) {
        next.turnDirection = normalizeDir((next.turnDirection ?? 1) * -1);
        narration += ' Direction reversed.';
      }
      advanceTurn(next, 1);
      narration += ` Pick Two — stack is now ${stack}.`;
      return { state: next, newHand, draws, winnerId: null, narration };
    }

    case PICK_THREE_VALUE: {
      const stack = (state.pendingDrawRank === '3' ? (state.pendingDrawCount ?? 0) : 0) + 3;
      next.pendingDrawCount = stack;
      next.pendingDrawRank = '3';
      advanceTurn(next, 1);
      narration += ` Pick Three — stack is now ${stack}.`;
      return { state: next, newHand, draws, winnerId: null, narration };
    }

    case SUSPENSION_VALUE: {
      next.pendingDrawCount = 0;
      next.pendingDrawRank = null;
      const skipSteps = card.shape === 'star' ? 3 : 2;
      advanceTurn(next, skipSteps);
      narration += card.shape === 'star'
        ? ' Star Suspension — next two players skipped.'
        : ' Suspension — next player skipped.';
      return { state: next, newHand, draws, winnerId: null, narration };
    }

    case GENERAL_MARKET_VALUE: {
      next.pendingDrawCount = 0;
      next.pendingDrawRank = null;
      for (const p of next.players) {
        if (p.id !== seatId) draws.push({ seatId: p.id, count: 1 });
      }
      narration += ' General Market — all other players pick one.';
      return { state: next, newHand, draws, winnerId: null, narration };
    }

    default: {
      next.pendingDrawCount = 0;
      next.pendingDrawRank = null;
      advanceTurn(next, 1);
      return { state: next, newHand, draws, winnerId: null, narration };
    }
  }
}

export interface ApplyDrawResult {
  state: WhotPublicState;
  drawCount: number;
  draws?: { seatId: string; count: number }[];
  narration: string;
}

export function applyDraw(state: WhotPublicState): ApplyDrawResult {
  const next = cloneState(state);
  const seatId = state.currentPlayerId;
  const me = next.players.find((p) => p.id === seatId);

  let drawCount = 1;
  if ((state.pendingDrawCount ?? 0) > 0) {
    drawCount = state.pendingDrawCount ?? 0;
    next.pendingDrawCount = 0;
    next.pendingDrawRank = null;
  }

  if (me) me.handCount += drawCount;
  clearAnnounceIfNeeded(next, seatId, me?.handCount ?? 0);
  next.turnNumber = state.turnNumber + 1;
  advanceTurn(next, 1);

  const narration = drawCount > 1
    ? `${me?.displayName ?? 'Player'} drew ${drawCount} (penalty).`
    : `${me?.displayName ?? 'Player'} drew a card.`;

  return { state: next, drawCount, narration };
}

export function applyCallSuit(
  state: WhotPublicState,
  shape: WhotShape,
): { ok: true; state: WhotPublicState; narration: string } | { ok: false; reason: WhotInvalidReason } {
  if (!state.mustCallSuit) return { ok: false, reason: 'no_pending_draw' };
  if (!VALID_SHAPES.includes(shape)) return { ok: false, reason: 'invalid_shape' };

  const next = cloneState(state);
  next.activeShape = shape;
  next.mustCallSuit = false;
  advanceTurn(next, 1);
  const me = state.players.find((p) => p.id === state.currentPlayerId);
  return { ok: true, state: next, narration: `${me?.displayName ?? 'Player'} called ${shape}.` };
}

export function applyAnnounceLastCard(
  state: WhotPublicState,
  hand: WhotCard[],
  seatId: string,
): { ok: true; state: WhotPublicState; narration: string } | { ok: false; reason: WhotInvalidReason } {
  if (state.currentPlayerId !== seatId) return { ok: false, reason: 'not_your_turn' };
  if (hand.length !== 1) return { ok: false, reason: 'must_announce_last_card' };

  const next = cloneState(state);
  const announced = new Set(next.lastCardAnnounced ?? []);
  announced.add(seatId);
  next.lastCardAnnounced = Array.from(announced);
  const me = state.players.find((p) => p.id === seatId);
  return { ok: true, state: next, narration: `${me?.displayName ?? 'Player'} called LAST CARD!` };
}

export function applyAnnounceSemiLastCard(
  state: WhotPublicState,
  hand: WhotCard[],
  seatId: string,
): { ok: true; state: WhotPublicState; narration: string } | { ok: false; reason: WhotInvalidReason } {
  if (state.currentPlayerId !== seatId) return { ok: false, reason: 'not_your_turn' };
  if (hand.length !== 2) return { ok: false, reason: 'must_announce_last_card' };

  const next = cloneState(state);
  const announced = new Set(next.semiLastCardAnnounced ?? []);
  announced.add(seatId);
  next.semiLastCardAnnounced = Array.from(announced);
  const me = state.players.find((p) => p.id === seatId);
  return { ok: true, state: next, narration: `${me?.displayName ?? 'Player'} called SEMI LAST CARD!` };
}

export function pickWhotBotMove(
  hand: WhotCard[],
  state: WhotPublicState,
):
  | { kind: 'play'; cardId: string; calledShape?: WhotShape }
  | { kind: 'announce_last_card' }
  | { kind: 'announce_semi_last_card' }
  | { kind: 'call_suit'; shape: WhotShape }
  | { kind: 'draw' } {
  if (state.mustCallSuit) return { kind: 'call_suit', shape: pickBestShape(hand) };

  if (hand.length === 2 && !(state.semiLastCardAnnounced ?? []).includes(state.currentPlayerId)) {
    return { kind: 'announce_semi_last_card' };
  }
  if (hand.length === 1 && !(state.lastCardAnnounced ?? []).includes(state.currentPlayerId)) {
    return { kind: 'announce_last_card' };
  }

  const legalIds = new Set(getLegalCardIds(hand, state));
  if (legalIds.size === 0) return { kind: 'draw' };
  const legals = hand.filter((c) => legalIds.has(c.id));

  const winner = legals.find((c) => wouldWin(c, hand.length));
  if (winner) {
    return winner.isWhot
      ? { kind: 'play', cardId: winner.id, calledShape: pickBestShape(hand) }
      : { kind: 'play', cardId: winner.id };
  }

  if (state.pendingDrawRank === '2') {
    const c = legals.find((x) => x.value === PICK_TWO_VALUE);
    if (c) return { kind: 'play', cardId: c.id };
  } else if (state.pendingDrawRank === '3') {
    const c = legals.find((x) => x.value === PICK_THREE_VALUE);
    if (c) return { kind: 'play', cardId: c.id };
  }

  const specialPriority = [GENERAL_MARKET_VALUE, PICK_TWO_VALUE, PICK_THREE_VALUE, SUSPENSION_VALUE, HOLD_ON_VALUE];
  for (const v of specialPriority) {
    const c = legals.find((x) => !x.isWhot && x.value === v);
    if (c) return { kind: 'play', cardId: c.id };
  }

  const whot = legals.find((c) => c.isWhot);
  if (whot) return { kind: 'play', cardId: whot.id, calledShape: pickBestShape(hand) };

  const normal = legals.find((c) => !c.isWhot);
  if (normal) return { kind: 'play', cardId: normal.id };

  return { kind: 'draw' };
}

function pickBestShape(hand: WhotCard[]): WhotShape {
  const counts: Record<WhotShape, number> = {
    circle: 0, triangle: 0, cross: 0, square: 0, star: 0, whot: 0,
  };
  for (const c of hand) if (!c.isWhot) counts[c.shape]++;
  let best: WhotShape = 'circle';
  let bestN = -1;
  for (const s of VALID_SHAPES) {
    if (counts[s] > bestN) { best = s; bestN = counts[s]; }
  }
  return best;
}

function normalizeDir(v: number): 1 | -1 {
  return v < 0 ? -1 : 1;
}

function advanceTurn(state: WhotPublicState, steps: number) {
  const n = state.players.length;
  if (n === 0) return;
  const dir = state.turnDirection ?? 1;
  let idx = state.currentPlayerIndex;
  for (let i = 0; i < steps; i++) {
    idx = (idx + dir + n) % n;
  }
  state.currentPlayerIndex = idx;
  state.currentPlayerId = state.players[idx].id;
}

function cloneState(s: WhotPublicState): WhotPublicState {
  return {
    ...s,
    turnDirection: s.turnDirection ?? 1,
    players: s.players.map((p) => ({ ...p })),
    lastCardAnnounced: s.lastCardAnnounced ? [...s.lastCardAnnounced] : [],
    semiLastCardAnnounced: s.semiLastCardAnnounced ? [...s.semiLastCardAnnounced] : [],
    penaltyContinuation: null,
  };
}

function clearAnnounceIfNeeded(state: WhotPublicState, seatId: string, handCount: number) {
  if (handCount > 1) {
    state.lastCardAnnounced = (state.lastCardAnnounced ?? []).filter((id) => id !== seatId);
  }
  if (handCount !== 2) {
    state.semiLastCardAnnounced = (state.semiLastCardAnnounced ?? []).filter((id) => id !== seatId);
  }
}

function cardLabel(c: WhotCard): string {
  if (c.isWhot) return 'Whot 20';
  return `${c.shape} ${c.value}`;
}

function matchesActiveCard(card: WhotCard, state: WhotPublicState): boolean {
  if (card.isWhot) return true;
  if (card.shape === state.activeShape) return true;
  if (state.topDiscard && card.value === state.topDiscard.value) return true;
  return false;
}
