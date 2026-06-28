// Whot — Nigerian card game runtime.
//
// Full 54-card Whot deck with all special cards:
//   1  Hold On       — player plays again
//   2  Pick Two      — next player draws 2 (defendable by another 2)
//   5  Pick Three    — next player draws 3 (defendable by another 5)
//   8  Suspension    — next player is skipped
//   11 Reverse       — reverses turn direction (optional, disabled by default)
//   14 General Market — every other player draws 1
//   20 Whot          — player names the shape to continue
//
// Settings:
//   specialCards (bool, default true) — enable/disable special card effects
//   enableDirection (bool, default false) — card 11 acts as Reverse
//   pickDefence ('stack_same'|'stack_any'|'no_stack') — house rule for pick cards
//   allowSpecialFinish (bool, default true) — whether an action/Whot card may end a round
//   timeoutPenalty ('draw_one'|'draw_and_pass'|'pass') — server-enforced turn timeout
//   A match is always best-of-five: first to three round wins, or the leader
//   after round five. Pip totals are retained as a tie-break and recap signal.
//   seed (number, optional) — deterministic shuffle seed

import { RuntimeBase, makeRng, shuffleInPlace, clone } from '../helpers.js';

export const WHOT_SHAPES = ['Circle', 'Triangle', 'Cross', 'Square', 'Star'];
const SPECIAL_NUMBERS = new Set([1, 2, 5, 8, 11, 14, 20]);

const WHOT_SHAPE_NUMBERS = {
  Circle: [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14],
  Triangle: [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14],
  Cross: [1, 2, 3, 5, 7, 10, 11, 13, 14],
  Square: [1, 2, 3, 5, 7, 10, 11, 13, 14],
  Star: [1, 2, 3, 4, 5, 7, 8],
};

export function createWhotDeck() {
  const cards = [];
  for (const shape of WHOT_SHAPES) {
    for (const number of WHOT_SHAPE_NUMBERS[shape]) {
      cards.push({ shape, number, isWhot: false });
    }
  }
  for (let i = 0; i < 5; i += 1) cards.push({ shape: 'Whot', number: 20, isWhot: true });
  return cards.map((card, index) => ({
    id: `c${index + 1}`,
    shape: card.shape,
    number: card.number,
    label: card.isWhot ? 'Whot 20' : `${card.shape} ${card.number}`,
    isWhot: card.isWhot,
  }));
}

export const WHOT_DECK = createWhotDeck();

export class WhotRuntime extends RuntimeBase {
  start() {
    const seed = Number(this.context?.settings?.seed) || (Date.now() & 0xffffffff);
    this.specialsOn = this.context?.settings?.specialCards !== false;
    this.directionEnabled = this.context?.settings?.enableDirection === true;
    this.pickDefence = ['stack_same', 'stack_any', 'no_stack'].includes(this.context?.settings?.pickDefence)
      ? this.context.settings.pickDefence
      : 'stack_same';
    this.allowSpecialFinish = this.context?.settings?.allowSpecialFinish !== false;
    this.timeoutPenalty = ['draw_one', 'draw_and_pass', 'pass'].includes(this.context?.settings?.timeoutPenalty)
      ? this.context.settings.timeoutPenalty
      : 'draw_and_pass';
    this.maxRounds = 5;
    this.roundsToWin = 3;
    this.direction = 1;

    const rng = makeRng(seed);
    const deck = shuffleInPlace(clone(WHOT_DECK), rng);
    const hands = {};
    const handSize = this.players.length <= 2 ? 5 : 4;
    for (const player of this.players) hands[player.id] = deck.splice(0, handSize);

    let topIndex = deck.findIndex((card) => !card.isWhot);
    if (topIndex < 0) topIndex = 0;
    const topCard = deck.splice(topIndex, 1)[0];

    this.state = {
      gameType: this.gameType,
      name: this.manifest.name,
      emoji: this.manifest.emoji,
      mode: 'whot',
      phase: 'playing',
      players: clone(this.players.map((p) => ({
        ...p,
        score: 0,
        roundWins: 0,
        pipScore: 0,
        handCount: hands[p.id]?.length ?? 0,
      }))),
      topCard,
      requestedShape: null,
      drawPileCount: deck.length,
      currentPlayerId: this.players[0]?.id,
      pendingPick: 0,
      pendingPickRank: null,
      round: 1,
      totalRounds: this.maxRounds,
      roundsToWin: this.roundsToWin,
      settings: {
        specialCards: this.specialsOn,
        enableDirection: this.directionEnabled,
        pickDefence: this.pickDefence,
        allowSpecialFinish: this.allowSpecialFinish,
        timeoutPenalty: this.timeoutPenalty,
        turnSeconds: Math.max(0, Math.trunc(Number(this.context?.settings?.turnSeconds ?? 45))),
      },
      roundWins: Object.fromEntries(this.players.map((player) => [player.id, 0])),
      callout: null,
      calloutSequence: 0,
      roundScores: [],
      winnerPlayerIds: [],
      lastAction: `Top card is ${topCard.label}.`,
    };
    this.hands = hands;
    this.deck = deck;
    this.discard = [];
    this.seed = seed;
  }

