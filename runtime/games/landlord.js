// Oga Landlord — Monopoly-inspired Nigerian property game.
// Board with properties, buy/pass, rent, property sets, houses, mortgages, jail, wahala cards.
//
// Feature target follows christelbuchanan/Monopoly-Game (used with the project owner's stated
// permission; that repo ships no LICENSE file, so its rule/feature set is treated as a
// reference target only — no source code is vendored here). Rules are reimplemented as
// deterministic, server-authoritative logic in BoredRoom's GameRuntime contract.

import { RuntimeBase, makeRng, shuffleInPlace, clone, topPlayers } from '../helpers.js';

const PASS_GO = 20000; // collected each time a token passes Start

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
  { name: 'Police Holding', type: 'jail' },
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
  { text: 'Police checkpoint wahala — go to holding!', effect: 'jail' },
];

const JAIL_POS = 10; // Police Holding
const JAIL_BAIL = 5000;
const MAX_HOUSES = 4;
const MIN_AUCTION_BID = 500;
const AUCTION_INCREMENT = 500;

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
    this.houses = {}; // cellIndex -> house count
    this.mortgaged = {}; // cellIndex -> true
    this.jail = {}; // playerId -> jail turns served (0 = not jailed)
    this.doublesStreak = {}; // playerId -> consecutive doubles this turn-chain
    this.auction = null;
    this.pendingTrade = null;
    this.tradeSequence = 0;

    for (const player of this.players) {
      this.cash[player.id] = this.startingCash;
      this.positions[player.id] = 0;
      this.properties[player.id] = [];
      this.jail[player.id] = 0;
    }

    this.state = this.buildState('Roll to move and buy properties.');
  }

  buildState(lastAction) {
    return {
      gameType: this.gameType, name: this.manifest.name, emoji: this.manifest.emoji,
      mode: 'landlord', phase: this.state?.phase ?? 'playing', board: clone(this.board),
      players: clone(this.players.map((p) => ({ ...p, cash: this.cash[p.id] }))),
      currentPlayerId: this.state?.currentPlayerId ?? this.players[0]?.id,
      positions: clone(this.positions),
      properties: clone(this.properties),
      houses: clone(this.houses),
      mortgaged: Object.keys(this.mortgaged),
      jail: clone(this.jail),
      wahalaCard: this.state?.wahalaCard ?? null,
      rollsRemaining: this.state?.rollsRemaining ?? 1,
      rollAgain: this.state?.rollAgain ?? false,
      diceValue: this.state?.diceValue ?? null,
      cellProps: this.state?.cellProps ?? null,
      auction: clone(this.auction),
      pendingTrade: clone(this.pendingTrade),
      winnerPlayerIds: this.state?.winnerPlayerIds ?? [],
      lastAction: lastAction ?? this.state?.lastAction ?? '',
    };
  }

  handleIntent(playerId, intent, isHost) {
    if (!this.state || this.state.phase !== 'playing' || !this.seated(playerId)) return false;

    if (this.auction) return this.handleAuctionIntent(playerId, intent);
    if (this.pendingTrade) return this.handleTradeDecision(playerId, intent);

    if (intent?.type === 'propose_trade') {
      if (this.state.currentPlayerId !== playerId) return false;
      return this.proposeTrade(playerId, intent);
    }

    if (this.state.currentPlayerId !== playerId) return false;
    const blockedByPurchase = this.state.cellProps && !this.state.cellProps.owned;

    switch (intent?.type) {
      case 'roll':
        if (blockedByPurchase) return false;
        return this.jail[playerId] > 0 ? this.doJailRoll(playerId) : this.doRoll(playerId);
      case 'buy':
        return this.doBuy(playerId);
      case 'pass':
        if (blockedByPurchase) return this.startAuction(playerId);
        this.advanceTurn();
        this.state.lastAction = `${this.playerName(playerId)} passed.`;
        return true;
      case 'pay_bail':
        return this.payBail(playerId);
      case 'buy_house':
        return blockedByPurchase ? false : this.buyHouse(playerId, Number(intent?.position));
      case 'mortgage':
        return blockedByPurchase ? false : this.mortgageProperty(playerId, Number(intent?.position));
      case 'unmortgage':
        return blockedByPurchase ? false : this.unmortgageProperty(playerId, Number(intent?.position));
      default:
        return false;
    }
  }

  doRoll(playerId) {
    const d1 = 1 + Math.floor(this.rng() * 6);
    const d2 = 1 + Math.floor(this.rng() * 6);
    const total = d1 + d2;
    const isDouble = d1 === d2;

    // Three doubles in a row sends you straight to Police Holding (no move).
    if (isDouble) {
      this.doublesStreak[playerId] = (this.doublesStreak[playerId] ?? 0) + 1;
      if (this.doublesStreak[playerId] >= 3) {
        this.doublesStreak[playerId] = 0;
        this.positions[playerId] = JAIL_POS;
        this.jail[playerId] = 1;
        this.state.positions = clone(this.positions);
        this.state.diceValue = total;
        this.state.lastAction = `${this.playerName(playerId)} rolled three doubles — off to holding!`;
        this.advanceTurn();
        this.updatePlayerCash();
        return true;
      }
    } else {
      this.doublesStreak[playerId] = 0;
    }

    this.state.diceValue = total;
    const from = this.positions[playerId] ?? 0;
    let pos = (from + total) % this.board.length;
    if (pos < 0) pos += this.board.length;
    if (from + total >= this.board.length) this.cash[playerId] += PASS_GO; // passed Start
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
    } else if (cell.type === 'property' || cell.type === 'rail') {
      const owner = this.findOwnerOfPosition(pos);
      if (!owner) {
        this.state.cellProps = { price: cell.price, owned: false };
        this.state.lastAction = `${cell.name}: Buy for ₦${cell.price.toLocaleString()} or pass.`;
        this.updatePlayerCash();
        return true;
      }
      if (owner !== playerId) {
        const rent = this.rentFor(pos);
        this.cash[playerId] -= rent;
        this.cash[owner] += rent;
        this.state.lastAction = rent === 0
          ? `${cell.name} is mortgaged — no rent.`
          : `${this.playerName(playerId)} paid ₦${rent.toLocaleString()} rent to ${this.playerName(owner)}.`;
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
    if (this.findOwnerOfPosition(pos)) return false;
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

  // --- Auctions ------------------------------------------------------------------------------
  // Passing on an unowned property starts a public auction. The normal turn is suspended until
  // every bidder except the highest bidder has passed, then ownership and cash move atomically.
  startAuction(playerId) {
    const position = this.positions[playerId];
    const cell = this.board[position];
    if (!cell || (cell.type !== 'property' && cell.type !== 'rail')) return false;
    if (this.findOwnerOfPosition(position)) return false;
    const eligiblePlayerIds = this.players.filter((player) => (this.cash[player.id] ?? 0) >= MIN_AUCTION_BID).map((player) => player.id);
    this.auction = {
      propertyPosition: position,
      propertyName: cell.name,
      currentBid: 0,
      highestBidderId: null,
      eligiblePlayerIds,
      passedPlayerIds: [],
      minimumNextBid: MIN_AUCTION_BID,
      startedByPlayerId: playerId,
    };
    this.state.cellProps = null;
    this.state.auction = clone(this.auction);
    this.state.lastAction = `${this.playerName(playerId)} passed. Auction open for ${cell.name}!`;
    if (eligiblePlayerIds.length === 0) this.resolveAuctionIfReady();
    return true;
  }

  handleAuctionIntent(playerId, intent) {
    const auction = this.auction;
    if (!auction || !auction.eligiblePlayerIds.includes(playerId) || auction.passedPlayerIds.includes(playerId)) return false;

    if (intent?.type === 'auction_pass') {
      if (auction.highestBidderId === playerId) return false;
      auction.passedPlayerIds.push(playerId);
      this.state.lastAction = `${this.playerName(playerId)} left the auction.`;
      this.resolveAuctionIfReady();
      return true;
    }

    if (intent?.type !== 'auction_bid') return false;
    const amount = Number(intent.amount);
    const minimum = Math.max(MIN_AUCTION_BID, auction.currentBid + AUCTION_INCREMENT);
    if (!Number.isSafeInteger(amount) || amount < minimum || amount > (this.cash[playerId] ?? 0)) return false;
    auction.currentBid = amount;
    auction.highestBidderId = playerId;
    auction.minimumNextBid = amount + AUCTION_INCREMENT;
    this.state.lastAction = `${this.playerName(playerId)} bid ₦${amount.toLocaleString()} for ${auction.propertyName}.`;
    this.resolveAuctionIfReady();
    return true;
  }

  resolveAuctionIfReady() {
    const auction = this.auction;
    if (!auction) return;
    const active = auction.eligiblePlayerIds.filter((id) => !auction.passedPlayerIds.includes(id));
    if (!auction.highestBidderId) {
      if (active.length > 0) {
        this.state.auction = clone(auction);
        return;
      }
      this.state.lastAction = `${auction.propertyName} received no bids and stays with the bank.`;
    } else {
      const challengers = active.filter((id) => id !== auction.highestBidderId);
      if (challengers.length > 0) {
        this.state.auction = clone(auction);
        return;
      }
      const winner = auction.highestBidderId;
      if ((this.cash[winner] ?? 0) < auction.currentBid) {
        // A stale bid cannot create money or ownership. Remove it and keep the auction open.
        auction.passedPlayerIds.push(winner);
        auction.highestBidderId = null;
        auction.currentBid = 0;
        auction.minimumNextBid = MIN_AUCTION_BID;
        this.state.auction = clone(auction);
        return;
      }
      this.cash[winner] -= auction.currentBid;
      this.properties[winner] = [...(this.properties[winner] ?? []), auction.propertyPosition];
      this.state.lastAction = `${this.playerName(winner)} won ${auction.propertyName} for ₦${auction.currentBid.toLocaleString()}!`;
    }
    this.auction = null;
    this.state.auction = null;
    this.state.properties = clone(this.properties);
    this.advanceTurn();
    this.updatePlayerCash();
  }

  // --- Bilateral trades ----------------------------------------------------------------------
  // A proposal freezes normal turn actions until the recipient accepts/rejects or the proposer
  // cancels. Acceptance revalidates all assets so stale/replayed proposals cannot transfer money.
  proposeTrade(playerId, intent) {
    const targetPlayerId = String(intent.targetPlayerId ?? '');
    const offeredProperties = this.validPositionList(intent.offeredProperties);
    const requestedProperties = this.validPositionList(intent.requestedProperties);
    const offeredCash = Number(intent.offeredCash ?? 0);
    const requestedCash = Number(intent.requestedCash ?? 0);
    if (!targetPlayerId || targetPlayerId === playerId || !this.seated(targetPlayerId)) return false;
    if (!Number.isSafeInteger(offeredCash) || offeredCash < 0 || !Number.isSafeInteger(requestedCash) || requestedCash < 0) return false;
    if (offeredProperties.length === 0 && requestedProperties.length === 0 && offeredCash === 0 && requestedCash === 0) return false;
    if (!this.tradeAssetsValid(playerId, targetPlayerId, offeredProperties, requestedProperties, offeredCash, requestedCash)) return false;

    this.tradeSequence += 1;
    this.pendingTrade = {
      id: `trade-${this.tradeSequence}`,
      proposerId: playerId,
      targetPlayerId,
      offeredProperties,
      requestedProperties,
      offeredCash,
      requestedCash,
    };
    this.state.pendingTrade = clone(this.pendingTrade);
    this.state.lastAction = `${this.playerName(playerId)} offered ${this.playerName(targetPlayerId)} a trade.`;
    return true;
  }

  handleTradeDecision(playerId, intent) {
    const trade = this.pendingTrade;
    if (!trade) return false;
    if (intent?.type === 'cancel_trade' && playerId === trade.proposerId) {
      this.clearTrade(`${this.playerName(playerId)} cancelled the trade.`);
      return true;
    }
    if (playerId !== trade.targetPlayerId || !['accept_trade', 'reject_trade'].includes(intent?.type)) return false;
    if (intent.type === 'reject_trade') {
      this.clearTrade(`${this.playerName(playerId)} rejected the trade.`);
      return true;
    }
    if (!this.tradeAssetsValid(
      trade.proposerId,
      trade.targetPlayerId,
      trade.offeredProperties,
      trade.requestedProperties,
      trade.offeredCash,
      trade.requestedCash,
    )) {
      this.clearTrade('The trade expired because the assets changed.');
      return false;
    }

    this.properties[trade.proposerId] = this.swapPropertyOwnership(
      this.properties[trade.proposerId], trade.offeredProperties, trade.requestedProperties,
    );
    this.properties[trade.targetPlayerId] = this.swapPropertyOwnership(
      this.properties[trade.targetPlayerId], trade.requestedProperties, trade.offeredProperties,
    );
    this.cash[trade.proposerId] += trade.requestedCash - trade.offeredCash;
    this.cash[trade.targetPlayerId] += trade.offeredCash - trade.requestedCash;
    const message = `${this.playerName(trade.proposerId)} and ${this.playerName(trade.targetPlayerId)} completed a trade.`;
    this.pendingTrade = null;
    this.state.pendingTrade = null;
    this.state.properties = clone(this.properties);
    this.state.lastAction = message;
    this.updatePlayerCash();
    return true;
  }

  validPositionList(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(Number).filter((position) => Number.isSafeInteger(position) && position >= 0 && position < this.board.length))];
  }

  tradeAssetsValid(proposerId, targetId, offeredProperties, requestedProperties, offeredCash, requestedCash) {
    if ((this.cash[proposerId] ?? 0) < offeredCash || (this.cash[targetId] ?? 0) < requestedCash) return false;
    if (!offeredProperties.every((position) => this.findOwnerOfPosition(position) === proposerId)) return false;
    if (!requestedProperties.every((position) => this.findOwnerOfPosition(position) === targetId)) return false;
    // Improved properties cannot be traded until their houses have been sold/removed.
    if ([...offeredProperties, ...requestedProperties].some((position) => (this.houses[position] ?? 0) > 0)) return false;
    return true;
  }

  swapPropertyOwnership(current, outgoing, incoming) {
    const outgoingSet = new Set(outgoing);
    return [...current.filter((position) => !outgoingSet.has(position)), ...incoming];
  }

  clearTrade(message) {
    this.pendingTrade = null;
    this.state.pendingTrade = null;
    this.state.lastAction = message;
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
    } else if (card.effect === 'jail') {
      this.positions[playerId] = JAIL_POS;
      this.jail[playerId] = 1;
      this.state.positions = clone(this.positions);
      this.state.lastAction = `Wahala: ${card.text}`;
      this.advanceTurn();
      this.updatePlayerCash();
      return true;
    }
    this.advanceTurn();
    this.updatePlayerCash();
    return true;
  }

  // --- Rent with monopoly sets and houses; mortgaged properties collect nothing ---------------
  rentFor(pos) {
    const cell = this.board[pos];
    const owner = this.findOwnerOfPosition(pos);
    if (!owner || this.mortgaged[pos]) return 0;
    let rent = cell.rent;
    if (cell.set && this.ownsFullSet(owner, cell.set)) rent *= 2; // monopoly bonus
    rent *= 1 + (this.houses[pos] ?? 0); // each house adds one base rent
    if (this.quickMode) rent = Math.round(rent / 2);
    return rent;
  }

  ownsFullSet(ownerId, set) {
    const setCells = this.board.map((c, i) => (c.set === set ? i : -1)).filter((i) => i >= 0);
    return setCells.length > 0 && setCells.every((i) => (this.properties[ownerId] ?? []).includes(i));
  }

  // --- Jail: pay bail or roll a double to get out; auto-released after 3 turns -----------------
  doJailRoll(playerId) {
    const d1 = 1 + Math.floor(this.rng() * 6);
    const d2 = 1 + Math.floor(this.rng() * 6);
    this.state.diceValue = d1 + d2;
    if (d1 === d2) {
      this.jail[playerId] = 0;
      this.state.lastAction = `${this.playerName(playerId)} rolled a double and walks free!`;
      return this.moveBy(playerId, d1 + d2, false);
    }
    this.jail[playerId] += 1;
    if (this.jail[playerId] >= 3) {
      this.cash[playerId] -= JAIL_BAIL;
      this.jail[playerId] = 0;
      this.state.lastAction = `${this.playerName(playerId)} served time and paid ₦${JAIL_BAIL.toLocaleString()} bail.`;
      this.checkBankruptcy(playerId);
    } else {
      this.state.lastAction = `${this.playerName(playerId)} stays in holding (${this.jail[playerId]}/3).`;
    }
    this.advanceTurn();
    this.updatePlayerCash();
    return true;
  }

  payBail(playerId) {
    if (this.jail[playerId] <= 0 || this.cash[playerId] < JAIL_BAIL) return false;
    this.cash[playerId] -= JAIL_BAIL;
    this.jail[playerId] = 0;
    this.state.lastAction = `${this.playerName(playerId)} paid ₦${JAIL_BAIL.toLocaleString()} bail.`;
    this.updatePlayerCash();
    return true;
  }

  // Shared move resolution used after leaving jail on a double.
  moveBy(playerId, total, isDouble) {
    const from = this.positions[playerId] ?? 0;
    let pos = (from + total) % this.board.length;
    if (pos < 0) pos += this.board.length;
    if (from + total >= this.board.length) this.cash[playerId] += PASS_GO;
    this.positions[playerId] = pos;
    this.state.positions = clone(this.positions);
    const cell = this.board[pos];
    if (cell.type === 'property' || cell.type === 'rail') {
      const owner = this.findOwnerOfPosition(pos);
      if (!owner) {
        this.state.cellProps = { price: cell.price, owned: false };
        this.updatePlayerCash();
        return true;
      }
      if (owner !== playerId) {
        const rent = this.rentFor(pos);
        this.cash[playerId] -= rent; this.cash[owner] += rent;
        this.checkBankruptcy(playerId);
      }
    }
    if (!isDouble) this.advanceTurn();
    this.updatePlayerCash();
    return true;
  }

  // --- Building, mortgaging -------------------------------------------------------------------
  buyHouse(playerId, pos) {
    const cell = this.board[pos];
    if (!cell || cell.type !== 'property') return false;
    if (this.findOwnerOfPosition(pos) !== playerId) return false;
    if (!this.ownsFullSet(playerId, cell.set)) return false; // houses need the full colour set
    if (this.mortgaged[pos]) return false;
    if ((this.houses[pos] ?? 0) >= MAX_HOUSES) return false;
    const cost = Math.round(cell.price / 2);
    if (this.cash[playerId] < cost) return false;
    this.cash[playerId] -= cost;
    this.houses[pos] = (this.houses[pos] ?? 0) + 1;
    this.state = this.buildState(`${this.playerName(playerId)} built on ${cell.name} (house ${this.houses[pos]}).`);
    return true;
  }

  mortgageProperty(playerId, pos) {
    const cell = this.board[pos];
    if (!cell || this.findOwnerOfPosition(pos) !== playerId) return false;
    if (this.mortgaged[pos] || (this.houses[pos] ?? 0) > 0) return false; // sell houses first
    this.cash[playerId] += Math.round(cell.price / 2);
    this.mortgaged[pos] = true;
    this.state = this.buildState(`${this.playerName(playerId)} mortgaged ${cell.name}.`);
    return true;
  }

  unmortgageProperty(playerId, pos) {
    const cell = this.board[pos];
    if (!cell || this.findOwnerOfPosition(pos) !== playerId || !this.mortgaged[pos]) return false;
    const cost = Math.round(cell.price * 0.55);
    if (this.cash[playerId] < cost) return false;
    this.cash[playerId] -= cost;
    delete this.mortgaged[pos];
    this.state = this.buildState(`${this.playerName(playerId)} cleared the mortgage on ${cell.name}.`);
    return true;
  }

  // Owner of the property at a board index, or null. (Properties are tracked by cell index.)
  findOwnerOfPosition(pos) {
    for (const [pid, props] of Object.entries(this.properties)) {
      if (props.includes(pos)) return pid;
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
    this.state.houses = clone(this.houses);
    this.state.mortgaged = Object.keys(this.mortgaged);
    this.state.jail = clone(this.jail);
  }

  playerName(id) { return this.state?.players?.find((p) => p.id === id)?.name ?? 'A player'; }
  publicState() { return clone(this.state); }
  privateState(id) {
    return {
      seated: this.seated(id), isTurn: this.state?.currentPlayerId === id,
      cash: this.cash?.[id], position: this.positions?.[id],
      properties: clone(this.properties?.[id] ?? []),
      auction: clone(this.auction),
      pendingTrade: clone(this.pendingTrade),
      legalIntents: this.legalIntents(id),
    };
  }
  legalIntents(id) {
    if (!this.state || this.state.phase !== 'playing' || !this.seated(id)) return [];
    if (this.auction) {
      if (!this.auction.eligiblePlayerIds.includes(id) || this.auction.passedPlayerIds.includes(id)) return [];
      const intents = [];
      const minimum = Math.max(MIN_AUCTION_BID, this.auction.currentBid + AUCTION_INCREMENT);
      if ((this.cash[id] ?? 0) >= minimum) intents.push({ type: 'auction_bid', amount: minimum, minimum, label: `Bid ₦${minimum.toLocaleString()}` });
      if (this.auction.highestBidderId !== id) intents.push({ type: 'auction_pass', label: 'Leave auction' });
      return intents;
    }
    if (this.pendingTrade) {
      if (this.pendingTrade.targetPlayerId === id) return [
        { type: 'accept_trade', label: 'Accept trade' },
        { type: 'reject_trade', label: 'Reject trade' },
      ];
      if (this.pendingTrade.proposerId === id) return [{ type: 'cancel_trade', label: 'Cancel trade' }];
      return [];
    }
    if (this.state.currentPlayerId !== id) return [];
    if (this.state.cellProps && !this.state.cellProps.owned) {
      return [
        { type: 'buy', label: `Buy for ₦${this.state.cellProps.price.toLocaleString()}` },
        { type: 'pass', label: 'Pass' },
      ];
    }
    if (this.jail[id] > 0) {
      const out = [{ type: 'roll', label: 'Roll for a double' }];
      if (this.cash[id] >= JAIL_BAIL) out.unshift({ type: 'pay_bail', label: `Pay ₦${JAIL_BAIL.toLocaleString()} bail` });
      return out;
    }
    const intents = [{ type: 'roll', label: `Roll dice${this.state.rollAgain ? ' (double!)' : ''}` }];
    if (this.players.length > 1 && ((this.properties[id]?.length ?? 0) > 0 || (this.cash[id] ?? 0) > 0)) {
      intents.push({
        type: 'propose_trade', label: 'Propose a trade',
        targets: this.players.filter((player) => player.id !== id).map((player) => player.id),
      });
    }
    // Management actions on your own properties.
    for (const pos of this.properties[id] ?? []) {
      const cell = this.board[pos];
      if (this.mortgaged[pos]) {
        if (this.cash[id] >= Math.round(cell.price * 0.55)) intents.push({ type: 'unmortgage', position: pos, label: `Clear mortgage on ${cell.name}` });
      } else {
        if (cell.type === 'property' && this.ownsFullSet(id, cell.set) && (this.houses[pos] ?? 0) < MAX_HOUSES && this.cash[id] >= Math.round(cell.price / 2)) {
          intents.push({ type: 'buy_house', position: pos, label: `Build on ${cell.name}` });
        }
        if ((this.houses[pos] ?? 0) === 0) intents.push({ type: 'mortgage', position: pos, label: `Mortgage ${cell.name}` });
      }
    }
    return intents;
  }
  rankBotIntent(id) {
    const intents = this.legalIntents(id);
    if (intents.length === 0) return null;
    // Prefer building, then rolling; never voluntarily mortgage.
    return intents.find((i) => i.type === 'buy_house') ?? intents.find((i) => i.type === 'roll') ?? intents[0];
  }
  extraSnapshot() {
    return {
      cash: this.cash, positions: this.positions, properties: this.properties,
      houses: this.houses, mortgaged: this.mortgaged, jail: this.jail, doublesStreak: this.doublesStreak,
      wahalaDeck: this.wahalaDeck, wahalaIndex: this.wahalaIndex,
      auction: this.auction, pendingTrade: this.pendingTrade, tradeSequence: this.tradeSequence,
    };
  }
  restoreExtra(extra) {
    this.cash = extra?.cash ?? {}; this.positions = extra?.positions ?? {};
    this.properties = extra?.properties ?? {};
    this.houses = extra?.houses ?? {}; this.mortgaged = extra?.mortgaged ?? {}; this.jail = extra?.jail ?? {}; this.doublesStreak = extra?.doublesStreak ?? {};
    this.wahalaDeck = extra?.wahalaDeck ?? clone(WAHALA_CARDS); this.wahalaIndex = extra?.wahalaIndex ?? 0;
    this.auction = extra?.auction ?? null; this.pendingTrade = extra?.pendingTrade ?? null; this.tradeSequence = extra?.tradeSequence ?? 0;
  }
}
