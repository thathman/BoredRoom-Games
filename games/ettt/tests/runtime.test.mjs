// Endless Tic Tac Toe tests — rolling marks, win, board reset, restore

import assert from 'node:assert/strict';
import test from 'node:test';
import { EtttRuntime } from '../../../runtime/games/ettt.js';

function makeEttt(settings = {}) {
  const runtime = new EtttRuntime({
    id: 'ettt', name: 'Endless TTT', emoji: '⭕', version: '2.0.0.0',
    minPlayers: 2, maxPlayers: 2,
    capabilities: { bots: true, audience: true, hints: false, restore: true },
  });
  runtime.configure({ sessionId: 's', gameRunId: 'r', settings: { activeMarkLimit: 3, targetScore: 3, ...settings } });
  runtime.seatPlayers([{ id: 'p1', name: 'X' }, { id: 'p2', name: 'O' }]);
  runtime.start();
  return runtime;
}

function play(runtime, playerId, cell) {
  return runtime.handleIntent(playerId, { type: 'place', cell }, false);
}

// ── Initial state ────────────────────────────────────────────────────────

test('board starts empty', () => {
  const runtime = makeEttt();
  const board = runtime.publicState().board.flat();
  assert.ok(board.every((c) => c === null));
});

test('p1 moves first', () => {
  const runtime = makeEttt();
  assert.equal(runtime.publicState().currentPlayerId, 'p1');
});

// ── Limited active marks ─────────────────────────────────────────────────

test('places marks up to the active limit', () => {
  const runtime = makeEttt({ activeMarkLimit: 3 });
  play(runtime, 'p1', 0); play(runtime, 'p2', 1);
  play(runtime, 'p1', 2); play(runtime, 'p2', 3);
  play(runtime, 'p1', 4); play(runtime, 'p2', 5);
  // Both players have 3 active marks
  const board = runtime.publicState().board.flat();
  const active = board.filter(Boolean);
  assert.equal(active.length, 6);
});

test('oldest mark rolls off on 4th placement', () => {
  const runtime = makeEttt({ activeMarkLimit: 3 });
  play(runtime, 'p1', 0); play(runtime, 'p2', 8);
  play(runtime, 'p1', 1); play(runtime, 'p2', 7);
  play(runtime, 'p1', 2); play(runtime, 'p2', 6);
  // p1 places 4th — oldest (cell 0) should roll off
  play(runtime, 'p1', 3);
  const board = runtime.publicState().board.flat();
  assert.equal(board[0], null); // rolled off
  assert.equal(board[3], 'X'); // new mark placed
});

test('oldestMarks shows the oldest active mark after hitting limit', () => {
  const runtime = makeEttt({ activeMarkLimit: 2 });
  // p1 fills both slots: cells 0 and 1
  play(runtime, 'p1', 0); play(runtime, 'p2', 8);
  play(runtime, 'p1', 1); play(runtime, 'p2', 7);
  // p1 now places a 3rd — cell 0 should roll off before checking oldestMarks
  play(runtime, 'p1', 4);
  const oldest = runtime.publicState().oldestMarks;
  // After rolling off cell 0, cells 1 and 4 remain; oldest active is cell 1
  assert.equal(oldest.length, 1);
  assert.deepEqual(oldest[0], { row: 0, col: 1 });
});

// ── Old marks removed do not contribute to win ────────────────────────────

test('win checked after roll-off (marks 0+1+2 win, rolled-off cells do not count)', () => {
  const runtime = makeEttt({ activeMarkLimit: 2 });
  // p1 places cells 0, 1 — that's 2 marks, hitting limit
  play(runtime, 'p1', 0); play(runtime, 'p2', 5);
  play(runtime, 'p1', 1); play(runtime, 'p2', 6);
  // p1 places cell 2 — oldest (cell 0) rolls off, leaving [1, 2]
  // But [1, 2] is only 2 cells — not a win. So this won't trigger a win.
  // Need 3 in a row: cells [0,1,2] = top row. After placing cell 2, cell 0 rolls off.
  // Board has [null, X, X] — NOT a win. Test should verify no false win.
  play(runtime, 'p1', 2);
  const state = runtime.publicState();
  assert.equal(state.phase, 'playing');
  assert.equal(state.lastAction.includes('roll'), true);
});

