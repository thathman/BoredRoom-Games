// Whot runtime tests — deck, shuffle, legal play, special cards, bots, restore, scoring

import assert from 'node:assert/strict';
import test from 'node:test';
import { WhotRuntime, WHOT_DECK, WHOT_SHAPES, createWhotDeck } from '../../../runtime/games/whot.js';
import { createPlugin } from '../../../runtime/game-runtime.js';

function makeWhot(settings = {}) {
  const runtime = new WhotRuntime({
    id: 'whot', name: 'Whot', emoji: '🃏', version: '1.2.0.0',
    minPlayers: 2, maxPlayers: 8,
    capabilities: { bots: true, audience: true, hints: true, restore: true },
  });
  runtime.configure({ sessionId: 's', gameRunId: 'r', settings: { allowBots: true, seed: 42, ...settings } });
  runtime.seatPlayers([{ id: 'p1', name: 'Ada' }, { id: 'p2', name: 'Tobi' }]);
  runtime.start();
  return runtime;
}

// Helper: white-box override for a known hand state
function setHands(runtime, p1Cards, p2Cards) {
  const makeCard = (shape, number, index) => ({
    id: `h${index}`, shape, number, label: shape === 'Whot' ? 'Whot 20' : `${shape} ${number}`, isWhot: shape === 'Whot',
  });
  runtime.hands = {
    p1: p1Cards.map(([shape, number], i) => makeCard(shape, number, i)),
    p2: p2Cards.map(([shape, number], i) => makeCard(shape, number, i + 10)),
  };
  runtime.state.players = runtime.state.players.map((p) => ({
    ...p, handCount: runtime.hands[p.id]?.length ?? 0,
  }));
  runtime.state.pendingPick = 0;
  runtime.state.pendingPickRank = null;
}

// ── Deck ──────────────────────────────────────────────────────────────────

test('deck has exactly 54 cards', () => {
  assert.equal(WHOT_DECK.length, 54);
});

test('deck has correct per-shape counts', () => {
  const counts = {};
  for (const card of WHOT_DECK) {
    counts[card.shape] = (counts[card.shape] || 0) + 1;
  }
  assert.equal(counts.Circle, 12);
  assert.equal(counts.Triangle, 12);
  assert.equal(counts.Cross, 9);
  assert.equal(counts.Square, 9);
  assert.equal(counts.Star, 7);
  assert.equal(counts.Whot, 5);
});

test('all Whot cards are number 20 with isWhot true', () => {
  const whots = WHOT_DECK.filter((c) => c.isWhot);
  assert.equal(whots.length, 5);
  for (const card of whots) {
    assert.equal(card.number, 20);
    assert.equal(card.shape, 'Whot');
  }
});

test('createWhotDeck produces fresh independent deck', () => {
  const deck1 = createWhotDeck();
  const deck2 = createWhotDeck();
  assert.equal(deck1.length, 54);
  assert.equal(deck2.length, 54);
  // Same structure but independent instances (different id strings)
  assert.equal(deck1[0].shape, deck2[0].shape);
});

// ── Deterministic shuffle ────────────────────────────────────────────────

test('same seed produces identical initial state', () => {
  const a = makeWhot({ seed: 42 });
  const b = makeWhot({ seed: 42 });
  assert.equal(a.publicState().topCard.id, b.publicState().topCard.id);
  assert.equal(a.privateState('p1').hand.length, b.privateState('p1').hand.length);
  assert.equal(a.privateState('p1').hand[0].id, b.privateState('p1').hand[0].id);
});

test('different seed produces different initial state', () => {
  const a = makeWhot({ seed: 42 });
  const b = makeWhot({ seed: 99 });
  // Very unlikely same top card with different seeds
  assert.notEqual(a.publicState().topCard.id, b.publicState().topCard.id);
});

// ── Deal ──────────────────────────────────────────────────────────────────

test('each player gets the correct hand size (5 for 2 players, 4 for 3+)', () => {
  const runtime = makeWhot();
  const p1 = runtime.privateState('p1');
  const p2 = runtime.privateState('p2');
  // 2 players -> handSize = 5 (code: players.length <= 2 ? 5 : 4)
  assert.equal(p1.hand.length, 5);
  assert.equal(p2.hand.length, 5);
});

