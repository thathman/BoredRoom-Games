// Hustle — pure engine. No I/O. Server runs the loop and calls into these.
//
// Phase loop: lobby → intro → turn (rolling → moving → resolving → cardPrompt?)
//             → next | finished
//
// v1.1 scope:
//   - 60-square board with markets (₦) + Japa endgame exits (UK 58, Canada 59,
//     US 60). Win conditions are gated by ₦ and "documents" (markets crossed).
//   - 1 die per roll
//   - 5 cards (connection, side_hustle, owambe_invite, bribe, village_people)
//   - Crab-in-a-Bucket lite: landing on another player's square pushes them
//     back 5 squares (floor 1).
//   - Money economy: starting ₦100, market rewards, GO bonus on bribe.

import {
  HUSTLE_BOARD_SIZE,
  HUSTLE_LADDER_LOOKUP,
  HUSTLE_MARKET_LOOKUP,
  HUSTLE_SNAKE_LOOKUP,
  HUSTLE_WIN_SQUARE,
  HUSTLE_JAPA_EXITS,
  type HustleEvent,
} from './board.js';
import {
  HUSTLE_CARDS,
  HUSTLE_CARD_POOL,
  type HustleCardId,
  type HustleCardInstance,
} from './cards.js';

export type HustlePhase =
  | 'lobby'
  | 'intro'
  | 'rolling'      // active player can press Roll
  | 'moving'       // animating dice → token slide on the host display
  | 'resolving'    // ladder / snake / collision applied; banner showing
  | 'cardPrompt'   // an Owambe invite / Connection notice is queued
  | 'japaPrompt'   // active player landed on a Japa exit and can attempt to escape
  | 'finished';

export interface HustleSettings {
  /** Cards dealt at start. */
  startingCards: number;
  /** Extra card every N squares crossed. */
  cardEveryNSquares: number;
  /** ms the resolving banner stays on-screen before next turn. */
  resolveHoldMs: number;
  /** ms between rolling and the moving animation completing. */
  movePerSquareMs: number;
  /** Crab-in-a-Bucket setback when landing on another player. */
  collisionPushback: number;
  /** Starting Naira. */
  startingMoney: number;
  /** Whether Japa endgame (3 exit squares) is enabled. When false, square 60 wins. */
  japaEndgame: boolean;
}

export const DEFAULT_HUSTLE_SETTINGS: HustleSettings = {
  startingCards: 2,
  cardEveryNSquares: 5,
  resolveHoldMs: 2400,
  movePerSquareMs: 110,
  collisionPushback: 5,
  startingMoney: 100,
  japaEndgame: true,
};

/** Cost / requirements for each Japa exit. */
export const JAPA_EXIT_REQUIREMENTS = {
  uk: { cost: 200, documentsRequired: 0, exactRoll: false, label: 'UK' },
  canada: { cost: 150, documentsRequired: 4, exactRoll: false, label: 'Canada' },
  us: { cost: 0, documentsRequired: 0, exactRoll: true, label: 'US' },
} as const;

export type JapaExit = keyof typeof JAPA_EXIT_REQUIREMENTS;

export interface HustlePlayerState {
  id: string;
  displayName: string;
  color?: string;
  /** 0 = base, 1..60 = on-board. */
  position: number;
  /** Total squares advanced this match (used for card-drip cadence). */
  squaresAdvanced: number;
  /** Naira balance. */
  money: number;
  /** Number of unique market tiles crossed (for Canada Japa). */
  documents: number;
  /** Cards in hand. */
  hand: HustleCardInstance[];
  /** True when this player must skip their next turn (owambe debuff). */
  skipsNextTurn: boolean;
  /** True if their next snake should be dodged (connection or bribe buff). */
  hasSnakeShield: boolean;
  /** True when bribe is queued: next GO crossing pays an extra ₦100. */
  bribeGoBonus: boolean;
  /** Number of cards drawn since the last drip. */
  cardDripProgress: number;
  isBot?: boolean;
}

