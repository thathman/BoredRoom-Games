// Oga Landlord — Monopoly-inspired Nigerian property game.
// Board with properties, buy/pass, rent, property sets, upgrades, wahala cards.

import { RuntimeBase, makeRng, shuffleInPlace, clone, topPlayers } from '../helpers.js';

const BOARD_CELLS = [
  { name: 'Start', type: 'start', price: 0, rent: 0 },
  { name: 'Mile 12 Market', type: 'property', price: 6000, rent: 400, set: 'market' },
  { name: 'Wahala Card', type: 'chance' },
  { name: 'Alaba Intl', type: 'property', price: 6000, rent: 400, set: 'market' },
  { name: 'Tax Office', type: 'tax', amount: 2000 },
  { name: 'Danfo Station', type: 'rail', price: 20000, rent: 1500 },
  { name: 'Ikeja Computer Village', type: 'property', price: 10000, rent: 700, set: 'tech' },
  { name: 'Wahala Card', type: 'chance' },
  { name: 'Wuse Market', type: 'property', price: 12000, rent: 800, set: 'tech' },
  { name: 'Surulere', type: 'property', price: 14000, rent: 1000, set: 'estate' },
  { name: 'Parking Fee', type: 'penalty', amount: 1000 },
  { name: 'Banana Island', type: 'property', price: 18000, rent: 1300, set: 'estate' },
  { name: 'Wahala Card', type: 'chance' },
  { name: 'Ikoyi', type: 'property', price: 22000, rent: 1600, set: 'estate' },
  { name: 'Bolt Garage', type: 'rail', price: 20000, rent: 1500 },
  { name: 'Victoria Island', type: 'property', price: 26000, rent: 2000, set: 'island' },
  { name: 'Wahala Card', type: 'chance' },
  { name: 'Lekki Phase 1', type: 'property', price: 30000, rent: 2400, set: 'island' },
  { name: 'NEPA Bill', type: 'tax', amount: 3000 },
  { name: 'Eko Atlantic', type: 'property', price: 40000, rent: 3200, set: 'island' },
];

const WAHALA_CARDS = [
  { text: 'Federal allocation paid. Collect ₦10,000.', effect: 'collect', amount: 10000 },
  { text: 'Generator repair bill. Pay ₦3,000.', effect: 'pay', amount: 3000 },
  { text: 'Family alert from village. Pay ₦5,000.', effect: 'pay', amount: 5000 },
  { text: 'Aso Ebi contribution. Pay ₦2,500.', effect: 'pay', amount: 2500 },
  { text: 'Landed a contract! Collect ₦15,000.', effect: 'collect', amount: 15000 },
  { text: 'Okada crushed your side mirror. Pay ₦1,500.', effect: 'pay', amount: 1500 },
  { text: 'Data subscription expired. Pay ₦500.', effect: 'pay', amount: 500 },
  { text: 'Sold spare parts. Collect ₦8,000.', effect: 'collect', amount: 8000 },
  { text: 'Go to Start. Collect ₦20,000.', effect: 'goto', cell: 0, amount: 20000 },
  { text: 'Danfo conductor forgot your change. Pay ₦200.', effect: 'pay', amount: 200 },
];

export class LandlordRuntime extends RuntimeBase {
  start() {
    const seed = Number(this.context?.settings?.seed) || (Date.now() & 0xffffffff);
    this.rng = makeRng(seed);
    this.startingCash = Number(this.context?.settings?.startingCash) || 50000;
    this.quickMode = this.context?.settings?.quickMode === true;
    this.board = clone(BOARD_CELLS);
    this.wahalaDeck = shuffleInPlace(clone(WAHALA_CARDS), this.rng);
    this.wahalaIndex = 0;

    this.cash = {};
    this.positions = {};
    this.properties = {};
    this.upgrades = {};

    for (const player of this.players) {
      this.cash[player.id] = this.startingCash;
      this.positions[player.id] = 0;
      this.properties[player.id] = [];
      this.upgrades[player.id] = {};
    }

    this.state = {
      gameType: this.gameType, name: this.manifest.name, emoji: this.manifest.emoji,
      mode: 'landlord', phase: 'playing', board: clone(this.board),
      players: clone(this.players.map((p) => ({ ...p, cash: this.cash[p.id] }))),
      currentPlayerId: this.players[0]?.id, positions: clone(this.positions),
      properties: clone(this.properties), wahalaCard: null,
      rollsRemaining: 1, rollAgain: false, diceValue: null,
      winnerPlayerIds: [], lastAction: 'Roll to move and buy properties.',
    };
  }

