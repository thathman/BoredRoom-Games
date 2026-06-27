// Word Wahala — server-authoritative Scrabble-style board game.
// Controllers submit tile ids and coordinates; the runtime validates geometry, connectivity,
// every formed word, premium squares, scoring, rack ownership, turn order and end conditions.

import { RuntimeBase, makeRng, shuffleInPlace, clone } from '../helpers.js';
import { WORD_DICTIONARY } from './word-dictionary.js';

const BOARD_SIZE = 15;
const CENTER = 7;
const BINGO_BONUS = 50;

const TILE_DISTRIBUTION = [
  { letter:'A', value:1, count:9 },{ letter:'B', value:3, count:2 },{ letter:'C', value:3, count:2 },
  { letter:'D', value:2, count:4 },{ letter:'E', value:1, count:12 },{ letter:'F', value:4, count:2 },
  { letter:'G', value:2, count:3 },{ letter:'H', value:4, count:2 },{ letter:'I', value:1, count:9 },
  { letter:'J', value:8, count:1 },{ letter:'K', value:5, count:1 },{ letter:'L', value:1, count:4 },
  { letter:'M', value:3, count:2 },{ letter:'N', value:1, count:6 },{ letter:'O', value:1, count:8 },
  { letter:'P', value:3, count:2 },{ letter:'Q', value:10, count:1 },{ letter:'R', value:1, count:6 },
  { letter:'S', value:1, count:4 },{ letter:'T', value:1, count:6 },{ letter:'U', value:1, count:4 },
  { letter:'V', value:4, count:2 },{ letter:'W', value:4, count:2 },{ letter:'X', value:8, count:1 },
  { letter:'Y', value:4, count:2 },{ letter:'Z', value:10, count:1 },
];

const DEFAULT_WORDS = [
  'AM','AN','AS','AT','BE','BY','DO','GO','HE','IF','IN','IS','IT','ME','MY','NO','OF','OH','ON','OR','SO','TO','UP','US','WE',
  'CHURCH','PRAISE','AMEN','HALLELUJAH','FAITH','GRACE','MERCY','BLESS','HOLY','GLORY',
  'PEACE','LOVE','HOPE','TRUTH','LIFE','LIGHT','WORD','PRAYER','WORSHIP','SPIRIT',
  'JESUS','CHRIST','LORD','GOD','HEAVEN','EARTH','WATER','FIRE','WIND','POWER',
  'KING','QUEEN','CROWN','CROSS','BIBLE','PSALM','PROVERB','GOSPEL','JOY','SONG',
  'NAIJA','LAGOS','ABUJA','JOLLOF','SUYA','EGUSI','FUFU','DANFO','OWAMBE','WAHALA',
  'CHOP','OBOY','SHINE','BODI','SWEET','TANK','GBAS','GBOS','ZAZU','GBEDU',
];

const PREMIUMS = new Map();
function addPremium(kind, coordinates) {
  for (const [row, col] of coordinates) PREMIUMS.set(`${row}:${col}`, kind);
}
addPremium('triple_word', [[0,0],[0,7],[0,14],[7,0],[7,14],[14,0],[14,7],[14,14]]);
addPremium('double_word', [[1,1],[2,2],[3,3],[4,4],[7,7],[10,10],[11,11],[12,12],[13,13],[1,13],[2,12],[3,11],[4,10],[10,4],[11,3],[12,2],[13,1]]);
addPremium('triple_letter', [[1,5],[1,9],[5,1],[5,5],[5,9],[5,13],[9,1],[9,5],[9,9],[9,13],[13,5],[13,9]]);
addPremium('double_letter', [[0,3],[0,11],[2,6],[2,8],[3,0],[3,7],[3,14],[6,2],[6,6],[6,8],[6,12],[7,3],[7,11],[8,2],[8,6],[8,8],[8,12],[11,0],[11,7],[11,14],[12,6],[12,8],[14,3],[14,11]]);

function createTileBag(rng) {
  const bag = [];
  for (const { letter, value, count } of TILE_DISTRIBUTION) {
    for (let index = 0; index < count; index += 1) bag.push({ letter, value, id: `${letter}-${index}` });
  }
  return shuffleInPlace(bag, rng);
}

function emptyBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
}