export interface HustleLastBanner {
  /** Headline shown big on the display. */
  headline: string;
  /** Sub-line used for color (e.g. ladder caption or card flavor). */
  detail: string;
  /** Optional event payload for the display to render a glyph. */
  event?: HustleEvent | null;
  /** Tag for styling (snake/ladder/collision/card/move). */
  kind: 'roll' | 'move' | 'ladder' | 'snake' | 'collision' | 'card' | 'win' | 'skip' | 'shield' | 'market' | 'japa';
  actorId?: string | null;
  targetId?: string | null;
}

export interface HustlePublicState {
  phase: HustlePhase;
  settings: HustleSettings;
  players: HustlePlayerState[];
  /** Index into `players`. */
  currentPlayerIndex: number;
  /** Last die value rolled (1..6) or null. */
  lastDie: number | null;
  /** Server epoch ms when the current phase ends (UI countdown). */
  phaseEndsAt: number | null;
  /** Most recent narrative banner. */
  lastBanner: HustleLastBanner | null;
  /** Mirror of `lastBanner.headline` for cross-game audio cue routing. */
  lastAction: string;
  winnerId: string | null;
  /** Which Japa exit the winner used (if any). */
  winnerExit: JapaExit | null;
  turnNumber: number;
  /** When phase === 'japaPrompt', which exit the active player landed on. */
  pendingJapaExit: JapaExit | null;
}

let cardInstanceCounter = 0;
function newCardInstance(cardId: HustleCardId): HustleCardInstance {
  cardInstanceCounter += 1;
  return { instanceId: `c${cardInstanceCounter}-${Math.floor(Math.random() * 1e6).toString(36)}`, cardId };
}

/** Roll a single d6 with a deterministic seed for testing/replay. */
export function rollDie(rand: () => number): number {
  return 1 + Math.floor(rand() * 6);
}

/** Deal a random card from the pool. */
export function dealCard(rand: () => number = Math.random): HustleCardInstance {
  const idx = Math.floor(rand() * HUSTLE_CARD_POOL.length);
  return newCardInstance(HUSTLE_CARD_POOL[idx]);
}

export function createInitialHustleState(
  players: HustlePlayerState[],
  settings: HustleSettings,
): HustlePublicState {
  return {
    phase: 'lobby',
    settings,
    players,
    currentPlayerIndex: 0,
    lastDie: null,
    phaseEndsAt: null,
    lastBanner: null,
    lastAction: 'Hustle ready.',
    winnerId: null,
    winnerExit: null,
    turnNumber: 0,
    pendingJapaExit: null,
  };
}

export function makeInitialPlayer(
  id: string,
  displayName: string,
  color: string,
  startingCards: number,
  rand: () => number = Math.random,
  startingMoney = 100,
  isBot = false,
): HustlePlayerState {
  const hand: HustleCardInstance[] = [];
  for (let i = 0; i < startingCards; i++) hand.push(dealCard(rand));
  return {
    id,
    displayName,
    color,
    position: 0,
    squaresAdvanced: 0,
    money: startingMoney,
    documents: 0,
    hand,
    skipsNextTurn: false,
    hasSnakeShield: false,
    bribeGoBonus: false,
    cardDripProgress: 0,
    isBot,
  };
}

// ── Resolution helpers ────────────────────────────────────────────────────

export interface RollResolution {
  /** State after applying the roll + ladders/snakes/collision/card-drip/win. */
  state: HustlePublicState;
  /** Headline events the server should narrate (in order). */
  banners: HustleLastBanner[];
  /** True if the player wins as a result of this roll. */
  isWin: boolean;
}

/**
 * Apply a die roll for the current player. Returns the next state +
 * narration banners. Pure — caller (the server) handles broadcast / timing.
 */
