// Logo Guesser — progressive reveal logo recognition game.
// Categories, blur/crop/pixelate/mask reveal stages, typed or multiple choice.

import { RuntimeBase, makeRng, shuffleInPlace, clone, topPlayers, deprioritizeRecent } from '../helpers.js';

const LOGO_BANK = [
  { name: 'Nike', hint: 'Just Do It', category: 'Sports' },
  { name: 'MTN', hint: 'Everywhere You Go', category: 'Telecoms' },
  { name: 'Glo', hint: 'Grandmasters of Data', category: 'Telecoms' },
  { name: 'Dangote', hint: 'Industrial giant', category: 'Business' },
  { name: 'GTBank', hint: 'Orange brand', category: 'Banking' },
  { name: 'First Bank', hint: 'Since 1894', category: 'Banking' },
  { name: 'Coca-Cola', hint: 'Taste The Feeling', category: 'Drinks' },
  { name: 'Pepsi', hint: 'Thats What I Like', category: 'Drinks' },
  { name: 'Apple', hint: 'Think Different', category: 'Tech' },
  { name: 'Google', hint: 'Do The Right Thing', category: 'Tech' },
  { name: 'Toyota', hint: 'Let\'s Go Places', category: 'Auto' },
  { name: 'Chicken Republic', hint: 'Naija fast food', category: 'Food' },
  { name: 'Airtel', hint: 'Smartphone Network', category: 'Telecoms' },
  { name: 'Kuda', hint: 'Bank of the Free', category: 'Fintech' },
  { name: 'PiggyVest', hint: 'Save & Invest', category: 'Fintech' },
  { name: 'Flutterwave', hint: 'Payment gateway', category: 'Fintech' },
  { name: 'Opay', hint: 'We Move You', category: 'Fintech' },
  { name: 'Access Bank', hint: 'More than Banking', category: 'Banking' },
  { name: 'Zenith Bank', hint: 'In Your Best Interest', category: 'Banking' },
  { name: 'UBA', hint: 'Africa\'s Global Bank', category: 'Banking' },
];

const REVEAL_STAGES = [
  { type: 'blur', level: 8, label: 'Very blurry' },
  { type: 'blur', level: 4, label: 'Less blurry' },
  { type: 'pixelate', size: 8, label: 'Pixelated' },
  { type: 'mask', percent: 40, label: 'Partially shown' },
  { type: 'clear', label: 'Clear' },
];

export class LogoGuesserRuntime extends RuntimeBase {
  start() {
    const seed = Number(this.context?.settings?.seed) || (Date.now() & 0xffffffff);
    const rng = makeRng(seed);
    const category = this.context?.settings?.category || 'all';
    this.questionCount = Math.min(15, Math.max(5, Number(this.context?.settings?.questionCount) || 10));
    this.revealStages = Number(this.context?.settings?.revealStages) || 5;

    let pool = LOGO_BANK;
    if (category !== 'all') pool = LOGO_BANK.filter((l) => l.category.toLowerCase() === category.toLowerCase());
    this.questions = deprioritizeRecent(shuffleInPlace(clone(pool), rng), this.context?.settings?.avoidPrompts, (q) => q.name).slice(0, this.questionCount);
    this.currentIndex = 0;
    this.currentStage = 0;

    this.state = {
      gameType: this.gameType, name: this.manifest.name, emoji: this.manifest.emoji,
      mode: 'challenge', phase: 'playing', round: 1, totalRounds: this.questionCount,
      challenge: this.buildChallenge(), players: clone(this.players.map((p) => ({ ...p }))),
      submittedCount: 0, submissions: {}, lastResults: [], winnerPlayerIds: [],
      lastAction: 'Guess the logo!',
      currentStage: 0, totalStages: this.revealStages,
    };
  }

  buildChallenge() {
    const q = this.questions[this.currentIndex];
    if (!q) return null;
    return {
      kind: 'text',
      prompt: `Guess the brand: Stage ${this.currentStage + 1}/${this.revealStages}`,
      options: undefined,
      hint: `Category: ${q.category}`,
    };
  }

  handleIntent(playerId, intent, isHost) {
    if (!this.state || this.state.phase === 'finished') return false;
    if (intent?.type === 'advance' && isHost) {
      if (this.state.phase === 'reveal') { this.nextLogo(); return true; }
      this.currentStage += 1;
      if (this.currentStage >= this.revealStages) { this.revealAnswer(); return true; }
      this.state.challenge = this.buildChallenge();
      this.state.currentStage = this.currentStage;
      this.state.lastAction = `Stage ${this.currentStage + 1}/${this.revealStages}`;
      return true;
    }
    if (this.state.phase !== 'playing' || this.state.submissions?.[playerId]) return false;
    if (intent?.type !== 'answer_text' || !intent?.text) return false;

    const text = String(intent.text).trim().toLowerCase();
    const correct = this.questions[this.currentIndex]?.name.toLowerCase();
    const isCorrect = text === correct || (text.length > 2 && correct.includes(text));

    this.state.submissions[playerId] = { text: String(intent.text), correct: isCorrect };
    this.state.submittedCount = Object.keys(this.state.submissions).length;
    this.state.players = clone(this.state.players);
    this.state.lastAction = `${this.playerName(playerId)} guessed ${intent.text}.`;

    if (isCorrect || this.state.submittedCount >= this.players.length) this.revealAnswer();
    return true;
  }

  revealAnswer() {
    const q = this.questions[this.currentIndex];
    const submissions = this.state.submissions ?? {};
    const results = [];
    for (const [playerId, { text, correct }] of Object.entries(submissions)) {
      const points = correct ? 100 : 0;
      const player = this.state.players.find((p) => p.id === playerId);
      if (player) player.score += points;
      results.push({ playerId, points, answer: text });
    }
    this.state.phase = 'reveal';
    this.state.lastResults = results;
    this.state.lastAction = `Answer: ${q.name} — "${q.hint}"`;
  }

  nextLogo() {
    this.currentStage = 0;
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
    this.state.currentStage = 0;
    this.state.lastAction = 'Next logo!';
  }

  playerName(id) { return this.state?.players?.find((p) => p.id === id)?.name ?? 'A player'; }
  publicState() { return clone(this.state); }
  privateState(id) {
    return { seated: this.seated(id), submitted: this.state?.submissions?.[id] != null, legalIntents: this.legalIntents(id) };
  }
  legalIntents(id) {
    if (!this.state || this.state.phase !== 'playing' || this.state.submissions?.[id] || !this.seated(id)) return [];
    return [{ type: 'answer_text', label: 'Guess the brand' }];
  }
  rankBotIntent(id) {
    if (!this.state || this.state.phase !== 'playing' || this.state.submissions?.[id]) return null;
    return { type: 'answer_text', text: 'MTN' };
  }
  extraSnapshot() { return { questions: this.questions, currentIndex: this.currentIndex, currentStage: this.currentStage }; }
  restoreExtra(extra) { this.questions = extra?.questions ?? []; this.currentIndex = extra?.currentIndex ?? 0; this.currentStage = extra?.currentStage ?? 0; }
}
