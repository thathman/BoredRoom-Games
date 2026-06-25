const GAME_DEFINITIONS = {
  'bible-timeline': {
    rules: 'Arrange the events from earliest to latest. Correct adjacent pairs earn points.',
    kind: 'order',
    rounds: [
      { prompt: 'Put these events in order', options: ['Creation', 'The Exodus', 'David becomes king', 'The Crucifixion'], answer: [0, 1, 2, 3] },
      { prompt: 'Put these events in order', options: ['Noah and the flood', 'Solomon builds the temple', 'Babylonian exile', 'Pentecost'], answer: [0, 1, 2, 3] },
    ],
  },
  'color-wahala': {
    rules: 'Match the displayed colour instruction before the other players.',
    kind: 'choice',
    rounds: [
      { prompt: 'Tap the colour of the Nigerian flag', options: ['Green', 'Purple', 'Orange', 'Blue'], answer: 0 },
      { prompt: 'Tap the colour named: PURPLE', options: ['Green', 'Purple', 'Yellow', 'Red'], answer: 1 },
    ],
  },
  'connect-4': {
    rules: 'Choose a column. Four connected counters wins the round.',
    kind: 'choice',
    rounds: [
      { prompt: 'Choose your opening column', options: ['1', '2', '3', '4', '5', '6', '7'], answer: 3 },
      { prompt: 'Block the centre threat', options: ['1', '2', '3', '4', '5', '6', '7'], answer: 3 },
    ],
  },
  ettt: {
    rules: 'Win local boards to claim squares on the ultimate board.',
    kind: 'choice',
    rounds: [
      { prompt: 'Choose a square', options: ['Top left', 'Top', 'Top right', 'Left', 'Centre', 'Right', 'Bottom left', 'Bottom', 'Bottom right'], answer: 4 },
      { prompt: 'Choose the strongest follow-up', options: ['Corner', 'Edge', 'Centre'], answer: 0 },
    ],
  },
  'faith-feud': {
    rules: 'Guess the most popular survey answers before the house runs out of strikes.',
    kind: 'text',
    rounds: [
      { prompt: 'Name a fruit of the Spirit', answers: ['love', 'joy', 'peace', 'patience'] },
      { prompt: 'Name something people bring to church', answers: ['bible', 'offering', 'money', 'notebook', 'water'] },
    ],
  },
  'half-half': {
    rules: 'Choose between two categories, then answer the challenge for that side.',
    kind: 'choice',
    rounds: [
      { prompt: 'Which side gets the point: Jollof or Fried Rice?', options: ['Jollof', 'Fried Rice'], answer: 0 },
      { prompt: 'Which side gets the point: Afrobeats or Highlife?', options: ['Afrobeats', 'Highlife'], answer: 1 },
    ],
  },
  hustle: {
    rules: 'Make the best business decision and finish with the highest score.',
    kind: 'choice',
    rounds: [
      { prompt: 'Your first customer wants a discount. What do you do?', options: ['Small discount', 'Refuse', 'Add value', 'Double price'], answer: 2 },
      { prompt: 'Demand suddenly rises. What is the best move?', options: ['Restock', 'Close shop', 'Ignore it', 'Give everything away'], answer: 0 },
    ],
  },
  landlord: {
    rules: 'Buy property, collect rent and protect your cash.',
    kind: 'choice',
    rounds: [
      { prompt: 'You land on an available Lagos property', options: ['Buy', 'Pass', 'Borrow', 'Quit'], answer: 0 },
      { prompt: 'Rent is due and cash is tight', options: ['Mortgage', 'Ignore', 'Pay correctly', 'Leave the table'], answer: 2 },
    ],
  },
  logo: {
    rules: 'Identify the brand or landmark from the clue.',
    kind: 'choice',
    rounds: [
      { prompt: 'Which Nigerian brand uses a red circular wordmark?', options: ['Glo', 'Airtel', 'MTN', 'Kuda'], answer: 1 },
      { prompt: 'Which landmark is the tall Lagos communications tower?', options: ['NECOM House', 'National Theatre', 'Civic Centre', 'Tafawa Balewa Square'], answer: 0 },
    ],
  },
  ludo: {
    rules: 'Move every token from the yard to home. Captures and safe squares matter.',
    kind: 'choice',
    rounds: [
      { prompt: 'You rolled a six. Choose a move', options: ['Bring out a token', 'Move a home token', 'Skip'], answer: 0 },
      { prompt: 'A capture is available', options: ['Capture', 'Play safe', 'Move another token'], answer: 0 },
    ],
  },
  'market-price': {
    rules: 'Guess the Lagos market price. The closest estimate earns the most points.',
    kind: 'number',
    rounds: [
      { prompt: '50kg bag of rice', answer: 78000, tolerance: 0.35 },
      { prompt: '5L vegetable oil', answer: 14500, tolerance: 0.35 },
      { prompt: 'A tuber of yam', answer: 4200, tolerance: 0.4 },
    ],
  },
  'pidgin-translator': {
    rules: 'Translate between English and Nigerian Pidgin.',
    kind: 'choice',
    rounds: [
      { prompt: 'Translate “How are you?”', options: ['How you dey?', 'Wetin be dat?', 'No wahala'], answer: 0 },
      { prompt: 'Translate “I am coming”', options: ['I don reach', 'I dey come', 'I no sabi'], answer: 1 },
    ],
  },
  trivia: {
    rules: 'Answer Nigerian culture, history, geography, music and film questions.',
    kind: 'choice',
    rounds: [
      { prompt: 'What is the capital of Nigeria?', options: ['Lagos', 'Abuja', 'Kano', 'Port Harcourt'], answer: 1 },
      { prompt: 'Nigeria gained independence in which year?', options: ['1957', '1960', '1963', '1966'], answer: 1 },
      { prompt: 'How many states does Nigeria have?', options: ['30', '36', '37', '40'], answer: 1 },
    ],
  },
  whot: {
    rules: 'Match shape or number, stack valid pick cards and announce the last card.',
    kind: 'choice',
    rounds: [
      { prompt: 'Top card is Circle 7. Choose a legal play', options: ['Circle 3', 'Triangle 4', 'Cross 9', 'Square 1'], answer: 0 },
      { prompt: 'A Pick Two is active. Choose a response', options: ['Stack Pick Two', 'Play Suspension', 'Call a shape', 'Pass silently'], answer: 0 },
    ],
  },
  'word-wahala': {
    rules: 'Solve the word clue before the other players.',
    kind: 'text',
    rounds: [
      { prompt: 'Unscramble: SOGAL', answers: ['lagos'] },
      { prompt: 'Nigerian word for traffic congestion', answers: ['go slow', 'go-slow'] },
    ],
  },
};