export function applyRoll(state: HustlePublicState, die: number): RollResolution {
  const banners: HustleLastBanner[] = [];
  const players = state.players.map((p) => ({ ...p, hand: [...p.hand] }));
  const idx = state.currentPlayerIndex;
  const me = players[idx];
  if (!me) return { state, banners, isWin: false };

  const fromPos = me.position;
  let nextPos = fromPos + die;

  // Japa endgame: 58/59/60 are exit squares. Landing on or past one of them
  // triggers the Japa prompt; overshoot of 60 bounces back per classic rules.
  if (state.settings.japaEndgame) {
    if (nextPos > HUSTLE_WIN_SQUARE) {
      const overshoot = nextPos - HUSTLE_WIN_SQUARE;
      nextPos = HUSTLE_WIN_SQUARE - overshoot;
      if (nextPos < 1) nextPos = 1;
      banners.push({
        headline: `${me.displayName} rolled ${die}`,
        detail: `Overshot the airport — bounced back to ${nextPos}.`,
        kind: 'move',
        actorId: me.id,
      });
    } else {
      banners.push({
        headline: `${me.displayName} rolled ${die}`,
        detail: `Moving to square ${nextPos}.`,
        kind: 'roll',
        actorId: me.id,
      });
    }
  } else {
    // Legacy MVP behaviour: bounce off 60.
    if (nextPos > HUSTLE_WIN_SQUARE) {
      const overshoot = nextPos - HUSTLE_WIN_SQUARE;
      nextPos = HUSTLE_WIN_SQUARE - overshoot;
      if (nextPos < 1) nextPos = 1;
      banners.push({
        headline: `${me.displayName} rolled ${die}`,
        detail: `Overshot — bounced back to ${nextPos}.`,
        kind: 'move',
        actorId: me.id,
      });
    } else {
      banners.push({
        headline: `${me.displayName} rolled ${die}`,
        detail: `Moving to square ${nextPos}.`,
        kind: 'roll',
        actorId: me.id,
      });
    }
  }

  // Apply the move — markets/ladder/snake/collision resolve in that order.
  const advanced = Math.max(0, nextPos - fromPos);
  me.squaresAdvanced += advanced;
  me.position = nextPos;

  // Classic mode: exact landing on 60 wins immediately.
  if (!state.settings.japaEndgame && me.position === HUSTLE_WIN_SQUARE) {
    banners.push({
      headline: `${me.displayName} JAPA'D!`,
      detail: 'Wheels up. The hustle paid off.',
      kind: 'win',
      actorId: me.id,
    });
    const finalState: HustlePublicState = {
      ...state,
      players,
      lastDie: die,
      lastBanner: banners[banners.length - 1],
      lastAction: banners[banners.length - 1].headline,
      winnerId: me.id,
      winnerExit: null,
      phase: 'finished',
      phaseEndsAt: null,
    };
    return { state: finalState, banners, isWin: true };
  }

  // Snake?
  const snake = HUSTLE_SNAKE_LOOKUP.get(me.position);
  if (snake) {
    if (me.hasSnakeShield) {
      me.hasSnakeShield = false;
      banners.push({
        headline: `${me.displayName} dodged a snake!`,
        detail: `Skipped "${snake.caption}"`,
        kind: 'shield',
        actorId: me.id,
        event: snake,
      });
    } else {
      me.position = snake.to;
      banners.push({
        headline: `${me.displayName} got bit`,
        detail: snake.caption,
        kind: 'snake',
        actorId: me.id,
        event: snake,
      });
    }
  } else {
    // Ladder?
    const ladder = HUSTLE_LADDER_LOOKUP.get(me.position);
    if (ladder) {
      me.squaresAdvanced += Math.max(0, ladder.to - me.position);
      me.position = ladder.to;
      banners.push({
        headline: `${me.displayName} caught a come-up!`,
        detail: ladder.caption,
        kind: 'ladder',
        actorId: me.id,
        event: ladder,
      });
    }
  }

  // Market check (after ladder may have landed us on one).
  const market = HUSTLE_MARKET_LOOKUP.get(me.position);
  if (market) {
    me.money += market.reward;
    me.documents += 1;
    banners.push({
      headline: `${me.displayName} hit ${market.caption.split(' — ')[0]}`,
      detail: `+₦${market.reward}, +1 document. Wallet: ₦${me.money}.`,
      kind: 'market',
      actorId: me.id,
    });
  }

  // Japa endgame: landing on 58/59/60 in japa mode triggers prompt phase.
  if (state.settings.japaEndgame) {
    let exit: JapaExit | null = null;
    if (me.position === HUSTLE_JAPA_EXITS.uk) exit = 'uk';
    else if (me.position === HUSTLE_JAPA_EXITS.canada) exit = 'canada';
    else if (me.position === HUSTLE_JAPA_EXITS.us) exit = 'us';
    if (exit) {
      banners.push({
        headline: `${me.displayName} reached the ${JAPA_EXIT_REQUIREMENTS[exit].label} gate`,
        detail: japaRequirementText(exit),
        kind: 'japa',
        actorId: me.id,
      });
      // Auto-claim US exit on exact roll (no cost) — go straight to win.
      if (exit === 'us' && me.position === HUSTLE_JAPA_EXITS.us) {
        // Fall through to japaPrompt and let player accept; this preserves
        // the same UI path. Bots will accept automatically server-side.
      }
      const last = banners[banners.length - 1];
      const next: HustlePublicState = {
        ...state,
        players,
        lastDie: die,
        lastBanner: last,
        lastAction: last.headline,
        phase: 'japaPrompt',
        pendingJapaExit: exit,
      };
      return { state: next, banners, isWin: false };
    }
  }

  // Collision (Crab-in-a-Bucket lite). Process after ladders/snakes so the
  // collision target is the final square. Only push back OTHER players who
  // are sitting on the same square. Skip the win square.
  if (me.position > 0 && me.position < HUSTLE_WIN_SQUARE) {
    for (const other of players) {
      if (other.id === me.id) continue;
      if (other.position !== me.position) continue;
      const before = other.position;
      const pushed = Math.max(1, before - state.settings.collisionPushback);
      other.position = pushed;
      banners.push({
        headline: `${me.displayName} bumped ${other.displayName}`,
        detail: `Crab in a bucket — back to square ${pushed}.`,
        kind: 'collision',
        actorId: me.id,
        targetId: other.id,
      });
    }
  }

  // Card drip: every N squares advanced, +1 card.
  while (me.cardDripProgress + state.settings.cardEveryNSquares <= me.squaresAdvanced) {
    me.cardDripProgress += state.settings.cardEveryNSquares;
    me.hand.push(dealCard());
    banners.push({
      headline: `${me.displayName} drew a Hustle card`,
      detail: 'Hand grows.',
      kind: 'card',
      actorId: me.id,
    });
  }

  const last = banners[banners.length - 1] ?? null;
  const next: HustlePublicState = {
    ...state,
    players,
    lastDie: die,
    lastBanner: last,
    lastAction: last?.headline ?? state.lastAction,
  };
  return { state: next, banners, isWin: false };
}

