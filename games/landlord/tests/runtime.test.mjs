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

test('owning a full colour set doubles the base rent', () => {
  const r = makeLL();
  // Market set is indexes 1 and 3 (Mile 12, Alaba), rent 400 each.
  r.properties.p2 = [1, 3];
  r.positions.p2 = 0;
  r.state.currentPlayerId = 'p1';
  forceRoll(r, 1); // p1 -> index 1, owned by p2 with full set
  r.handleIntent('p1', { type: 'roll' }, false);
  assert.equal(r.privateState('p1').cash, 50000 - 800); // 400 * 2 monopoly bonus
});

test('building a house increases rent and costs cash', () => {
  const r = makeLL();
  r.properties.p1 = [1, 3]; // full market set
  r.state.currentPlayerId = 'p1';
  // buy_house should be a legal management intent
  const houseIntent = r.legalIntents('p1').find((i) => i.type === 'buy_house' && i.position === 1);
  assert.ok(houseIntent);
  assert.equal(r.handleIntent('p1', { type: 'buy_house', position: 1 }, false), true);
  assert.equal(r.publicState().houses['1'], 1);
  assert.equal(r.privateState('p1').cash, 50000 - 3000); // house cost = price/2 = 3000
  // rent now: 400 base * 2 set * (1 + 1 house) = 1600
  assert.equal(r.rentFor(1), 1600);
});

test('mortgaging raises cash and suspends rent; unmortgage restores it', () => {
  const r = makeLL();
  r.properties.p1 = [1];
  r.state.currentPlayerId = 'p1';
  assert.equal(r.handleIntent('p1', { type: 'mortgage', position: 1 }, false), true);
  assert.equal(r.privateState('p1').cash, 50000 + 3000); // +price/2
  assert.equal(r.rentFor(1), 0); // mortgaged = no rent
  assert.equal(r.handleIntent('p1', { type: 'unmortgage', position: 1 }, false), true);
  assert.equal(r.rentFor(1), 400);
});

test('a jail wahala card jails the player; paying bail frees them', () => {
  const r = makeLL();
  r.state.currentPlayerId = 'p1';
  r.wahalaDeck = [{ text: 'Police!', effect: 'jail' }];
  r.wahalaIndex = 0;
  forceRoll(r, 2); // index 2 = Wahala Card
  r.handleIntent('p1', { type: 'roll' }, false);
  assert.equal(r.publicState().jail.p1 > 0, true);
  assert.equal(r.publicState().positions.p1, 10); // moved to Police Holding
  // Back on p1's turn: pay bail
  r.state.currentPlayerId = 'p1';
  const bail = r.legalIntents('p1').find((i) => i.type === 'pay_bail');
  assert.ok(bail);
  assert.equal(r.handleIntent('p1', { type: 'pay_bail' }, false), true);
  assert.equal(r.publicState().jail.p1, 0);
  assert.equal(r.privateState('p1').cash, 50000 - 5000);
});

test('houses, mortgages and jail survive snapshot/restore', () => {
  const r = makeLL();
  r.properties.p1 = [1, 3];
  r.state.currentPlayerId = 'p1';
  r.handleIntent('p1', { type: 'buy_house', position: 1 }, false);
  r.jail.p2 = 2;
  r.updatePlayerCash();
  const snap = r.snapshot();
  const r2 = new LandlordRuntime({ id: 'landlord', name: 'Oga Landlord', emoji: '🏠', version: '1.2.0.0', minPlayers: 2, maxPlayers: 6, capabilities: { bots: true, audience: true, hints: false, restore: true } });
  r2.configure({ sessionId: 's', gameRunId: 'r', settings: {} });
  r2.seatPlayers([]);
  r2.start();
  r2.restore(snap);
  assert.equal(r2.houses['1'], 1);
  assert.equal(r2.jail.p2, 2);
  assert.deepEqual(r2.publicState(), r.publicState());
});

test('passing Start awards the GO bonus', () => {
  const r = makeLL();
  r.positions.p1 = 18; // NEPA Bill; rolling will wrap past Start
  r.state.currentPlayerId = 'p1';
  forceRoll(r, 5); // 18 -> (18+5)%20 = 3, wraps past 0
  const before = r.cash.p1;
  r.handleIntent('p1', { type: 'roll' }, false);
  // landed on index 3 (Alaba, a buyable property) so no rent/tax; cash only changes by +PASS_GO
  assert.equal(r.cash.p1, before + 20000);
});

test('three doubles in a row sends a player to jail', () => {
  const r = makeLL();
  r.state.currentPlayerId = 'p1';
  r.doublesStreak.p1 = 2; // two doubles already this turn-chain
  r.rng = () => (3 - 1) / 6 + 0.01; // next roll is a double (3,3) -> the third
  assert.equal(r.handleIntent('p1', { type: 'roll' }, false), true);
  assert.equal(r.publicState().jail.p1 > 0, true);
  assert.equal(r.publicState().positions.p1, 10); // straight to Police Holding, no normal move
});