  handleIntent(playerId, intent, isHost) {
    if (!this.state || this.state.phase === 'finished') return false;
    if (intent?.type === 'advance' && isHost) {
      if (this.state.phase === 'round_end') {
        this.advanceRound();
        return true;
      }
      return false;
    }
    if (this.state.phase !== 'playing' || this.state.currentPlayerId !== playerId) return false;
    if (intent?.type === 'timeout' && isHost) return this.handleTimeout(playerId);
    if (intent?.type === 'draw') return this.handleDraw(playerId);
    if (intent?.type !== 'play_card') return false;

    const cardId = String(intent?.cardId ?? '');
    const hand = this.hands[playerId] ?? [];
    const card = hand.find((c) => c.id === cardId);
    if (!card || !this.isLegalCard(card)) return false;
    if (!this.allowSpecialFinish && hand.length === 1 && SPECIAL_NUMBERS.has(card.number)) return false;
    const calledShape = card.isWhot ? String(intent?.calledShape ?? intent?.shape ?? '') : null;
    if (card.isWhot && !WHOT_SHAPES.includes(calledShape)) return false;

    this.hands[playerId] = hand.filter((c) => c.id !== cardId);
    this.discard.push(this.state.topCard);
    this.state.topCard = card;
    this.state.requestedShape = null;

    let requestedShape = null;
    if (card.isWhot) {
      this.state.requestedShape = calledShape;
      requestedShape = calledShape;
    }

    const player = this.players.find((c) => c.id === playerId);
    const remainingCards = this.hands[playerId].length;
    if (this.hands[playerId].length === 0) {
      this.announceCardCount(playerId, remainingCards);
      this.endRound(player);
      return true;
    }
    this.applySpecial(card, player, requestedShape);
    this.announceCardCount(playerId, remainingCards);
    this.updateHandCounts();
    return true;
  }

  handleTimeout(playerId) {
    if (this.state.currentPlayerId !== playerId || this.state.phase !== 'playing') return false;
    const name = this.playerName(playerId);
    if (this.state.pendingPick > 0) {
      const count = this.state.pendingPick;
      for (let i = 0; i < count; i += 1) {
        const card = this.drawCard();
        if (card) this.hands[playerId].push(card);
      }
      this.state.pendingPick = 0;
      this.state.pendingPickRank = null;
      this.advanceTurn();
      this.state.lastAction = `${name} ran out of time, picked ${count}, and lost the turn.`;
    } else if (this.timeoutPenalty === 'pass') {
      this.advanceTurn();
      this.state.lastAction = `${name} ran out of time and lost the turn.`;
    } else {
      const card = this.drawCard();
      if (card) this.hands[playerId].push(card);
      if (this.timeoutPenalty === 'draw_and_pass') this.advanceTurn();
      this.state.lastAction = this.timeoutPenalty === 'draw_one'
        ? `${name} ran out of time and picked one. Their turn continues.`
        : `${name} ran out of time, picked one, and lost the turn.`;
    }
    this.state.drawPileCount = this.deck.length;
    this.updateHandCounts();
    return true;
  }

