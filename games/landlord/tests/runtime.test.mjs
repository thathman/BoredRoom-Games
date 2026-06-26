// Oga Landlord tests — movement, buying, rent (owner lookup), wahala, bankruptcy, restore.

import assert from 'node:assert/strict';
import test from 'node:test';
import { LandlordRuntime } from '../../../runtime/games/landlord.js';

function makeLL(settings = {}, players = [{ id: 'p1', name: 'Ada' }, { id: 'p2', name: 'Tobi' }]) {
  const r = new LandlordRuntime({
    id: 'landlord', name: 'Oga Landlord', emoji: '🏠', version: '1.2.0.0',
    minPlayers: 2, maxPlayers: 6, capabilities: { bots: true, audience: true, hints: false, restore: true },
  });
  r.configure({ sessionId: 's', gameRunId: 'r', settings: { seed: 1, startingCash: 50000, ...settings } });
  r.seatPlayers(players);
  r.start();
  return r;
}

// Force the next roll to a specific total (no double) by stubbing the rng.
function forceRoll(r, total) {
  const d1 = 1, d2 = total - 1; // never equal for total>2 except 2; fine for our totals
  const vals = [(d1 - 1) / 6 + 0.01, (d2 - 1) / 6 + 0.01];
  let i = 0;
  r.rng = () => vals[i++ % vals.length];
}

test('every player starts on Start with the configured cash', () => {
  const r = makeLL({ startingCash: 40000 });
  assert.equal(r.privateState('p1').cash, 40000);
  assert.equal(r.privateState('p1').position, 0);
});

test('rolling moves the player and offers to buy an unowned property', () => {
  const r = makeLL();
  forceRoll(r, 1); // 0 -> 1 = Mile 12 Market (property)
  assert.equal(r.handleIntent('p1', { type: 'roll' }, false), true);
  assert.equal(r.privateState('p1').position, 1);
  const kinds = r.legalIntents('p1').map((i) => i.type).sort();
  assert.deepEqual(kinds, ['buy', 'pass']);
});

test('buying a property debits cash and records ownership', () => {
  const r = makeLL();
  forceRoll(r, 1);
  r.handleIntent('p1', { type: 'roll' }, false); // land on Mile 12 (₦6000)
  assert.equal(r.handleIntent('p1', { type: 'buy' }, false), true);
  assert.equal(r.privateState('p1').cash, 44000);
  assert.deepEqual(r.privateState('p1').properties, [1]);
});

test('landing on an owned property pays rent to the owner (correct owner lookup)', () => {
  const r = makeLL();
  // p2 owns Mile 12 Market (index 1, rent 400). p1 standing elsewhere should not confuse lookup.
  r.properties.p2 = [1];
  r.positions.p2 = 1; // p2 standing on its own property — the old bug returned p2 for any cell
  r.state.currentPlayerId = 'p1';
  forceRoll(r, 1); // p1: 0 -> 1
  r.handleIntent('p1', { type: 'roll' }, false);
  assert.equal(r.privateState('p1').cash, 50000 - 400);
  assert.equal(r.cash.p2, 50000 + 400);
});

test('a tax cell debits the player', () => {
  const r = makeLL();
  forceRoll(r, 4); // 0 -> 4 = Tax Office (₦2000)
  r.handleIntent('p1', { type: 'roll' }, false);
  assert.equal(r.privateState('p1').cash, 48000);
});

test('a pay wahala card that bankrupts a player ends the game', () => {
  const r = makeLL();
  r.cash.p1 = 100; // almost broke
  r.state.currentPlayerId = 'p1';
  // Make the next wahala card a big pay card.
  r.wahalaDeck = [{ text: 'Huge bill', effect: 'pay', amount: 999999 }];
  r.wahalaIndex = 0;
  forceRoll(r, 2); // 0 -> 2 = Wahala Card
  r.handleIntent('p1', { type: 'roll' }, false);
  assert.equal(r.publicState().phase, 'finished');
});

test('snapshot/restore preserves cash, positions, properties and the wahala deck', () => {
  const r = makeLL();
  forceRoll(r, 1);
  r.handleIntent('p1', { type: 'roll' }, false);
  r.handleIntent('p1', { type: 'buy' }, false);
  const snap = r.snapshot();
  const r2 = new LandlordRuntime({ id: 'landlord', name: 'Oga Landlord', emoji: '🏠', version: '1.2.0.0', minPlayers: 2, maxPlayers: 6, capabilities: { bots: true, audience: true, hints: false, restore: true } });
  r2.configure({ sessionId: 's', gameRunId: 'r', settings: {} });
  r2.seatPlayers([]);
  r2.start();
  r2.restore(snap);
  assert.deepEqual(r2.publicState(), r.publicState());
  assert.deepEqual(r2.properties, r.properties);
});
