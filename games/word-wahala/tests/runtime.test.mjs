// Word Wahala board-engine tests — geometry, connectivity, dictionary, premiums and recovery.

import assert from 'node:assert/strict';
import test from 'node:test';
import { WordWahalaRuntime } from '../../../runtime/games/word-wahala.js';

function makeWord(settings = {}, players = [{ id: 'p1', name: 'Ada' }, { id: 'p2', name: 'Tobi' }]) {
  const runtime = new WordWahalaRuntime({
    id: 'word-wahala', name: 'Word Wahala', emoji: '🔡', version: '1.2.0.0',
    minPlayers: 2, maxPlayers: 8, capabilities: { bots: true, audience: true, hints: true, restore: true },
  });
  runtime.configure({ sessionId: 's', gameRunId: 'r', settings: { seed: 4, maxTurns: 20, ...settings } });
  runtime.seatPlayers(players);
  runtime.start();
  return runtime;
}

function tiles(word, prefix = 'forced') {
  const values = { A:1, B:3, C:3, D:2, E:1, F:4, G:2, H:4, I:1, J:8, K:5, L:1, M:3, N:1, O:1, P:3, Q:10, R:1, S:1, T:1, U:1, V:4, W:4, X:8, Y:4, Z:10 };
  return [...word].map((letter, index) => ({ id: `${prefix}-${index}`, letter, value: values[letter] }));
}

function forceRack(runtime, playerId, word, prefix) {
  runtime.racks[playerId] = tiles(word, prefix);
  return runtime.racks[playerId];
}

function placeWord(runtime, playerId, word, row, col, horizontal = true, prefix = playerId) {
  const rack = forceRack(runtime, playerId, word, prefix);
  return runtime.handleIntent(playerId, {
    type: 'place_tiles',
    placements: rack.map((tile, index) => ({
      tileId: tile.id,
      row: row + (horizontal ? 0 : index),
      col: col + (horizontal ? index : 0),
    })),
  }, false);
}

test('starts with a public 15x15 board and private seven-tile racks', () => {
  const runtime = makeWord();
  assert.equal(runtime.publicState().board.length, 15);
  assert.equal(runtime.publicState().board.every((row) => row.length === 15), true);
  assert.equal(runtime.privateState('p1').rack.length, 7);
  assert.equal(JSON.stringify(runtime.publicState()).includes(runtime.privateState('p1').rack[0].id), false);
});

test('first word must cover centre and rotates the turn after valid placement', () => {
  const runtime = makeWord();
  assert.equal(placeWord(runtime, 'p1', 'AMEN', 0, 0), false);
  assert.equal(placeWord(runtime, 'p1', 'AMEN', 7, 5), true);
  const state = runtime.publicState();
  assert.equal(state.board[7][5].letter, 'A');
  assert.equal(state.board[7][8].letter, 'N');
  assert.equal(state.currentPlayerId, 'p2');
  assert.equal(state.lastMove.words[0], 'AMEN');
  assert.equal(state.lastMove.score, 12); // six letter points, doubled by the centre star
});

test('later words must connect and every formed cross-word must be valid', () => {
  const runtime = makeWord();
  placeWord(runtime, 'p1', 'AMEN', 7, 5);
  forceRack(runtime, 'p2', 'LOVE', 'p2-disconnected');
  assert.equal(runtime.handleIntent('p2', {
    type: 'place_tiles',
    placements: runtime.racks.p2.map((tile, index) => ({ tileId: tile.id, row: 0, col: index })),
  }, false), false);

  // Existing M at 7,6 plus a new E at 8,6 makes the valid vertical word ME.
  const [e] = forceRack(runtime, 'p2', 'E', 'p2-connected');
  assert.equal(runtime.handleIntent('p2', {
    type: 'place_tiles', placements: [{ tileId: e.id, row: 8, col: 6 }],
  }, false), true);
  assert.equal(runtime.publicState().lastMove.words.includes('ME'), true);
});

test('rejects gaps, diagonal placement, occupied cells and unknown words', () => {
  const runtime = makeWord();
  const [a, m] = forceRack(runtime, 'p1', 'AM', 'bad');
  assert.equal(runtime.handleIntent('p1', {
    type: 'place_tiles', placements: [
      { tileId: a.id, row: 7, col: 7 },
      { tileId: m.id, row: 7, col: 9 },
    ],
  }, false), false);
  assert.equal(runtime.handleIntent('p1', {
    type: 'place_tiles', placements: [
      { tileId: a.id, row: 7, col: 7 },
      { tileId: m.id, row: 8, col: 8 },
    ],
  }, false), false);
  assert.equal(placeWord(runtime, 'p1', 'ZX', 7, 7, true, 'unknown'), false);
});

test('scores cross words and applies premium squares only to newly placed tiles', () => {
  const runtime = makeWord();
  placeWord(runtime, 'p1', 'AMEN', 7, 5);
  const [e] = forceRack(runtime, 'p2', 'E', 'cross');
  runtime.handleIntent('p2', { type: 'place_tiles', placements: [{ tileId: e.id, row: 8, col: 6 }] }, false);
  assert.equal(runtime.publicState().lastMove.score, 5); // M(3) + E on double-letter(2)
});

test('pass and swap are turn actions and invalid tile ids are rejected', () => {
  const runtime = makeWord();
  assert.equal(runtime.handleIntent('p1', { type: 'pass' }, false), true);
  const before = runtime.privateState('p2').rack.map((tile) => tile.id);
  assert.equal(runtime.handleIntent('p2', { type: 'swap', tileIds: ['not-owned'] }, false), false);
  assert.equal(runtime.handleIntent('p2', { type: 'swap', tileIds: before.slice(0, 2) }, false), true);
  assert.notDeepEqual(runtime.privateState('p2').rack.map((tile) => tile.id), before);
});

test('two full rounds of passes finish the game with rack penalties', () => {
  const runtime = makeWord();
  for (const playerId of ['p1', 'p2', 'p1', 'p2']) assert.equal(runtime.handleIntent(playerId, { type: 'pass' }, false), true);
  assert.equal(runtime.publicState().phase, 'finished');
  assert.ok(runtime.publicState().winnerPlayerIds.length >= 1);
  assert.equal(runtime.publicState().players.every((player) => player.score <= 0), true);
});

test('bot generates a legal centre placement or passes without inventing tiles', () => {
  const runtime = makeWord({}, [{ id: 'bot-1', name: 'Bot', bot: true }, { id: 'p2', name: 'Tobi' }]);
  forceRack(runtime, 'bot-1', 'AMENXYZ', 'bot');
  const intent = runtime.rankBotIntent('bot-1');
  assert.equal(intent.type, 'place_tiles');
  assert.equal(runtime.handleIntent('bot-1', intent, false), true);
  assert.equal(runtime.publicState().board[7].some((cell) => cell != null), true);
});

test('snapshot restore preserves board, racks, dictionary and turn state', () => {
  const runtime = makeWord({ dictionaryWords: ['CODE'] });
  placeWord(runtime, 'p1', 'CODE', 7, 5);
  const snapshot = runtime.snapshot();
  const restored = makeWord();
  restored.restore(snapshot);
  assert.deepEqual(restored.publicState(), runtime.publicState());
  assert.deepEqual(restored.privateState('p1'), runtime.privateState('p1'));
  assert.equal(restored.dictionary.has('CODE'), true);
});
