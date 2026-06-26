// Hustle — Snakes-and-Ladders-style Nigerian hustle board game.
//
// Board path with:
//   ladders  = opportunities, breakthroughs, helper, contract
//   snakes   = wahala, billing, traffic, scam, landlord, fuel scarcity
//   events   = Naija hustle situations
//
// Settings:
//   boardLength (number, default 30) — number of cells on the path
//   quickMode (bool, default false) — shorter board with more effects
//   diceMode (string, default 'single') — 'single' or 'double'
//   eventDensity (number, default 0.15) — fraction of cells that are event squares
//   seed (number, optional) — deterministic seed

import { RuntimeBase, makeRng, shuffleInPlace, clone, topPlayers } from '../helpers.js';

const LADDER_NAMES = [
  'Found a connect', 'Side hustle pays off', 'Family sends alert',
  'Spare parts resold', 'Contract landed', 'Data bundle promo',
  'Pastor prayed for you', 'Free ride to mainland',
];
const SNAKE_NAMES = [
  'Fuel scarcity', 'Landlord came knocking', 'NEPA took light',
  'Danfo conductor cheated', 'Scam alert hit', 'Traffic on Third Mainland',
  'Billing dey', 'Generator fuel finish',
];
const EVENT_NAMES = [
  'Aso Ebi contribution due', 'Owanbe invitation', 'Okada fare increase',
  'Market woman gave discount', 'Police checkpoint cleared',
  'Neighbor borrowed charger', 'Free food at party',
  'Phone screen cracked',
];

function rollDice(rng, diceMode) {
  const a = 1 + Math.floor(rng() * 6);
  if (diceMode === 'double') {
    const b = 1 + Math.floor(rng() * 6);
    return { value: a + b, double: a === b };
  }
  return { value: a, double: a === 6 };
}

function buildBoard(boardLength, eventDensity, rng) {
  const board = [];
  for (let i = 1; i <= boardLength; i += 1) {
    board.push({ position: i, type: 'normal' });
  }
  const r = () => Math.floor(rng() * 1000);
  // Add ladders (climb up 3-8 cells)
  const ladderCount = Math.max(1, Math.floor(boardLength * 0.12));
  for (let l = 0; l < ladderCount; l += 1) {
    const pos = 2 + (r() % (boardLength - 5));
    if (board[pos - 1].type !== 'normal') continue;
    const climb = 3 + (r() % 6);
    const target = Math.min(boardLength, pos + climb);
    board[pos - 1] = { position: pos, type: 'ladder', target, name: LADDER_NAMES[l % LADDER_NAMES.length] };
  }
  // Add snakes (slide down 3-10 cells)
  const snakeCount = Math.max(1, Math.floor(boardLength * 0.12));
  for (let s = 0; s < snakeCount; s += 1) {
    const pos = 5 + (r() % (boardLength - 8));
    if (board[pos - 1].type !== 'normal') continue;
    const fall = 3 + (r() % 8);
    const target = Math.max(1, pos - fall);
    board[pos - 1] = { position: pos, type: 'snake', target, name: SNAKE_NAMES[s % SNAKE_NAMES.length] };
  }
  // Add event squares
  const eventCount = Math.floor(boardLength * eventDensity);
  for (let e = 0; e < eventCount; e += 1) {
    const pos = 2 + (r() % (boardLength - 2));
    if (board[pos - 1].type !== 'normal') continue;
    board[pos - 1] = {
      position: pos,
      type: 'event',
      name: EVENT_NAMES[e % EVENT_NAMES.length],
      effect: r() % 2 === 0 ? 'forward' : 'backward',
      steps: 1 + (r() % 3),
    };
  }
  return board;
}

export class HustleRuntime extends RuntimeBase {
  start() {
    const seed = Number(this.context?.settings?.seed) || (Date.now() & 0xffffffff);
    this.rng = makeRng(seed);
    this.quickMode = this.context?.settings?.quickMode === true;
    this.diceMode = String(this.context?.settings?.diceMode || 'single');
    const boardLength = this.quickMode ? 20 : Number(this.context?.settings?.boardLength) || 30;
    const eventDensity = Math.min(0.3, Math.max(0, Number(this.context?.settings?.eventDensity) || 0.15));

    this.board = buildBoard(boardLength, eventDensity, this.rng);
    this.positions = {};
    this.eventLog = [];

    for (const player of this.players) {
      this.positions[player.id] = 0; // 0 = start, not yet on board
    }

    this.state = {
      gameType: this.gameType,
      name: this.manifest.name,
      emoji: this.manifest.emoji,
      mode: 'hustle',
      phase: 'playing',
      boardLength,
      board: clone(this.board),
      positions: clone(this.positions),
      players: clone(this.players.map((p) => ({ ...p }))),
      currentPlayerId: this.players[0]?.id,
      diceValue: null,
      diceDouble: false,
      rollAgain: false,
      rollsRemaining: 1,
      lastEvent: null,
      winnerPlayerIds: [],
      lastAction: 'Roll the dice to start your hustle.',
    };
  }

