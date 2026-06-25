// Word Wahala — pure engine. Server-authoritative validation, scoring, and
// rack management. No I/O, no side effects beyond returned state.
//
// Turn loop: lobby → playing(turn: rack → place → validate → score → refill)
//            → finished

import {
  BOARD_SIZE,
  CENTER,
  bonusAt,
  type BoardBonus,
} from './board.js';
import {
  BINGO_BONUS,
  RACK_SIZE,
  TILE_DEFS,
  buildTileBag,
  tileDef,
  type TileLetter,
} from './tiles.js';
import {
  TIER_CONFIGS,
  lookupWord,
  tierConfig,
  type DictionaryTier,
} from './dictionary.js';

export type WordWahalaPhase = 'lobby' | 'playing' | 'finished';

export interface WordWahalaSettings {
  /** Maximum consecutive passes before the game ends. Classic Scrabble = 6. */
  maxConsecutivePasses: number;
  /** Mode flag — 'standard' allows all tiers, 'pidgin_only' rejects standard. */
  mode: 'standard' | 'pidgin_only' | 'yarn_battle';
  /** Per-turn timer in seconds (0 = no timer). */
  turnTimerSec: number;
}

export const DEFAULT_WORDWAHALA_SETTINGS: WordWahalaSettings = {
  maxConsecutivePasses: 6,
  mode: 'standard',
  turnTimerSec: 0,
};

/** A tile sitting on the board. `wildAs` is set when the tile was a wildcard. */
export interface BoardTile {
  letter: TileLetter;
  wildAs?: string | null;
  /** Player who placed this tile. */
  placedBy: string;
}

export type BoardCell = BoardTile | null;

export interface WordWahalaPlayerState {
  id: string;
  displayName: string;
  color?: string;
  score: number;
  /** Public rack tile COUNT only — actual tiles live in private state. */
  rackSize: number;
}

export interface WordWahalaPrivateState {
  seatId: string;
  rack: TileLetter[];
}

/** A single placement intent from the controller. */
export interface PlacementIntent {
  row: number;
  col: number;
  letter: TileLetter;
  /** Required when letter is a wildcard. */
  wildAs?: string;
}

export interface ScoredWord {
  word: string;
  tier: DictionaryTier;
  baseLetterScore: number;
  multiplier: number;
  flatBonus: number;
  finalScore: number;
}

export interface PlayResult {
  ok: boolean;
  rejection?: string;
  scoredWords?: ScoredWord[];
  totalScore?: number;
  bingo?: boolean;
  state?: WordWahalaPublicState;
  /** Tiles to refill to placing player's rack (count). */
  refillCount?: number;
}

export interface WordWahalaLastBanner {
  kind: 'play' | 'pass' | 'swap' | 'reject' | 'win' | 'timeout';
  actorId: string;
  headline: string;
  detail: string;
  scoredWords?: ScoredWord[];
}

export interface WordWahalaPublicState {
  phase: WordWahalaPhase;
  settings: WordWahalaSettings;
  players: WordWahalaPlayerState[];
  currentPlayerIndex: number;
  /** 15×15 board. null = empty. */
  board: BoardCell[][];
  /** Tiles remaining in the bag. Public count only. */
  bagSize: number;
  consecutivePasses: number;
  turnNumber: number;
  lastBanner: WordWahalaLastBanner | null;
  lastAction: string;
  winnerId: string | null;
  /** Cached bonus map for client convenience. */
  bonusMap: BoardBonus[][];
  /** Server epoch ms when the current turn auto-passes (Yarn Battle). null = no timer. */
  turnEndsAt: number | null;
}

// ──────────────────────────────────────────────────────────────────────────
// Bag helpers (server-private; bag tiles aren't broadcast)
// ──────────────────────────────────────────────────────────────────────────

