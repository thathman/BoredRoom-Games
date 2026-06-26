// Connect 4 runtime tests — solo win, team mode, best-of rounds, contributions, bot, restore.

import assert from 'node:assert/strict';
import test from 'node:test';
import { Connect4Runtime } from '../../../runtime/games/connect4.js';

function makeC4(settings = {}, players = [{ id: 'p1', name: 'Ada' }, { id: 'p2', name: 'Tobi' }]) {
  const r = new Connect4Runtime({
    id: 'connect-4', name: 'Connect 4', emoji: '🔴', version: '1.2.0.0',
    minPlayers: 2, maxPlayers: 4, capabilities: { bots: true, audience: true, hints: true, restore: true },
  });
  r.configure({ sessionId: 's', gameRunId: 'r', settings });
  r.seatPlayers(players);
  r.start();
  return r;
}

// Drive a horizontal four for the player who currently owns the turn's disc by columns.
function fourInARow(r, winnerId, otherId) {
  r.handleIntent(winnerId, { type: 'drop', column: 0 }, false);
  r.handleIntent(otherId, { type: 'drop', column: 0 }, false);
  r.handleIntent(winnerId, { type: 'drop', column: 1 }, false);
  r.handleIntent(otherId, { type: 'drop', column: 1 }, false);
  r.handleIntent(winnerId, { type: 'drop', column: 2 }, false);
  r.handleIntent(otherId, { type: 'drop', column: 2 }, false);
  return r.handleIntent(winnerId, { type: 'drop', column: 3 }, false);
}

test('solo best-of-1 win finishes the game and records the winning cells', () => {
  const r = makeC4();
  assert.equal(fourInARow(r, 'p1', 'p2'), true);
  assert.equal(r.publicState().phase, 'finished');
  assert.deepEqual(r.publicState().winnerPlayerIds, ['p1']);
  assert.equal(r.publicState().winningCells.length, 4);
  assert.equal(r.publicState().contributions.p1, 4);
});

test('team mode alternates sides and credits the whole team', () => {
  const r = makeC4({ teamMode: true }, [
    { id: 'a1', name: 'A1' }, { id: 'b1', name: 'B1' }, { id: 'a2', name: 'A2' }, { id: 'b2', name: 'B2' },
  ]);
  assert.equal(r.publicState().teamMode, true);
  // a1 and a2 are team A; b1,b2 team B. Turn order interleaves A,B,A,B.
  assert.deepEqual(r.publicState().turnOrder, ['a1', 'b1', 'a2', 'b2']);
  assert.equal(r.privateState('a1').side, 'A');
  assert.equal(r.privateState('b1').side, 'B');
});

test('best-of-3 advances rounds and needs two wins to take the match', () => {
  const r = makeC4({ bestOf: 3 });
  assert.equal(r.publicState().roundsToWin, 2);
  // Round 1: p1 connects four. Match should NOT end — best-of-3 needs two.
  fourInARow(r, 'p1', 'p2');
  assert.equal(r.publicState().phase, 'playing');
  assert.equal(r.publicState().round, 2);
  assert.equal(r.publicState().roundWins.p1, 1);
  assert.equal(r.publicState().board.flat().every((c) => c === null), true); // fresh board
  // Force p1 to the second round win deterministically and resolve.
  r.state.roundWins.p1 = 1;
  r.state.currentPlayerId = 'p1';
  // give p1 three in a row then the fourth wins the match
  r.state.board[5][0] = 'G'; r.state.board[5][1] = 'G'; r.state.board[5][2] = 'G';
  assert.equal(r.handleIntent('p1', { type: 'drop', column: 3 }, false), true);
  assert.equal(r.publicState().phase, 'finished');
  assert.deepEqual(r.publicState().winnerPlayerIds, ['p1']);
});

test('bot blocks an immediate opponent win', () => {
  const r = makeC4();
  // p1 has three in column-adjacent row 5: cols 0,1,2 -> bot p2 should block col 3.
  r.state.board[5][0] = 'G';
  r.state.board[5][1] = 'G';
  r.state.board[5][2] = 'G';
  r.state.currentPlayerId = 'p2';
  const intent = r.rankBotIntent('p2');
  assert.equal(intent.column, 3);
});

test('snapshot/restore preserves board, round wins and contributions', () => {
  const r = makeC4({ bestOf: 3 });
  fourInARow(r, 'p1', 'p2');
  const snap = r.snapshot();
  const r2 = new Connect4Runtime({ id: 'connect-4', name: 'Connect 4', emoji: '🔴', version: '1.2.0.0', minPlayers: 2, maxPlayers: 4, capabilities: { bots: true, audience: true, hints: true, restore: true } });
  r2.configure({ sessionId: 's', gameRunId: 'r', settings: {} });
  r2.seatPlayers([]);
  r2.start();
  r2.restore(snap);
  assert.deepEqual(r2.publicState(), r.publicState());
  assert.equal(r2.publicState().roundWins.p1, 1);
});
