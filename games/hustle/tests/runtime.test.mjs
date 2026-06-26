// Hustle runtime tests — board generation, dice, ladders, snakes, events, win, restore

import assert from 'node:assert/strict';
import test from 'node:test';
import { HustleRuntime } from '../../../runtime/games/hustle.js';
import { createPlugin } from '../../../runtime/game-runtime.js';

function makeHustle(settings = {}) {
  const runtime = new HustleRuntime({
    id: 'hustle', name: 'Hustle', emoji: '🏃🏿', version: '1.0.0.0',
    minPlayers: 2, maxPlayers: 6,
    capabilities: { bots: true, audience: true, hints: false, restore: true },
  });
  runtime.configure({ sessionId: 's', gameRunId: 'r', settings: { allowBots: true, seed: 42, ...settings } });
  runtime.seatPlayers([{ id: 'p1', name: 'Chioma' }, { id: 'p2', name: 'Tobi' }]);
  runtime.start();
  return runtime;
}

// ── Initialization ───────────────────────────────────────────────────────

test('starts with players at position 0', () => {
  const runtime = makeHustle();
  const state = runtime.publicState();
  assert.equal(state.positions.p1, 0);
  assert.equal(state.positions.p2, 0);
});

test('board has correct length', () => {
  const runtime = makeHustle({ boardLength: 25 });
  assert.equal(runtime.publicState().boardLength, 25);
  assert.equal(runtime.publicState().board.length, 25);
});

test('quick mode shortens board to 20', () => {
  const runtime = makeHustle({ quickMode: true });
  assert.equal(runtime.publicState().boardLength, 20);
});

test('different seed produces different board', () => {
  const a = makeHustle({ seed: 42 });
  const b = makeHustle({ seed: 99 });
  const aTypes = a.publicState().board.map((c) => c.type);
  const bTypes = b.publicState().board.map((c) => c.type);
  assert.notDeepEqual(aTypes, bTypes);
});

// ── Dice ─────────────────────────────────────────────────────────────────

test('rolling dice moves player forward', () => {
  const runtime = makeHustle({ seed: 42, boardLength: 50, eventDensity: 0 });
  const state = runtime.publicState();
  assert.equal(state.currentPlayerId, 'p1');
  const posBefore = state.positions.p1;
  assert.equal(runtime.handleIntent('p1', { type: 'roll' }, false), true);
  const posAfter = runtime.publicState().positions.p1;
  assert.ok(posAfter > posBefore);
  assert.ok(posAfter <= posBefore + 6);
});

test('roll rotates to next player after single dice', () => {
  const runtime = makeHustle({ diceMode: 'single', eventDensity: 0 });
  runtime.handleIntent('p1', { type: 'roll' }, false);
  const next = runtime.publicState().currentPlayerId;
  assert.ok(next === 'p1' || next === 'p2'); // p1 might stay on double
  if (next === 'p1') {
    // p1 rolled a double 6, roll again
    runtime.handleIntent('p1', { type: 'roll' }, false);
    assert.equal(runtime.publicState().currentPlayerId, 'p2');
  }
});

test('rejects roll on wrong turn', () => {
  const runtime = makeHustle();
  assert.equal(runtime.handleIntent('p2', { type: 'roll' }, false), false);
});

test('rejects non-roll intent', () => {
  const runtime = makeHustle();
  assert.equal(runtime.handleIntent('p1', { type: 'move' }, false), false);
});

// ── Ladders and snakes ───────────────────────────────────────────────────

test('board contains both ladders and snakes', () => {
  const runtime = makeHustle({ boardLength: 40 });
  const board = runtime.publicState().board;
  const ladders = board.filter((c) => c.type === 'ladder');
  const snakes = board.filter((c) => c.type === 'snake');
  assert.ok(ladders.length > 0, 'Expected at least one ladder');
  assert.ok(snakes.length > 0, 'Expected at least one snake');
});

test('ladder climbs to higher position', () => {
  const runtime = makeHustle({ boardLength: 30 });
  const board = runtime.publicState().board;
  const ladder = board.find((c) => c.type === 'ladder');
  assert.ok(ladder);
  assert.ok((ladder.target ?? 0) > ladder.position);
});

test('snake slides to lower position', () => {
  const runtime = makeHustle({ boardLength: 30 });
  const board = runtime.publicState().board;
  const snake = board.find((c) => c.type === 'snake');
  assert.ok(snake);
  assert.ok((snake.target ?? 999) < snake.position);
});

// ── Win ──────────────────────────────────────────────────────────────────

test('finish returns winnerPlayerIds', () => {
  const runtime = makeHustle();
  const result = runtime.finish();
  assert.ok(Array.isArray(result.winnerPlayerIds));
});

// ── Snapshot / restore ───────────────────────────────────────────────────

test('snapshot and restore preserves game state', () => {
  const a = makeHustle({ seed: 42, eventDensity: 0 });
  a.handleIntent('p1', { type: 'roll' }, false);
  // Advance past p1's double if needed
  while (a.publicState().currentPlayerId === 'p1' && a.publicState().phase === 'playing') {
    a.handleIntent('p1', { type: 'roll' }, false);
  }
  const snap = a.snapshot();

  const b = makeHustle({ seed: 999 });
  b.restore(snap);
  assert.equal(b.publicState().positions.p1, a.publicState().positions.p1);
  assert.equal(b.publicState().currentPlayerId, a.publicState().currentPlayerId);
  assert.equal(b.publicState().boardLength, a.publicState().boardLength);
});

// ── Bot ──────────────────────────────────────────────────────────────────

test('bot rolls during its turn', () => {
  const runtime = makeHustle({ eventDensity: 0 });
  const intent = runtime.rankBotIntent('p1');
  assert.ok(intent);
  assert.equal(intent.type, 'roll');
  assert.equal(runtime.handleIntent('p1', intent, false), true);
});

test('bot returns null when not its turn', () => {
  const runtime = makeHustle();
  assert.equal(runtime.rankBotIntent('p2'), null);
});

// ── Legal intents ────────────────────────────────────────────────────────

test('only roll intent available', () => {
  const runtime = makeHustle();
  const intents = runtime.legalIntents('p1');
  assert.equal(intents.length, 1);
  assert.equal(intents[0].type, 'roll');
});

test('empty legal intents for non-active player', () => {
  const runtime = makeHustle();
  assert.deepEqual(runtime.legalIntents('p2'), []);
});