  handleIntent(playerId, intent, isHost) {
    if (!this.state || this.state.phase !== 'playing' || this.state.currentPlayerId !== playerId) return false;
    if (intent?.type !== 'roll' && intent?.type !== 'buy' && intent?.type !== 'pass') return false;

    if (intent?.type === 'roll') {
      if (this.state.cellProps && !this.state.cellProps.owned) return false;
      return this.doRoll(playerId);
    }
    if (intent?.type === 'buy') {
      return this.doBuy(playerId);
    }
    if (intent?.type === 'pass') {
      this.advanceTurn();
      this.state.lastAction = `${this.playerName(playerId)} passed.`;
      return true;
    }
    return false;
  }

  doRoll(playerId) {
    const d1 = 1 + Math.floor(this.rng() * 6);
    const d2 = 1 + Math.floor(this.rng() * 6);
    const total = d1 + d2;
    const isDouble = d1 === d2;

    this.state.diceValue = total;
    let pos = ((this.positions[playerId] ?? 0) + total) % this.board.length;
    if (pos < 0) pos += this.board.length;
    this.positions[playerId] = pos;
    this.state.positions = clone(this.positions);

    const cell = this.board[pos];
    this.state.cellAction = cell;
    this.state.lastAction = `${this.playerName(playerId)} rolled ${total} and landed on ${cell.name}.`;

    if (cell.type === 'chance') {
      return this.handleWahala(playerId);
    }
    if (cell.type === 'tax') {
      this.cash[playerId] -= cell.amount;
      this.state.lastAction = `${this.playerName(playerId)} paid ₦${cell.amount.toLocaleString()} tax.`;
      this.checkBankruptcy(playerId);
    } else if (cell.type === 'property') {
      const owner = this.findOwner(cell);
      if (!owner) {
        this.state.cellProps = { price: cell.price, owned: false };
        this.state.lastAction = `${cell.name}: Buy for ₦${cell.price.toLocaleString()} or pass.`;
        // Stay on player, let them buy/pass
        this.updatePlayerCash();
        return true;
      } else if (owner !== playerId) {
        const rent = this.quickMode ? Math.round(cell.rent / 2) : cell.rent;
        this.cash[playerId] -= rent;
        this.cash[owner] += rent;
        this.state.lastAction = `${this.playerName(playerId)} paid ₦${rent.toLocaleString()} rent to ${this.playerName(owner)}.`;
        this.checkBankruptcy(playerId);
      }
    } else if (cell.type === 'penalty') {
      this.cash[playerId] -= cell.amount;
      this.state.lastAction = `${this.playerName(playerId)} paid ₦${cell.amount.toLocaleString()} penalty.`;
      this.checkBankruptcy(playerId);
    } else if (cell.type === 'rail') {
      const owner = this.findOwner(cell);
      if (!owner) {
        this.state.cellProps = { price: cell.price, owned: false };
        this.updatePlayerCash();
        return true;
      } else if (owner !== playerId) {
        this.cash[playerId] -= cell.rent; this.cash[owner] += cell.rent;
        this.state.lastAction = `${this.playerName(playerId)} paid ₦${cell.rent.toLocaleString()} to ${this.playerName(owner)}.`;
        this.checkBankruptcy(playerId);
      }
    }

    if (isDouble) {
      this.state.rollsRemaining = 2; this.state.rollAgain = true;
      this.state.lastAction += ' Double! Roll again.';
    } else {
      this.advanceTurn();
    }
    this.updatePlayerCash();
    return true;
  }

