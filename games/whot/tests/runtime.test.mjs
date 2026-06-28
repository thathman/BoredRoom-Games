// Whot runtime tests — deck, shuffle, legal play, special cards, bots, restore, scoring

import assert from 'node:assert/strict';
import test from 'node:test';
import { WhotRuntime, WHOT_DECK, WHOT_SHAPES, createWhotDeck } from '../../../runtime/games/whot.js';
import { createPlugin } from '../../../runtime/game-runtime.js';

function makeWhot(settings = {}, players = [{ id: 'p1', name: 'Ada' }, { id: 'p2', name: 'Tobi' }]) {
  const runtime = new WhotRuntime({
    id: 'whot', name: 'Whot', emoji: '🃏', version: '1.2.0.0',
    minPlayers: 2, maxPlayers: 8,
    capabilities: { bots: true, audience: true, hints: true, restore: true },
  });
  runtime.configure({ sessionId: 's', gameRunId: 'r', settings: { allowBots: true, seed: 42, ...settings } });
  runtime.seatPlayers(players);
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

test('the standard deal gives every player six cards', () => {
  const runtime = makeWhot();
  const p1 = runtime.privateState('p1');
  const p2 = runtime.privateState('p2');
  assert.equal(p1.hand.length, 6);
  assert.equal(p2.hand.length, 6);
  assert.equal(runtime.publicState().settings.initialHandSize, 6);
});

test('the house can choose a shorter four-card deal', () => {
  const runtime = makeWhot({ initialHandSize: 4 }, [
    { id: 'p1', name: 'A' }, { id: 'p2', name: 'B' },
    { id: 'p3', name: 'C' }, { id: 'p4', name: 'D' },
  ]);
  assert.equal(runtime.privateState('p1').hand.length, 4);
  assert.equal(runtime.privateState('p2').hand.length, 4);
  assert.equal(runtime.publicState().settings.initialHandSize, 4);
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
  runtime.state.callout = { kind: 'last_card', playerId: 'p2', playerName: 'Tobi', text: 'Tobi: last card!', sequence: 1 };
  // Card goes back to hand on illegal call
  assert.equal(runtime.handleIntent('p1', { type: 'play_card', cardId: 'h0', calledShape: 'Invalid' }, false), false);
  assert.equal(runtime.privateState('p1').hand.length, 1);
  assert.equal(runtime.publicState().topCard.id, 't');
  assert.equal(runtime.publicState().callout.kind, 'last_card');
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

test('Star 8 suspends the next two players by default', () => {
  const runtime = makeWhot({}, [
    { id: 'p1', name: 'Ada' }, { id: 'p2', name: 'Tobi' },
    { id: 'p3', name: 'Ngozi' }, { id: 'p4', name: 'Femi' },
  ]);
  runtime.hands.p1 = [
    { id: 'star8', shape: 'Star', number: 8, label: 'Star 8', isWhot: false },
    { id: 'star3', shape: 'Star', number: 3, label: 'Star 3', isWhot: false },
  ];
  runtime.state.topCard = { id: 't', shape: 'Star', number: 7, label: 'Star 7', isWhot: false };
  runtime.state.currentPlayerId = 'p1';
  assert.equal(runtime.handleIntent('p1', { type: 'play_card', cardId: 'star8' }, false), true);
  assert.equal(runtime.state.currentPlayerId, 'p4');
  assert.match(runtime.state.lastAction, /next two players are suspended/i);
});

test('the house can make Star 8 use ordinary one-player suspension', () => {
  const runtime = makeWhot({ starSuspension: 'skip_one' }, [
    { id: 'p1', name: 'Ada' }, { id: 'p2', name: 'Tobi' },
    { id: 'p3', name: 'Ngozi' }, { id: 'p4', name: 'Femi' },
  ]);
  runtime.hands.p1 = [
    { id: 'star8', shape: 'Star', number: 8, label: 'Star 8', isWhot: false },
    { id: 'star3', shape: 'Star', number: 3, label: 'Star 3', isWhot: false },
  ];
  runtime.state.topCard = { id: 't', shape: 'Star', number: 7, label: 'Star 7', isWhot: false };
  runtime.state.currentPlayerId = 'p1';
  runtime.handleIntent('p1', { type: 'play_card', cardId: 'star8' }, false);
  assert.equal(runtime.state.currentPlayerId, 'p3');
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
  assert.equal(runtime.state.currentPlayerId, 'p1'); // authentic reference rule: player goes again
  assert.match(runtime.state.lastAction, /plays again/i);
});

test('the house can pass the turn after General Market', () => {
  const runtime = makeWhot({ generalMarketTurn: 'pass' });
  setHands(runtime, [['Circle', 14], ['Circle', 3]], [['Triangle', 4]]);
  runtime.state.topCard = { id: 't', shape: 'Circle', number: 10, label: 'Circle 10', isWhot: false };
  runtime.state.currentPlayerId = 'p1';
  runtime.handleIntent('p1', { type: 'play_card', cardId: 'h0' }, false);
  assert.equal(runtime.state.currentPlayerId, 'p2');
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

test('round winner gets one match point and retains pip total as a tie-break', () => {
  const runtime = makeWhot();
  setHands(runtime, [['Circle', 3]], [['Triangle', 4]]);
  runtime.state.topCard = { id: 't', shape: 'Circle', number: 10, label: 'Circle 10', isWhot: false };
  runtime.state.currentPlayerId = 'p1';
  runtime.handleIntent('p1', { type: 'play_card', cardId: 'h0' }, false);
  const winner = runtime.publicState().players.find((p) => p.id === 'p1');
  assert.equal(winner.score, 1);
  assert.equal(winner.roundWins, 1);
  assert.equal(winner.pipScore, 4);
});

// ── Multi-round ──────────────────────────────────────────────────────────

test('best-of-five match advances rounds', () => {
  const runtime = makeWhot();
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
  assert.equal(runtime.state.totalRounds, 5);
  assert.equal(runtime.state.roundsToWin, 3);
  assert.equal(runtime.state.currentPlayerId, 'p2');
});

test('the house can keep the same opening player every round', () => {
  const runtime = makeWhot({ rotateStarter: false });
  setHands(runtime, [['Circle', 3]], [['Triangle', 10]]);
  runtime.state.topCard = { id: 't', shape: 'Circle', number: 10, label: 'Circle 10', isWhot: false };
  runtime.state.currentPlayerId = 'p1';
  runtime.handleIntent('p1', { type: 'play_card', cardId: 'h0' }, false);
  runtime.handleIntent('p1', { type: 'advance' }, true);
  assert.equal(runtime.state.currentPlayerId, 'p1');
});

test('automatically calls semi last card, last card and check up', () => {
  const runtime = makeWhot();
  setHands(runtime, [['Circle', 3], ['Circle', 7], ['Circle', 10]], [['Triangle', 4]]);
  runtime.state.topCard = { id: 't', shape: 'Circle', number: 12, label: 'Circle 12', isWhot: false };
  runtime.state.currentPlayerId = 'p1';

  runtime.handleIntent('p1', { type: 'play_card', cardId: 'h0' }, false);
  assert.equal(runtime.state.callout.kind, 'semi_last_card');
  runtime.state.currentPlayerId = 'p1';
  runtime.handleIntent('p1', { type: 'play_card', cardId: 'h1' }, false);
  assert.equal(runtime.state.callout.kind, 'last_card');
  runtime.state.currentPlayerId = 'p1';
  runtime.handleIntent('p1', { type: 'play_card', cardId: 'h2' }, false);
  assert.equal(runtime.state.callout.kind, 'check_up');
  assert.equal(runtime.state.phase, 'round_end');
});

test('first player to three round wins clinches the best-of-five match', () => {
  const runtime = makeWhot();
  for (let round = 1; round <= 3; round += 1) {
    setHands(runtime, [['Circle', 3]], [['Triangle', 4]]);
    runtime.state.topCard = { id: `t${round}`, shape: 'Circle', number: 10, label: 'Circle 10', isWhot: false };
    runtime.state.currentPlayerId = 'p1';
    runtime.handleIntent('p1', { type: 'play_card', cardId: 'h0' }, false);
    if (round < 3) runtime.handleIntent('p1', { type: 'advance' }, true);
  }
  assert.equal(runtime.state.phase, 'finished');
  assert.equal(runtime.state.round, 3);
  assert.equal(runtime.state.roundWins.p1, 3);
  assert.deepEqual(runtime.state.winnerPlayerIds, ['p1']);
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

test('bot calls the shape it holds most after playing Whot 20', () => {
  const runtime = makeWhot();
  setHands(runtime, [['Whot', 20], ['Star', 3], ['Star', 4], ['Circle', 7]], [['Triangle', 4]]);
  runtime.state.topCard = { id: 't', shape: 'Circle', number: 10, label: 'Circle 10', isWhot: false };
  runtime.state.currentPlayerId = 'p1';
  const intent = runtime.rankBotIntent('p1');
  assert.equal(intent.cardId, 'h0');
  assert.equal(intent.calledShape, 'Star');
});

test('a later action clears a stale card-count callout', () => {
  const runtime = makeWhot();
  runtime.state.callout = { kind: 'last_card', playerId: 'p1', playerName: 'Ada', text: 'Ada: last card!', sequence: 2 };
  runtime.state.currentPlayerId = 'p1';
  runtime.handleIntent('p1', { type: 'draw' }, false);
  assert.equal(runtime.state.callout, null);
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

test('Whot narration includes the requested shape', () => {
  const runtime = makeWhot();
  setHands(runtime, [['Whot', 20], ['Circle', 3]], [['Star', 7]]);
  runtime.state.topCard = { id: 't', shape: 'Circle', number: 10, label: 'Circle 10', isWhot: false };
  runtime.state.currentPlayerId = 'p1';
  assert.equal(runtime.handleIntent('p1', { type: 'play_card', cardId: 'h0', calledShape: 'Star' }, false), true);
  assert.match(runtime.publicState().lastAction, /Ada played Whot 20 and requested Star/i);
});

test('house can prohibit blocking a pick request', () => {
  const runtime = makeWhot({ pickDefence: 'no_stack' });
  setHands(runtime, [['Circle', 2], ['Circle', 3]], [['Circle', 2], ['Circle', 4]]);
  runtime.state.topCard = { id: 't', shape: 'Circle', number: 10, label: 'Circle 10', isWhot: false };
  runtime.state.currentPlayerId = 'p1';
  assert.equal(runtime.handleIntent('p1', { type: 'play_card', cardId: 'h0' }, false), true);
  assert.equal(runtime.legalIntents('p2').some((intent) => intent.type === 'play_card'), false);
  assert.equal(runtime.handleIntent('p2', { type: 'play_card', cardId: 'h10' }, false), false);
});

test('house can allow either pick rank to block a request', () => {
  const runtime = makeWhot({ pickDefence: 'stack_any' });
  setHands(runtime, [['Circle', 2], ['Circle', 3]], [['Circle', 5], ['Circle', 4]]);
  runtime.state.topCard = { id: 't', shape: 'Circle', number: 10, label: 'Circle 10', isWhot: false };
  runtime.state.currentPlayerId = 'p1';
  assert.equal(runtime.handleIntent('p1', { type: 'play_card', cardId: 'h0' }, false), true);
  assert.equal(runtime.handleIntent('p2', { type: 'play_card', cardId: 'h10' }, false), true);
  assert.equal(runtime.state.pendingPick, 5);
});

test('house can prohibit finishing a round with a special card', () => {
  const runtime = makeWhot({ allowSpecialFinish: false });
  setHands(runtime, [['Circle', 2]], [['Circle', 4]]);
  runtime.state.topCard = { id: 't', shape: 'Circle', number: 10, label: 'Circle 10', isWhot: false };
  runtime.state.currentPlayerId = 'p1';
  assert.equal(runtime.legalIntents('p1').some((intent) => intent.type === 'play_card'), false);
  assert.equal(runtime.handleIntent('p1', { type: 'play_card', cardId: 'h0' }, false), false);
});

test('ordinary card 11 can finish when reverse is disabled', () => {
  const runtime = makeWhot({ allowSpecialFinish: false, enableDirection: false });
  setHands(runtime, [['Circle', 11]], [['Circle', 4]]);
  runtime.state.topCard = { id: 't', shape: 'Circle', number: 10, label: 'Circle 10', isWhot: false };
  runtime.state.currentPlayerId = 'p1';
  assert.equal(runtime.handleIntent('p1', { type: 'play_card', cardId: 'h0' }, false), true);
  assert.equal(runtime.state.phase, 'round_end');
});

test('finish restrictions do not block regular cards when special effects are disabled', () => {
  const runtime = makeWhot({ allowSpecialFinish: false, specialCards: false });
  setHands(runtime, [['Circle', 2]], [['Circle', 4]]);
  runtime.state.topCard = { id: 't', shape: 'Circle', number: 10, label: 'Circle 10', isWhot: false };
  runtime.state.currentPlayerId = 'p1';
  assert.equal(runtime.handleIntent('p1', { type: 'play_card', cardId: 'h0' }, false), true);
  assert.equal(runtime.state.phase, 'round_end');
});

test('turn timeout applies the configured draw-and-pass penalty', () => {
  const runtime = makeWhot({ timeoutPenalty: 'draw_and_pass' });
  const before = runtime.privateState('p1').hand.length;
  assert.equal(runtime.handleIntent('p1', { type: 'timeout' }, true), true);
  assert.equal(runtime.privateState('p1').hand.length, before + 1);
  assert.equal(runtime.state.currentPlayerId, 'p2');
  assert.match(runtime.state.lastAction, /ran out of time, picked one, and lost the turn/i);
});

test('turn timeout serves the full pending pick and clears it', () => {
  const runtime = makeWhot();
  runtime.state.pendingPick = 4;
  runtime.state.pendingPickRank = 2;
  const before = runtime.privateState('p1').hand.length;
  assert.equal(runtime.handleIntent('p1', { type: 'timeout' }, true), true);
  assert.equal(runtime.privateState('p1').hand.length, before + 4);
  assert.equal(runtime.state.pendingPick, 0);
  assert.equal(runtime.state.currentPlayerId, 'p2');
});

test('explainIntent returns readable message for rejected action', () => {
  const runtime = makeWhot();
  const msg = runtime.explainIntent({ type: 'invalid' });
  assert.ok(typeof msg === 'string');
  assert.ok(msg.length > 0);
});
