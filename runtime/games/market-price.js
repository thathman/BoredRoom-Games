// Market Price — Nigerian price estimation game with cached product snapshots.

import { RuntimeBase, makeRng, shuffleInPlace, clone, topPlayers, deprioritizeRecent } from '../helpers.js';

const CURATED_PRODUCTS = [
  { name: '50kg bag of rice (local)', category: 'Food', unit: '50kg bag', price: 45000, range: 5000 },
  { name: '1 crate of eggs', category: 'Food', unit: 'crate', price: 3800, range: 500 },
  { name: '1 litre of groundnut oil', category: 'Food', unit: 'litre', price: 1800, range: 300 },
  { name: 'Indomie noodles (carton)', category: 'Food', unit: 'carton', price: 4500, range: 500 },
  { name: 'Milo (500g tin)', category: 'Food', unit: '500g', price: 1200, range: 200 },
  { name: 'Dano milk (carton)', category: 'Food', unit: 'carton', price: 2800, range: 400 },
  { name: 'Bread (Agege loaf)', category: 'Food', unit: 'loaf', price: 700, range: 100 },
  { name: 'Peak milk (400g tin)', category: 'Food', unit: '400g', price: 900, range: 150 },
  { name: 'Goat meat (1kg)', category: 'Food', unit: 'kg', price: 3500, range: 500 },
  { name: 'Titus fish (1kg)', category: 'Food', unit: 'kg', price: 2200, range: 400 },
  { name: 'Cement (Dangote, bag)', category: 'Building', unit: 'bag', price: 5500, range: 800 },
  { name: 'Petrol (1 litre, current)', category: 'Transport', unit: 'litre', price: 650, range: 100 },
  { name: 'Danfo ride (short drop)', category: 'Transport', unit: 'trip', price: 300, range: 100 },
  { name: 'Bolt ride (Lagos Island to Mainland)', category: 'Transport', unit: 'trip', price: 4500, range: 1000 },
  { name: 'iPhone charger (roadside)', category: 'Electronics', unit: 'piece', price: 800, range: 200 },
  { name: 'MTN 1.5GB data', category: 'Telecoms', unit: 'bundle', price: 500, range: 100 },
  { name: 'DStv Compact (monthly)', category: 'Entertainment', unit: 'month', price: 7900, range: 1000 },
  { name: 'Generator (Tiger 2.5kva)', category: 'Electronics', unit: 'generator', price: 180000, range: 20000 },
  { name: 'Fufu wrap (restaurant)', category: 'Food', unit: 'wrap', price: 500, range: 100 },
  { name: 'Bottled water (Eva 75cl)', category: 'Drinks', unit: 'bottle', price: 200, range: 50 },
];

export class MarketPriceRuntime extends RuntimeBase {
  start() {
    const seed = Number(this.context?.settings?.seed) || (Date.now() & 0xffffffff);
    const rng = makeRng(seed);
    const category = this.context?.settings?.category || 'all';
    this.questionCount = Math.min(15, Math.max(5, Number(this.context?.settings?.questionCount) || 8));
    this.tolerancePct = Math.min(50, Math.max(5, Number(this.context?.settings?.tolerance) || 15));
    this.source = 'curated';

    let pool = CURATED_PRODUCTS;
    if (category !== 'all') pool = CURATED_PRODUCTS.filter((p) => p.category.toLowerCase() === category.toLowerCase());
    this.questions = deprioritizeRecent(shuffleInPlace(clone(pool), rng), this.context?.settings?.avoidPrompts, (q) => q.name).slice(0, this.questionCount);
    this.currentIndex = 0;

    this.state = {
      gameType: this.gameType, name: this.manifest.name, emoji: this.manifest.emoji,
      mode: 'challenge', phase: 'playing', round: 1, totalRounds: this.questionCount,
      challenge: this.buildChallenge(), players: clone(this.players.map((p) => ({ ...p }))),
      submittedCount: 0, submissions: {}, lastResults: [], winnerPlayerIds: [],
      lastAction: 'Estimate the price in Naira.',
    };
  }

  buildChallenge() {
    const q = this.questions[this.currentIndex];
    if (!q) return null;
    return { kind: 'number', prompt: `How much for ${q.name}? (${q.category})`, unit: q.unit, min: 0, max: 9999999 };
  }