test('4 players get 4 cards each', () => {
  const runtime = new WhotRuntime({
    id: 'whot', name: 'Whot', emoji: '🃏', version: '1.2.0.0',
    minPlayers: 2, maxPlayers: 8,
    capabilities: { bots: true, audience: true, hints: true, restore: true },
  });
  runtime.configure({ sessionId: 's', gameRunId: 'r', settings: { allowBots: true, seed: 42 } });
  runtime.seatPlayers([
    { id: 'p1', name: 'A' }, { id: 'p2', name: 'B' },
    { id: 'p3', name: 'C' }, { id: 'p4', name: 'D' },
  ]);
  runtime.start();
  assert.equal(runtime.privateState('p1').hand.length, 4);
  assert.equal(runtime.privateState('p2').hand.length, 4);
});

test('top card is never a Whot card', () => {
  const runtime = makeWhot();
  assert.equal(runtime.publicState().topCard.isWhot, false);
});

test('hands are private — not in public state', () => {
  const runtime = makeWhot();
  const pub = JSON.stringify(runtime.publicState());
  const p1 = runtime.privateState('p1');
  for (const card of p1.hand) {
    assert.equal(pub.includes(card.id), false);
  }
});

// ── Legal / illegal play ─────────────────────────────────────────────────

test('can play a matching shape', () => {
  const runtime = makeWhot();
  setHands(runtime, [['Circle', 3], ['Cross', 7]], [['Triangle', 4]]);
  runtime.state.topCard = { id: 't', shape: 'Circle', number: 10, label: 'Circle 10', isWhot: false };
  runtime.state.currentPlayerId = 'p1';
  const legal = runtime.legalIntents('p1');
  assert.ok(legal.some((i) => i.type === 'play_card' && i.cardId === 'h0')); // Circle 3 matches Circle
  assert.equal(runtime.handleIntent('p1', { type: 'play_card', cardId: 'h0' }, false), true);
});

test('can play a matching number', () => {
  const runtime = makeWhot();
  setHands(runtime, [['Circle', 10], ['Triangle', 7]], [['Cross', 4]]);
  runtime.state.topCard = { id: 't', shape: 'Star', number: 10, label: 'Star 10', isWhot: false };
  runtime.state.currentPlayerId = 'p1';
  assert.equal(runtime.handleIntent('p1', { type: 'play_card', cardId: 'h0' }, false), true); // Circle 10 matches #10
});

test('rejects wrong shape and wrong number', () => {
  const runtime = makeWhot();
  setHands(runtime, [['Triangle', 7]], [['Circle', 4]]);
  runtime.state.topCard = { id: 't', shape: 'Star', number: 10, label: 'Star 10', isWhot: false };
  runtime.state.currentPlayerId = 'p1';
  assert.equal(runtime.handleIntent('p1', { type: 'play_card', cardId: 'h0' }, false), false); // Triangle 7 — no match
});

test('rejects play on wrong turn', () => {
  const runtime = makeWhot();
  runtime.state.currentPlayerId = 'p1';
  assert.equal(runtime.handleIntent('p2', { type: 'play_card', cardId: 'h0' }, false), false);
});

test('rejects play of card not in hand', () => {
  const runtime = makeWhot();
  runtime.state.currentPlayerId = 'p1';
  assert.equal(runtime.handleIntent('p1', { type: 'play_card', cardId: 'nonexistent' }, false), false);
});

test('rejects play after round ended', () => {
  const runtime = makeWhot();
  setHands(runtime, [['Circle', 3]], [['Triangle', 4]]);
  runtime.state.topCard = { id: 't', shape: 'Circle', number: 10, label: 'Circle 10', isWhot: false };
  runtime.state.currentPlayerId = 'p1';
  runtime.handleIntent('p1', { type: 'play_card', cardId: 'h0' }, false); // p1 plays last card
  assert.equal(runtime.state.phase, 'round_end');
  assert.equal(runtime.handleIntent('p1', { type: 'play_card', cardId: 'h0' }, false), false);
});

// ── Whot call-shape ──────────────────────────────────────────────────────

