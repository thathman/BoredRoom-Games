// Who Sabi Pass / Trivia — full trivia game with categories, difficulty, no repeats.
//
// Settings:
//   categories (string, default 'all')
//   difficulty (string, default 'mixed')
//   questionCount (number, default 10)
//   timer (number, default 15)
//   seed (number, optional)

import { RuntimeBase, makeRng, shuffleInPlace, clone, topPlayers, deprioritizeRecent } from '../helpers.js';

const QUESTION_BANK = {
  culture: [
    { prompt: 'What is the capital of Nigeria?', options: ['Abuja', 'Lagos', 'Kano', 'Port Harcourt'], answer: 0, explanation: 'Abuja became the capital in 1991.' },
    { prompt: 'Which Nigerian dish is made from cassava?', options: ['Garri', 'Jollof', 'Suya', 'Akara'], answer: 0, explanation: 'Garri is a popular cassava-based staple.' },
    { prompt: 'What does "Wahala" mean in Nigerian Pidgin?', options: ['Trouble', 'Money', 'Food', 'Love'], answer: 0, explanation: 'Wahala means trouble or problem.' },
    { prompt: 'Which city is known as the "Centre of Excellence"?', options: ['Lagos', 'Abuja', 'Enugu', 'Ibadan'], answer: 0, explanation: 'Lagos State is called the Centre of Excellence.' },
    { prompt: 'What is the traditional Yoruba attire called?', options: ['Agbada', 'Kaftan', 'Dashiki', 'Wrapper'], answer: 0, explanation: 'Agbada is the flowing wide-sleeved robe worn by Yoruba men.' },
    { prompt: 'Which Nigerian musician is known as "Fela"?', options: ['Fela Kuti', 'Wizkid', 'Davido', 'Burna Boy'], answer: 0, explanation: 'Fela Anikulapo Kuti pioneered Afrobeat music.' },
    { prompt: 'What is "NEPA" a reference to in Nigeria?', options: ['Electricity', 'Food', 'Transport', 'Education'], answer: 0, explanation: 'NEPA (National Electric Power Authority) — often joked about due to power outages.' },
    { prompt: 'Which is the largest ethnic group in Nigeria?', options: ['Hausa', 'Yoruba', 'Igbo', 'Ijaw'], answer: 0, explanation: 'The Hausa are the largest ethnic group, concentrated in the north.' },
  ],
  history: [
    { prompt: 'When did Nigeria gain independence?', options: ['1960', '1957', '1963', '1970'], answer: 0, explanation: 'Nigeria gained independence from Britain on October 1, 1960.' },
    { prompt: 'Who was Nigeria\'s first president?', options: ['Nnamdi Azikiwe', 'Tafawa Balewa', 'Obasanjo', 'Shagari'], answer: 0, explanation: 'Dr. Nnamdi Azikiwe was the first President (1963–1966).' },
    { prompt: 'The Nigerian Civil War lasted from?', options: ['1967–1970', '1960–1963', '1975–1978', '1980–1983'], answer: 0, explanation: 'The Biafran War lasted from 1967 to 1970.' },
  ],
  music: [
    { prompt: 'Who sings "Essence"?', options: ['Wizkid', 'Davido', 'Burna Boy', 'Olamide'], answer: 0, explanation: 'Wizkid\'s "Essence" featuring Tems became a global hit.' },
    { prompt: 'Which artist won the first Grammy for "Twice As Tall"?', options: ['Burna Boy', 'Wizkid', 'Davido', 'Tiwa Savage'], answer: 0, explanation: 'Burna Boy won Best Global Music Album for "Twice As Tall" in 2021.' },
    { prompt: 'What genre did Fela Kuti create?', options: ['Afrobeat', 'Highlife', 'Juju', 'Fuji'], answer: 0, explanation: 'Fela Kuti created Afrobeat, blending jazz, funk, and traditional African rhythms.' },
  ],
  sports: [
    { prompt: 'What are the Super Eagles?', options: ['Football team', 'Basketball team', 'Athletics team', 'Rugby team'], answer: 0, explanation: 'The Super Eagles is Nigeria\'s national football team.' },
    { prompt: 'Which Nigerian footballer won African Player of the Year in 2023?', options: ['Victor Osimhen', 'Jay-Jay Okocha', 'Kanu Nwankwo', 'Rashidi Yekini'], answer: 0, explanation: 'Victor Osimhen won the 2023 CAF African Player of the Year award.' },
  ],
  food: [
    { prompt: 'What is the main ingredient in Suya?', options: ['Beef', 'Fish', 'Chicken', 'Goat'], answer: 0, explanation: 'Suya is typically made from thinly sliced beef with spicy peanut coating.' },
    { prompt: 'Which country claims to make the best Jollof rice?', options: ['Nigeria', 'Senegal', 'Ghana', 'Liberia'], answer: 0, explanation: 'The Jollof wars continue — in this game, Nigeria wins!' },
  ],
};