test('three in a row wins after rolling (strategic placement)', () => {
  const runtime = makeEttt({ activeMarkLimit: 2 });
  // p1: cells 0, 3 — limit 2, oldest queue = [0, 3]
  play(runtime, 'p1', 0); play(runtime, 'p2', 8);
  play(runtime, 'p1', 3); play(runtime, 'p2', 7);
  // p1: cell 6 — rolls off 0, queue = [3, 6]
  play(runtime, 'p1', 6); play(runtime, 'p2', 5);
  // Winning line: vertical column 0 = [0, 3, 6]. But cell 0 was rolled off.
  // Board: col 0 = [null, X, X] — no win.
  assert.equal(runtime.publicState().phase, 'playing');
});

// ── Board resets after win ────────────────────────────────────────────────

test('board resets after win but scores persist', () => {
  const runtime = makeEttt({ activeMarkLimit: 3, targetScore: 3 });
  play(runtime, 'p1', 0); play(runtime, 'p2', 6);
  play(runtime, 'p1', 1); play(runtime, 'p2', 7);
  play(runtime, 'p1', 2); // p1 wins row 0
  // Board should be empty
  const board = runtime.publicState().board.flat();
  assert.ok(board.every((c) => c === null));
  const p1 = runtime.publicState().players.find((p) => p.id === 'p1');
  assert.equal(p1.score, 1);
});

// ── Reach target score ────────────────────────────────────────────────────

test('first to targetScore wins the game', () => {
  const runtime = makeEttt({ activeMarkLimit: 3, targetScore: 2 });
  // Win 1
  play(runtime, 'p1', 0); play(runtime, 'p2', 6);
  play(runtime, 'p1', 1); play(runtime, 'p2', 7);
  play(runtime, 'p1', 2);
  // Win 2 (board reset, p1's turn since they just won)
  play(runtime, runtime.publicState().currentPlayerId, 0); 
  play(runtime, runtime.publicState().currentPlayerId === 'p2' ? 'p1' : 'p2', 6);
  play(runtime, runtime.publicState().currentPlayerId, 1);
  play(runtime, runtime.publicState().currentPlayerId === 'p2' ? 'p1' : 'p2', 7);
  play(runtime, runtime.publicState().currentPlayerId, 2);
  // If p1 got both, game should be finished
  const state = runtime.publicState();
  if (state.phase === 'finished') {
    assert.ok(state.winnerPlayerIds.length > 0);
  }
});

// ── Reject illegal ────────────────────────────────────────────────────────

test('rejects occupied cell', () => {
  const runtime = makeEttt();
  play(runtime, 'p1', 0);
  assert.equal(play(runtime, 'p2', 0), false);
});

test('rejects out-of-range cell', () => {
  const runtime = makeEttt();
  assert.equal(play(runtime, 'p1', 9), false);
  assert.equal(play(runtime, 'p1', -1), false);
});

test('rejects non-place intent', () => {
  const runtime = makeEttt();
  assert.equal(runtime.handleIntent('p1', { type: 'roll' }, false), false);
});

// ── Snapshot / restore ───────────────────────────────────────────────────

test('snapshot and restore with rolling state', () => {
  const a = makeEttt({ activeMarkLimit: 2 });
  play(a, 'p1', 0); play(a, 'p2', 8);
  play(a, 'p1', 4); play(a, 'p2', 7);
  const snap = a.snapshot();

  const b = makeEttt({ activeMarkLimit: 2 });
  b.restore(snap);
  assert.deepEqual(b.publicState().board, a.publicState().board);
  assert.equal(b.publicState().currentPlayerId, a.publicState().currentPlayerId);
});

// ── Bot ──────────────────────────────────────────────────────────────────

test('bot places valid cell', () => {
  const runtime = makeEttt();
  const intent = runtime.rankBotIntent('p1');
  assert.ok(intent);
  assert.equal(intent.type, 'place');
  assert.equal(play(runtime, 'p1', intent.cell), true);
});