export function shuffleBag(bag: TileLetter[], rand: () => number = Math.random): TileLetter[] {
  const a = bag.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function drawTiles(bag: TileLetter[], n: number): { drawn: TileLetter[]; bag: TileLetter[] } {
  const drawn = bag.slice(0, n);
  const remaining = bag.slice(n);
  return { drawn, bag: remaining };
}

// ──────────────────────────────────────────────────────────────────────────
// State construction
// ──────────────────────────────────────────────────────────────────────────

export function makeInitialPlayer(
  id: string,
  displayName: string,
  color?: string,
): WordWahalaPlayerState {
  return { id, displayName, color, score: 0, rackSize: 0 };
}

export function createInitialWordWahalaState(
  players: WordWahalaPlayerState[],
  settings: WordWahalaSettings,
): WordWahalaPublicState {
  const board: BoardCell[][] = Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => null as BoardCell),
  );
  const bonusMap: BoardBonus[][] = Array.from({ length: BOARD_SIZE }, (_, r) =>
    Array.from({ length: BOARD_SIZE }, (_, c) => bonusAt(r, c)),
  );
  return {
    phase: 'lobby',
    settings,
    players: players.map((p) => ({ ...p, score: 0, rackSize: 0 })),
    currentPlayerIndex: 0,
    board,
    bagSize: 0,
    consecutivePasses: 0,
    turnNumber: 0,
    lastBanner: null,
    lastAction: 'Lobby — waiting for host to start.',
    winnerId: null,
    bonusMap,
    turnEndsAt: null,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Placement validation + scoring
// ──────────────────────────────────────────────────────────────────────────

interface ValidatedPlacement {
  /** Sorted (line-major) placements. */
  placements: PlacementIntent[];
  axis: 'row' | 'col';
  /** Words formed (the main word first, then cross-words). */
  words: ScoredWord[];
  totalScore: number;
  bingo: boolean;
}

function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
}

/**
 * Validate a set of placements against the board, ensure all formed words
 * are dictionary-legal, and compute score with per-square bonuses.
 *
 * Rules enforced:
 *   1. All placements share a single row OR single column.
 *   2. Placed cells + connected existing tiles form a contiguous line.
 *   3. First-ever play covers the center star.
 *   4. After first play, at least one new tile touches an existing tile.
 *   5. Every word formed (main + cross-words) is in the dictionary.
 *   6. Wildcards must declare `wildAs`.
 */