  handleDraw(playerId) {
    const count = this.state.pendingPick > 0 ? this.state.pendingPick : 1;
    for (let i = 0; i < count; i += 1) {
      const card = this.drawCard();
      if (card) this.hands[playerId].push(card);
    }
    const served = this.state.pendingPick > 0;
    this.state.pendingPick = 0;
    this.state.pendingPickRank = null;
    this.state.drawPileCount = this.deck.length;
    this.updateHandCounts();
    this.advanceTurn();
    this.state.lastAction = served
      ? `${this.playerName(playerId)} picked ${count}.`
      : `${this.playerName(playerId)} went to market.`;
    return true;
  }

  applySpecial(card, player, requestedShape = null) {
    const played = requestedShape
      ? `${player.name} played Whot 20 and requested ${requestedShape}.`
      : `${player.name} played ${card.label}.`;
    if (!this.specialsOn) {
      this.advanceTurn();
      this.state.lastAction = played;
      return;
    }
    switch (card.number) {
      case 1:
        this.state.lastAction = `${player.name} played ${card.label} — hold on, go again.`;
        return;
      case 2:
        this.state.pendingPick += 2;
        this.state.pendingPickRank = 2;
        this.advanceTurn();
        this.state.lastAction = `${player.name} played Pick Two.`;
        return;
      case 5:
        this.state.pendingPick += 3;
        this.state.pendingPickRank = 5;
        this.advanceTurn();
        this.state.lastAction = `${player.name} played Pick Three.`;
        return;
      case 8:
        this.advanceTurn(2);
        this.state.lastAction = `${player.name} played Suspension — next player skipped.`;
        return;
      case 11:
        if (!this.directionEnabled) {
          this.advanceTurn();
          this.state.lastAction = `${player.name} played ${card.label}.`;
          return;
        }
        this.direction *= -1;
        this.advanceTurn();
        this.state.lastAction = `${player.name} played Reverse — direction ${this.direction > 0 ? 'clockwise' : 'counter-clockwise'}.`;
        return;
      case 14:
        for (const other of this.players) {
          if (other.id === player.id) continue;
          const drawn = this.drawCard();
          if (drawn) this.hands[other.id].push(drawn);
        }
        this.state.drawPileCount = this.deck.length;
        this.advanceTurn();
        this.state.lastAction = `${player.name} played General Market — everyone picks one.`;
        return;
      default:
        this.advanceTurn();
        this.state.lastAction = played;
    }
  }

  drawCard() {
    if (this.deck.length === 0) {
      const top = this.state.topCard;
      const recycled = this.discard ?? [];
      this.discard = [];
      if (recycled.length) {
        this.deck = shuffleInPlace(recycled, makeRng((this.seed ^ this.state.round) >>> 0));
      }
      this.state.topCard = top;
    }
    return this.deck.shift();
  }

  endRound(player) {
    const pipsLeft = this.players.reduce((sum, p) => {
      if (p.id === player.id) return sum;
      return sum + (this.hands[p.id] ?? []).reduce((s, c) => s + c.number, 0);
    }, 0);
    player.score += 1;
    player.roundWins = (player.roundWins ?? 0) + 1;
    player.pipScore = (player.pipScore ?? 0) + Math.max(1, pipsLeft);
    this.state.roundWins[player.id] = player.roundWins;
    this.updateHandCounts();
    this.state.roundScores = this.players.map((p) => ({
      playerId: p.id,
      cardsLeft: this.hands[p.id]?.length ?? 0,
      pips: (this.hands[p.id] ?? []).reduce((s, c) => s + c.number, 0),
    }));

    const clinched = player.roundWins >= this.roundsToWin;
    if (clinched || this.state.round >= this.maxRounds) {
      this.state.phase = 'finished';
      this.state.winnerPlayerIds = this.matchWinners();
      const winner = this.players.find((p) => p.id === this.state.winnerPlayerIds[0]);
      this.state.lastAction = this.state.winnerPlayerIds.length > 1
        ? `Round ${this.state.round} ends. Game is a draw!`
        : `${player.name} calls check up and wins round ${this.state.round}. ${winner?.name} wins the best-of-five match!`;
    } else {
      this.state.phase = 'round_end';
      this.state.winnerPlayerIds = [player.id];
      this.state.lastAction = `${player.name} calls check up and wins round ${this.state.round}.`;
    }
    this.updateHandCounts();
  }

