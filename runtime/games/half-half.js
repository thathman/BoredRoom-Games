// Half & Half — social midpoint/split prediction game.
// Modes: split_vote (choose side), midpoint_guess (closest to median), debate_party (split into teams)

import { RuntimeBase, makeRng, clone, topPlayers } from '../helpers.js';

const SPLIT_PROMPTS = [
  { prompt: 'Jollof Wars: Nigeria or Ghana?', sides: ['Nigeria 🇳🇬', 'Ghana 🇬🇭'] },
  { prompt: 'Better ride: Uber or Bolt?', sides: ['Uber', 'Bolt'] },
  { prompt: 'Wizkid or Davido?', sides: ['Wizkid', 'Davido'] },
  { prompt: 'Morning person or Night owl?', sides: ['Morning 🌅', 'Night 🌙'] },
  { prompt: 'Windows or Mac?', sides: ['Windows', 'Mac'] },
  { prompt: 'Tea or Coffee?', sides: ['Tea ☕', 'Coffee 🫘'] },
  { prompt: 'Lagos or Abuja?', sides: ['Lagos', 'Abuja'] },
  { prompt: 'iPhone or Android?', sides: ['iPhone 📱', 'Android 🤖'] },
];

const MIDPOINT_PROMPTS = [
  { prompt: 'How much should a plate of Jollof cost in Lagos?', unit: '₦', min: 500, max: 5000 },
  { prompt: 'How many people fit in one Danfo?', unit: '', min: 8, max: 25 },
  { prompt: 'How many hours of NEPA light per day?', unit: 'hrs', min: 0, max: 24 },
  { prompt: 'What is a fair bride price? (₦)', unit: '₦', min: 5000, max: 500000 },
  { prompt: 'How many unread WhatsApp messages do you have?', unit: '', min: 0, max: 999 },
];

export class HalfHalfRuntime extends RuntimeBase {
  start() {
    const seed = Number(this.context?.settings?.seed) || (Date.now() & 0xffffffff);
    this.rng = makeRng(seed);
    this.mode = String(this.context?.settings?.mode || 'split_vote');
    this.totalRounds = Math.min(10, Math.max(3, Number(this.context?.settings?.rounds) || 5));

    this.currentRound = 0;
    this.prepareRound();
    this.state = { gameType: this.gameType, name: this.manifest.name, emoji: this.manifest.emoji, mode: 'challenge', phase: 'playing', round: 1, totalRounds: this.totalRounds, challenge: this.currentPrompt, players: clone(this.players.map((p) => ({ ...p }))), submittedCount: 0, submissions: {}, lastResults: [], winnerPlayerIds: [], lastAction: this.currentPrompt?.prompt ?? '' };
  }

  prepareRound() {
    if (this.mode === 'midpoint_guess') {
      const pool = MIDPOINT_PROMPTS;
      const idx = Math.floor(this.rng() * pool.length);
      const p = pool[idx];
      this.currentPrompt = { kind: 'number', prompt: p.prompt, min: p.min, max: p.max, unit: p.unit };
    } else {
      const pool = SPLIT_PROMPTS;
      const idx = Math.floor(this.rng() * pool.length);
      const p = pool[idx];
      this.currentPrompt = { kind: 'choice', prompt: p.prompt, options: p.sides };
    }
  }

  handleIntent(playerId, intent, isHost) {
    if (!this.state || this.state.phase === 'finished') return false;
    if (intent?.type === 'advance' && isHost) {
      if (this.state.phase === 'reveal') { this.nextRound(); return true; }
      this.revealRound(); return true;
    }
    if (this.state.phase !== 'playing' || this.state.submissions?.[playerId]) return false;

    if (this.state.challenge?.kind === 'choice' && intent?.type === 'answer') {
      const idx = Number(intent?.optionIndex);
      if (idx < 0 || idx >= (this.state.challenge.options?.length ?? 0)) return false;
      this.state.submissions[playerId] = { type: 'split', choice: idx };
    } else if (this.state.challenge?.kind === 'number' && intent?.type === 'guess') {
      const amount = Number(intent?.amount);
      if (!Number.isFinite(amount)) return false;
      this.state.submissions[playerId] = { type: 'midpoint', amount };
    } else return false;

    this.state.submittedCount = Object.keys(this.state.submissions).length;
    this.state.players = clone(this.state.players);
    this.state.lastAction = `${this.playerName(playerId)} submitted.`;
    if (this.state.submittedCount >= this.players.length) this.revealRound();
    return true;
  }