test('Whot card sets requested shape', () => {
  const runtime = makeWhot();
  setHands(runtime, [['Whot', 20]], [['Circle', 3]]);
  runtime.state.topCard = { id: 't', shape: 'Circle', number: 10, label: 'Circle 10', isWhot: false };
  runtime.state.currentPlayerId = 'p1';
  assert.equal(runtime.handleIntent('p1', { type: 'play_card', cardId: 'h0', calledShape: 'Star' }, false), true);
  assert.equal(runtime.publicState().topCard.isWhot, true);
  assert.equal(runtime.publicState().requestedShape, 'Star');
});

test('Whot call-shape rejects invalid shape', () => {
  const runtime = makeWhot();
  setHands(runtime, [['Whot', 20]], [['Circle', 3]]);
  runtime.state.topCard = { id: 't', shape: 'Circle', number: 10, label: 'Circle 10', isWhot: false };
  runtime.state.currentPlayerId = 'p1';
  // Card goes back to hand on illegal call
  assert.equal(runtime.handleIntent('p1', { type: 'play_card', cardId: 'h0', calledShape: 'Invalid' }, false), false);
  assert.equal(runtime.privateState('p1').hand.length, 1);
});

test('after Whot call, next player must match requested shape', () => {
  const runtime = makeWhot();
  setHands(runtime, [['Whot', 20], ['Circle', 3]], [['Star', 7], ['Triangle', 3]]);
  runtime.state.topCard = { id: 't', shape: 'Circle', number: 10, label: 'Circle 10', isWhot: false };
  runtime.state.currentPlayerId = 'p1';
  runtime.handleIntent('p1', { type: 'play_card', cardId: 'h0', calledShape: 'Star' }, false);
  assert.equal(runtime.state.currentPlayerId, 'p2');
  // p2 can play Star 7 (matches requested Star) but not Triangle 3
  assert.equal(runtime.handleIntent('p2', { type: 'play_card', cardId: 'h11' }, false), false); // Triangle 3
  assert.equal(runtime.handleIntent('p2', { type: 'play_card', cardId: 'h10' }, false), true);  // Star 7
});

// ── Pick Two / Pick Three stacking ───────────────────────────────────────

test('Pick Two forces next player to draw or stack', () => {
  const runtime = makeWhot();
  setHands(runtime, [['Circle', 2], ['Circle', 3]], [['Circle', 2], ['Circle', 4]]);
  runtime.state.topCard = { id: 't', shape: 'Circle', number: 10, label: 'Circle 10', isWhot: false };
  runtime.state.currentPlayerId = 'p1';
  runtime.specialsOn = true;

  assert.equal(runtime.handleIntent('p1', { type: 'play_card', cardId: 'h0' }, false), true); // Pick Two
  assert.equal(runtime.state.pendingPick, 2);
  assert.equal(runtime.state.pendingPickRank, 2);
  assert.equal(runtime.state.currentPlayerId, 'p2');

  // p2 can stack with their Circle 2
  assert.equal(runtime.handleIntent('p2', { type: 'play_card', cardId: 'h10' }, false), true); // Stack Pick Two
  assert.equal(runtime.state.pendingPick, 4);
  assert.equal(runtime.state.currentPlayerId, 'p1');

  // p1 must serve or stack — Circle 3 is not a 2, rejected
  assert.equal(runtime.handleIntent('p1', { type: 'play_card', cardId: 'h1' }, false), false);

  // p1 draws
  assert.equal(runtime.handleIntent('p1', { type: 'draw' }, false), true);
  assert.equal(runtime.state.pendingPick, 0);
});

test('Pick Three works like Pick Two with rank 5', () => {
  const runtime = makeWhot();
  setHands(runtime, [['Circle', 5], ['Triangle', 3], ['Circle', 7]], [['Cross', 5], ['Triangle', 8]]);
  runtime.state.topCard = { id: 't', shape: 'Circle', number: 10, label: 'Circle 10', isWhot: false };
  runtime.state.currentPlayerId = 'p1';
  runtime.specialsOn = true;

  assert.equal(runtime.handleIntent('p1', { type: 'play_card', cardId: 'h0' }, false), true);
  assert.equal(runtime.state.pendingPick, 3);
  assert.equal(runtime.state.pendingPickRank, 5);
  // p2 stacks with Cross 5
  assert.equal(runtime.handleIntent('p2', { type: 'play_card', cardId: 'h10' }, false), true);
  assert.equal(runtime.state.pendingPick, 6);
});

