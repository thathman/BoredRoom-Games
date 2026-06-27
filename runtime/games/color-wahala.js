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

// In-memory flag database — country → the colours actually on its flag (mapped to the COLORS
// option set above). Flag questions are generated and randomised from this; no hardcoded
// question strings, no AI, and accurate by construction. Each colour set is multi-accept.
const FLAG_COLORS = {
  Nigeria: ['green', 'white'],
  Ghana: ['red', 'yellow', 'green', 'black'],
  Kenya: ['black', 'red', 'green', 'white'],
  'South Africa': ['black', 'red', 'green', 'yellow', 'blue', 'white'],
  Senegal: ['green', 'yellow', 'red'],
  Cameroon: ['green', 'red', 'yellow'],
  Mali: ['green', 'yellow', 'red'],
  Guinea: ['red', 'yellow', 'green'],
  Benin: ['green', 'yellow', 'red'],
  Togo: ['green', 'yellow', 'red', 'white'],
  Ethiopia: ['green', 'yellow', 'red', 'blue'],
  Angola: ['red', 'black', 'yellow'],
  Mozambique: ['green', 'black', 'yellow', 'white', 'red'],
  Zimbabwe: ['green', 'yellow', 'red', 'black', 'white'],
  Tanzania: ['green', 'yellow', 'black', 'blue'],
  Uganda: ['black', 'yellow', 'red', 'white'],
  Rwanda: ['blue', 'yellow', 'green'],
  Zambia: ['green', 'red', 'black', 'orange'],
  Botswana: ['blue', 'white', 'black'],
  Namibia: ['blue', 'red', 'green', 'white', 'yellow'],
  Egypt: ['red', 'white', 'black', 'yellow'],
  Morocco: ['red', 'green'],
  Algeria: ['green', 'white', 'red'],
  Tunisia: ['red', 'white'],
  Libya: ['red', 'black', 'green', 'white'],
  Sudan: ['red', 'white', 'black', 'green'],
  'Ivory Coast': ['orange', 'white', 'green'],
  Niger: ['orange', 'white', 'green'],
  'Sierra Leone': ['green', 'white', 'blue'],
  Liberia: ['red', 'white', 'blue'],
  Gambia: ['red', 'blue', 'green', 'white'],
  Gabon: ['green', 'yellow', 'blue'],
  Congo: ['green', 'yellow', 'red'],
  Chad: ['blue', 'yellow', 'red'],
  Brazil: ['green', 'yellow', 'blue', 'white'],
  France: ['blue', 'white', 'red'],
  Germany: ['black', 'red', 'yellow'],
  Italy: ['green', 'white', 'red'],
  Spain: ['red', 'yellow'],
  Jamaica: ['green', 'yellow', 'black'],
  India: ['orange', 'white', 'green', 'blue'],
  China: ['red', 'yellow'],
  Japan: ['white', 'red'],
  'United States': ['red', 'white', 'blue'],
  Canada: ['red', 'white'],
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

// Fully procedural: pick random countries from the in-memory flag database, ask which colour is
// on the flag, accept any colour actually on it. Two question styles add variety: "which IS on"
// (multi-accept) and "which is NOT on" (single correct colour absent from the flag).
function generateFlagPrompts(count, rng, avoid) {
  const colorNames = COLORS.map((c) => c.name);
  let countries = Object.keys(FLAG_COLORS);
  // Sink recently-used countries to the back so a long session keeps fresh flags.
  if (Array.isArray(avoid) && avoid.length) {
    const recent = new Set(avoid.map((p) => String(p).toLowerCase()));
    countries = [...countries.filter((c) => !recent.has(`flag:${c.toLowerCase()}`)), ...countries.filter((c) => recent.has(`flag:${c.toLowerCase()}`))];
  } else {
    countries = shuffleInPlace([...countries], rng);
  }
  const prompts = [];
  for (const country of countries) {
    if (prompts.length >= count) break;
    const onFlag = FLAG_COLORS[country].map((c) => c.charAt(0).toUpperCase() + c.slice(1));
    const askNot = rng() < 0.4 && onFlag.length <= 5; // mix in "NOT on the flag" questions
    if (askNot) {
      const absent = colorNames.filter((c) => !onFlag.includes(c));
      if (absent.length === 0) continue;
      const answer = absent[Math.floor(rng() * absent.length)];
      prompts.push({
        kind: 'choice', id: `flag:${country}`,
        prompt: `Which colour is NOT on the ${country} flag?`,
        correctAnswer: answer.toLowerCase(),
        options: colorNames,
        explanation: `The ${country} flag is ${onFlag.join(', ')} — so ${answer} is not on it.`,
      });
    } else {
      prompts.push({
        kind: 'choice', id: `flag:${country}`,
        prompt: `Which colour is on the ${country} flag?`,
        correctAnswer: FLAG_COLORS[country],
        options: colorNames,
        explanation: `The ${country} flag is ${onFlag.join(', ')}.`,
        multiAccept: true,
      });
    }
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

    // 'mixed' (default) blends Stroop + flag questions; 'flags' / 'stroop' force one kind.
    const set = this.contentSet;
    const flagCount = set === 'flags' ? this.questionCount : set === 'stroop' ? 0 : Math.ceil(this.questionCount / 2);
    const stroopCount = this.questionCount - flagCount;

    this.prompts = [
      ...generateStroopPrompts(stroopCount, this.difficulty, rng),
      ...generateFlagPrompts(flagCount, rng, this.context?.settings?.avoidPrompts),
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
