// Color Wahala — true Stroop/reaction game.
//
// Word color vs ink color mismatch. Misleading ink colors.
// Nigerian flag-color prompts. Speed scoring.
//
// Settings:
//   contentSet (string, default 'stroop')
//   questionCount (number, default 10)
//   timer (number, default 8) — seconds per question
//   difficulty (string, default 'medium')
//   seed (number, optional)

import { RuntimeBase, makeRng, shuffleInPlace, clone, topPlayers } from '../helpers.js';

const COLORS = [
  { name: 'Red', hex: '#ef4444' },
  { name: 'Green', hex: '#22c55e' },
  { name: 'Blue', hex: '#3b82f6' },
  { name: 'Purple', hex: '#a855f7' },
  { name: 'Orange', hex: '#f97316' },
  { name: 'Yellow', hex: '#eab308' },
  { name: 'White', hex: '#fafafa' },
  { name: 'Black', hex: '#171717' },
];

// Each flag question accepts every colour actually on that flag (multi-accept), with a correct
// per-flag explanation. Single-stripe/ambiguous flags are avoided where the answer would be unfair.
const ACCEPTABLE_FLAGS = {
  'Which colour is on the Nigerian flag?': { answers: ['green', 'white'], note: 'The Nigerian flag is green and white.' },
  'Which colour is on the Ghanaian flag?': { answers: ['red', 'yellow', 'green'], note: 'Ghana: red, gold/yellow and green with a black star.' },
  'Which colour is on the Kenyan flag?': { answers: ['black', 'red', 'green', 'white'], note: 'Kenya: black, red and green with white fimbriation.' },
  'Which colour is on the South African flag?': { answers: ['black', 'red', 'green', 'yellow', 'blue', 'white'], note: 'South Africa is the most colourful: black, red, green, gold, blue and white.' },
  'Which colour is on the Senegalese flag?': { answers: ['green', 'yellow', 'red'], note: 'Senegal: green, yellow and red with a green star.' },
  'Which colour is on the Cameroonian flag?': { answers: ['green', 'red', 'yellow'], note: 'Cameroon: green, red and yellow with a gold star.' },
};

function generateStroopPrompts(count, difficulty, rng) {
  const prompts = [];
  const used = new Set();

  while (prompts.length < count) {
    const wordColor = COLORS[Math.floor(rng() * COLORS.length)];
    const others = COLORS.filter((c) => c.name !== wordColor.name);
    const inkColor = others[Math.floor(rng() * others.length)];

    if (difficulty === 'hard') {
      const key = `ink:${inkColor.name}`;
      if (used.has(key)) continue;
      used.add(key);
      prompts.push({
        kind: 'choice',
        prompt: 'Tap the INK colour of this word.',
        hint: `<span style="color:${inkColor.hex}">${wordColor.name}</span>`,
        correctAnswer: inkColor.name,
        options: COLORS.map((c) => c.name),
        explanation: `The word "${wordColor.name}" is written in ${inkColor.name} ink.`,
      });
    } else {
      const key = `word:${wordColor.name}:ink:${inkColor.name}`;
      if (used.has(key)) continue;
      used.add(key);
      prompts.push({
        kind: 'choice',
        prompt: 'Tap the WORD, not the ink colour!',
        hint: `<span style="color:${inkColor.hex}">${wordColor.name}</span>`,
        correctAnswer: wordColor.name,
        options: COLORS.map((c) => c.name),
        explanation: `The word says "${wordColor.name}" — don't be tricked by the ${inkColor.name} ink.`,
      });
    }
  }
  return prompts;
}

function generateFlagPrompts(count, rng) {
  const flags = Object.entries(ACCEPTABLE_FLAGS);
  const prompts = [];
  const used = new Set();
  while (prompts.length < Math.min(count, flags.length)) {
    const [question, { answers, note }] = flags[Math.floor(rng() * flags.length)];
    if (used.has(question)) continue;
    used.add(question);
    prompts.push({
      kind: 'choice',
      prompt: question,
      correctAnswer: answers,
      options: COLORS.map((c) => c.name),
      explanation: note,
      multiAccept: true,
    });
  }
  return prompts;
}

