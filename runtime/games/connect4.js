// Connect 4 — drop-disc strategy game runtime.
// Supports solo (1v1+) and team mode, best-of-N rounds with a final-board history for review,
// and per-player contribution tracking.

import { RuntimeBase, clone } from '../helpers.js';

const DISCS = ['G', 'P', 'Y', 'B'];

export class Connect4Runtime extends RuntimeBase {
  start() {
    const settings = this.context?.settings ?? {};
    this.teamMode = settings.teamMode === true && this.players.length >= 2;
    const bestOf = Number.isInteger(settings.bestOf) && settings.bestOf > 0 ? settings.bestOf : 1;
    this.bestOf = bestOf;
    this.roundsToWin = Math.floor(bestOf / 2) + 1;

    // In team mode players split into two alternating teams (A/B) so turns ping-pong by side.
    const sides = this.players.map((player, index) => (this.teamMode ? (index % 2 === 0 ? 'A' : 'B') : player.id));
    const order = this.teamMode ? this.interleaveBySide() : this.players.slice();

    this.state = {
      gameType: this.gameType,
      name: this.manifest.name,
      emoji: this.manifest.emoji,
      mode: 'connect4',
      phase: 'playing',
      teamMode: this.teamMode,
      bestOf,
      roundsToWin: this.roundsToWin,
      round: 1,
      board: this.emptyBoard(),
      players: clone(this.players.map((player, index) => ({
        ...player,
        side: sides[index],
        disc: this.teamMode ? (sides[index] === 'A' ? 'G' : 'P') : DISCS[index % DISCS.length],
      }))),
      turnOrder: order.map((player) => player.id),
      currentPlayerId: order[0]?.id,
      moveCount: 0,
      roundWins: {}, // keyed by side (team) or playerId
      contributions: Object.fromEntries(this.players.map((p) => [p.id, 0])),
      boardHistory: [],
      lastRoundWinner: null,
      winningCells: [],
      winnerPlayerIds: [],
      lastAction: 'Drop a counter into any open column.',
    };
  }

  emptyBoard() { return Array.from({ length: 6 }, () => Array(7).fill(null)); }

  interleaveBySide() {
    const a = this.players.filter((_, i) => i % 2 === 0);
    const b = this.players.filter((_, i) => i % 2 === 1);
    const order = [];
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      if (a[i]) order.push(a[i]);
      if (b[i]) order.push(b[i]);
    }
    return order;
  }

  sideOf(playerId) {
    const player = this.state.players.find((p) => p.id === playerId);
    return this.state.teamMode ? player?.side : playerId;
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
    this.state.contributions[playerId] = (this.state.contributions[playerId] ?? 0) + 1;

    const win = this.findWin(actualRow, column, player.disc);
    if (win.length) return this.resolveRound(player, win);
    if (this.state.moveCount >= 42) return this.resolveRound(null, []);

    this.advanceTurn(playerId);
    this.state.lastAction = `${player.name} dropped in column ${column + 1}.`;
    return true;
  }

  resolveRound(winnerPlayer, winningCells) {
    const key = winnerPlayer ? this.sideOf(winnerPlayer.id) : null;
    this.state.boardHistory.push({ round: this.state.round, board: clone(this.state.board), winnerKey: key, winningCells });
    this.state.winningCells = winningCells;
    if (key) {
      this.state.roundWins[key] = (this.state.roundWins[key] ?? 0) + 1;
      this.state.lastRoundWinner = key;
      // Credit a round point to every player on the winning side.
      for (const p of this.players) {
        if (this.sideOf(p.id) === key) p.score += 1;
      }
      this.state.players = clone(this.state.players.map((p) => ({ ...p, score: this.players.find((x) => x.id === p.id)?.score ?? p.score })));
    } else {
      this.state.lastRoundWinner = 'draw';
    }

    const reachedTarget = key && (this.state.roundWins[key] >= this.state.roundsToWin);
    if (reachedTarget || this.state.bestOf === 1) {
      this.state.phase = 'finished';
      this.state.winnerPlayerIds = key ? this.players.filter((p) => this.sideOf(p.id) === key).map((p) => p.id) : [];
      this.state.lastAction = key
        ? `${winnerPlayer.name}${this.state.teamMode ? ` (team ${key})` : ''} wins${this.state.bestOf > 1 ? ' the match' : ''}.`
        : 'Board full. Draw.';
      return true;
    }

    // Start the next round; rotate the turn order so the opening move alternates.
    this.state.round += 1;
    this.state.board = this.emptyBoard();
    this.state.moveCount = 0;
    this.state.winningCells = [];
    this.state.turnOrder = [...this.state.turnOrder.slice(1), this.state.turnOrder[0]];
    this.state.currentPlayerId = this.state.turnOrder[0];
    this.state.lastAction = key
      ? `Round ${this.state.round - 1} to ${key}. Round ${this.state.round} — drop a counter.`
      : `Round ${this.state.round - 1} drawn. Round ${this.state.round} — drop a counter.`;
    return true;
  }

  advanceTurn(playerId) {
    const order = this.state.turnOrder;
    const next = (order.indexOf(playerId) + 1) % order.length;
    this.state.currentPlayerId = order[next];
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

  privateState(playerId) {
    const player = this.state?.players.find((p) => p.id === playerId);
    return {
      seated: this.seated(playerId),
      isTurn: this.state?.currentPlayerId === playerId,
      disc: player?.disc ?? null,
      side: player?.side ?? null,
      legalIntents: this.legalIntents(playerId),
    };
  }

  legalIntents(playerId) {
    if (!this.state || this.state.phase !== 'playing' || this.state.currentPlayerId !== playerId) return [];
    return this.state.board[0].map((cell, column) => cell == null ? { type: 'drop', column, label: `Column ${column + 1}` } : null).filter(Boolean);
  }

  // Bot: take a winning drop, block an opponent win, else play centre-ward.
  rankBotIntent(playerId) {
    const moves = this.legalIntents(playerId);
    if (moves.length === 0) return null;
    const player = this.state.players.find((p) => p.id === playerId);
    const oppDisc = this.state.players.find((p) => this.sideOf(p.id) !== this.sideOf(playerId))?.disc;
    const wins = moves.filter((m) => this.wouldConnect(m.column, player.disc));
    if (wins.length) return wins[0];
    if (oppDisc) {
      const blocks = moves.filter((m) => this.wouldConnect(m.column, oppDisc));
      if (blocks.length) return blocks[0];
    }
    return moves.sort((a, b) => Math.abs(3 - a.column) - Math.abs(3 - b.column))[0];
  }

  wouldConnect(column, disc) {
    const row = [...this.state.board].reverse().findIndex((candidate) => candidate[column] == null);
    if (row < 0) return false;
    const actualRow = 5 - row;
    this.state.board[actualRow][column] = disc;
    const win = this.findWin(actualRow, column, disc).length >= 4;
    this.state.board[actualRow][column] = null;
    return win;
  }

  recapSignals() {
    return {
      mode: this.state?.mode,
      round: this.state?.round,
      roundWins: this.state?.roundWins,
      contributions: this.state?.contributions,
    };
  }
}