function clone(value) {
  return structuredClone(value);
}

class InstalledGameRuntime {
  constructor(manifest) {
    this.gameType = manifest.id;
    this.manifest = manifest;
    this.definition = GAME_DEFINITIONS[manifest.id];
    if (!this.definition) throw new Error('game_definition_missing');
    this.context = null;
    this.players = [];
    this.state = null;
    this.submissions = {};
  }

  get metadata() {
    return {
      gameType: this.gameType,
      capabilities: {
        playerCount: { min: this.manifest.minPlayers, max: this.manifest.maxPlayers },
        bots: this.manifest.capabilities.bots,
        audience: this.manifest.capabilities.audience,
        hints: this.manifest.capabilities.hints,
        voice: false,
        restore: this.manifest.capabilities.restore,
      },
      rules: this.manifest.rules,
    };
  }

  configure(context) {
    this.context = clone(context);
  }

  seatPlayers(players) {
    this.players = players.slice(0, this.manifest.maxPlayers).map((player) => ({
      id: player.id,
      name: player.name,
      score: 0,
    }));
    if (this.context?.settings?.allowBots && this.manifest.capabilities.bots) {
      while (this.players.length < this.manifest.minPlayers) {
        const number = this.players.length + 1;
        this.players.push({ id: `bot-${number}`, name: `Bot ${number}`, score: 0, bot: true });
      }
    }
  }

