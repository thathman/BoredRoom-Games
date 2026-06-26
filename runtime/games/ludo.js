// Ludo — classic race-home board game runtime.
// Extracted from game-runtime.js for independent testing.

import { RuntimeBase, clone } from '../helpers.js';

export class LudoRuntime extends RuntimeBase {
  start() {
    const tokens = Object.fromEntries(this.players.map((player) => [player.id, [-1, -1, -1, -1]]));
    this.state = {
      gameType: this.gameType,
      name: this.manifest.name,
      emoji: this.manifest.emoji,
      mode: 'ludo',
      phase: 'playing',
      players: clone(this.players),
      tokens,
      currentPlayerId: this.players[0]?.id,
      pendingRoll: null,
      rollIndex: 0,
      winnerPlayerIds: [],
      lastAction: 'Roll to start. A six brings a token out.',
    };
  }

  handleIntent(playerId, intent) {
    if (!this.state || this.state.phase !== 'playing' || this.state.currentPlayerId !== playerId) return false;
    if (intent?.type === 'roll') {
      if (this.state.pendingRoll != null) return false;
      const sequence = [6, 3, 6, 4, 2, 5, 6, 1];
      this.state.pendingRoll = sequence[this.state.rollIndex % sequence.length];
      this.state.rollIndex += 1;
      this.state.lastAction = `${this.playerName(playerId)} rolled ${this.state.pendingRoll}.`;
      if (this.legalMoves(playerId).length === 0) this.advanceTurn();
      return true;
    }
    if (intent?.type !== 'move_token') return false;
    if (this.state.pendingRoll == null) return false;
    const tokenIndex = Number(intent?.tokenIndex);
    if (!this.legalMoves(playerId).some((move) => move.tokenIndex === tokenIndex)) return false;
    const tokens = this.state.tokens[playerId];
    tokens[tokenIndex] = tokens[tokenIndex] < 0 ? 0 : Math.min(57, tokens[tokenIndex] + this.state.pendingRoll);
    this.capture(playerId, tokens[tokenIndex]);
    if (tokens.every((position) => position >= 57)) {
      const player = this.players.find((candidate) => candidate.id === playerId);
      player.score += 1;
      this.state.players = clone(this.players);
      this.state.phase = 'finished';
      this.state.winnerPlayerIds = [playerId];
      this.state.lastAction = `${this.playerName(playerId)} brought every token home.`;
      return true;
    }
    const rolledSix = this.state.pendingRoll === 6;
    this.state.pendingRoll = null;
    if (!rolledSix) this.advanceTurn();
    else this.state.lastAction = `${this.playerName(playerId)} moved and keeps the turn for rolling six.`;
    return true;
  }

  playerName(playerId) { return this.players.find((player) => player.id === playerId)?.name ?? 'A player'; }
  legalMoves(playerId) {
    const roll = this.state?.pendingRoll;
    if (roll == null) return [];
    return (this.state.tokens[playerId] ?? []).map((position, tokenIndex) => {
      if (position < 0 && roll !== 6) return null;
      if (position >= 57) return null;
      if (position + roll > 57 && position >= 0) return null;
      return { type: 'move_token', tokenIndex, label: position < 0 ? `Bring out token ${tokenIndex + 1}` : `Move token ${tokenIndex + 1}` };
    }).filter(Boolean);
  }
  capture(playerId, position) {
    if (position <= 0 || [0, 8, 13, 21, 26, 34, 39, 47].includes(position)) return;
    for (const [opponentId, tokens] of Object.entries(this.state.tokens)) {
      if (opponentId === playerId) continue;
      tokens.forEach((tokenPosition, index) => { if (tokenPosition === position) tokens[index] = -1; });
    }
  }
  advanceTurn() {
    const next = (this.players.findIndex((candidate) => candidate.id === this.state.currentPlayerId) + 1) % this.players.length;
    this.state.currentPlayerId = this.players[next].id;
    this.state.pendingRoll = null;
    this.state.lastAction = `Turn passed to ${this.players[next].name}.`;
  }
  publicState() { return clone(this.state); }
  privateState(playerId) { return { seated: this.seated(playerId), isTurn: this.state?.currentPlayerId === playerId, tokens: clone(this.state?.tokens[playerId] ?? []), legalIntents: this.legalIntents(playerId) }; }
  legalIntents(playerId) {
    if (!this.state || this.state.phase !== 'playing' || this.state.currentPlayerId !== playerId) return [];
    if (this.state.pendingRoll == null) return [{ type: 'roll', label: 'Roll dice' }];
    return this.legalMoves(playerId);
  }
}
