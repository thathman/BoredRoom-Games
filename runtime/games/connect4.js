// Connect 4 — drop-disc strategy game runtime.
// Extracted from game-runtime.js for independent testing.

import { RuntimeBase, clone, topPlayers } from '../helpers.js';

export class Connect4Runtime extends RuntimeBase {
  start() {
    this.state = {
      gameType: this.gameType,
      name: this.manifest.name,
      emoji: this.manifest.emoji,
      mode: 'connect4',
      phase: 'playing',
      board: Array.from({ length: 6 }, () => Array(7).fill(null)),
      players: clone(this.players.map((player, index) => ({ ...player, disc: index === 0 ? 'G' : index === 1 ? 'P' : 'Y' }))),
      currentPlayerId: this.players[0]?.id,
      moveCount: 0,
      winningCells: [],
      winnerPlayerIds: [],
      lastAction: 'Drop a counter into any open column.',
    };
  }

  handleIntent(playerId, intent) {
    if (!this.state || this.state.phase !== 'playing' || this.state.currentPlayerId !== playerId) return false;
    const column = Number(intent?.column ?? intent?.col);
    if (intent?.type !== 'drop' && intent?.type !== 'connect4:drop') return false;
    if (!Number.isInteger(column) || column < 0 || column > 6) return false;
    const row = [...this.state.board].reverse().findIndex((candidate) => candidate[column] == null);
    if (row < 0) return false;
    const actualRow = 5 - row;
    const player = this.state.players.find((candidate) => candidate.id === playerId);
    this.state.board[actualRow][column] = player.disc;
    this.state.moveCount += 1;
    const win = this.findWin(actualRow, column, player.disc);
    if (win.length) {
      player.score += 1;
      this.state.players = clone(this.state.players);
      this.state.phase = 'finished';
      this.state.winnerPlayerIds = [playerId];
      this.state.winningCells = win;
      this.state.lastAction = `${player.name} connected four.`;
      return true;
    }
    if (this.state.moveCount >= 42) {
      this.state.phase = 'finished';
      this.state.winnerPlayerIds = topPlayers(this.state.players);
      this.state.lastAction = 'Board full. Draw.';
      return true;
    }
    const next = (this.players.findIndex((candidate) => candidate.id === playerId) + 1) % this.players.length;
    this.state.currentPlayerId = this.players[next].id;
    this.state.lastAction = `${player.name} dropped in column ${column + 1}.`;
    return true;
  }

  findWin(row, col, disc) {
    const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
    for (const [dr, dc] of directions) {
      const cells = [[row, col]];
      for (const sign of [-1, 1]) {
        let r = row + dr * sign;
        let c = col + dc * sign;
        while (this.state.board[r]?.[c] === disc) {
          cells.push([r, c]);
          r += dr * sign;
          c += dc * sign;
        }
      }
      if (cells.length >= 4) return cells.slice(0, 4).map(([r, c]) => ({ row: r, column: c }));
    }
    return [];
  }

  publicState() { return clone(this.state); }
  privateState(playerId) { return { seated: this.seated(playerId), isTurn: this.state?.currentPlayerId === playerId, legalIntents: this.legalIntents(playerId) }; }
  legalIntents(playerId) {
    if (!this.state || this.state.phase !== 'playing' || this.state.currentPlayerId !== playerId) return [];
    return this.state.board[0].map((cell, column) => cell == null ? { type: 'drop', column, label: `Column ${column + 1}` } : null).filter(Boolean);
  }
}
