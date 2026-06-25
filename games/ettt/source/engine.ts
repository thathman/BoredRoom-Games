// Pure Endless Tic Tac Toe engine. Server-authoritative.
// Standard 3x3 grid. Tag-team-ready: 3 marks max per TEAM (or per player when
// no team assignment is set, preserving 1v1 behaviour). On the 4th placement
// by the team, the team's oldest mark is removed before the new one lands.
// Win = standard 3-in-a-row by team mark.

export const ETTT_SIZE = 3;
export const ETTT_MAX_PIECES_PER_PLAYER = 3;

export type EtttMark = 'X' | 'O';
export type EtttCell = EtttMark | null;
export type EtttPhase = 'playing' | 'finished';
export type EtttTeam = 'A' | 'B';

/** Maps a team to its mark. */
export const TEAM_MARK: Record<EtttTeam, EtttMark> = {
  A: 'X',
  B: 'O',
};

export interface EtttPlayer {
  /** deviceId / seat id */
  id: string;
  displayName: string;
  mark: EtttMark;
  /** Tag-team assignment. Optional for backward-compat (1v1 still works). */
  team?: EtttTeam;
  color?: string;
}

export interface EtttPieceRef {
  row: number;
  col: number;
}

export interface EtttPublicState {
  phase: EtttPhase;
  /** Row-major 3x3 grid. */
  board: EtttCell[][];
  players: EtttPlayer[];
  currentPlayerIndex: number;
  currentPlayerId: string;
  turnNumber: number;
  winnerId: string | null;
  winningTeam: EtttTeam | null;
  /** The 3 winning cells, if any. */
  winningCells: EtttPieceRef[] | null;
  /** Each player's pieces in placement order (oldest first). Kept for legacy
   *  1v1 mode and UI hints. */
  piecesByPlayer: Record<string, EtttPieceRef[]>;
  /** Each team's pieces in placement order (oldest first). Used for eviction
   *  in tag-team mode; absent when players have no team assignment. */
  piecesByTeam: Record<EtttTeam, EtttPieceRef[]>;
  /** The piece that will disappear on the current TEAM (or player) NEXT
   *  placement if their pool is at cap. UI hint only. */
  oldestForCurrent: EtttPieceRef | null;
  lastAction: string;
  /** Last cell placed for animation. */
  lastPlacement: EtttPieceRef | null;
}

export function createEmptyEtttBoard(): EtttCell[][] {
  const board: EtttCell[][] = [];
  for (let r = 0; r < ETTT_SIZE; r++) {
    const row: EtttCell[] = [];
    for (let c = 0; c < ETTT_SIZE; c++) row.push(null);
    board.push(row);
  }
  return board;
}

export function createInitialEtttState(players: EtttPlayer[]): EtttPublicState {
  const piecesByPlayer: Record<string, EtttPieceRef[]> = {};
  for (const p of players) piecesByPlayer[p.id] = [];
  const piecesByTeam: Record<EtttTeam, EtttPieceRef[]> = { A: [], B: [] };
  const starter = players[0];
  const starterTeam = starter?.team;
  return {
    phase: 'playing',
    board: createEmptyEtttBoard(),
    players,
    currentPlayerIndex: 0,
    currentPlayerId: starter?.id ?? '',
    turnNumber: 1,
    winnerId: null,
    winningTeam: null,
    winningCells: null,
    piecesByPlayer,
    piecesByTeam,
    oldestForCurrent: null,
    lastAction: starter
      ? starterTeam
        ? `${starter.displayName} starts for Team ${starterTeam}.`
        : `${starter.displayName} starts.`
      : 'Waiting for players.',
    lastPlacement: null,
  };
}

const WIN_LINES: EtttPieceRef[][] = [
  [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }],
  [{ row: 1, col: 0 }, { row: 1, col: 1 }, { row: 1, col: 2 }],
  [{ row: 2, col: 0 }, { row: 2, col: 1 }, { row: 2, col: 2 }],
  [{ row: 0, col: 0 }, { row: 1, col: 0 }, { row: 2, col: 0 }],
  [{ row: 0, col: 1 }, { row: 1, col: 1 }, { row: 2, col: 1 }],
  [{ row: 0, col: 2 }, { row: 1, col: 2 }, { row: 2, col: 2 }],
  [{ row: 0, col: 0 }, { row: 1, col: 1 }, { row: 2, col: 2 }],
  [{ row: 0, col: 2 }, { row: 1, col: 1 }, { row: 2, col: 0 }],
];

export function findEtttWinningCells(
  board: EtttCell[][],
  mark: EtttMark,
): EtttPieceRef[] | null {
  for (const line of WIN_LINES) {
    if (line.every((c) => board[c.row][c.col] === mark)) return line;
  }
  return null;
}