function japaRequirementText(exit: JapaExit): string {
  const r = JAPA_EXIT_REQUIREMENTS[exit];
  if (exit === 'uk') return `Pay ₦${r.cost} to board the flight to ${r.label}.`;
  if (exit === 'canada') return `Need ${r.documentsRequired} documents + ₦${r.cost} for ${r.label}.`;
  return `Free flight to ${r.label} — accept to win!`;
}

/** Active player attempts to claim their pending Japa exit. */
export function claimJapa(state: HustlePublicState): { state: HustlePublicState; ok: boolean; banner: HustleLastBanner | null; rejection?: string } {
  if (state.phase !== 'japaPrompt' || !state.pendingJapaExit) {
    return { state, ok: false, banner: null, rejection: 'wrong_phase' };
  }
  const exit = state.pendingJapaExit;
  const req = JAPA_EXIT_REQUIREMENTS[exit];
  const players = state.players.map((p) => ({ ...p, hand: [...p.hand] }));
  const me = players[state.currentPlayerIndex];
  if (!me) return { state, ok: false, banner: null, rejection: 'no_player' };
  if (me.money < req.cost) return { state, ok: false, banner: null, rejection: 'insufficient_funds' };
  if (me.documents < req.documentsRequired) return { state, ok: false, banner: null, rejection: 'insufficient_documents' };

  me.money -= req.cost;
  const banner: HustleLastBanner = {
    headline: `${me.displayName} JAPA'D to ${req.label}!`,
    detail: req.cost > 0 ? `Paid ₦${req.cost}. Wheels up.` : 'Wheels up. Free flight.',
    kind: 'win',
    actorId: me.id,
  };
  return {
    state: {
      ...state,
      players,
      phase: 'finished',
      pendingJapaExit: null,
      winnerId: me.id,
      winnerExit: exit,
      lastBanner: banner,
      lastAction: banner.headline,
    },
    ok: true,
    banner,
  };
}