test('cannot play non-matching card while pick is pending', () => {
  const runtime = makeWhot();
  setHands(runtime, [['Circle', 2], ['Circle', 7]], [['Triangle', 7]]);
  runtime.state.topCard = { id: 't', shape: 'Circle', number: 10, label: 'Circle 10', isWhot: false };
  runtime.state.currentPlayerId = 'p1';
  runtime.specialsOn = true;
  runtime.handleIntent('p1', { type: 'play_card', cardId: 'h0' }, false);
  assert.equal(runtime.state.pendingPick, 2);
  // p2 can only play 2s — Triangle 7 is rejected
  assert.equal(runtime.handleIntent('p2', { type: 'play_card', cardId: 'h10' }, false), false);
  // Draw is the only option
  assert.deepEqual(runtime.legalIntents('p2'), [{ type: 'draw', label: 'Pick 2' }]);
});

// ── Hold On (1) ──────────────────────────────────────────────────────────

test('Hold On lets player play again', () => {
  const runtime = makeWhot();
  setHands(runtime, [['Circle', 1], ['Circle', 3], ['Cross', 7]], [['Triangle', 4]]);
  runtime.state.topCard = { id: 't', shape: 'Circle', number: 10, label: 'Circle 10', isWhot: false };
  runtime.state.currentPlayerId = 'p1';
  runtime.specialsOn = true;

  assert.equal(runtime.handleIntent('p1', { type: 'play_card', cardId: 'h0' }, false), true); // Hold On
  assert.equal(runtime.state.currentPlayerId, 'p1'); // same player again
  assert.equal(runtime.handleIntent('p1', { type: 'play_card', cardId: 'h1' }, false), true); // Circle 3 (non-special)
  assert.equal(runtime.state.currentPlayerId, 'p2'); // turn passed
});

// ── Suspension (8) ───────────────────────────────────────────────────────

test('Suspension skips next player', () => {
  const runtime = makeWhot();
  setHands(runtime, [['Circle', 8], ['Triangle', 3]], [['Triangle', 4]]);
  runtime.state.topCard = { id: 't', shape: 'Circle', number: 10, label: 'Circle 10', isWhot: false };
  runtime.state.currentPlayerId = 'p1';
  runtime.specialsOn = true;

  assert.equal(runtime.handleIntent('p1', { type: 'play_card', cardId: 'h0' }, false), true); // Suspension
  // With 2 players, Suspension(8) advances by 2, which wraps back to p1
  assert.equal(runtime.state.currentPlayerId, 'p1');
});

// ── General Market (14) ──────────────────────────────────────────────────

test('General Market makes opponents draw one card each', () => {
  const runtime = makeWhot();
  setHands(runtime, [['Circle', 14], ['Circle', 3]], [['Triangle', 4]]);
  runtime.state.topCard = { id: 't', shape: 'Circle', number: 10, label: 'Circle 10', isWhot: false };
  runtime.state.currentPlayerId = 'p1';
  runtime.specialsOn = true;

  const p2HandBefore = runtime.privateState('p2').hand.length;
  assert.equal(runtime.handleIntent('p1', { type: 'play_card', cardId: 'h0' }, false), true);
  assert.equal(runtime.privateState('p2').hand.length, p2HandBefore + 1); // p2 drew 1
});

// ── Reverse (11) ─────────────────────────────────────────────────────────

test('Reverse flips direction when enabled', () => {
  const runtime = makeWhot({ enableDirection: true });
  setHands(runtime, [['Circle', 11], ['Circle', 7]], [['Circle', 5], ['Triangle', 3]]);
  runtime.state.topCard = { id: 't', shape: 'Circle', number: 10, label: 'Circle 10', isWhot: false };
  runtime.state.currentPlayerId = 'p1';
  runtime.specialsOn = true;

  assert.equal(runtime.handleIntent('p1', { type: 'play_card', cardId: 'h0' }, false), true); // Reverse
  assert.equal(runtime.direction, -1);
  assert.equal(runtime.state.currentPlayerId, 'p2');

  // p2 plays Circle 5 (matches Circle from top card), direction reversed so next goes back to p1
  assert.equal(runtime.handleIntent('p2', { type: 'play_card', cardId: 'h10' }, false), true);
  assert.equal(runtime.state.currentPlayerId, 'p1');
});

