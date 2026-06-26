// Endless Tic Tac Toe — rolling Tic Tac Toe with limited active marks.
//
// 3×3 board with limited active marks per player (default 3).
// When a player places their 4th mark, their oldest mark is removed (FIFO).
// Board never fills — game is truly endless.
// Win: 3 marks in a row wins +1 point. First to targetScore wins round.
//
// Settings:
//   activeMarkLimit (number, default 3) — marks per player before rolling
//   targetScore (number, default 3) — wins needed to win round
//   teamMode (bool, default false) — players share mark pool as teams

import { RuntimeBase, clone, topPlayers } from '../helpers.js';

export class EtttRuntime extends RuntimeBase {
  start() {
    this.activeMarkLimit = Number(this.context?.settings?.activeMarkLimit) || 3;
    this.targetScore = Number(this.context?.settings?.targetScore) || 3;
    this.teamMode = this.context?.settings?.teamMode === true;

    const team0 = this.teamMode ? (this.context?.settings?.team0 ?? 'G') : 'X';
    const team1 = this.teamMode ? (this.context?.settings?.team1 ?? 'P') : 'O';

    this.markQueues = {};
    this.teamAssignments = {};
    if (this.teamMode) {
      for (let i = 0; i < this.players.length; i += 1) {
        this.teamAssignments[this.players[i].id] = i % 2 === 0 ? 0 : 1;
      }
      this.markQueues[0] = [];
      this.markQueues[1] = [];
    } else {
      for (const player of this.players) {
        this.markQueues[player.id] = [];
      }
    }

    this.state = {
      gameType: this.gameType,
      name: this.manifest.name,
      emoji: this.manifest.emoji,
      mode: 'ettt',
      phase: 'playing',
      board: Array.from({ length: 3 }, () => Array(3).fill(null)),
      oldestMarks: [],
      players: clone(this.players.map((p, i) => ({
        ...p,
        mark: this.teamMode ? (this.teamAssignments[p.id] === 0 ? team0 : team1) : (i === 0 ? 'X' : 'O'),
        team: this.teamMode ? this.teamAssignments[p.id] : undefined,
      }))),
      currentPlayerId: this.players[0]?.id,
      activeMarkLimit: this.activeMarkLimit,
      targetScore: this.targetScore,
      winnerPlayerIds: [],
      lastAction: 'Place 3 in a row. Oldest mark rolls off when you exceed 3.',
    };
  }

  handleIntent(playerId, intent) {
    if (!this.state || this.state.phase !== 'playing') return false;
    if (this.state.currentPlayerId !== playerId) return false;
    if (intent?.type !== 'place' && intent?.type !== 'ettt:place') return false;

    const cell = Number(intent?.cell);
    if (!Number.isInteger(cell) || cell < 0 || cell > 8) return false;
    const row = Math.floor(cell / 3);
    const col = cell % 3;
    if (this.state.board[row][col] != null) return false;

    const player = this.state.players.find((p) => p.id === playerId);
    if (!player) return false;

    // Place mark
    this.state.board[row][col] = player.mark;

    // Track queue for rolling
    const queueKey = this.teamMode ? this.teamAssignments[playerId] : playerId;
    const queue = this.markQueues[queueKey];
    queue.push({ row, col });

    // Roll off oldest mark if over limit
    let removed = null;
    if (queue.length > this.activeMarkLimit) {
      const oldest = queue.shift();
      this.state.board[oldest.row][oldest.col] = null;
      removed = oldest;
    }

    // Track oldest marks for UI
    const oldest = queue.length >= this.activeMarkLimit ? queue[0] : null;
    this.state.oldestMarks = oldest ? [{ row: oldest.row, col: oldest.col }] : [];

    // Check win after rolling
    const win = this.checkWin(player.mark);
    if (win) {
      player.score += 1;
      if (player.score >= this.targetScore) {
        // Round over
        this.state.players = clone(this.state.players);
        this.state.phase = 'finished';
        this.state.winnerPlayerIds = [playerId];
        this.state.winningCells = win;
        this.state.lastAction = `${player.name} got ${player.score} in a row and wins the round!`;
        return true;
      }
      // Score a win, reset board but keep score
      this.resetBoard();
      this.state.lastAction = `${player.name} got 3 in a row! Score: ${player.score}/${this.targetScore}. Board resets.`;
      this.state.winnerPlayerIds = [];
      return true;
    }

    // Advance to next player
    const currentIdx = this.players.findIndex((p) => p.id === playerId);
    const next = (currentIdx + 1) % this.players.length;
    this.state.currentPlayerId = this.players[next].id;
    this.state.lastAction = `${player.name} placed ${player.mark}${removed ? ', oldest mark rolled off' : ''}.`;
    return true;
  }

  resetBoard() {
    this.state.board = Array.from({ length: 3 }, () => Array(3).fill(null));
    this.state.oldestMarks = [];
    this.markQueues = {};
    if (this.teamMode) {
      this.markQueues[0] = [];
      this.markQueues[1] = [];
    } else {
      for (const player of this.players) {
        this.markQueues[player.id] = [];
      }
    }
  }

  checkWin(mark) {
    const lines = [
      [[0, 0], [0, 1], [0, 2]], [[1, 0], [1, 1], [1, 2]], [[2, 0], [2, 1], [2, 2]],
      [[0, 0], [1, 0], [2, 0]], [[0, 1], [1, 1], [2, 1]], [[0, 2], [1, 2], [2, 2]],
      [[0, 0], [1, 1], [2, 2]], [[0, 2], [1, 1], [2, 0]],
    ];
    return lines.find((line) => line.every(([r, c]) => this.state.board[r][c] === mark))
      ?.map(([r, c]) => ({ row: r, column: c })) ?? null;
  }

  publicState() { return clone(this.state); }

  privateState(playerId) {
    const player = this.state?.players?.find((p) => p.id === playerId);
    return {
      seated: this.seated(playerId),
      isTurn: this.state?.currentPlayerId === playerId,
      team: player?.team,
      markCount: (this.markQueues?.[this.teamMode ? this.teamAssignments?.[playerId] : playerId] ?? []).length,
      legalIntents: this.legalIntents(playerId),
    };
  }

  legalIntents(playerId) {
    if (!this.state || this.state.phase !== 'playing' || this.state.currentPlayerId !== playerId) return [];
    return this.state.board.flatMap((row, rowIndex) => row.map((cell, colIndex) => (
      cell == null ? { type: 'place', cell: rowIndex * 3 + colIndex, label: `Square ${rowIndex * 3 + colIndex + 1}` } : null
    ))).filter(Boolean);
  }

  rankBotIntent(playerId) {
    const intents = this.legalIntents(playerId);
    if (intents.length === 0) return null;
    // Simple strategy: prefer center, then corners, then edges
    const priorities = { 4: 10, 0: 8, 2: 8, 6: 8, 8: 8, 1: 5, 3: 5, 5: 5, 7: 5 };
    const best = intents.reduce((a, b) => (priorities[a.cell] ?? 0) >= (priorities[b.cell] ?? 0) ? a : b);
    return best;
  }

  recapSignals() {
    return {
      mode: 'ettt',
      scores: this.players.map(({ id, score }) => ({ playerId: id, score })),
      targetScore: this.state?.targetScore,
    };
  }

  extraSnapshot() {
    return {
      markQueues: this.markQueues,
      teamAssignments: this.teamAssignments,
    };
  }

  restoreExtra(extra) {
    this.markQueues = extra?.markQueues ?? {};
    this.teamAssignments = extra?.teamAssignments ?? {};
  }
}