  advanceRound() {
    if (this.state.round >= this.maxRounds) {
      this.state.phase = 'finished';
      this.state.winnerPlayerIds = this.matchWinners();
      this.state.lastAction = this.state.winnerPlayerIds.length > 1
        ? 'Game ends in a draw!'
        : `${this.players.find((p) => p.id === this.state.winnerPlayerIds[0])?.name} wins the game!`;
      return;
    }
    this.state.round += 1;
    this.state.phase = 'playing';
    this.state.requestedShape = null;
    this.state.pendingPick = 0;
    this.state.pendingPickRank = null;
    this.direction = 1;
    this.state.lastAction = `Round ${this.state.round} started.`;
    this.dealNewRound();
  }

  dealNewRound() {
    const seed = (this.seed ^ this.state.round) >>> 0;
    const rng = makeRng(seed);
    const deck = shuffleInPlace(clone(WHOT_DECK), rng);
    const handSize = this.players.length <= 2 ? 5 : 4;
    for (const player of this.players) this.hands[player.id] = deck.splice(0, handSize);
    let topIndex = deck.findIndex((card) => !card.isWhot);
    if (topIndex < 0) topIndex = 0;
    const topCard = deck.splice(topIndex, 1)[0];
    this.deck = deck;
    this.discard = [];
    this.state.topCard = topCard;
    this.state.drawPileCount = deck.length;
    this.state.currentPlayerId = this.players[0]?.id;
    this.state.roundScores = [];
    this.state.winnerPlayerIds = [];
    this.updateHandCounts();
  }

  playerName(playerId) {
    return this.players.find((p) => p.id === playerId)?.name ?? 'A player';
  }

  isLegalCard(card) {
    if (!this.allowSpecialFinish && (this.hands[this.state.currentPlayerId]?.length ?? 0) === 1 && SPECIAL_NUMBERS.has(card.number)) return false;
    if (this.state.pendingPick > 0) {
      if (this.pickDefence === 'no_stack') return false;
      if (this.pickDefence === 'stack_any') return card.number === 2 || card.number === 5;
      return card.number === this.state.pendingPickRank;
    }
    if (card.isWhot) return true;
    const matchShape = this.state.requestedShape ?? this.state.topCard.shape;
    if (card.shape === matchShape) return true;
    if (card.number === this.state.topCard.number) return true;
    if (this.directionEnabled && card.number === 11) return true;
    return false;
  }

  advanceTurn(steps = 1) {
    const current = this.players.findIndex((c) => c.id === this.state.currentPlayerId);
    if (current < 0 || this.players.length === 0) return;
    const dir = this.direction;
    let next = (current + steps * dir) % this.players.length;
    if (next < 0) next += this.players.length;
    this.state.currentPlayerId = this.players[next].id;
  }

  updateHandCounts() {
    this.state.players = this.state.players.map((player) => ({
      ...player,
      handCount: this.hands[player.id]?.length ?? 0,
      score: this.players.find((p) => p.id === player.id)?.score ?? player.score,
      roundWins: this.players.find((p) => p.id === player.id)?.roundWins ?? player.roundWins ?? 0,
      pipScore: this.players.find((p) => p.id === player.id)?.pipScore ?? player.pipScore ?? 0,
    }));
  }

  announceCardCount(playerId, remainingCards) {
    const playerName = this.playerName(playerId);
    const kind = remainingCards === 2
      ? 'semi_last_card'
      : remainingCards === 1
        ? 'last_card'
        : remainingCards === 0
          ? 'check_up'
          : null;
    if (!kind) return;
    const text = kind === 'semi_last_card'
      ? `${playerName}: semi last card!`
      : kind === 'last_card'
        ? `${playerName}: last card!`
        : `${playerName}: check up!`;
    this.state.calloutSequence = (this.state.calloutSequence ?? 0) + 1;
    this.state.callout = { kind, playerId, playerName, text, sequence: this.state.calloutSequence };
    if (remainingCards > 0) this.state.lastAction = this.state.lastAction
      ? `${this.state.lastAction} ${text}`
      : text;
  }

