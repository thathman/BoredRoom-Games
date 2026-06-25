// Pure Connect 4 engine. Server-authoritative; UI only renders this state.
// Standard 7 columns × 6 rows. Two TEAMS (2v2 tag team supported, 1v1 also works).
// Discs are coloured by TEAM, not by individual player. Teams alternate turns
// (A1 → B1 → A2 → B2 → …). A team wins when any of its discs forms a 4-in-a-row.

export const CONNECT4_COLS = 7;
export const CONNECT4_ROWS = 6;

export type Connect4Disc = 'red' | 'yellow';
export type Connect4Cell = Connect4Disc | null;
export type Connect4Phase = 'playing' | 'finished';
export type Connect4Team = 'A' | 'B';

/** Maps a team to its disc colour. */
export const TEAM_DISC: Record<Connect4Team, Connect4Disc> = {
  A: 'red',
  B: 'yellow',
};

export interface Connect4Player {
  /** deviceId / seat id */
  id: string;
  displayName: string;
  disc: Connect4Disc;
  /** Tag-team assignment. Optional for backward-compat; rooms set this. */
  team?: Connect4Team;
  color?: string;
}

export interface Connect4WinningCell {
  row: number;
  col: number;
}

export interface Connect4PublicState {
  phase: Connect4Phase;
  /** Row-major grid: board[row][col]. row 0 = top, row 5 = bottom. */
  board: Connect4Cell[][];
  players: Connect4Player[];
  currentPlayerIndex: number;
  currentPlayerId: string;
  turnNumber: number;
  winnerId: string | null;
  /** Winning team, derived from the disc that completed the 4-in-a-row. */
  winningTeam: Connect4Team | null;
  /** Cells highlighted as the winning 4-in-a-row, if any. */
  winningCells: Connect4WinningCell[] | null;
  /** Last server-narrated action — mirrors LudoState/WhotPublicState shape. */
  lastAction: string;
  /** Last column dropped into, for UI animation. */
  lastDropCol: number | null;
}

export function createEmptyBoard(): Connect4Cell[][] {
  const board: Connect4Cell[][] = [];
  for (let r = 0; r < CONNECT4_ROWS; r++) {
    const row: Connect4Cell[] = [];
    for (let c = 0; c < CONNECT4_COLS; c++) row.push(null);
    board.push(row);
  }
  return board;
}

export function createInitialConnect4State(players: Connect4Player[]): Connect4PublicState {
  return {
    phase: 'playing',
    board: createEmptyBoard(),
    players,
    currentPlayerIndex: 0,
    currentPlayerId: players[0]?.id ?? '',
    turnNumber: 1,
    winnerId: null,
    winningTeam: null,
    winningCells: null,
    lastAction: players[0]
      ? `${players[0].displayName} starts for Team ${players[0].team ?? 'A'}.`
      : 'Waiting for players.',
    lastDropCol: null,
  };
}

/** Returns the lowest empty row index in the column, or -1 if full. */
export function lowestEmptyRow(board: Connect4Cell[][], col: number): number {
  for (let r = CONNECT4_ROWS - 1; r >= 0; r--) {
    if (board[r][col] === null) return r;
  }
  return -1;
}

export function isColumnPlayable(board: Connect4Cell[][], col: number): boolean {
  if (col < 0 || col >= CONNECT4_COLS) return false;
  return lowestEmptyRow(board, col) >= 0;
}

export function isBoardFull(board: Connect4Cell[][]): boolean {
  for (let c = 0; c < CONNECT4_COLS; c++) {
    if (lowestEmptyRow(board, c) >= 0) return false;
  }
  return true;
}

const DIRECTIONS: Array<[number, number]> = [
  [0, 1],   // horizontal
  [1, 0],   // vertical
  [1, 1],   // diagonal down-right
  [1, -1],  // diagonal down-left
];

/** If placing `disc` at (row, col) creates a 4-in-a-row, returns those 4 cells. */
export function findWinningCells(
  board: Connect4Cell[][],
  row: number,
  col: number,
  disc: Connect4Disc,
): Connect4WinningCell[] | null {
  for (const [dr, dc] of DIRECTIONS) {
    const cells: Connect4WinningCell[] = [{ row, col }];
    // Walk forward
    let r = row + dr;
    let c = col + dc;
    while (
      r >= 0 && r < CONNECT4_ROWS &&
      c >= 0 && c < CONNECT4_COLS &&
      board[r][c] === disc
    ) {
      cells.push({ row: r, col: c });
      r += dr;
      c += dc;
    }
    // Walk backward
    r = row - dr;
    c = col - dc;
    while (
      r >= 0 && r < CONNECT4_ROWS &&
      c >= 0 && c < CONNECT4_COLS &&
      board[r][c] === disc
    ) {
      cells.unshift({ row: r, col: c });
      r -= dr;
      c -= dc;
    }
    if (cells.length >= 4) return cells.slice(0, 4);
  }
  return null;
}

export type Connect4MoveResult =
  | { ok: true; state: Connect4PublicState }
  | { ok: false; reason: 'wrong_turn' | 'game_over' | 'invalid_column' | 'column_full' };

export function applyConnect4Drop(
  state: Connect4PublicState,
  playerId: string,
  col: number,
): Connect4MoveResult {
  if (state.phase === 'finished') return { ok: false, reason: 'game_over' };
  if (state.currentPlayerId !== playerId) return { ok: false, reason: 'wrong_turn' };
  if (col < 0 || col >= CONNECT4_COLS) return { ok: false, reason: 'invalid_column' };
  const row = lowestEmptyRow(state.board, col);
  if (row < 0) return { ok: false, reason: 'column_full' };

  const player = state.players[state.currentPlayerIndex];
  if (!player) return { ok: false, reason: 'wrong_turn' };

  // Immutable board copy with the new disc placed.
  const board = state.board.map((r) => r.slice());
  board[row][col] = player.disc;

  const winningCells = findWinningCells(board, row, col, player.disc);
  if (winningCells) {
    const team = player.team ?? null;
    const winLabel = team
      ? `Team ${team} (${player.displayName}) connects four — game over!`
      : `${player.displayName} wins with 4 in a row!`;
    return {
      ok: true,
      state: {
        ...state,
        board,
        phase: 'finished',
        winnerId: player.id,
        winningTeam: team,
        winningCells,
        lastAction: winLabel,
        lastDropCol: col,
        turnNumber: state.turnNumber + 1,
      },
    };
  }

  if (isBoardFull(board)) {
    return {
      ok: true,
      state: {
        ...state,
        board,
        phase: 'finished',
        winnerId: null,
        winningTeam: null,
        winningCells: null,
        lastAction: 'Draw — board is full.',
        lastDropCol: col,
        turnNumber: state.turnNumber + 1,
      },
    };
  }

  const nextIndex = (state.currentPlayerIndex + 1) % state.players.length;
  const nextPlayer = state.players[nextIndex];
  const teamLabel = player.team ? `Team ${player.team} (${player.displayName})` : player.displayName;
  return {
    ok: true,
    state: {
      ...state,
      board,
      currentPlayerIndex: nextIndex,
      currentPlayerId: nextPlayer.id,
      lastAction: `${teamLabel} dropped in column ${col + 1}.`,
      lastDropCol: col,
      turnNumber: state.turnNumber + 1,
    },
  };
}