  handleIntent(playerId, intent, isHost) {
    if (!this.state || this.state.phase === 'finished') return false;
    if (intent?.type === 'advance' && isHost) {
      if (this.state.phase === 'reveal') { this.nextQuestion(); return true; }
      this.revealQuestion(); return true;
    }
    if (this.state.phase !== 'playing' || this.state.submissions?.[playerId]) return false;
    if (intent?.type !== 'guess' || !Number.isFinite(Number(intent?.amount))) return false;

    this.state.submissions[playerId] = { amount: Number(intent.amount) };
    this.state.submittedCount = Object.keys(this.state.submissions).length;
    this.state.players = clone(this.state.players);
    this.state.lastAction = `${this.playerName(playerId)} guessed ₦${Number(intent.amount).toLocaleString()}.`;
    if (this.state.submittedCount >= this.players.length) this.revealQuestion();
    return true;
  }

  revealQuestion() {
    const q = this.questions[this.currentIndex];
    const correctPrice = q.price;
    const tolerance = correctPrice * (this.tolerancePct / 100);
    const submissions = this.state.submissions ?? {};
    const results = [];
    let closest = null;

    for (const [playerId, { amount }] of Object.entries(submissions)) {
      const diff = Math.abs(amount - correctPrice);
      const pctOff = (diff / correctPrice) * 100;
      let points = 0;
      if (diff <= 1) points = 100; // exact
      else if (pctOff <= 5) points = 80;
      else if (pctOff <= 10) points = 60;
      else if (diff <= tolerance) points = 40;
      else if (!closest || diff < closest.diff) closest = { playerId, diff };
      const player = this.state.players.find((p) => p.id === playerId);
      if (player) player.score += points;
      results.push({ playerId, points, guess: amount, diff });
    }
    if (closest && !results.some((r) => r.points > 0)) {
      const cs = results.find((r) => r.playerId === closest.playerId);
      if (cs) { cs.points = 20; const p = this.state.players.find((pp) => pp.id === closest.playerId); if (p) p.score += 20; }
    }

    this.state.phase = 'reveal';
    this.state.lastResults = results.map((r) => ({ playerId: r.playerId, points: r.points }));
    this.state.lastAction = `Actual price: ₦${correctPrice.toLocaleString()} per ${q.unit}. ${this.source === 'supermart' ? 'Product/price reference: Supermart.ng' : ''}`;
  }

  nextQuestion() {
    this.currentIndex += 1;
    if (this.currentIndex >= this.questions.length) {
      this.state.phase = 'finished';
      this.state.winnerPlayerIds = topPlayers(this.state.players);
      this.state.players = clone(this.state.players);
      this.state.lastAction = this.state.winnerPlayerIds.length > 1 ? 'Draw!' : `${this.playerName(this.state.winnerPlayerIds[0])} wins!`;
      return;
    }
    this.state.phase = 'playing';
    this.state.round = this.currentIndex + 1;
    this.state.challenge = this.buildChallenge();
    this.state.submittedCount = 0; this.state.submissions = {}; this.state.lastResults = [];
    this.state.lastAction = this.questions[this.currentIndex]?.name ?? 'Next item!';
  }

  playerName(id) { return this.state?.players?.find((p) => p.id === id)?.name ?? 'A player'; }
  publicState() { return clone(this.state); }
  privateState(id) {
    return { seated: this.seated(id), submitted: this.state?.submissions?.[id] != null, legalIntents: this.legalIntents(id) };
  }
  legalIntents(id) {
    if (!this.state || this.state.phase !== 'playing' || this.state.submissions?.[id] || !this.seated(id)) return [];
    return [{ type: 'guess', label: 'Enter price in Naira', amount: 0 }];
  }
  rankBotIntent(id) {
    if (!this.state || this.state.phase !== 'playing' || this.state.submissions?.[id]) return null;
    const base = this.questions[this.currentIndex]?.price ?? 5000;
    return { type: 'guess', amount: Math.round(base * (0.5 + Math.random())) };
  }
  extraSnapshot() { return { questions: this.questions, currentIndex: this.currentIndex, tolerancePct: this.tolerancePct }; }
  restoreExtra(extra) { this.questions = extra?.questions ?? []; this.currentIndex = extra?.currentIndex ?? 0; this.tolerancePct = extra?.tolerancePct ?? 15; }
}