  matchWinners() {
    const ranked = [...this.players].sort((a, b) =>
      (b.roundWins ?? 0) - (a.roundWins ?? 0) || (b.pipScore ?? 0) - (a.pipScore ?? 0),
    );
    const leader = ranked[0];
    if (!leader) return [];
    return ranked
      .filter((player) => (player.roundWins ?? 0) === (leader.roundWins ?? 0) && (player.pipScore ?? 0) === (leader.pipScore ?? 0))
      .map((player) => player.id);
  }

  publicState() { return clone(this.state); }

  privateState(playerId) {
    return {
      seated: this.seated(playerId),
      isTurn: this.state?.currentPlayerId === playerId,
      hand: clone(this.hands?.[playerId] ?? []),
      pendingPick: this.state?.currentPlayerId === playerId ? (this.state?.pendingPick ?? 0) : 0,
      legalIntents: this.legalIntents(playerId),
    };
  }

  legalIntents(playerId) {
    if (!this.state || this.state.phase === 'finished') return [];
    if (this.state.phase !== 'playing' || this.state.currentPlayerId !== playerId) return [];
    const plays = (this.hands[playerId] ?? []).filter((card) => this.isLegalCard(card)).map((card) => ({
      type: 'play_card',
      cardId: card.id,
      calledShape: card.isWhot ? 'Circle' : undefined,
      label: `Play ${card.label}`,
    }));
    const drawLabel = this.state.pendingPick > 0 ? `Pick ${this.state.pendingPick}` : 'Go to market';
    return [...plays, { type: 'draw', label: drawLabel }];
  }

  rankBotIntent(playerId) {
    const intents = this.legalIntents(playerId);
    if (intents.length === 0) return null;
    const hand = this.hands[playerId] ?? [];
    const scored = intents.map((intent) => {
      if (intent.type === 'draw') return { intent, weight: this.state.pendingPick > 0 ? 1 : 5 };
      const card = hand.find((c) => c.id === intent.cardId);
      let weight = 50 + (card?.number ?? 0);
      if (card?.isWhot) weight += 5;
      if (this.specialsOn && [1, 2, 5, 8, 11, 14].includes(card?.number)) weight += 20;
      return { intent, weight };
    });
    scored.sort((a, b) => b.weight - a.weight);
    return scored[0]?.intent ?? null;
  }

  recapSignals() {
    return {
      mode: 'whot',
      scores: this.players.map(({ id, score, roundWins, pipScore }) => ({ playerId: id, score, roundWins, pipScore })),
      roundScores: this.state?.roundScores ?? [],
      round: this.state?.round ?? 1,
      totalRounds: this.state?.totalRounds ?? 1,
    };
  }

  extraSnapshot() {
    return {
      hands: this.hands,
      deck: this.deck,
      discard: this.discard ?? [],
      seed: this.seed,
      specialsOn: this.specialsOn,
      directionEnabled: this.directionEnabled,
      pickDefence: this.pickDefence,
      allowSpecialFinish: this.allowSpecialFinish,
      timeoutPenalty: this.timeoutPenalty,
      direction: this.direction,
      maxRounds: this.maxRounds,
      roundsToWin: this.roundsToWin,
    };
  }

  restoreExtra(extra) {
    this.hands = extra?.hands ?? {};
    this.deck = extra?.deck ?? [];
    this.discard = extra?.discard ?? [];
    this.seed = extra?.seed ?? 1;
    this.specialsOn = extra?.specialsOn ?? true;
    this.directionEnabled = extra?.directionEnabled ?? false;
    this.pickDefence = extra?.pickDefence ?? 'stack_same';
    this.allowSpecialFinish = extra?.allowSpecialFinish ?? true;
    this.timeoutPenalty = extra?.timeoutPenalty ?? 'draw_and_pass';
    this.direction = extra?.direction ?? 1;
    this.maxRounds = extra?.maxRounds ?? 5;
    this.roundsToWin = extra?.roundsToWin ?? 3;
  }
}