/** Active player declines the Japa exit (or fails) — turn ends, they stay put. */
export function declineJapa(state: HustlePublicState): HustlePublicState {
  if (state.phase !== 'japaPrompt') return state;
  const me = state.players[state.currentPlayerIndex];
  const banner: HustleLastBanner = {
    headline: `${me?.displayName ?? 'Player'} stayed put`,
    detail: 'Declined the Japa flight. Hustle continues.',
    kind: 'move',
    actorId: me?.id ?? null,
  };
  return {
    ...state,
    phase: 'rolling',
    pendingJapaExit: null,
    lastBanner: banner,
    lastAction: banner.headline,
  };
}

/** Advance the turn pointer, applying skip-next-turn debuffs. */
export function advanceTurn(state: HustlePublicState): HustlePublicState {
  if (state.phase === 'finished' || !state.players.length) return state;
  const players = state.players.map((p) => ({ ...p }));
  let nextIdx = state.currentPlayerIndex;
  // Walk up to N players to find someone who isn't skipped.
  for (let i = 0; i < players.length; i++) {
    nextIdx = (nextIdx + 1) % players.length;
    const candidate = players[nextIdx];
    if (candidate.skipsNextTurn) {
      candidate.skipsNextTurn = false;
      // Continue scanning — they lose this turn.
      continue;
    }
    break;
  }
  return {
    ...state,
    players,
    currentPlayerIndex: nextIdx,
    turnNumber: state.turnNumber + 1,
    lastDie: null,
    phase: 'rolling',
  };
}

export interface PlayCardResolution {
  state: HustlePublicState;
  banner: HustleLastBanner | null;
  /** True if the card resolved successfully (was removed from hand). */
  ok: boolean;
  /** Reason if the play was rejected. */
  rejection?:
    | 'unknown_card'
    | 'not_in_hand'
    | 'not_your_turn'
    | 'target_required'
    | 'invalid_target'
    | 'self_target'
    | 'wrong_phase'
    | 'insufficient_funds';
  /** True if the caller should re-roll (side_hustle). */
  shouldReroll?: boolean;
}

/**
 * Play a card. Server validates `playerId` against current attached client.
 */