test('Reverse card treated as normal card when direction disabled', () => {
  const runtime = makeWhot({ enableDirection: false });
  setHands(runtime, [['Circle', 11], ['Circle', 7]], [['Triangle', 3]]);
  runtime.state.topCard = { id: 't', shape: 'Circle', number: 10, label: 'Circle 10', isWhot: false };
  runtime.state.currentPlayerId = 'p1';
  assert.equal(runtime.handleIntent('p1', { type: 'play_card', cardId: 'h0' }, false), true); // normal play
  assert.equal(runtime.state.currentPlayerId, 'p2');
  assert.equal(runtime.direction, 1);
});

// ── Draw pile exhaustion ─────────────────────────────────────────────────

test('discard reshuffles into draw pile when empty', () => {
  const runtime = makeWhot();
  setHands(runtime, [['Circle', 3], ['Circle', 7], ['Circle', 5]], [['Triangle', 4]]);
  runtime.state.topCard = { id: 't', shape: 'Circle', number: 10, label: 'Circle 10', isWhot: false };
  runtime.state.currentPlayerId = 'p1';
  runtime.deck = []; // empty deck
  runtime.discard = [{ id: 'd1', shape: 'Cross', number: 7, label: 'Cross 7', isWhot: false }];
  runtime.state.drawPileCount = 0;

  // p1 plays Circle 3 — old top card (Circle 10) goes to discard
  runtime.handleIntent('p1', { type: 'play_card', cardId: 'h0' }, false);
  assert.equal(runtime.discard.length, 2); // Circle 10 + d1
  assert.equal(runtime.deck.length, 0);

  // p2's turn: draw triggers reshuffle
  const p2HandBefore = runtime.privateState('p2').hand.length;
  runtime.handleIntent('p2', { type: 'draw' }, false);
  // After reshuffle + draw: discard cleared, 1 card drawn from recycled 2
  assert.equal(runtime.discard.length, 0);
  assert.equal(runtime.privateState('p2').hand.length, p2HandBefore + 1);
});

// ── Round win ────────────────────────────────────────────────────────────

test('playing last card ends the round', () => {
  const runtime = makeWhot();
  setHands(runtime, [['Circle', 3]], [['Triangle', 4]]);
  runtime.state.topCard = { id: 't', shape: 'Circle', number: 10, label: 'Circle 10', isWhot: false };
  runtime.state.currentPlayerId = 'p1';
  assert.equal(runtime.handleIntent('p1', { type: 'play_card', cardId: 'h0' }, false), true);
  assert.equal(runtime.state.phase, 'round_end');
  assert.deepEqual(runtime.state.winnerPlayerIds, ['p1']);
});

test('round winner gets pips from opponents remaining cards', () => {
  const runtime = makeWhot();
  setHands(runtime, [['Circle', 3]], [['Triangle', 4]]);
  runtime.state.topCard = { id: 't', shape: 'Circle', number: 10, label: 'Circle 10', isWhot: false };
  runtime.state.currentPlayerId = 'p1';
  runtime.handleIntent('p1', { type: 'play_card', cardId: 'h0' }, false);
  // p2 had Triangle 4 = 4 pips
  assert.ok(runtime.publicState().players.find((p) => p.id === 'p1').score >= 4);
});

// ── Multi-round ──────────────────────────────────────────────────────────

test('multi-round game advances rounds', () => {
  const runtime = makeWhot({ maxRounds: 3 });
  // Round 1: p1 wins
  setHands(runtime, [['Circle', 3]], [['Triangle', 10, 12, 14]]);
  runtime.state.topCard = { id: 't', shape: 'Circle', number: 10, label: 'Circle 10', isWhot: false };
  runtime.state.currentPlayerId = 'p1';
  runtime.handleIntent('p1', { type: 'play_card', cardId: 'h0' }, false);
  assert.equal(runtime.state.phase, 'round_end');
  // Host advances
  assert.equal(runtime.handleIntent('p1', { type: 'advance' }, true), true);
  assert.equal(runtime.state.round, 2);
  assert.equal(runtime.state.phase, 'playing');
});

// ── Finish / game end ────────────────────────────────────────────────────

test('finish returns winnerPlayerIds', () => {
  const runtime = makeWhot();
  const result = runtime.finish();
  assert.ok(Array.isArray(result.winnerPlayerIds));
});

