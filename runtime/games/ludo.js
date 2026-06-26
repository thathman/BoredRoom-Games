// Ludo — classic race-home board game runtime.
// Real board model: a shared 52-square main ring with four entry points, per-player home
// columns, safe squares (entries + stars), captures on the absolute ring, exact-finish,
// three-sixes forfeit, and extra turns for sixes/captures/reaching home.

import { RuntimeBase, clone, makeRng } from '../helpers.js';

const RING = 52; // shared main-track squares (absolute 0..51)
const HOME = 56; // relative finish square; needs an exact roll
const START_OFFSETS = [0, 13, 26, 39]; // four entry points around the ring
const SAFE_ABS = new Set([0, 13, 26, 39, 8, 21, 34, 47]); // entries + star squares

// Deterministic die from (seed, serial) so snapshot/restore reproduces the exact sequence.
function dieFor(seed, serial) {
  return 1 + Math.floor(makeRng((seed + serial * 2654435761) >>> 0)() * 6);
}

export class LudoRuntime extends RuntimeBase {
  start() {
    this.seed = Number(this.context?.settings?.seed) || (Date.now() & 0xffffffff);
    const tokens = Object.fromEntries(this.players.map((player) => [player.id, [-1, -1, -1, -1]]));
    const offsets = Object.fromEntries(this.players.map((player, index) => [player.id, START_OFFSETS[index % START_OFFSETS.length]]));
    this.state = {
      gameType: this.gameType,
      name: this.manifest.name,
      emoji: this.manifest.emoji,
      mode: 'ludo',
      phase: 'playing',
      players: clone(this.players),
      tokens,
      offsets,
      currentPlayerId: this.players[0]?.id,
      pendingRoll: null,
      rollSerial: 0,
      sixStreak: 0,
      safeSquares: [...SAFE_ABS],
      winnerPlayerIds: [],
      lastAction: 'Roll to start. A six brings a token out.',
    };
  }

  // Absolute ring square for a relative position (null when in yard or home column).
  absSquare(playerId, position) {
    if (position < 0 || position > 50) return null;
    return (this.state.offsets[playerId] + position) % RING;
  }

  handleIntent(playerId, intent) {
    if (!this.state || this.state.phase !== 'playing' || this.state.currentPlayerId !== playerId) return false;

    if (intent?.type === 'roll') {
      if (this.state.pendingRoll != null) return false;
      this.state.rollSerial += 1;
      const value = dieFor(this.seed, this.state.rollSerial);
      this.state.sixStreak = value === 6 ? this.state.sixStreak + 1 : 0;
      if (this.state.sixStreak >= 3) {
        // Three sixes in a row: forfeit the turn, no move.
        this.state.lastAction = `${this.playerName(playerId)} rolled three sixes — turn forfeited.`;
        this.advanceTurn();
        return true;
      }
      this.state.pendingRoll = value;
      this.state.lastAction = `${this.playerName(playerId)} rolled ${value}.`;
      if (this.legalMoves(playerId).length === 0) {
        this.state.lastAction += ' No legal move.';
        this.endTurn(playerId, false);
      }
      return true;
    }

    if (intent?.type !== 'move_token' || this.state.pendingRoll == null) return false;
    const tokenIndex = Number(intent?.tokenIndex);
    if (!this.legalMoves(playerId).some((move) => move.tokenIndex === tokenIndex)) return false;

    const tokens = this.state.tokens[playerId];
    const roll = this.state.pendingRoll;
    tokens[tokenIndex] = tokens[tokenIndex] < 0 ? 0 : tokens[tokenIndex] + roll;
    const captured = this.resolveCapture(playerId, tokens[tokenIndex]);
    const reachedHome = tokens[tokenIndex] === HOME;

    if (tokens.every((position) => position === HOME)) {
      const player = this.players.find((candidate) => candidate.id === playerId);
      player.score += 1;
      this.state.players = clone(this.players);
      this.state.phase = 'finished';
      this.state.winnerPlayerIds = [playerId];
      this.state.lastAction = `${this.playerName(playerId)} brought every token home.`;
      return true;
    }

    const extraTurn = roll === 6 || captured || reachedHome;
    this.state.lastAction = `${this.playerName(playerId)} moved token ${tokenIndex + 1}`
      + (captured ? ' and captured!' : reachedHome ? ' home!' : '.')
      + (extraTurn ? ' Roll again.' : '');
    this.endTurn(playerId, extraTurn);
    return true;
  }