export function validateAndScore(
  state: WordWahalaPublicState,
  playerId: string,
  placements: PlacementIntent[],
): { ok: true; result: ValidatedPlacement } | { ok: false; rejection: string } {
  if (placements.length === 0) return { ok: false, rejection: 'no_tiles_placed' };
  if (placements.length > RACK_SIZE) return { ok: false, rejection: 'too_many_tiles' };

  // 1. Bounds + duplicate check + wildcard letter check
  const seen = new Set<string>();
  for (const p of placements) {
    if (!inBounds(p.row, p.col)) return { ok: false, rejection: 'out_of_bounds' };
    const key = `${p.row}:${p.col}`;
    if (seen.has(key)) return { ok: false, rejection: 'duplicate_square' };
    seen.add(key);
    if (state.board[p.row][p.col] !== null) return { ok: false, rejection: 'square_occupied' };
    const def = tileDef(p.letter);
    if (def.isWild && !p.wildAs) return { ok: false, rejection: 'wildcard_needs_letter' };
  }

  // 2. Single row OR column
  const rows = new Set(placements.map((p) => p.row));
  const cols = new Set(placements.map((p) => p.col));
  let axis: 'row' | 'col';
  if (rows.size === 1) axis = 'row';
  else if (cols.size === 1) axis = 'col';
  else return { ok: false, rejection: 'placements_not_in_line' };

  // Build a hypothetical board with new tiles applied
  const hypo: BoardCell[][] = state.board.map((row) => row.slice());
  for (const p of placements) {
    hypo[p.row][p.col] = {
      letter: p.letter,
      wildAs: p.wildAs ?? null,
      placedBy: playerId,
    };
  }

  // 3. First play covers center
  const isFirstPlay = state.turnNumber === 0 && state.board.flat().every((c) => c === null);
  if (isFirstPlay) {
    const coversCenter = placements.some((p) => p.row === CENTER && p.col === CENTER);
    if (!coversCenter) return { ok: false, rejection: 'first_play_must_cover_center' };
    if (placements.length < 2) return { ok: false, rejection: 'first_play_needs_two_tiles' };
  }

  // 2b. Contiguity along axis (placements + existing tiles fill a span)
  const sorted = [...placements].sort((a, b) =>
    axis === 'row' ? a.col - b.col : a.row - b.row,
  );
  if (axis === 'row') {
    const r = sorted[0].row;
    const minC = sorted[0].col;
    const maxC = sorted[sorted.length - 1].col;
    for (let c = minC; c <= maxC; c++) {
      if (hypo[r][c] === null) return { ok: false, rejection: 'gap_in_word' };
    }
  } else {
    const c = sorted[0].col;
    const minR = sorted[0].row;
    const maxR = sorted[sorted.length - 1].row;
    for (let r = minR; r <= maxR; r++) {
      if (hypo[r][c] === null) return { ok: false, rejection: 'gap_in_word' };
    }
  }

  // 4. After first play, must touch existing tile
  if (!isFirstPlay) {
    const touches = placements.some((p) => {
      const adj = [
        [p.row - 1, p.col], [p.row + 1, p.col],
        [p.row, p.col - 1], [p.row, p.col + 1],
      ];
      return adj.some(([r, c]) => inBounds(r, c) && state.board[r][c] !== null);
    });
    if (!touches) return { ok: false, rejection: 'must_connect_to_existing' };
  }

  // 5. Collect formed words: main word + cross-word per placement
  const wordsRaw: { tiles: { row: number; col: number }[]; isMain: boolean }[] = [];

  // Main word: extend along axis from first placement through existing tiles
  const first = sorted[0];
  const mainTiles = collectLine(hypo, first.row, first.col, axis);
  if (mainTiles.length >= 2) wordsRaw.push({ tiles: mainTiles, isMain: true });

  // Cross-words for each placed tile (perpendicular axis)
  const crossAxis: 'row' | 'col' = axis === 'row' ? 'col' : 'row';
  for (const p of placements) {
    const cross = collectLine(hypo, p.row, p.col, crossAxis);
    if (cross.length >= 2) wordsRaw.push({ tiles: cross, isMain: false });
  }

  if (wordsRaw.length === 0) return { ok: false, rejection: 'no_word_formed' };

  // 6. Validate + score each word
  const placedSet = new Set(placements.map((p) => `${p.row}:${p.col}`));
  const scored: ScoredWord[] = [];
  let total = 0;

  for (const w of wordsRaw) {
    const wordStr = w.tiles
      .map(({ row, col }) => {
        const cell = hypo[row][col];
        if (!cell) return '';
        if (cell.wildAs) return cell.wildAs.toLowerCase();
        return tileDef(cell.letter).chars;
      })
      .join('');

    const lookup = lookupWord(wordStr);
    if (!lookup.found) return { ok: false, rejection: `not_a_word:${wordStr}` };
    if (state.settings.mode === 'pidgin_only' && lookup.tier === 'standard') {
      return { ok: false, rejection: `pidgin_only_mode:${wordStr}` };
    }

    // Wildcard pidgin tier check
    for (const { row, col } of w.tiles) {
      const cell = hypo[row][col];
      if (cell && tileDef(cell.letter).wildTier === 'pidgin' && lookup.tier === 'standard') {
        return { ok: false, rejection: `pidgin_wild_in_standard:${wordStr}` };
      }
    }

    // Score: sum letter values × letter bonuses (only for newly-placed tiles),
    // then × word bonuses (only counting bonus squares newly covered).
    let baseLetter = 0;
    let wordMul = 1;
    for (const { row, col } of w.tiles) {
      const cell = hypo[row][col]!;
      const isNew = placedSet.has(`${row}:${col}`);
      const tilePts = tileDef(cell.letter).points;
      let letterMul = 1;
      if (isNew) {
        const bonus = bonusAt(row, col);
        if (bonus === 'dl') letterMul = 2;
        else if (bonus === 'tl') letterMul = 3;
        else if (bonus === 'dw' || bonus === 'star') wordMul *= 2;
        else if (bonus === 'tw') wordMul *= 3;
      }
      baseLetter += tilePts * letterMul;
    }
    const cfg = tierConfig(lookup.tier!);
    const tierMul = cfg.multiplier * wordMul;
    const finalScore = Math.round(baseLetter * tierMul) + cfg.flatBonus;

    scored.push({
      word: wordStr,
      tier: lookup.tier!,
      baseLetterScore: baseLetter,
      multiplier: tierMul,
      flatBonus: cfg.flatBonus,
      finalScore,
    });
    total += finalScore;
  }

  const bingo = placements.length === RACK_SIZE;
  if (bingo) total += BINGO_BONUS;

  return {
    ok: true,
    result: { placements: sorted, axis, words: scored, totalScore: total, bingo },
  };
}

function collectLine(
  board: BoardCell[][],
  row: number,
  col: number,
  axis: 'row' | 'col',
): { row: number; col: number }[] {
  const tiles: { row: number; col: number }[] = [];
  if (axis === 'row') {
    let c = col;
    while (c >= 0 && board[row][c] !== null) c--;
    c++;
    while (c < BOARD_SIZE && board[row][c] !== null) {
      tiles.push({ row, col: c });
      c++;
    }
  } else {
    let r = row;
    while (r >= 0 && board[r][col] !== null) r--;
    r++;
    while (r < BOARD_SIZE && board[r][col] !== null) {
      tiles.push({ row: r, col });
      r++;
    }
  }
  return tiles;
}

// ──────────────────────────────────────────────────────────────────────────
// Apply a successful play to state
// ──────────────────────────────────────────────────────────────────────────