  revealRound() {
    const submissions = this.state.submissions ?? {};
    const results = [];
    const challenge = this.state.challenge;

    if (challenge?.kind === 'choice') {
      const tallies = {};
      for (const [, { choice }] of Object.entries(submissions)) tallies[choice] = (tallies[choice] || 0) + 1;
      const totals = Object.entries(tallies).sort((a, b) => b[1] - a[1]);
      const majority = totals[0] ? Number(totals[0][0]) : null;
      const minority = totals[1] ? Number(totals[1][0]) : majority;

      for (const [playerId, { choice }] of Object.entries(submissions)) {
        let points = 0;
        if (totals.length >= 2) {
          points = choice === minority ? 100 : 30; // Riskier minority gets more
        }
        const player = this.state.players.find((p) => p.id === playerId);
        if (player) player.score += points;
        results.push({ playerId, points });
      }
      this.state.lastAction = `Split: ${totals.map(([k, v]) => `${challenge.options?.[k] ?? k}: ${v}`).join(', ')}`;
    } else if (challenge?.kind === 'number') {
      const amounts = Object.values(submissions).map((s) => s.amount).sort((a, b) => a - b);
      const mid = amounts.length % 2 === 0
        ? (amounts[amounts.length / 2 - 1] + amounts[amounts.length / 2]) / 2
        : amounts[Math.floor(amounts.length / 2)];

      for (const [playerId, { amount }] of Object.entries(submissions)) {
        const dist = Math.abs(amount - mid);
        const points = Math.max(0, Math.round(100 - (dist / Math.max(1, mid)) * 100));
        const player = this.state.players.find((p) => p.id === playerId);
        if (player) player.score += points;
        results.push({ playerId, points });
      }
      this.state.lastAction = `Median: ${mid.toLocaleString()}${challenge.unit ?? ''}`;
    }

    this.state.phase = 'reveal';
    this.state.lastResults = results;
  }

  nextRound() {
    this.currentRound += 1;
    if (this.currentRound >= this.totalRounds) {
      this.state.phase = 'finished';
      this.state.winnerPlayerIds = topPlayers(this.state.players);
      this.state.players = clone(this.state.players);
      this.state.lastAction = this.state.winnerPlayerIds.length > 1 ? 'Draw!' : `${this.playerName(this.state.winnerPlayerIds[0])} wins!`;
      return;
    }
    this.prepareRound();
    this.state.phase = 'playing';
    this.state.round = this.currentRound + 1;
    this.state.challenge = this.currentPrompt;
    this.state.submittedCount = 0;
    this.state.submissions = {};
    this.state.lastResults = [];
    this.state.lastAction = this.currentPrompt?.prompt ?? '';
  }

  playerName(id) { return this.state?.players?.find((p) => p.id === id)?.name ?? 'A player'; }
  publicState() { return clone(this.state); }
  privateState(id) { return { seated: this.seated(id), submitted: this.state?.submissions?.[id] != null, legalIntents: this.legalIntents(id) }; }
  legalIntents(id) {
    if (!this.state || this.state.phase !== 'playing' || this.state.submissions?.[id]) return [];
    if (!this.seated(id)) return [];
    return this.state.challenge?.kind === 'choice'
      ? (this.state.challenge.options ?? []).map((o, i) => ({ type: 'answer', optionIndex: i, label: o }))
      : [{ type: 'guess', label: `Enter ${this.state.challenge?.unit ?? ''} amount` }];
  }
  rankBotIntent(id) {
    if (!this.state || this.state.phase !== 'playing' || this.state.submissions?.[id]) return null;
    const c = this.state.challenge;
    if (c?.kind === 'choice') return { type: 'answer', optionIndex: Math.floor(Math.random() * (c.options?.length ?? 2)) };
    if (c?.kind === 'number') return { type: 'guess', amount: Math.floor(c.min + Math.random() * (c.max - c.min)) };
    return null;
  }
  extraSnapshot() { return { currentRound: this.currentRound, mode: this.mode, totalRounds: this.totalRounds }; }
  restoreExtra(extra) { this.currentRound = extra?.currentRound ?? 0; this.mode = extra?.mode ?? 'split_vote'; this.totalRounds = extra?.totalRounds ?? 5; }
}
