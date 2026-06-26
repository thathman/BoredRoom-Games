// ChallengeRuntime — transitional generic runtime for content-based games.
// Used by: bible-timeline, color-wahala, faith-feud, half-half, hustle,
//          landlord, logo, market-price, pidgin-translator, trivia, word-wahala
//
// NOTE: Each of these games should get its own proper runtime (GOAL2.md).
// This is kept for backward compatibility until all games are rebuilt.

import { RuntimeBase, clone, normalize, topPlayers } from '../helpers.js';

export const CHALLENGE_DEFINITIONS = {
  'bible-timeline': {
    mode: 'timeline',
    rules: 'Arrange Bible events from earliest to latest. Adjacent order and exact position both score.',
    kind: 'order',
    rounds: [
      { prompt: 'Put these events in order', options: ['Creation', 'The Exodus', 'David becomes king', 'The Crucifixion'], answer: [0, 1, 2, 3] },
      { prompt: 'Put these events in order', options: ['Noah and the flood', 'Solomon builds the temple', 'Babylonian exile', 'Pentecost'], answer: [0, 1, 2, 3] },
    ],
  },
  'color-wahala': {
    mode: 'reaction',
    rules: 'Read the instruction, ignore the distraction, and tap the correct colour before the house catches you slipping.',
    kind: 'choice',
    rounds: [
      { prompt: 'Tap the colour of the Nigerian flag', options: ['Green', 'Purple', 'Orange', 'Blue'], answer: 0 },
      { prompt: 'The word says PURPLE. Tap the ink colour.', options: ['Green', 'Purple', 'Yellow', 'Red'], answer: 1 },
    ],
  },
  'faith-feud': {
    mode: 'survey',
    rules: 'Guess survey answers. Common church answers score higher than rare misses.',
    kind: 'text',
    rounds: [
      { prompt: 'Name a fruit of the Spirit', answers: ['love', 'joy', 'peace', 'patience'], weights: { love: 100, joy: 85, peace: 70, patience: 55 } },
      { prompt: 'Name something people bring to church', answers: ['bible', 'offering', 'money', 'notebook', 'water'], weights: { bible: 100, offering: 90, money: 75, notebook: 60, water: 45 } },
    ],
  },
  'half-half': {
    mode: 'duel',
    rules: 'Pick a side and defend it. Correct house-side calls earn the round.',
    kind: 'choice',
    rounds: [
      { prompt: 'Which side gets the point: Jollof or Fried Rice?', options: ['Jollof', 'Fried Rice'], answer: 0 },
      { prompt: 'Which side gets the point: Afrobeats or Highlife?', options: ['Afrobeats', 'Highlife'], answer: 1 },
    ],
  },
  hustle: {
    mode: 'business',
    rules: 'Make business moves, manage pressure, and build the highest hustle score.',
    kind: 'choice',
    rounds: [
      { prompt: 'Your first customer wants a discount. What do you do?', options: ['Small discount', 'Refuse', 'Add value', 'Double price'], answer: 2 },
      { prompt: 'Demand suddenly rises. What is the best move?', options: ['Restock', 'Close shop', 'Ignore it', 'Give everything away'], answer: 0 },
    ],
  },
  landlord: {
    mode: 'property',
    rules: 'Buy smart property, collect rent, and survive Lagos landlord wahala.',
    kind: 'choice',
    rounds: [
      { prompt: 'You land on an available Lagos property', options: ['Buy', 'Pass', 'Borrow', 'Quit'], answer: 0 },
      { prompt: 'Rent is due and cash is tight', options: ['Mortgage', 'Ignore', 'Pay correctly', 'Leave the table'], answer: 2 },
    ],
  },
  logo: {
    mode: 'recognition',
    rules: 'Identify Nigerian brands and Lagos landmarks from clues.',
    kind: 'choice',
    rounds: [
      { prompt: 'Which Nigerian brand uses a red circular wordmark?', options: ['Glo', 'Airtel', 'MTN', 'Kuda'], answer: 1 },
      { prompt: 'Which landmark is the tall Lagos communications tower?', options: ['NECOM House', 'National Theatre', 'Civic Centre', 'Tafawa Balewa Square'], answer: 0 },
    ],
  },
  'market-price': {
    mode: 'estimate',
    rules: 'Guess Lagos market prices. Closer estimates earn more points.',
    kind: 'number',
    rounds: [
      { prompt: '50kg bag of rice', answer: 78000, tolerance: 0.35 },
      { prompt: '5L vegetable oil', answer: 14500, tolerance: 0.35 },
      { prompt: 'A tuber of yam', answer: 4200, tolerance: 0.4 },
    ],
  },
  'pidgin-translator': {
    mode: 'translation',
    rules: 'Translate English and Nigerian Pidgin phrases without losing the meaning.',
    kind: 'choice',
    rounds: [
      { prompt: 'Translate "How are you?"', options: ['How you dey?', 'Wetin be dat?', 'No wahala'], answer: 0 },
      { prompt: 'Translate "I am coming"', options: ['I don reach', 'I dey come', 'I no sabi'], answer: 1 },
    ],
  },
  trivia: {
    mode: 'quiz',
    rules: 'Answer Nigerian culture, geography, history, music and film questions.',
    kind: 'choice',
    rounds: [
      { prompt: 'What is the capital of Nigeria?', options: ['Lagos', 'Abuja', 'Kano', 'Port Harcourt'], answer: 1 },
      { prompt: 'Nigeria gained independence in which year?', options: ['1957', '1960', '1963', '1966'], answer: 1 },
      { prompt: 'How many states does Nigeria have?', options: ['30', '36', '37', '40'], answer: 1 },
    ],
  },
  'word-wahala': {
    mode: 'word',
    rules: 'Solve word clues, submit real words, and score before the table catches up.',
    kind: 'text',
    rounds: [
      { prompt: 'Unscramble: SOGAL', answers: ['lagos'] },
      { prompt: 'Nigerian word for traffic congestion', answers: ['go slow', 'go-slow'] },
    ],
  },
};

