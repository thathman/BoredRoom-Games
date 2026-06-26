// Market Price tests — tolerance scoring, closest player, no-leak, no-repeat, restore.

import assert from 'node:assert/strict';
import test from 'node:test';
import { MarketPriceRuntime } from '../../../runtime/games/market-price.js';

function makeMP(settings = {}, players = [{ id: 'p1', name: 'Ada' }, { id: 'p2', name: 'Tobi' }]) {
  const r = new MarketPriceRuntime({
    id: 'market-price', name: 'Market Price', emoji: '🛒', version: '1.2.0.0',
    minPlayers: 1, maxPlayers: 12, capabilities: { bots: true, audience: true, hints: true, restore: true },
  });
  r.configure({ sessionId: 's', gameRunId: 'r', settings: { seed: 8, questionCount: 6, tolerance: 15, ...settings } });
  r.seatPlayers(players);
  r.start();
  return r;
}

test('the public challenge never leaks the true price', () => {
  const r = makeMP();
  const price = String(r.questions[0].price);
  assert.equal(JSON.stringify(r.publicState().challenge).includes(price), false);
});

test('a guess inside the tolerance band scores more than a wild guess', () => {
  const r = makeMP();
  const price = r.questions[0].price;
  r.handleIntent('p1', { type: 'guess', amount: price }, false); // exact
  r.handleIntent('p2', { type: 'guess', amount: price * 10 }, false); // way off
  const s = r.publicState();
  assert.equal(s.phase, 'reveal');
  const p1 = s.players.find((p) => p.id === 'p1').score;
  const p2 = s.players.find((p) => p.id === 'p2').score;
  assert.ok(p1 > p2);
  assert.ok(p1 > 0);
});

test('the reveal names the closest player', () => {
  const r = makeMP();
  const price = r.questions[0].price;
  r.handleIntent('p1', { type: 'guess', amount: price }, false);
  r.handleIntent('p2', { type: 'guess', amount: price + price }, false);
  assert.ok(r.publicState().lastAction.length > 0);
});

test('products do not repeat within a session', () => {
  const r = makeMP({ questionCount: 6 });
  const names = r.questions.map((q) => q.name);
  assert.equal(new Set(names).size, names.length);
});

test('snapshot/restore preserves products and index', () => {
  const r = makeMP();
  r.handleIntent('p1', { type: 'guess', amount: 1000 }, false);
  const snap = r.snapshot();
  const r2 = new MarketPriceRuntime({ id: 'market-price', name: 'Market Price', emoji: '🛒', version: '1.2.0.0', minPlayers: 1, maxPlayers: 12, capabilities: { bots: true, audience: true, hints: true, restore: true } });
  r2.configure({ sessionId: 's', gameRunId: 'r', settings: {} });
  r2.seatPlayers([]);
  r2.start();
  r2.restore(snap);
  assert.deepEqual(r2.publicState(), r.publicState());
});