  endTurn(playerId, keepTurn) {
    this.state.pendingRoll = null;
    if (keepTurn) return; // same player rolls again; six streak persists
    this.state.sixStreak = 0;
    this.advanceTurn();
  }

  // Send any un-safe opponent token on the same ring square back to its yard.
  resolveCapture(playerId, position) {
    const square = this.absSquare(playerId, position);
    if (square == null || SAFE_ABS.has(square)) return false;
    let captured = false;
    for (const [opponentId, tokens] of Object.entries(this.state.tokens)) {
      if (opponentId === playerId) continue;
      tokens.forEach((tokenPosition, index) => {
        if (this.absSquare(opponentId, tokenPosition) === square) {
          tokens[index] = -1;
          captured = true;
        }
      });
    }
    return captured;
  }

  playerName(playerId) { return this.players.find((player) => player.id === playerId)?.name ?? 'A player'; }

  legalMoves(playerId) {
    const roll = this.state?.pendingRoll;
    if (roll == null) return [];
    return (this.state.tokens[playerId] ?? []).map((position, tokenIndex) => {
      if (position === HOME) return null;
      if (position < 0) {
        return roll === 6 ? { type: 'move_token', tokenIndex, label: `Bring out token ${tokenIndex + 1}` } : null;
      }
      if (position + roll > HOME) return null; // exact finish required
      return { type: 'move_token', tokenIndex, label: `Move token ${tokenIndex + 1}` };
    }).filter(Boolean);
  }

  advanceTurn() {
    const next = (this.players.findIndex((candidate) => candidate.id === this.state.currentPlayerId) + 1) % this.players.length;
    this.state.currentPlayerId = this.players[next].id;
    this.state.pendingRoll = null;
    this.state.lastAction = `Turn passed to ${this.players[next].name}.`;
  }

  publicState() { return clone(this.state); }

  privateState(playerId) {
    return {
      seated: this.seated(playerId),
      isTurn: this.state?.currentPlayerId === playerId,
      tokens: clone(this.state?.tokens[playerId] ?? []),
      pendingRoll: this.state?.currentPlayerId === playerId ? this.state?.pendingRoll ?? null : null,
      legalIntents: this.legalIntents(playerId),
    };
  }

  legalIntents(playerId) {
    if (!this.state || this.state.phase !== 'playing' || this.state.currentPlayerId !== playerId) return [];
    if (this.state.pendingRoll == null) return [{ type: 'roll', label: 'Roll dice' }];
    return this.legalMoves(playerId);
  }

  // Bot policy: prefer a capture, then the most-advanced token, then bringing one out.
  rankBotIntent(playerId) {
    const moves = this.legalIntents(playerId);
    if (moves.length === 0) return null;
    if (moves[0]?.type === 'roll') return moves[0];
    const tokens = this.state.tokens[playerId] ?? [];
    const scored = moves.map((move) => {
      const pos = tokens[move.tokenIndex];
      let weight = pos < 0 ? 30 : pos; // advance furthest by default
      const target = pos < 0 ? 0 : pos + this.state.pendingRoll;
      const square = this.absSquare(playerId, target);
      if (square != null && !SAFE_ABS.has(square)) {
        for (const [oppId, oppTokens] of Object.entries(this.state.tokens)) {
          if (oppId === playerId) continue;
          if (oppTokens.some((p) => this.absSquare(oppId, p) === square)) weight += 100; // capture
        }
      }
      if (target === HOME) weight += 60; // reach home
      return { move, weight };
    });
    scored.sort((a, b) => b.weight - a.weight);
    return scored[0].move;
  }

  extraSnapshot() { return { seed: this.seed }; }
  restoreExtra(extra) { this.seed = extra?.seed ?? 1; }
}
