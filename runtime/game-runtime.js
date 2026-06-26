const CHALLENGE_DEFINITIONS = {
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
      { prompt: 'Translate “How are you?”', options: ['How you dey?', 'Wetin be dat?', 'No wahala'], answer: 0 },
      { prompt: 'Translate “I am coming”', options: ['I don reach', 'I dey come', 'I no sabi'], answer: 1 },
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

const WHOT_SHAPES = ['Circle', 'Triangle', 'Cross', 'Square', 'Star'];
const WHOT_DECK = [
  ['Circle', 7], ['Circle', 3], ['Triangle', 7], ['Cross', 9], ['Square', 1], ['Star', 14],
  ['Triangle', 2], ['Cross', 2], ['Square', 5], ['Circle', 14], ['Star', 8], ['Triangle', 4],
  ['Cross', 7], ['Square', 2], ['Circle', 1], ['Star', 20], ['Triangle', 14], ['Cross', 5],
].map(([shape, number], index) => ({
  id: `c${index + 1}`,
  shape,
  number,
  label: Number(number) === 20 ? 'Whot 20' : `${shape} ${number}`,
  isWhot: Number(number) === 20,
}));

function clone(value) {
  return structuredClone(value);
}

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

function topPlayers(players) {
  const top = Math.max(0, ...players.map((player) => player.score ?? 0));
  return players.filter((player) => (player.score ?? 0) === top).map((player) => player.id);
}

class RuntimeBase {
  constructor(manifest) {
    this.gameType = manifest.id;
    this.manifest = manifest;
    this.context = null;
    this.players = [];
    this.state = null;
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
    this.players = players.slice(0, this.manifest.maxPlayers).map((player, index) => ({
      id: player.id,
      name: player.name,
      score: 0,
      seat: index,
    }));
    if (this.context?.settings?.allowBots && this.manifest.capabilities.bots) {
      while (this.players.length < this.manifest.minPlayers) {
        const number = this.players.length + 1;
        this.players.push({ id: `bot-${number}`, name: `Bot ${number}`, score: 0, seat: number - 1, bot: true });
      }
    }
  }

  seated(playerId) {
    return this.players.some((player) => player.id === playerId);
  }

  companionState() {
    return this.publicState();
  }

  crowdState() {
    const state = this.publicState();
    return { ...state, private: undefined };
  }

  snapshot() {
    return clone({ context: this.context, players: this.players, state: this.state, extra: this.extraSnapshot?.() });
  }

  restore(snapshot) {
    this.context = clone(snapshot.context);
    this.players = clone(snapshot.players);
    this.state = clone(snapshot.state);
    this.restoreExtra?.(clone(snapshot.extra));
  }

  finish() {
    if (this.state && this.state.phase !== 'finished') {
      this.state.phase = 'finished';
      this.state.winnerPlayerIds = topPlayers(this.players);
      this.state.lastAction = 'Game complete.';
    }
    return { winnerPlayerIds: clone(this.state?.winnerPlayerIds ?? []) };
  }

  dispose() {
    this.context = null;
    this.players = [];
    this.state = null;
  }

  explainIntent(intent) {
    return `${this.manifest.name} rejected ${String(intent?.type ?? 'that action')} because it is not legal in the current state.`;
  }

  recapSignals() {
    return { mode: this.state?.mode, scores: this.players.map(({ id, score }) => ({ playerId: id, score })) };
  }
}

class ChallengeRuntime extends RuntimeBase {
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

  publicState() {
    return clone(this.state);
  }

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

  extraSnapshot() {
    return { submissions: this.submissions };
  }

  restoreExtra(extra) {
    this.submissions = extra?.submissions ?? {};
  }
}

class Connect4Runtime extends RuntimeBase {
  start() {
    this.state = {
      gameType: this.gameType,
      name: this.manifest.name,
      emoji: this.manifest.emoji,
      mode: 'connect4',
      phase: 'playing',
      board: Array.from({ length: 6 }, () => Array(7).fill(null)),
      players: clone(this.players.map((player, index) => ({ ...player, disc: index === 0 ? 'G' : index === 1 ? 'P' : 'Y' }))),
      currentPlayerId: this.players[0]?.id,
      moveCount: 0,
      winningCells: [],
      winnerPlayerIds: [],
      lastAction: 'Drop a counter into any open column.',
    };
  }

  handleIntent(playerId, intent) {
    if (!this.state || this.state.phase !== 'playing' || this.state.currentPlayerId !== playerId) return false;
    const column = Number(intent?.column ?? intent?.col);
    if (intent?.type !== 'drop' && intent?.type !== 'connect4:drop') return false;
    if (!Number.isInteger(column) || column < 0 || column > 6) return false;
    const row = [...this.state.board].reverse().findIndex((candidate) => candidate[column] == null);
    if (row < 0) return false;
    const actualRow = 5 - row;
    const player = this.state.players.find((candidate) => candidate.id === playerId);
    this.state.board[actualRow][column] = player.disc;
    this.state.moveCount += 1;
    const win = this.findWin(actualRow, column, player.disc);
    if (win.length) {
      player.score += 1;
      this.state.players = clone(this.state.players);
      this.state.phase = 'finished';
      this.state.winnerPlayerIds = [playerId];
      this.state.winningCells = win;
      this.state.lastAction = `${player.name} connected four.`;
      return true;
    }
    if (this.state.moveCount >= 42) {
      this.state.phase = 'finished';
      this.state.winnerPlayerIds = topPlayers(this.state.players);
      this.state.lastAction = 'Board full. Draw.';
      return true;
    }
    const next = (this.players.findIndex((candidate) => candidate.id === playerId) + 1) % this.players.length;
    this.state.currentPlayerId = this.players[next].id;
    this.state.lastAction = `${player.name} dropped in column ${column + 1}.`;
    return true;
  }

  findWin(row, col, disc) {
    const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
    for (const [dr, dc] of directions) {
      const cells = [[row, col]];
      for (const sign of [-1, 1]) {
        let r = row + dr * sign;
        let c = col + dc * sign;
        while (this.state.board[r]?.[c] === disc) {
          cells.push([r, c]);
          r += dr * sign;
          c += dc * sign;
        }
      }
      if (cells.length >= 4) return cells.slice(0, 4).map(([r, c]) => ({ row: r, column: c }));
    }
    return [];
  }

  publicState() { return clone(this.state); }
  privateState(playerId) { return { seated: this.seated(playerId), isTurn: this.state?.currentPlayerId === playerId, legalIntents: this.legalIntents(playerId) }; }
  legalIntents(playerId) {
    if (!this.state || this.state.phase !== 'playing' || this.state.currentPlayerId !== playerId) return [];
    return this.state.board[0].map((cell, column) => cell == null ? { type: 'drop', column, label: `Column ${column + 1}` } : null).filter(Boolean);
  }
}

class EtttRuntime extends RuntimeBase {
  start() {
    this.state = {
      gameType: this.gameType,
      name: this.manifest.name,
      emoji: this.manifest.emoji,
      mode: 'ettt',
      phase: 'playing',
      board: Array.from({ length: 3 }, () => Array(3).fill(null)),
      players: clone(this.players.map((player, index) => ({ ...player, mark: index === 0 ? 'X' : 'O' }))),
      currentPlayerId: this.players[0]?.id,
      moveCount: 0,
      winnerPlayerIds: [],
      lastAction: 'Claim three in a row.',
    };
  }

  handleIntent(playerId, intent) {
    if (!this.state || this.state.phase !== 'playing' || this.state.currentPlayerId !== playerId) return false;
    if (intent?.type !== 'place' && intent?.type !== 'ettt:place') return false;
    const cell = Number(intent?.cell);
    if (!Number.isInteger(cell) || cell < 0 || cell > 8) return false;
    const row = Math.floor(cell / 3);
    const col = cell % 3;
    if (this.state.board[row][col] != null) return false;
    const player = this.state.players.find((candidate) => candidate.id === playerId);
    this.state.board[row][col] = player.mark;
    this.state.moveCount += 1;
    const win = this.checkWin(player.mark);
    if (win) {
      player.score += 1;
      this.state.players = clone(this.state.players);
      this.state.phase = 'finished';
      this.state.winnerPlayerIds = [playerId];
      this.state.winningCells = win;
      this.state.lastAction = `${player.name} won the board.`;
      return true;
    }
    if (this.state.moveCount >= 9) {
      this.state.phase = 'finished';
      this.state.winnerPlayerIds = topPlayers(this.state.players);
      this.state.lastAction = 'Board filled. Draw.';
      return true;
    }
    const next = (this.players.findIndex((candidate) => candidate.id === playerId) + 1) % this.players.length;
    this.state.currentPlayerId = this.players[next].id;
    this.state.lastAction = `${player.name} claimed square ${cell + 1}.`;
    return true;
  }

  checkWin(mark) {
    const lines = [
      [[0, 0], [0, 1], [0, 2]], [[1, 0], [1, 1], [1, 2]], [[2, 0], [2, 1], [2, 2]],
      [[0, 0], [1, 0], [2, 0]], [[0, 1], [1, 1], [2, 1]], [[0, 2], [1, 2], [2, 2]],
      [[0, 0], [1, 1], [2, 2]], [[0, 2], [1, 1], [2, 0]],
    ];
    return lines.find((line) => line.every(([r, c]) => this.state.board[r][c] === mark))?.map(([row, column]) => ({ row, column })) ?? null;
  }

  publicState() { return clone(this.state); }
  privateState(playerId) { return { seated: this.seated(playerId), isTurn: this.state?.currentPlayerId === playerId, legalIntents: this.legalIntents(playerId) }; }
  legalIntents(playerId) {
    if (!this.state || this.state.phase !== 'playing' || this.state.currentPlayerId !== playerId) return [];
    return this.state.board.flatMap((row, rowIndex) => row.map((cell, colIndex) => (
      cell == null ? { type: 'place', cell: rowIndex * 3 + colIndex, label: `Square ${rowIndex * 3 + colIndex + 1}` } : null
    ))).filter(Boolean);
  }
}

class LudoRuntime extends RuntimeBase {
  start() {
    const tokens = Object.fromEntries(this.players.map((player) => [player.id, [-1, -1, -1, -1]]));
    this.state = {
      gameType: this.gameType,
      name: this.manifest.name,
      emoji: this.manifest.emoji,
      mode: 'ludo',
      phase: 'playing',
      players: clone(this.players),
      tokens,
      currentPlayerId: this.players[0]?.id,
      pendingRoll: null,
      rollIndex: 0,
      winnerPlayerIds: [],
      lastAction: 'Roll to start. A six brings a token out.',
    };
  }

  handleIntent(playerId, intent) {
    if (!this.state || this.state.phase !== 'playing' || this.state.currentPlayerId !== playerId) return false;
    if (intent?.type === 'roll') {
      if (this.state.pendingRoll != null) return false;
      const sequence = [6, 3, 6, 4, 2, 5, 6, 1];
      this.state.pendingRoll = sequence[this.state.rollIndex % sequence.length];
      this.state.rollIndex += 1;
      this.state.lastAction = `${this.playerName(playerId)} rolled ${this.state.pendingRoll}.`;
      if (this.legalMoves(playerId).length === 0) this.advanceTurn();
      return true;
    }
    if (intent?.type !== 'move_token') return false;
    if (this.state.pendingRoll == null) return false;
    const tokenIndex = Number(intent?.tokenIndex);
    if (!this.legalMoves(playerId).some((move) => move.tokenIndex === tokenIndex)) return false;
    const tokens = this.state.tokens[playerId];
    tokens[tokenIndex] = tokens[tokenIndex] < 0 ? 0 : Math.min(57, tokens[tokenIndex] + this.state.pendingRoll);
    this.capture(playerId, tokens[tokenIndex]);
    if (tokens.every((position) => position >= 57)) {
      const player = this.players.find((candidate) => candidate.id === playerId);
      player.score += 1;
      this.state.players = clone(this.players);
      this.state.phase = 'finished';
      this.state.winnerPlayerIds = [playerId];
      this.state.lastAction = `${this.playerName(playerId)} brought every token home.`;
      return true;
    }
    const rolledSix = this.state.pendingRoll === 6;
    this.state.pendingRoll = null;
    if (!rolledSix) this.advanceTurn();
    else this.state.lastAction = `${this.playerName(playerId)} moved and keeps the turn for rolling six.`;
    return true;
  }

  playerName(playerId) { return this.players.find((player) => player.id === playerId)?.name ?? 'A player'; }
  legalMoves(playerId) {
    const roll = this.state?.pendingRoll;
    if (roll == null) return [];
    return (this.state.tokens[playerId] ?? []).map((position, tokenIndex) => {
      if (position < 0 && roll !== 6) return null;
      if (position >= 57) return null;
      if (position + roll > 57 && position >= 0) return null;
      return { type: 'move_token', tokenIndex, label: position < 0 ? `Bring out token ${tokenIndex + 1}` : `Move token ${tokenIndex + 1}` };
    }).filter(Boolean);
  }
  capture(playerId, position) {
    if (position <= 0 || [0, 8, 13, 21, 26, 34, 39, 47].includes(position)) return;
    for (const [opponentId, tokens] of Object.entries(this.state.tokens)) {
      if (opponentId === playerId) continue;
      tokens.forEach((tokenPosition, index) => { if (tokenPosition === position) tokens[index] = -1; });
    }
  }
  advanceTurn() {
    const next = (this.players.findIndex((candidate) => candidate.id === this.state.currentPlayerId) + 1) % this.players.length;
    this.state.currentPlayerId = this.players[next].id;
    this.state.pendingRoll = null;
    this.state.lastAction = `Turn passed to ${this.players[next].name}.`;
  }
  publicState() { return clone(this.state); }
  privateState(playerId) { return { seated: this.seated(playerId), isTurn: this.state?.currentPlayerId === playerId, tokens: clone(this.state?.tokens[playerId] ?? []), legalIntents: this.legalIntents(playerId) }; }
  legalIntents(playerId) {
    if (!this.state || this.state.phase !== 'playing' || this.state.currentPlayerId !== playerId) return [];
    if (this.state.pendingRoll == null) return [{ type: 'roll', label: 'Roll dice' }];
    return this.legalMoves(playerId);
  }
}

class WhotRuntime extends RuntimeBase {
  start() {
    const deck = clone(WHOT_DECK);
    const hands = {};
    for (const player of this.players) hands[player.id] = deck.splice(0, 4);
    const topCard = deck.shift();
    this.state = {
      gameType: this.gameType,
      name: this.manifest.name,
      emoji: this.manifest.emoji,
      mode: 'whot',
      phase: 'playing',
      players: clone(this.players.map((player) => ({ ...player, handCount: hands[player.id].length }))),
      topCard,
      requestedShape: null,
      drawPileCount: deck.length,
      currentPlayerId: this.players[0]?.id,
      direction: 1,
      winnerPlayerIds: [],
      lastAction: `Top card is ${topCard.label}.`,
    };
    this.hands = hands;
    this.deck = deck;
  }

  handleIntent(playerId, intent) {
    if (!this.state || this.state.phase !== 'playing' || this.state.currentPlayerId !== playerId) return false;
    if (intent?.type === 'draw') {
      const card = this.deck.shift();
      if (!card) return false;
      this.hands[playerId].push(card);
      this.state.drawPileCount = this.deck.length;
      this.updateHandCounts();
      this.advanceTurn();
      this.state.lastAction = `${this.playerName(playerId)} went to market.`;
      return true;
    }
    if (intent?.type !== 'play_card') return false;
    const cardId = String(intent?.cardId ?? '');
    const hand = this.hands[playerId] ?? [];
    const card = hand.find((candidate) => candidate.id === cardId);
    if (!card || !this.isLegalCard(card)) return false;
    this.hands[playerId] = hand.filter((candidate) => candidate.id !== cardId);
    this.state.topCard = card;
    this.state.requestedShape = card.isWhot ? String(intent?.calledShape ?? intent?.shape ?? 'Circle') : null;
    if (card.isWhot && !WHOT_SHAPES.includes(this.state.requestedShape)) return false;
    const player = this.players.find((candidate) => candidate.id === playerId);
    if (this.hands[playerId].length === 0) {
      player.score += 1;
      this.updateHandCounts();
      this.state.phase = 'finished';
      this.state.winnerPlayerIds = [playerId];
      this.state.lastAction = `${player.name} finished their hand.`;
      return true;
    }
    this.updateHandCounts();
    this.advanceTurn(card.number === 14 ? 2 : 1);
    this.state.lastAction = `${player.name} played ${card.label}.`;
    return true;
  }

  playerName(playerId) { return this.players.find((player) => player.id === playerId)?.name ?? 'A player'; }
  isLegalCard(card) {
    return card.isWhot || card.shape === (this.state.requestedShape ?? this.state.topCard.shape) || card.number === this.state.topCard.number;
  }
  advanceTurn(steps = 1) {
    const current = this.players.findIndex((candidate) => candidate.id === this.state.currentPlayerId);
    this.state.currentPlayerId = this.players[(current + steps) % this.players.length].id;
  }
  updateHandCounts() {
    this.state.players = this.state.players.map((player) => ({ ...player, handCount: this.hands[player.id]?.length ?? 0 }));
  }
  publicState() { return clone(this.state); }
  privateState(playerId) { return { seated: this.seated(playerId), isTurn: this.state?.currentPlayerId === playerId, hand: clone(this.hands?.[playerId] ?? []), legalIntents: this.legalIntents(playerId) }; }
  legalIntents(playerId) {
    if (!this.state || this.state.phase !== 'playing' || this.state.currentPlayerId !== playerId) return [];
    const plays = (this.hands[playerId] ?? []).filter((card) => this.isLegalCard(card)).map((card) => ({
      type: 'play_card',
      cardId: card.id,
      calledShape: card.isWhot ? 'Circle' : undefined,
      label: `Play ${card.label}`,
    }));
    return plays.length ? plays : [{ type: 'draw', label: 'Go to market' }];
  }
  extraSnapshot() { return { hands: this.hands, deck: this.deck }; }
  restoreExtra(extra) {
    this.hands = extra?.hands ?? {};
    this.deck = extra?.deck ?? [];
  }
}

function createRuntime(manifest) {
  if (manifest.id === 'connect-4') return new Connect4Runtime(manifest);
  if (manifest.id === 'ettt') return new EtttRuntime(manifest);
  if (manifest.id === 'ludo') return new LudoRuntime(manifest);
  if (manifest.id === 'whot') return new WhotRuntime(manifest);
  const definition = CHALLENGE_DEFINITIONS[manifest.id];
  if (!definition) throw new Error('game_definition_missing');
  return new ChallengeRuntime(manifest, definition);
}

export function createPlugin(manifest) {
  return {
    id: manifest.id,
    version: manifest.version,
    createRuntime: () => createRuntime(manifest),
  };
}