function computeOldestForCurrent(state: EtttPublicState): EtttPieceRef | null {
  const cur = state.players[state.currentPlayerIndex];
  if (!cur) return null;
  const arr = cur.team
    ? state.piecesByTeam[cur.team] ?? []
    : state.piecesByPlayer[cur.id] ?? [];
  if (arr.length >= ETTT_MAX_PIECES_PER_PLAYER) return arr[0];
  return null;
}

export type EtttMoveResult =
  | { ok: true; state: EtttPublicState }
  | { ok: false; reason: 'wrong_turn' | 'game_over' | 'invalid_cell' | 'cell_occupied' };

export function applyEtttPlace(
  state: EtttPublicState,
  playerId: string,
  row: number,
  col: number,
): EtttMoveResult {
  if (state.phase === 'finished') return { ok: false, reason: 'game_over' };
  if (state.currentPlayerId !== playerId) return { ok: false, reason: 'wrong_turn' };
  if (row < 0 || row >= ETTT_SIZE || col < 0 || col >= ETTT_SIZE) {
    return { ok: false, reason: 'invalid_cell' };
  }
  const player = state.players[state.currentPlayerIndex];
  if (!player) return { ok: false, reason: 'wrong_turn' };

  const board = state.board.map((r) => r.slice());
  const piecesByPlayer: Record<string, EtttPieceRef[]> = {};
  for (const [id, arr] of Object.entries(state.piecesByPlayer)) {
    piecesByPlayer[id] = arr.slice();
  }
  const piecesByTeam: Record<EtttTeam, EtttPieceRef[]> = {
    A: state.piecesByTeam?.A?.slice() ?? [],
    B: state.piecesByTeam?.B?.slice() ?? [],
  };
  const myPlayerPieces = piecesByPlayer[player.id] ?? [];

  // The eviction pool: team pool when team-assigned (tag team), else player pool.
  // This is what enforces "3 marks per team" in 2v2.
  const evictionPool = player.team ? piecesByTeam[player.team] : myPlayerPieces;

  // If the cell holds the eviction pool's oldest mark and we're at cap, that's
  // a no-op (the oldest disappears and we replace it). Otherwise occupied = err.
  if (board[row][col] !== null) {
    const willEvict =
      evictionPool.length >= ETTT_MAX_PIECES_PER_PLAYER &&
      evictionPool[0].row === row &&
      evictionPool[0].col === col;
    if (!willEvict) return { ok: false, reason: 'cell_occupied' };
  }

  // Evict oldest from the eviction pool if at cap. Mirror the removal in
  // BOTH per-player and per-team trackers so they stay consistent.
  if (evictionPool.length >= ETTT_MAX_PIECES_PER_PLAYER) {
    const oldest = evictionPool.shift()!;
    board[oldest.row][oldest.col] = null;
    // Remove from per-player too.
    for (const id of Object.keys(piecesByPlayer)) {
      const idx = piecesByPlayer[id].findIndex((p) => p.row === oldest.row && p.col === oldest.col);
      if (idx >= 0) {
        piecesByPlayer[id].splice(idx, 1);
        break;
      }
    }
    // Remove from the OTHER pool too if we ate from per-player (covers no-team mode).
    if (!player.team) {
      for (const t of ['A', 'B'] as EtttTeam[]) {
        const idx = piecesByTeam[t].findIndex((p) => p.row === oldest.row && p.col === oldest.col);
        if (idx >= 0) piecesByTeam[t].splice(idx, 1);
      }
    }
  }

  // Place new piece in both trackers.
  board[row][col] = player.mark;
  myPlayerPieces.push({ row, col });
  piecesByPlayer[player.id] = myPlayerPieces;
  if (player.team) piecesByTeam[player.team].push({ row, col });

  const winningCells = findEtttWinningCells(board, player.mark);
  if (winningCells) {
    const team = player.team ?? null;
    const winLabel = team
      ? `Team ${team} wins! (${player.displayName})`
      : `${player.displayName} wins!`;
    return {
      ok: true,
      state: {
        ...state,
        board,
        piecesByPlayer,
        piecesByTeam,
        phase: 'finished',
        winnerId: player.id,
        winningTeam: team,
        winningCells,
        lastAction: winLabel,
        lastPlacement: { row, col },
        oldestForCurrent: null,
        turnNumber: state.turnNumber + 1,
      },
    };
  }

  const nextIndex = (state.currentPlayerIndex + 1) % state.players.length;
  const nextPlayer = state.players[nextIndex];
  const teamLabel = player.team ? `Team ${player.team} (${player.displayName})` : player.displayName;
  const nextState: EtttPublicState = {
    ...state,
    board,
    piecesByPlayer,
    piecesByTeam,
    currentPlayerIndex: nextIndex,
    currentPlayerId: nextPlayer.id,
    lastAction: `${teamLabel} placed at row ${row + 1}, col ${col + 1}.`,
    lastPlacement: { row, col },
    turnNumber: state.turnNumber + 1,
    oldestForCurrent: null,
  };
  nextState.oldestForCurrent = computeOldestForCurrent(nextState);
  return { ok: true, state: nextState };
}