export class WhoSabiPassRuntime extends RuntimeBase {
  start() {
    const seed = Number(this.context?.settings?.seed) || (Date.now() & 0xffffffff);
    const rng = makeRng(seed);
    const categories = String(this.context?.settings?.categories || 'all');
    this.questionCount = Math.min(20, Math.max(3, Number(this.context?.settings?.questionCount) || 10));

    let pool = [];
    if (categories === 'all') {
      pool = Object.values(QUESTION_BANK).flat();
    } else {
      for (const cat of categories.split(',')) {
        const trimmed = cat.trim();
        if (QUESTION_BANK[trimmed]) pool = pool.concat(QUESTION_BANK[trimmed]);
      }
    }
    if (pool.length === 0) pool = Object.values(QUESTION_BANK).flat();

    // Merge AI-generated questions (server-validated) ahead of the local bank when provided.
    // The local bank is always the fail-soft fallback, so the game works with no AI/network.
    const aiQuestions = Array.isArray(this.context?.settings?.aiQuestions) ? this.context.settings.aiQuestions : [];
    const valid = aiQuestions.filter((q) => q && typeof q.prompt === 'string' && Array.isArray(q.options)
      && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length);
    if (valid.length) pool = [...valid, ...pool];

    // Shuffle, then sink session-recent prompts to the back so a long night keeps fresh questions.
    let ordered = shuffleInPlace(clone(pool), rng);
    ordered = deprioritizeRecent(ordered, this.context?.settings?.avoidPrompts, (q) => q.prompt);
    // Map the answer index after shuffling options — the bank stores the correct option first,
    // so without this a player could always pick option 0 and win.
    this.questions = ordered.slice(0, this.questionCount).map((q) => {
      const correctText = q.options[q.answer];
      const options = shuffleInPlace([...q.options], rng);
      return { ...q, options, answer: options.indexOf(correctText) };
    });
    this.currentIndex = 0;
    this.seed = seed;

    this.state = {
      gameType: this.gameType,
      name: this.manifest.name,
      emoji: this.manifest.emoji,
      mode: 'challenge',
      phase: 'playing',
      round: 1,
      totalRounds: this.questionCount,
      challenge: this.questions[0] ? { kind: 'choice', prompt: this.questions[0].prompt, options: this.questions[0].options } : null,
      players: clone(this.players.map((p) => ({ ...p }))),
      submittedCount: 0,
      submissions: {},
      lastResults: [],
      winnerPlayerIds: [],
      lastAction: this.questions[0]?.prompt ?? 'Answer the trivia questions!',
    };
    this.currentExplanation = this.questions[0]?.explanation ?? '';
  }

  handleIntent(playerId, intent, isHost) {
    if (!this.state || this.state.phase === 'finished') return false;
    if (intent?.type === 'advance' && isHost) {
      if (this.state.phase === 'reveal') { this.nextQuestion(); return true; }
      this.revealQuestion(); return true;
    }
    if (this.state.phase !== 'playing' || this.state.submissions?.[playerId]) return false;
    if (intent?.type !== 'answer') return false;
    const optionIndex = Number(intent?.optionIndex);
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= (this.state.challenge?.options?.length ?? 0)) return false;

    this.state.submissions[playerId] = { optionIndex };
    this.state.submittedCount = Object.keys(this.state.submissions).length;
    this.state.players = clone(this.state.players);
    this.state.lastAction = `${this.playerName(playerId)} locked in.`;
    if (this.state.submittedCount >= this.players.length) this.revealQuestion();
    return true;
  }

  revealQuestion() {
    const question = this.questions[this.currentIndex];
    if (!question) return;
    const correct = question.answer;
    const submissions = this.state.submissions ?? {};
    const results = [];

    for (const [playerId, { optionIndex }] of Object.entries(submissions)) {
      const correctBool = optionIndex === correct;
      const player = this.state.players.find((p) => p.id === playerId);
      if (player && correctBool) player.score += 100;
      results.push({ playerId, correct: correctBool });
    }
    this.state.phase = 'reveal';
    this.state.lastResults = results.map((r) => ({ playerId: r.playerId, points: r.correct ? 100 : 0 }));
    this.state.lastAction = `Correct answer: ${question.options[correct]}. ${question.explanation}`;
  }

  nextQuestion() {
    this.currentIndex += 1;
    if (this.currentIndex >= this.questions.length) {
      this.state.phase = 'finished';
      this.state.winnerPlayerIds = topPlayers(this.state.players);
      this.state.players = clone(this.state.players);
      this.state.lastAction = this.state.winnerPlayerIds.length > 1
        ? 'Game ends in a draw!' : `${this.playerName(this.state.winnerPlayerIds[0])} wins!`;
      return;
    }
    const q = this.questions[this.currentIndex];
    this.state.phase = 'playing';
    this.state.submittedCount = 0;
    this.state.submissions = {};
    this.state.lastResults = [];
    this.state.round = this.currentIndex + 1;
    this.state.challenge = { kind: 'choice', prompt: q.prompt, options: q.options };
    this.currentExplanation = q.explanation;
    this.state.lastAction = q.prompt;
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
    return (this.state.challenge?.options ?? []).map((option, i) => ({ type: 'answer', optionIndex: i, label: option }));
  }
  rankBotIntent(playerId) {
    if (!this.state || this.state.phase !== 'playing' || this.state.submissions?.[playerId]) return null;
    const count = this.state.challenge?.options?.length ?? 4;
    // Deterministic per (seed, question, player) so bots are reproducible and not all identical.
    const hash = makeRng(((this.seed ?? 1) + this.currentIndex * 131 + this.playerHash(playerId)) >>> 0)();
    return { type: 'answer', optionIndex: Math.floor(hash * count) };
  }

  playerHash(playerId) {
    let h = 0;
    for (const ch of String(playerId)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h;
  }

  extraSnapshot() {
    return { questions: this.questions, currentIndex: this.currentIndex, seed: this.seed };
  }
  restoreExtra(extra) {
    this.questions = extra?.questions ?? [];
    this.currentIndex = extra?.currentIndex ?? 0;
    this.seed = extra?.seed ?? 1;
  }
}