  start() {
    this.state = {
      gameType: this.gameType,
      name: this.manifest.name,
      emoji: this.manifest.emoji,
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
    this.runBots();
  }

  publicChallenge(index) {
    const round = this.definition.rounds[index];
    if (!round) return null;
    return {
      kind: this.definition.kind,
      prompt: round.prompt,
      options: Array.isArray(round.options) ? clone(round.options) : undefined,
    };
  }

  handleIntent(playerId, intent, isHost) {
    if (!this.state || this.state.phase === 'finished') return false;
    if (intent?.type === 'advance' && isHost) {
      if (this.state.phase === 'playing') {
        this.resolveRound();
      } else {
        this.nextRound();
      }
      return true;
    }
    if (this.state.phase !== 'playing' || !this.players.some((player) => player.id === playerId)) return false;
    if (this.submissions[playerId] !== undefined) return false;
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
      const normalized = String(value).trim().toLowerCase();
      return round.answers.includes(normalized) ? 100 : 0;
    }
    if (this.definition.kind === 'number') {
      const error = Math.abs(Number(value) - round.answer) / Math.max(1, round.answer);
      return Math.max(0, Math.round(100 * (1 - error / round.tolerance)));
    }
    if (this.definition.kind === 'order') {
      const submitted = Array.isArray(value) ? value : [];
      return round.answer.reduce((score, expected, index) => score + (submitted[index] === expected ? 25 : 0), 0);
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
      const top = Math.max(0, ...this.players.map((player) => player.score));
      this.state.phase = 'finished';
      this.state.winnerPlayerIds = this.players.filter((player) => player.score === top).map((player) => player.id);
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
    this.runBots();
  }

  runBots() {
    for (const player of this.players.filter((candidate) => candidate.bot)) {
      const round = this.definition.rounds[this.state.round - 1];
      if (this.definition.kind === 'choice') this.submissions[player.id] = round.answer;
      if (this.definition.kind === 'number') this.submissions[player.id] = round.answer;
      if (this.definition.kind === 'text') this.submissions[player.id] = round.answers[0];
      if (this.definition.kind === 'order') this.submissions[player.id] = clone(round.answer);
    }
    this.state.submittedCount = Object.keys(this.submissions).length;
  }

  publicState() {
    return clone(this.state);
  }

  privateState(playerId) {
    const seated = this.players.some((player) => player.id === playerId);
    return {
      seated,
      submitted: this.submissions[playerId] !== undefined,
      submission: clone(this.submissions[playerId]),
      legalIntents: this.legalIntents(playerId),
    };
  }

  companionState() {
    return this.publicState();
  }

  crowdState() {
    const state = this.publicState();
    return { ...state, players: state.players.map(({ id, name, score }) => ({ id, name, score })) };
  }

  snapshot() {
    return clone({
      context: this.context,
      players: this.players,
      state: this.state,
      submissions: this.submissions,
    });
  }

  restore(snapshot) {
    this.context = clone(snapshot.context);
    this.players = clone(snapshot.players);
    this.state = clone(snapshot.state);
    this.submissions = clone(snapshot.submissions);
  }

  legalIntents(playerId) {
    if (
      !this.state
      || this.state.phase !== 'playing'
      || !this.players.some((player) => player.id === playerId)
      || this.submissions[playerId] !== undefined
    ) return [];
    if (this.definition.kind === 'choice') {
      return (this.state.challenge?.options ?? []).map((_, optionIndex) => ({ type: 'answer', optionIndex }));
    }
    if (this.definition.kind === 'number') return [{ type: 'guess', amount: 'number' }];
    if (this.definition.kind === 'text') return [{ type: 'answer_text', text: 'string' }];
    if (this.definition.kind === 'order') return [{ type: 'submit_order', orderedIndexes: 'number[]' }];
    return [];
  }

  explainIntent(intent) {
    return `The ${String(intent?.type ?? 'unknown')} action is checked against ${this.manifest.name} rules before it is accepted.`;
  }

  recapSignals() {
    return {
      rounds: this.state?.round ?? 0,
      scores: this.players.map((player) => ({ playerId: player.id, score: player.score })),
    };
  }

  finish() {
    if (this.state?.phase !== 'finished') {
      const top = Math.max(0, ...this.players.map((player) => player.score));
      this.state.phase = 'finished';
      this.state.winnerPlayerIds = this.players.filter((player) => player.score === top).map((player) => player.id);
    }
    return { winnerPlayerIds: clone(this.state?.winnerPlayerIds ?? []) };
  }

  dispose() {
    this.context = null;
    this.players = [];
    this.state = null;
    this.submissions = {};
  }
}

export function createPlugin(manifest) {
  return {
    id: manifest.id,
    version: manifest.version,
    createRuntime: () => new InstalledGameRuntime(manifest),
  };
}