test('passing an unowned property starts an auction and highest remaining bidder wins', () => {
  const r = makeLL({}, [
    { id: 'p1', name: 'Ada' },
    { id: 'p2', name: 'Tobi' },
    { id: 'p3', name: 'Uche' },
  ]);
  forceRoll(r, 1);
  r.handleIntent('p1', { type: 'roll' }, false);
  assert.equal(r.handleIntent('p1', { type: 'pass' }, false), true);
  assert.equal(r.publicState().auction.propertyPosition, 1);
  assert.equal(r.handleIntent('p2', { type: 'auction_bid', amount: 4000 }, false), true);
  assert.equal(r.handleIntent('p1', { type: 'auction_pass' }, false), true);
  assert.equal(r.handleIntent('p3', { type: 'auction_pass' }, false), true);
  assert.equal(r.publicState().auction, null);
  assert.deepEqual(r.properties.p2, [1]);
  assert.equal(r.cash.p2, 46000);
  assert.equal(r.publicState().currentPlayerId, 'p2');
});

test('auction rejects low, unaffordable and retracted highest bids', () => {
  const r = makeLL();
  forceRoll(r, 1);
  r.handleIntent('p1', { type: 'roll' }, false);
  r.handleIntent('p1', { type: 'pass' }, false);
  assert.equal(r.handleIntent('p1', { type: 'auction_bid', amount: 100 }, false), false);
  assert.equal(r.handleIntent('p1', { type: 'auction_bid', amount: 60000 }, false), false);
  assert.equal(r.handleIntent('p1', { type: 'auction_bid', amount: 1000 }, false), true);
  assert.equal(r.handleIntent('p1', { type: 'auction_pass' }, false), false);
  assert.equal(r.handleIntent('p2', { type: 'auction_bid', amount: 1200 }, false), false);
});

test('auction closes unsold instead of stalling when nobody can meet the minimum bid', () => {
  const r = makeLL();
  r.cash.p1 = 100;
  r.cash.p2 = 100;
  forceRoll(r, 1);
  r.handleIntent('p1', { type: 'roll' }, false);
  assert.equal(r.handleIntent('p1', { type: 'pass' }, false), true);
  assert.equal(r.publicState().auction, null);
  assert.equal(r.publicState().currentPlayerId, 'p2');
  assert.deepEqual(r.properties.p1, []);
  assert.deepEqual(r.properties.p2, []);
});

test('accepted trade atomically exchanges properties and cash', () => {
  const r = makeLL();
  r.properties.p1 = [1];
  r.properties.p2 = [6];
  r.state.properties = structuredClone(r.properties);
  assert.equal(r.handleIntent('p1', {
    type: 'propose_trade',
    targetPlayerId: 'p2',
    offeredProperties: [1],
    requestedProperties: [6],
    offeredCash: 2000,
    requestedCash: 500,
  }, false), true);
  assert.deepEqual(r.legalIntents('p2').map((intent) => intent.type), ['accept_trade', 'reject_trade']);
  assert.equal(r.handleIntent('p2', { type: 'accept_trade' }, false), true);
  assert.deepEqual(r.properties.p1, [6]);
  assert.deepEqual(r.properties.p2, [1]);
  assert.equal(r.cash.p1, 48500);
  assert.equal(r.cash.p2, 51500);
  assert.equal(r.publicState().pendingTrade, null);
});

test('trade rejects stale ownership and improved properties', () => {
  const r = makeLL();
  r.properties.p1 = [1, 3];
  r.properties.p2 = [6];
  r.houses[1] = 1;
  assert.equal(r.handleIntent('p1', {
    type: 'propose_trade', targetPlayerId: 'p2', offeredProperties: [1], requestedProperties: [6],
  }, false), false);
  delete r.houses[1];
  assert.equal(r.handleIntent('p1', {
    type: 'propose_trade', targetPlayerId: 'p2', offeredProperties: [3], requestedProperties: [6],
  }, false), true);
  r.properties.p2 = []; // asset changed while recipient was deciding
  assert.equal(r.handleIntent('p2', { type: 'accept_trade' }, false), false);
  assert.equal(r.publicState().pendingTrade, null);
});

test('auction and pending trade survive snapshot restore', () => {
  const auctionRuntime = makeLL();
  forceRoll(auctionRuntime, 1);
  auctionRuntime.handleIntent('p1', { type: 'roll' }, false);
  auctionRuntime.handleIntent('p1', { type: 'pass' }, false);
  auctionRuntime.handleIntent('p2', { type: 'auction_bid', amount: 1000 }, false);
  const auctionSnapshot = auctionRuntime.snapshot();
  const restoredAuction = makeLL();
  restoredAuction.restore(auctionSnapshot);
  assert.deepEqual(restoredAuction.publicState(), auctionRuntime.publicState());

  const tradeRuntime = makeLL();
  tradeRuntime.properties.p1 = [1];
  tradeRuntime.properties.p2 = [6];
  tradeRuntime.handleIntent('p1', {
    type: 'propose_trade', targetPlayerId: 'p2', offeredProperties: [1], requestedProperties: [6],
  }, false);
  const tradeSnapshot = tradeRuntime.snapshot();
  const restoredTrade = makeLL();
  restoredTrade.restore(tradeSnapshot);
  assert.deepEqual(restoredTrade.publicState(), tradeRuntime.publicState());
});