function inside(row, col) {
  return Number.isInteger(row) && Number.isInteger(col) && row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

export class WordWahalaRuntime extends RuntimeBase {
  start() {
    const seed = Number(this.context?.settings?.seed) || (Date.now() & 0xffffffff);
    this.rng = makeRng(seed);
    this.rackSize = Math.min(7, Math.max(5, Number(this.context?.settings?.rackSize) || 7));
    this.maxTurns = Math.min(200, Math.max(10, Number(this.context?.settings?.maxTurns) || 80));
    this.dictionary = new Set([
      ...WORD_DICTIONARY,
      ...DEFAULT_WORDS,
      ...(Array.isArray(this.context?.settings?.dictionaryWords) ? this.context.settings.dictionaryWords : []),
    ].map((word) => String(word).trim().toUpperCase()).filter(Boolean));

    this.bag = createTileBag(this.rng);
    this.racks = {};
    this.board = emptyBoard();
    this.turn = 1;
    this.consecutivePasses = 0;
    for (const player of this.players) this.racks[player.id] = this.bag.splice(0, this.rackSize);

    this.state = {
      gameType: this.gameType, name: this.manifest.name, emoji: this.manifest.emoji,
      mode: 'word-board', phase: 'playing', board: clone(this.board),
      players: clone(this.players), currentPlayerId: this.players[0]?.id,
      turn: this.turn, bagCount: this.bag.length, lastMove: null,
      winnerPlayerIds: [], lastAction: 'Place a word through the centre star.',
    };
  }

  handleIntent(playerId, intent) {
    if (!this.state || this.state.phase !== 'playing' || this.state.currentPlayerId !== playerId || !this.seated(playerId)) return false;
    if (intent?.type === 'pass') return this.passTurn(playerId);
    if (intent?.type === 'swap') return this.swapTiles(playerId, intent.tileIds);
    if (intent?.type !== 'place_tiles') return false;

    const evaluated = this.evaluatePlacement(playerId, intent.placements);
    if (!evaluated) return false;
    for (const placement of evaluated.placements) {
      this.board[placement.row][placement.col] = {
        letter: placement.tile.letter,
        value: placement.tile.value,
        ownerId: playerId,
        turn: this.turn,
      };
    }
    const usedIds = new Set(evaluated.placements.map((placement) => placement.tile.id));
    this.racks[playerId] = this.racks[playerId].filter((tile) => !usedIds.has(tile.id));
    this.refillRack(playerId);
    const player = this.state.players.find((candidate) => candidate.id === playerId);
    if (player) player.score += evaluated.score;
    this.consecutivePasses = 0;
    this.state.board = clone(this.board);
    this.state.lastMove = {
      playerId,
      words: evaluated.words.map((word) => word.text),
      score: evaluated.score,
      placements: evaluated.placements.map(({ row, col, tile }) => ({ row, col, letter: tile.letter, value: tile.value })),
    };
    this.state.lastAction = `${this.playerName(playerId)} played ${evaluated.words.map((word) => word.text).join(' + ')} for ${evaluated.score} points.`;
    this.finishOrAdvance(playerId);
    return true;
  }

  evaluatePlacement(playerId, rawPlacements) {
    if (!Array.isArray(rawPlacements) || rawPlacements.length === 0 || rawPlacements.length > this.rackSize) return null;
    const rack = this.racks[playerId] ?? [];
    const rackById = new Map(rack.map((tile) => [tile.id, tile]));
    const cells = new Set();
    const tileIds = new Set();
    const placements = [];
    for (const raw of rawPlacements) {
      const row = Number(raw?.row);
      const col = Number(raw?.col);
      const tileId = String(raw?.tileId ?? '');
      const tile = rackById.get(tileId);
      const key = `${row}:${col}`;
      if (!inside(row, col) || !tile || this.board[row][col] || cells.has(key) || tileIds.has(tileId)) return null;
      cells.add(key); tileIds.add(tileId); placements.push({ row, col, tile });
    }

    const sameRow = placements.every((placement) => placement.row === placements[0].row);
    const sameCol = placements.every((placement) => placement.col === placements[0].col);
    if (!sameRow && !sameCol) return null;
    let direction = sameRow ? [0, 1] : [1, 0];
    if (placements.length === 1) {
      const { row, col } = placements[0];
      const horizontal = this.board[row]?.[col - 1] || this.board[row]?.[col + 1];
      const vertical = this.board[row - 1]?.[col] || this.board[row + 1]?.[col];
      if (vertical && !horizontal) direction = [1, 0];
    }

    const tentative = this.board.map((row) => row.slice());
    for (const placement of placements) tentative[placement.row][placement.col] = placement.tile;
    const boardWasEmpty = this.board.every((row) => row.every((cell) => cell == null));
    if (boardWasEmpty && !placements.some((placement) => placement.row === CENTER && placement.col === CENTER)) return null;
    if (!boardWasEmpty && !placements.some(({ row, col }) => [
      this.board[row - 1]?.[col], this.board[row + 1]?.[col], this.board[row]?.[col - 1], this.board[row]?.[col + 1],
    ].some(Boolean))) return null;

    const [dr, dc] = direction;
    const axis = placements.map((placement) => (dr ? placement.row : placement.col));
    for (let value = Math.min(...axis); value <= Math.max(...axis); value += 1) {
      const row = dr ? value : placements[0].row;
      const col = dc ? value : placements[0].col;
      if (!tentative[row][col]) return null;
    }

    const newKeys = new Set(placements.map(({ row, col }) => `${row}:${col}`));
    const mainWord = this.readWord(tentative, placements[0].row, placements[0].col, dr, dc);
    const words = mainWord.cells.length > 1 ? [mainWord] : [];
    for (const placement of placements) {
      const cross = this.readWord(tentative, placement.row, placement.col, dc, dr);
      if (cross.cells.length > 1) words.push(cross);
    }
    const uniqueWords = [...new Map(words.map((word) => [`${word.text}:${word.cells[0].row}:${word.cells[0].col}`, word])).values()];
    if (uniqueWords.length === 0 || uniqueWords.some((word) => !this.dictionary.has(word.text))) return null;
    const score = uniqueWords.reduce((total, word) => total + this.scoreWord(word, newKeys), 0)
      + (placements.length === this.rackSize ? BINGO_BONUS : 0);
    return { placements, words: uniqueWords, score };
  }

  readWord(board, row, col, dr, dc) {
    let startRow = row;
    let startCol = col;
    while (inside(startRow - dr, startCol - dc) && board[startRow - dr][startCol - dc]) {
      startRow -= dr; startCol -= dc;
    }
    const cells = [];
    let cursorRow = startRow;
    let cursorCol = startCol;
    while (inside(cursorRow, cursorCol) && board[cursorRow][cursorCol]) {
      cells.push({ row: cursorRow, col: cursorCol, tile: board[cursorRow][cursorCol] });
      cursorRow += dr; cursorCol += dc;
    }
    return { text: cells.map((cell) => cell.tile.letter).join(''), cells };
  }

  scoreWord(word, newKeys) {
    let subtotal = 0;
    let wordMultiplier = 1;
    for (const { row, col, tile } of word.cells) {
      let letterScore = tile.value;
      if (newKeys.has(`${row}:${col}`)) {
        const premium = PREMIUMS.get(`${row}:${col}`);
        if (premium === 'double_letter') letterScore *= 2;
        if (premium === 'triple_letter') letterScore *= 3;
        if (premium === 'double_word') wordMultiplier *= 2;
        if (premium === 'triple_word') wordMultiplier *= 3;
      }
      subtotal += letterScore;
    }
    return subtotal * wordMultiplier;
  }

  passTurn(playerId) {
    this.consecutivePasses += 1;
    this.state.lastMove = { playerId, words: [], score: 0, placements: [] };
    this.state.lastAction = `${this.playerName(playerId)} passed.`;
    this.finishOrAdvance(playerId);
    return true;
  }

  swapTiles(playerId, rawIds) {
    const ids = [...new Set(Array.isArray(rawIds) ? rawIds.map(String) : [])];
    const rack = this.racks[playerId] ?? [];
    const selected = rack.filter((tile) => ids.includes(tile.id));
    if (selected.length === 0 || selected.length !== ids.length || this.bag.length < selected.length) return false;
    const selectedSet = new Set(ids);
    const replacements = this.bag.splice(0, selected.length);
    this.racks[playerId] = [...rack.filter((tile) => !selectedSet.has(tile.id)), ...replacements];
    this.bag.push(...selected);
    shuffleInPlace(this.bag, this.rng);
    this.consecutivePasses += 1;
    this.state.lastMove = { playerId, words: [], score: 0, placements: [] };
    this.state.lastAction = `${this.playerName(playerId)} swapped ${selected.length} tile${selected.length === 1 ? '' : 's'}.`;
    this.finishOrAdvance(playerId);
    return true;
  }

  refillRack(playerId) {
    while (this.racks[playerId].length < this.rackSize && this.bag.length > 0) this.racks[playerId].push(this.bag.shift());
  }

  finishOrAdvance(playerId) {
    const emptiedRack = this.bag.length === 0 && (this.racks[playerId]?.length ?? 0) === 0;
    const passesToEnd = this.players.length * 2;
    if (emptiedRack || this.consecutivePasses >= passesToEnd || this.turn >= this.maxTurns) {
      this.finishBoardGame(playerId, emptiedRack);
      return;
    }
    const currentIndex = this.players.findIndex((player) => player.id === this.state.currentPlayerId);
    this.state.currentPlayerId = this.players[(currentIndex + 1) % this.players.length].id;
    this.turn += 1;
    this.state.turn = this.turn;
    this.state.bagCount = this.bag.length;
    this.state.players = clone(this.state.players);
  }

  finishBoardGame(finisherId, emptiedRack) {
    let finisherBonus = 0;
    for (const player of this.state.players) {
      const rackPenalty = (this.racks[player.id] ?? []).reduce((sum, tile) => sum + tile.value, 0);
      player.score -= rackPenalty;
      if (emptiedRack && player.id !== finisherId) finisherBonus += rackPenalty;
    }
    if (emptiedRack) {
      const finisher = this.state.players.find((player) => player.id === finisherId);
      if (finisher) finisher.score += finisherBonus;
    }
    this.state.phase = 'finished';
    this.state.players = clone(this.state.players);
    this.state.bagCount = this.bag.length;
    const winningScore = Math.max(...this.state.players.map((player) => player.score));
    this.state.winnerPlayerIds = this.state.players.filter((player) => player.score === winningScore).map((player) => player.id);
    this.state.lastAction = `${this.state.winnerPlayerIds.map((id) => this.playerName(id)).join(' & ')} win Word Wahala!`;
  }

  findBotPlacement(playerId) {
    const rack = this.racks[playerId] ?? [];
    const words = [...this.dictionary].filter((word) => word.length >= 2 && word.length <= BOARD_SIZE).sort((a, b) => b.length - a.length || a.localeCompare(b));
    for (const word of words) {
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        for (let row = 0; row < BOARD_SIZE; row += 1) {
          for (let col = 0; col < BOARD_SIZE; col += 1) {
            const endRow = row + dr * (word.length - 1);
            const endCol = col + dc * (word.length - 1);
            if (!inside(endRow, endCol)) continue;
            const available = [...rack];
            const placements = [];
            let possible = true;
            for (let index = 0; index < word.length; index += 1) {
              const cellRow = row + dr * index;
              const cellCol = col + dc * index;
              const existing = this.board[cellRow][cellCol];
              if (existing) {
                if (existing.letter !== word[index]) { possible = false; break; }
                continue;
              }
              const tileIndex = available.findIndex((tile) => tile.letter === word[index]);
              if (tileIndex < 0) { possible = false; break; }
              const [tile] = available.splice(tileIndex, 1);
              placements.push({ tileId: tile.id, row: cellRow, col: cellCol });
            }
            if (possible && placements.length > 0 && this.evaluatePlacement(playerId, placements)) return placements;
          }
        }
      }
    }
    return null;
  }

  playerName(id) { return this.state?.players?.find((player) => player.id === id)?.name ?? 'A player'; }
  publicState() { return clone(this.state); }
  privateState(id) {
    return {
      seated: this.seated(id), isTurn: this.state?.currentPlayerId === id,
      rack: clone(this.racks?.[id] ?? []), legalIntents: this.legalIntents(id),
    };
  }
  legalIntents(id) {
    if (!this.state || this.state.phase !== 'playing' || this.state.currentPlayerId !== id || !this.seated(id)) return [];
    const intents = [{ type: 'pass', label: 'Pass turn' }, { type: 'place_tiles', label: 'Place tiles' }];
    if (this.bag.length > 0) intents.push({ type: 'swap', label: 'Swap selected tiles' });
    return intents;
  }
  rankBotIntent(id) {
    if (!this.state || this.state.currentPlayerId !== id) return null;
    const placements = this.findBotPlacement(id);
    return placements ? { type: 'place_tiles', placements } : { type: 'pass' };
  }
  extraSnapshot() {
    return {
      bag: this.bag, racks: this.racks, board: this.board, turn: this.turn,
      consecutivePasses: this.consecutivePasses, rackSize: this.rackSize, maxTurns: this.maxTurns,
      dictionary: [...this.dictionary],
    };
  }
  restoreExtra(extra) {
    this.bag = extra?.bag ?? []; this.racks = extra?.racks ?? {}; this.board = extra?.board ?? emptyBoard();
    this.turn = extra?.turn ?? 1; this.consecutivePasses = extra?.consecutivePasses ?? 0;
    this.rackSize = extra?.rackSize ?? 7; this.maxTurns = extra?.maxTurns ?? 80;
    this.dictionary = new Set(extra?.dictionary ?? DEFAULT_WORDS);
  }
}