export class ChallengeRuntime extends RuntimeBase {
  constructor(manifest, definition) {
    super(manifest);
    this.definition = definition;
    this.submissions = {};
  }

  start() {
    this.state = {
      gameType: this.gameType,
      name: this.manifest.name,
      emoji: this.manifest.emoji,
      mode: this.definition.mode,
      phase: 'playing',
      round: 1,
      totalRounds: this.definition.rounds.length,
      challenge: this.publicChallenge(0),
      players: clone(this.players),
      submittedCount: 0,
      lastResults: [],
      winnerPlayerIds: [],
      lastAction: `${this.manifest.name} started.`,
    };
    this.submissions = {};
  }

  publicChallenge(index) {
    const round = this.definition.rounds[index];
    if (!round) return null;
    return { kind: this.definition.kind, prompt: round.prompt, options: Array.isArray(round.options) ? clone(round.options) : undefined };
  }

  handleIntent(playerId, intent, isHost) {
    if (!this.state || this.state.phase === 'finished') return false;
    if (intent?.type === 'advance' && isHost) {
      if (this.state.phase === 'playing') this.resolveRound();
      else this.nextRound();
      return true;
    }
    if (this.state.phase !== 'playing' || !this.seated(playerId) || this.submissions[playerId] !== undefined) return false;
    const kind = this.definition.kind;
    let value;
    if (kind === 'choice' && Number.isInteger(intent?.optionIndex)) value = Number(intent.optionIndex);
    else if (kind === 'number' && Number.isFinite(Number(intent?.amount))) value = Number(intent.amount);
    else if (kind === 'text' && typeof intent?.text === 'string' && intent.text.trim()) value = intent.text.trim();
    else if (kind === 'order' && Array.isArray(intent?.orderedIndexes)) value = intent.orderedIndexes.map(Number);
    else return false;
    this.submissions[playerId] = value;
    this.state.submittedCount = Object.keys(this.submissions).length;
    this.state.lastAction = `${this.players.find((player) => player.id === playerId)?.name ?? 'A player'} locked in.`;
    if (this.state.submittedCount >= this.players.length) this.resolveRound();
    return true;
  }

  scoreSubmission(round, value) {
    if (this.definition.kind === 'choice') return value === round.answer ? 100 : 0;
    if (this.definition.kind === 'text') {
      const answer = normalize(value);
      if (!round.answers.includes(answer)) return 0;
      return round.weights?.[answer] ?? 100;
    }
    if (this.definition.kind === 'number') {
      const error = Math.abs(Number(value) - round.answer) / Math.max(1, round.answer);
      return Math.max(0, Math.round(100 * (1 - error / round.tolerance)));
    }
    if (this.definition.kind === 'order') {
      const submitted = Array.isArray(value) ? value : [];
      const exact = round.answer.reduce((score, expected, index) => score + (submitted[index] === expected ? 20 : 0), 0);
      const adjacent = submitted.slice(0, -1).reduce((score, item, index) => {
        const left = round.answer.indexOf(item);
        const right = round.answer.indexOf(submitted[index + 1]);
        return score + (right === left + 1 ? 5 : 0);
      }, 0);
      return exact + adjacent;
    }
    return 0;
  }

  resolveRound() {
    const round = this.definition.rounds[this.state.round - 1];
    const results = this.players.map((player) => {
      const points = this.scoreSubmission(round, this.submissions[player.id]);
      player.score += points;
      return { playerId: player.id, points };
    });
    this.state.players = clone(this.players);
    this.state.lastResults = results;
    this.state.phase = 'reveal';
    this.state.lastAction = 'Answers revealed.';
  }

  nextRound() {
    if (this.state.round >= this.definition.rounds.length) {
      this.state.phase = 'finished';
      this.state.winnerPlayerIds = topPlayers(this.players);
      this.state.challenge = null;
      this.state.lastAction = 'Game complete.';
      return;
    }
    this.state.round += 1;
    this.state.phase = 'playing';
    this.state.challenge = this.publicChallenge(this.state.round - 1);
    this.state.submittedCount = 0;
    this.state.lastResults = [];
    this.state.lastAction = `Round ${this.state.round} started.`;
    this.submissions = {};
  }

  publicState() { return clone(this.state); }

  privateState(playerId) {
    return {
      seated: this.seated(playerId),
      submitted: this.submissions[playerId] !== undefined,
      submission: clone(this.submissions[playerId]),
      legalIntents: this.legalIntents(playerId),
    };
  }

  legalIntents(playerId) {
    if (!this.state || this.state.phase !== 'playing' || !this.seated(playerId) || this.submissions[playerId] !== undefined) return [];
    if (this.definition.kind === 'choice') return (this.state.challenge?.options ?? []).map((_, optionIndex) => ({ type: 'answer', optionIndex, label: this.state.challenge.options[optionIndex] }));
    if (this.definition.kind === 'number') return [{ type: 'guess', amount: this.definition.rounds[this.state.round - 1].answer, label: 'Submit estimate' }];
    if (this.definition.kind === 'text') return [{ type: 'answer_text', text: this.definition.rounds[this.state.round - 1].answers[0], label: 'Submit answer' }];
    if (this.definition.kind === 'order') return [{ type: 'submit_order', orderedIndexes: clone(this.definition.rounds[this.state.round - 1].answer), label: 'Submit order' }];
    return [];
  }

  extraSnapshot() { return { submissions: this.submissions }; }
  restoreExtra(extra) { this.submissions = extra?.submissions ?? {}; }
}