  handleIntent(playerId, intent, isHost) {
    if (!this.state || this.state.phase !== 'playing' || this.state.currentPlayerId !== playerId) return false;
    if (this._lastActed === playerId && this.state.rollAgain === false) return false;
    if (intent?.type !== 'roll') return false;

    this._lastActed = playerId;

    const roll = rollDice(this.rng, this.diceMode);
    this.state.diceValue = roll.value;
    this.state.diceDouble = roll.double;
    const player = this.state.players.find((p) => p.id === playerId);
    const pos = this.positions[playerId] ?? 0;

    let newPos = pos + roll.value;
    if (newPos >= this.state.boardLength) {
      newPos = this.state.boardLength;
      this.positions[playerId] = newPos;
      this.state.positions = clone(this.positions);
      this.resolveCell(newPos);
      this.state.phase = 'finished';
      this.state.winnerPlayerIds = [playerId];
      player.score += 10;
      this.state.lastAction = `${player.name} rolled ${roll.value} and reached the penthouse! Winner!`;
      this.state.rollsRemaining = 0;
      return true;
    }

    this.positions[playerId] = newPos;
    this.state.positions = clone(this.positions);
    this.resolveCell(newPos);

    if (roll.double) {
      this.state.rollsRemaining = 2;
      this.state.rollAgain = true;
      this.state.lastAction = `${player.name} rolled a double ${roll.value}! Roll again.`;
    } else {
      this.state.rollsRemaining = 1;
      this.state.rollAgain = false;
      this.advanceTurn();
    }
    return true;
  }

  resolveCell(position) {
    if (position < 1 || position > this.state.boardLength) return;
    const cell = this.board[position - 1];
    if (!cell || cell.type === 'normal') return;

    const playerId = this.state.currentPlayerId;
    const playerName = this.state.players.find((p) => p.id === playerId)?.name ?? 'Player';

    if (cell.type === 'ladder') {
      const oldPos = position;
      this.positions[playerId] = Math.min(this.state.boardLength, cell.target);
      this.state.positions = clone(this.positions);
      this.state.lastEvent = { type: 'ladder', name: cell.name, from: oldPos, to: cell.target };
      this.state.lastAction = `${playerName} landed on "${cell.name}" — climbed to ${cell.target}!`;
    } else if (cell.type === 'snake') {
      const oldPos = position;
      this.positions[playerId] = Math.max(1, cell.target);
      this.state.positions = clone(this.positions);
      this.state.lastEvent = { type: 'snake', name: cell.name, from: oldPos, to: cell.target };
      this.state.lastAction = `${playerName} landed on "${cell.name}" — slid down to ${cell.target}!`;
    } else if (cell.type === 'event') {
      const delta = cell.effect === 'forward' ? cell.steps : -cell.steps;
      const newPos = Math.min(this.state.boardLength, Math.max(1, position + delta));
      this.positions[playerId] = newPos;
      this.state.positions = clone(this.positions);
      this.state.lastEvent = { type: 'event', name: cell.name, effect: cell.effect, steps: cell.steps, from: position, to: newPos };
      this.state.lastAction = `${playerName} hit "${cell.name}" — moved ${cell.effect} ${cell.steps} step(s) to ${newPos}.`;
    }
  }

  advanceTurn() {
    const current = this.players.findIndex((c) => c.id === this.state.currentPlayerId);
    if (current < 0) return;
    const next = (current + 1) % this.players.length;
    this.state.currentPlayerId = this.players[next].id;
    this.state.rollsRemaining = 1;
    this.state.rollAgain = false;
    this.state.diceValue = null;
    this.state.diceDouble = false;
    this.state.lastEvent = null;
  }

  publicState() { return clone(this.state); }

  privateState(playerId) {
    return {
      seated: this.seated(playerId),
      isTurn: this.state?.currentPlayerId === playerId,
      position: this.positions?.[playerId] ?? 0,
      legalIntents: this.legalIntents(playerId),
      eventLog: clone(this.eventLog?.slice(-5) ?? []),
    };
  }

  legalIntents(playerId) {
    if (!this.state || this.state.phase !== 'playing' || this.state.currentPlayerId !== playerId) return [];
    if (this.state.rollAgain && this.state.rollsRemaining > 1) {
      return [{ type: 'roll', label: 'Roll again (double!)' }];
    }
    return [{ type: 'roll', label: 'Roll dice' }];
  }

  rankBotIntent(playerId) {
    const intents = this.legalIntents(playerId);
    if (intents.length === 0) return null;
    return intents[0]; // always roll
  }

  recapSignals() {
    return {
      mode: 'hustle',
      scores: this.players.map(({ id, score }) => ({ playerId: id, score })),
      boardLength: this.state?.boardLength,
    };
  }

  extraSnapshot() {
    return { positions: this.positions, board: this.board, rng: null, eventLog: this.eventLog };
  }

  restoreExtra(extra) {
    this.positions = extra?.positions ?? {};
    this.board = extra?.board ?? [];
    this.eventLog = extra?.eventLog ?? [];
    this.rng = makeRng((Date.now() & 0xffffffff));
  }
}