// ── Snapshot / restore ───────────────────────────────────────────────────

test('snapshot and restore preserves complete state', () => {
  const a = makeWhot();
  // Make a move
  setHands(a, [['Circle', 3], ['Cross', 7]], [['Triangle', 4]]);
  a.state.topCard = { id: 't', shape: 'Circle', number: 10, label: 'Circle 10', isWhot: false };
  a.state.currentPlayerId = 'p1';
  a.handleIntent('p1', { type: 'play_card', cardId: 'h0' }, false);

  const snap = a.snapshot();

  const b = makeWhot();
  b.restore(snap);

  // Restored state matches
  assert.equal(b.publicState().round, a.publicState().round);
  assert.equal(b.publicState().phase, a.publicState().phase);
  assert.equal(b.privateState('p1').hand.length, a.privateState('p1').hand.length);
  assert.equal(b.privateState('p2').hand.length, a.privateState('p2').hand.length);
  assert.deepEqual(b.publicState().winnerPlayerIds, a.publicState().winnerPlayerIds);

  // Can continue playing after restore
  assert.equal(b.state.currentPlayerId, a.state.currentPlayerId);
});

// ── Bot ──────────────────────────────────────────────────────────────────

test('bot generates valid intent during its turn', () => {
  const runtime = makeWhot();
  setHands(runtime, [['Circle', 3], ['Cross', 7]], [['Triangle', 4]]);
  runtime.state.topCard = { id: 't', shape: 'Circle', number: 10, label: 'Circle 10', isWhot: false };
  runtime.state.currentPlayerId = 'p1';
  const intent = runtime.rankBotIntent('p1');
  assert.ok(intent);
  assert.ok(intent.type === 'play_card' || intent.type === 'draw');
  assert.ok(runtime.handleIntent('p1', intent, false) === true);
});

test('bot returns null when no legal intents', () => {
  const runtime = makeWhot();
  runtime.state.phase = 'finished';
  assert.equal(runtime.rankBotIntent('p1'), null);
});

test('bot prioritises special cards', () => {
  const runtime = makeWhot();
  setHands(runtime, [['Circle', 14], ['Triangle', 3]], [['Triangle', 4]]);
  runtime.state.topCard = { id: 't', shape: 'Circle', number: 10, label: 'Circle 10', isWhot: false };
  runtime.state.currentPlayerId = 'p1';
  runtime.specialsOn = true;
  const intent = runtime.rankBotIntent('p1');
  // Should prefer General Market (14) over Triangle 3
  assert.equal(intent.cardId, 'h0');
});

// ── Special cards disabled ───────────────────────────────────────────────

test('with specialCards off, all cards play as regular', () => {
  const runtime = makeWhot({ specialCards: false });
  setHands(runtime, [['Circle', 2], ['Circle', 5], ['Circle', 14]], [['Triangle', 3]]);
  runtime.state.topCard = { id: 't', shape: 'Circle', number: 10, label: 'Circle 10', isWhot: false };
  runtime.state.currentPlayerId = 'p1';

  // Pick Two plays as regular card — no pending pick
  assert.equal(runtime.handleIntent('p1', { type: 'play_card', cardId: 'h0' }, false), true);
  assert.equal(runtime.state.pendingPick, 0);
});

// ── Reject illegal intents ───────────────────────────────────────────────

test('legal intents do not reveal opponent hands', () => {
  const runtime = makeWhot();
  const p1Legal = runtime.legalIntents('p1');
  const p2Legal = runtime.legalIntents('p2');
  // Legal intents should not contain opponent card IDs
  const p1HandIds = runtime.privateState('p1').hand.map((c) => c.id);
  const p2HandIds = runtime.privateState('p2').hand.map((c) => c.id);
  for (const intent of p1Legal) {
    if (intent.cardId) assert.ok(p1HandIds.includes(intent.cardId));
  }
  for (const intent of p2Legal) {
    if (intent.cardId) assert.ok(p2HandIds.includes(intent.cardId));
  }
});

test('explainIntent returns readable message for rejected action', () => {
  const runtime = makeWhot();
  const msg = runtime.explainIntent({ type: 'invalid' });
  assert.ok(typeof msg === 'string');
  assert.ok(msg.length > 0);
});