export function applyPlay(
  state: WordWahalaPublicState,
  playerId: string,
  result: ValidatedPlacement,
): WordWahalaPublicState {
  const next: WordWahalaPublicState = {
    ...state,
    board: state.board.map((row) => row.slice()),
    players: state.players.map((p) => ({ ...p })),
  };
  for (const p of result.placements) {
    next.board[p.row][p.col] = {
      letter: p.letter,
      wildAs: p.wildAs ?? null,
      placedBy: playerId,
    };
  }
  const player = next.players.find((p) => p.id === playerId);
  if (player) player.score += result.totalScore;
  next.consecutivePasses = 0;
  next.turnNumber += 1;
  next.lastBanner = {
    kind: 'play',
    actorId: playerId,
    headline: `${player?.displayName ?? 'Player'} scored ${result.totalScore}`,
    detail: result.words.map((w) => `${w.word.toUpperCase()} (${TIER_CONFIGS[w.tier].label}): ${w.finalScore}`).join(' • ') + (result.bingo ? ` • Owambe! +${BINGO_BONUS}` : ''),
    scoredWords: result.words,
  };
  next.lastAction = next.lastBanner.headline;
  return advanceTurn(next);
}

export function applyPass(
  state: WordWahalaPublicState,
  playerId: string,
): WordWahalaPublicState {
  const next: WordWahalaPublicState = {
    ...state,
    players: state.players.map((p) => ({ ...p })),
  };
  next.consecutivePasses += 1;
  next.turnNumber += 1;
  const player = next.players.find((p) => p.id === playerId);
  next.lastBanner = {
    kind: 'pass',
    actorId: playerId,
    headline: `${player?.displayName ?? 'Player'} passed`,
    detail: `${next.consecutivePasses} pass(es) in a row`,
  };
  next.lastAction = next.lastBanner.headline;
  if (next.consecutivePasses >= state.settings.maxConsecutivePasses) {
    return finishGame(next);
  }
  return advanceTurn(next);
}

export function advanceTurn(state: WordWahalaPublicState): WordWahalaPublicState {
  if (state.phase !== 'playing') return state;
  if (state.players.length === 0) return state;
  const next = { ...state };
  next.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
  return next;
}

export function finishGame(state: WordWahalaPublicState): WordWahalaPublicState {
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  const winner = sorted[0]?.id ?? null;
  return {
    ...state,
    phase: 'finished',
    winnerId: winner,
    lastAction: winner ? `${sorted[0].displayName} wins with ${sorted[0].score}` : 'Game over',
  };
}

/** Apply a swap action: increment pass-equivalent counter is NOT used (swap is its
 *  own action), but the turn ends. The actual bag/rack mutation is handled by the
 *  server (which holds private state). This only updates public state + banner. */
export function applySwap(
  state: WordWahalaPublicState,
  playerId: string,
  swapCount: number,
): WordWahalaPublicState {
  const next: WordWahalaPublicState = {
    ...state,
    players: state.players.map((p) => ({ ...p })),
  };
  // Swap counts as a pass for end-of-game detection.
  next.consecutivePasses += 1;
  next.turnNumber += 1;
  const player = next.players.find((p) => p.id === playerId);
  next.lastBanner = {
    kind: 'swap',
    actorId: playerId,
    headline: `${player?.displayName ?? 'Player'} swapped ${swapCount} tile${swapCount === 1 ? '' : 's'}`,
    detail: 'Lost a turn but refreshed their rack.',
  };
  next.lastAction = next.lastBanner.headline;
  if (next.consecutivePasses >= state.settings.maxConsecutivePasses) {
    return finishGame(next);
  }
  return advanceTurn(next);
}

/** Auto-pass when a turn timer expires (Yarn Battle). */
export function applyTimeout(
  state: WordWahalaPublicState,
  playerId: string,
): WordWahalaPublicState {
  const next: WordWahalaPublicState = {
    ...state,
    players: state.players.map((p) => ({ ...p })),
  };
  next.consecutivePasses += 1;
  next.turnNumber += 1;
  const player = next.players.find((p) => p.id === playerId);
  next.lastBanner = {
    kind: 'timeout',
    actorId: playerId,
    headline: `${player?.displayName ?? 'Player'} ran out of time`,
    detail: 'Yarn Battle clock expired — auto-passed.',
  };
  next.lastAction = next.lastBanner.headline;
  if (next.consecutivePasses >= state.settings.maxConsecutivePasses) {
    return finishGame(next);
  }
  return advanceTurn(next);
}

export { tileDef, TILE_DEFS, RACK_SIZE, BINGO_BONUS, buildTileBag };
export { lookupWord, TIER_CONFIGS };
export type { DictionaryTier };