  doBuy(playerId) {
    const pos = this.positions[playerId];
    const cell = this.board[pos];
    if (!cell || (cell.type !== 'property' && cell.type !== 'rail')) return false;
    if (this.findOwner(cell)) return false;
    if (this.cash[playerId] < cell.price) return false;

    this.cash[playerId] -= cell.price;
    this.properties[playerId] = [...(this.properties[playerId] ?? []), pos];
    this.state.properties = clone(this.properties);
    this.state.lastAction = `${this.playerName(playerId)} bought ${cell.name}!`;
    this.state.cellProps = null;
    this.advanceTurn();
    this.updatePlayerCash();
    return true;
  }

  handleWahala(playerId) {
    const card = this.wahalaDeck[this.wahalaIndex % this.wahalaDeck.length];
    this.wahalaIndex += 1;
    this.state.wahalaCard = card;

    if (card.effect === 'collect') {
      this.cash[playerId] += card.amount;
      this.state.lastAction = `Wahala: ${card.text}`;
    } else if (card.effect === 'pay') {
      this.cash[playerId] -= card.amount;
      this.state.lastAction = `Wahala: ${card.text}`;
      this.checkBankruptcy(playerId);
    } else if (card.effect === 'goto') {
      this.positions[playerId] = card.cell;
      this.state.positions = clone(this.positions);
      if (card.amount) this.cash[playerId] += card.amount;
      this.state.lastAction = `Wahala: ${card.text}`;
    }
    this.advanceTurn();
    this.updatePlayerCash();
    return true;
  }

  findOwner(cell) {
    for (const [pid, props] of Object.entries(this.properties)) {
      if (props.some((p) => p === this.state.positions[pid] || this.board[p] === cell)) return pid;
    }
    return null;
  }

  checkBankruptcy(playerId) {
    if (this.cash[playerId] <= 0) {
      this.state.phase = 'finished';
      const alive = this.players.filter((p) => this.cash[p.id] > 0);
      this.state.winnerPlayerIds = topPlayers(alive.map((p) => ({ ...p, score: this.cash[p.id] })));
      this.state.lastAction = `${this.playerName(playerId)} is bankrupt! Game over.`;
    }
  }

  advanceTurn() {
    const current = this.players.findIndex((c) => c.id === this.state.currentPlayerId);
    if (current < 0) return;
    const next = (current + 1) % this.players.length;
    this.state.currentPlayerId = this.players[next].id;
    this.state.rollsRemaining = 1; this.state.rollAgain = false;
    this.state.diceValue = null; this.state.cellAction = null; this.state.cellProps = null;
  }

  updatePlayerCash() {
    this.state.players = this.state.players.map((p) => ({ ...p, cash: this.cash[p.id] ?? 0 }));
  }

  playerName(id) { return this.state?.players?.find((p) => p.id === id)?.name ?? 'A player'; }
  publicState() { return clone(this.state); }
  privateState(id) {
    return {
      seated: this.seated(id), isTurn: this.state?.currentPlayerId === id,
      cash: this.cash?.[id], position: this.positions?.[id],
      properties: clone(this.properties?.[id] ?? []),
      legalIntents: this.legalIntents(id),
    };
  }
  legalIntents(id) {
    if (!this.state || this.state.phase !== 'playing' || this.state.currentPlayerId !== id || !this.seated(id)) return [];
    if (this.state.cellProps && !this.state.cellProps.owned) {
      return [
        { type: 'buy', label: `Buy for ₦${this.state.cellProps.price.toLocaleString()}` },
        { type: 'pass', label: 'Pass' },
      ];
    }
    return [{ type: 'roll', label: `Roll dice${this.state.rollAgain ? ' (double!)' : ''}` }];
  }
  rankBotIntent(id) {
    const intents = this.legalIntents(id);
    if (intents.length === 0) return null;
    return intents[0];
  }
  extraSnapshot() {
    return { cash: this.cash, positions: this.positions, properties: this.properties, wahalaDeck: this.wahalaDeck, wahalaIndex: this.wahalaIndex };
  }
  restoreExtra(extra) {
    this.cash = extra?.cash ?? {}; this.positions = extra?.positions ?? {};
    this.properties = extra?.properties ?? {}; this.wahalaDeck = extra?.wahalaDeck ?? clone(WAHALA_CARDS);
    this.wahalaIndex = extra?.wahalaIndex ?? 0;
  }
}