export class ColorWahalaRuntime extends RuntimeBase {
  start() {
    const seed = Number(this.context?.settings?.seed) || (Date.now() & 0xffffffff);
    const rng = makeRng(seed);
    this.contentSet = String(this.context?.settings?.contentSet || 'stroop');
    this.questionCount = Math.min(20, Math.max(5, Number(this.context?.settings?.questionCount) || 10));
    this.totalRounds = 1;
    this.difficulty = String(this.context?.settings?.difficulty || 'medium');

    const stroopCount = this.contentSet === 'flags' ? 0 : this.questionCount;
    const flagCount = this.contentSet === 'flags' ? this.questionCount : 0;

    this.prompts = [
      ...generateStroopPrompts(stroopCount, this.difficulty, rng),
      ...generateFlagPrompts(flagCount, rng),
    ];
    shuffleInPlace(this.prompts, rng);

    this.currentPromptIndex = 0;

    this.state = {
      gameType: this.gameType,
      name: this.manifest.name,
      emoji: this.manifest.emoji,
      mode: 'challenge',
      phase: 'playing',
      round: 1,
      totalRounds: 1,
      challenge: this.prompts[0],
      players: clone(this.players.map((p) => ({ ...p }))),
      submittedCount: 0,
      submissions: {},
      lastResults: [],
      winnerPlayerIds: [],
      lastAction: "Don't let the ink trick you!",
    };
  }

  handleIntent(playerId, intent, isHost) {
    if (!this.state || this.state.phase === 'finished') return false;
    if (intent?.type === 'advance' && isHost) {
      if (this.state.phase === 'reveal') {
        this.nextPrompt();
        return true;
      }
      this.revealPrompt();
      return true;
    }
    if (this.state.phase !== 'playing') return false;
    if (this.state.submissions?.[playerId]) return false;
    if (intent?.type === 'answer') {
      const optionIndex = Number(intent?.optionIndex);
      if (!Number.isInteger(optionIndex)) return false;
      const options = this.state.challenge?.options ?? [];
      if (optionIndex < 0 || optionIndex >= options.length) return false;
      const submittedAnswer = options[optionIndex];

      this.state.submissions[playerId] = { optionIndex, submittedAnswer, time: Date.now() };
      this.state.submittedCount = Object.keys(this.state.submissions).length;
      this.state.players = clone(this.state.players);
      this.state.lastAction = `${this.playerName(playerId)} answered.`;

      if (this.state.submittedCount >= this.players.length) {
        this.revealPrompt();
      }
      return true;
    }
    return false;
  }

  revealPrompt() {
    const prompt = this.state.challenge;
    const correct = prompt?.multiAccept ? prompt.correctAnswer : [prompt?.correctAnswer];
    const submissions = this.state.submissions ?? {};
    const results = [];

    for (const [playerId, { submittedAnswer }] of Object.entries(submissions)) {
      const isCorrect = (correct ?? []).some((a) => a.toLowerCase() === (submittedAnswer ?? '').toLowerCase());
      const player = this.state.players.find((p) => p.id === playerId);
      if (player && isCorrect) player.score += 100;
      results.push({ playerId, correct: isCorrect, answer: submittedAnswer });
    }

    this.state.phase = 'reveal';
    this.state.lastResults = results.map((r) => ({ playerId: r.playerId, points: r.correct ? 100 : 0 }));
    this.state.lastAction = `Correct: ${(correct ?? []).join(', ')}`;
  }

  nextPrompt() {
    this.currentPromptIndex += 1;
    if (this.currentPromptIndex >= this.prompts.length) {
      this.state.phase = 'finished';
      this.state.winnerPlayerIds = topPlayers(this.state.players);
      this.state.players = clone(this.state.players);
      this.state.lastAction = this.state.winnerPlayerIds.length > 1
        ? 'Game ends in a draw!'
        : `${this.playerName(this.state.winnerPlayerIds[0])} wins!`;
      return;
    }
    this.state.phase = 'playing';
    this.state.submittedCount = 0;
    this.state.submissions = {};
    this.state.lastResults = [];
    this.state.challenge = this.prompts[this.currentPromptIndex];
    this.state.lastAction = `Prompt ${this.currentPromptIndex + 1} of ${this.prompts.length}.`;
  }

  playerName(playerId) {
    return this.state?.players?.find((p) => p.id === playerId)?.name ?? 'A player';
  }

  publicState() { return clone(this.state); }
  privateState(playerId) {
    return {
      seated: this.seated(playerId),
      submitted: this.state?.submissions?.[playerId] != null,
      legalIntents: this.legalIntents(playerId),
    };
  }

  legalIntents(playerId) {
    if (!this.state || this.state.phase !== 'playing' || this.state.submissions?.[playerId]) return [];
    if (!this.seated(playerId)) return [];
    return (this.state.challenge?.options ?? []).map((option, i) => ({
      type: 'answer', optionIndex: i, label: option,
    }));
  }

  rankBotIntent(playerId) {
    if (!this.state || this.state.phase !== 'playing' || this.state.submissions?.[playerId]) return null;
    const options = this.state.challenge?.options ?? [];
    const idx = Math.floor(Math.random() * options.length);
    return { type: 'answer', optionIndex: idx };
  }
}