export function playCard(
  state: HustlePublicState,
  playerId: string,
  instanceId: string,
  targetPlayerId: string | null,
): PlayCardResolution {
  if (state.phase === 'finished') {
    return { state, banner: null, ok: false, rejection: 'wrong_phase' };
  }
  const players = state.players.map((p) => ({ ...p, hand: [...p.hand] }));
  const me = players.find((p) => p.id === playerId);
  if (!me) return { state, banner: null, ok: false, rejection: 'not_in_hand' };
  const cardIdx = me.hand.findIndex((c) => c.instanceId === instanceId);
  if (cardIdx < 0) return { state, banner: null, ok: false, rejection: 'not_in_hand' };
  const card = me.hand[cardIdx];
  const def = HUSTLE_CARDS[card.cardId];
  if (!def) return { state, banner: null, ok: false, rejection: 'unknown_card' };

  if (def.timing === 'own_turn') {
    if (players[state.currentPlayerIndex]?.id !== playerId) {
      return { state, banner: null, ok: false, rejection: 'not_your_turn' };
    }
  }
  if (def.needsTarget) {
    if (!targetPlayerId) return { state, banner: null, ok: false, rejection: 'target_required' };
    if (targetPlayerId === playerId) return { state, banner: null, ok: false, rejection: 'self_target' };
    if (!players.find((p) => p.id === targetPlayerId)) {
      return { state, banner: null, ok: false, rejection: 'invalid_target' };
    }
  }
  // Cost check
  const cost = def.cost ?? 0;
  if (cost > 0 && me.money < cost) {
    return { state, banner: null, ok: false, rejection: 'insufficient_funds' };
  }

  // Remove the card from the hand BEFORE applying the effect.
  me.hand.splice(cardIdx, 1);
  if (cost > 0) me.money -= cost;

  let banner: HustleLastBanner | null = null;
  let shouldReroll = false;

  switch (card.cardId) {
    case 'connection': {
      me.hasSnakeShield = true;
      banner = {
        headline: `${me.displayName} played Connection`,
        detail: HUSTLE_CARDS.connection.caption,
        kind: 'shield',
        actorId: me.id,
      };
      break;
    }
    case 'side_hustle': {
      if (state.lastDie == null) {
        // Restore card + cost.
        me.hand.splice(cardIdx, 0, card);
        if (cost > 0) me.money += cost;
        return { state, banner: null, ok: false, rejection: 'wrong_phase' };
      }
      shouldReroll = true;
      banner = {
        headline: `${me.displayName} played Side hustle`,
        detail: HUSTLE_CARDS.side_hustle.caption,
        kind: 'card',
        actorId: me.id,
      };
      break;
    }
    case 'owambe_invite': {
      const target = players.find((p) => p.id === targetPlayerId);
      if (!target) {
        me.hand.splice(cardIdx, 0, card);
        if (cost > 0) me.money += cost;
        return { state, banner: null, ok: false, rejection: 'invalid_target' };
      }
      target.skipsNextTurn = true;
      banner = {
        headline: `${me.displayName} played Owambe invite on ${target.displayName}`,
        detail: HUSTLE_CARDS.owambe_invite.caption,
        kind: 'card',
        actorId: me.id,
        targetId: target.id,
      };
      break;
    }
    case 'bribe': {
      me.hasSnakeShield = true;
      me.bribeGoBonus = true;
      // Immediate ₦100 GO bonus (board doesn't loop, so pay on play).
      me.money += 100;
      banner = {
        headline: `${me.displayName} dropped a bribe`,
        detail: `Paid ₦${cost}, got ₦100 GO kick-back. Next snake skipped. Wallet: ₦${me.money}.`,
        kind: 'card',
        actorId: me.id,
      };
      break;
    }
    case 'village_people': {
      const target = players.find((p) => p.id === targetPlayerId);
      if (!target) {
        me.hand.splice(cardIdx, 0, card);
        if (cost > 0) me.money += cost;
        return { state, banner: null, ok: false, rejection: 'invalid_target' };
      }
      const before = target.position;
      target.position = Math.max(1, before - 8);
      banner = {
        headline: `${me.displayName} sent Village people on ${target.displayName}`,
        detail: `Paid ₦${cost}. Target slid from ${before} to ${target.position}.`,
        kind: 'card',
        actorId: me.id,
        targetId: target.id,
      };
      break;
    }
  }

  const next: HustlePublicState = {
    ...state,
    players,
    lastBanner: banner,
    lastAction: banner?.headline ?? state.lastAction,
  };
  return { state: next, banner, ok: true, shouldReroll };
}

/** Lookup helper — returns the card definition (re-exported for clients). */
export { HUSTLE_CARDS } from './cards.js';
