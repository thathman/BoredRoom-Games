// Ludo runtime tests — board model, captures, safe zones, exact finish, three sixes, bots, restore.

import assert from 'node:assert/strict';
import test from 'node:test';
import { LudoRuntime } from '../../../runtime/games/ludo.js';

function makeLudo(settings = {}, players = [{ id: 'p1', name: 'Ada' }, { id: 'p2', name: 'Tobi' }]) {
  const runtime = new LudoRuntime({
    id: 'ludo', name: 'Ludo', emoji: '🎲', version: '1.2.0.0',
    minPlayers: 2, maxPlayers: 4,
    capabilities: { bots: true, audience: true, hints: true, restore: true },
  });
  runtime.configure({ sessionId: 's', gameRunId: 'r', settings: { allowBots: true, seed: 1, ...settings } });
  runtime.seatPlayers(players);
  runtime.start();
  return runtime;
}

test('ludo starts every token in the yard with distinct entry offsets', () => {
  const r = makeLudo();
  assert.deepEqual(r.publicState().tokens.p1, [-1, -1, -1, -1]);
  assert.equal(r.publicState().offsets.p1, 0);
  assert.equal(r.publicState().offsets.p2, 13);
});

test('a token can only leave the yard on a six', () => {
  const r = makeLudo();
  r.state.pendingRoll = 4;
  assert.equal(r.legalMoves('p1').length, 0);
  r.state.pendingRoll = 6;
  assert.equal(r.legalMoves('p1').length, 4);
});

test('captures send an un-safe opponent token home and grant an extra turn', () => {
  const r = makeLudo();
  // p1 token at relative 5 (absolute 5). p2 (offset 13) needs relative -8 -> use a token whose
  // absolute equals 5: p2 relative position 44 -> (13+44)%52 = 5. Place it and capture.
  r.state.tokens.p1 = [3, -1, -1, -1]; // absolute 3
  r.state.tokens.p2 = [44, -1, -1, -1]; // absolute (13+44)%52 = 5
  r.state.currentPlayerId = 'p1';
  r.state.pendingRoll = 2; // 3 -> 5, absolute 5, lands on p2
  assert.equal(r.handleIntent('p1', { type: 'move_token', tokenIndex: 0 }, false), true);
  assert.equal(r.publicState().tokens.p2[0], -1); // captured back to yard
  assert.equal(r.publicState().currentPlayerId, 'p1'); // extra turn from capture
});

test('safe (star/entry) squares cannot be captured', () => {
  const r = makeLudo();
  // Absolute 8 is a star safe square. p1 offset 0 -> relative 8. p2 offset 13 -> relative 47 = (13+47)%52=8.
  r.state.tokens.p1 = [6, -1, -1, -1];
  r.state.tokens.p2 = [47, -1, -1, -1]; // absolute 8 (safe)
  r.state.currentPlayerId = 'p1';
  r.state.pendingRoll = 2; // 6 -> 8 (safe square)
  r.handleIntent('p1', { type: 'move_token', tokenIndex: 0 }, false);
  assert.equal(r.publicState().tokens.p2[0], 47); // survives on safe square
});

test('finishing requires an exact roll', () => {
  const r = makeLudo();
  r.state.tokens.p1 = [54, -1, -1, -1]; // needs exactly 2 to reach HOME (56)
  r.state.currentPlayerId = 'p1';
  r.state.pendingRoll = 3;
  assert.equal(r.legalMoves('p1').length, 0); // overshoot illegal
  r.state.pendingRoll = 2;
  assert.equal(r.legalMoves('p1').some((m) => m.tokenIndex === 0), true);
});

test('all four tokens home wins the game', () => {
  const r = makeLudo();
  r.state.tokens.p1 = [56, 56, 56, 50];
  r.state.currentPlayerId = 'p1';
  r.state.pendingRoll = 6; // 50 -> 56 exact
  r.handleIntent('p1', { type: 'move_token', tokenIndex: 3 }, false);
  assert.equal(r.publicState().phase, 'finished');
  assert.deepEqual(r.publicState().winnerPlayerIds, ['p1']);
});

test('three consecutive sixes forfeit the turn', () => {
  const r = makeLudo();
  r.state.currentPlayerId = 'p1';
  r.state.sixStreak = 2; // next six is the third
  // Force a six by stubbing the serial path: set pendingRoll via a real roll won't guarantee six,
  // so simulate the streak rule directly through a crafted roll.
  r.seed = 13; r.state.rollSerial = 0; // seed 13 -> first roll is 6
  assert.equal(r.handleIntent('p1', { type: 'roll' }, false), true);
  assert.equal(r.publicState().currentPlayerId, 'p2'); // forfeited to next player
  assert.equal(r.publicState().pendingRoll, null);
});

test('bot prefers a capture move', () => {
  const r = makeLudo();
  r.state.tokens.p1 = [3, 20, -1, -1];
  r.state.tokens.p2 = [44, -1, -1, -1]; // absolute 5
  r.state.currentPlayerId = 'p1';
  r.state.pendingRoll = 2; // token0: 3->5 captures; token1: 20->22 no capture
  const intent = r.rankBotIntent('p1');
  assert.equal(intent.tokenIndex, 0);
});

test('snapshot/restore preserves the board and dice seed', () => {
  const r = makeLudo({ seed: 77 });
  r.handleIntent('p1', { type: 'roll' }, false);
  const snap = r.snapshot();
  const r2 = new LudoRuntime({ id: 'ludo', name: 'Ludo', emoji: '🎲', version: '1.2.0.0', minPlayers: 2, maxPlayers: 4, capabilities: { bots: true, audience: true, hints: true, restore: true } });
  r2.configure({ sessionId: 's', gameRunId: 'r', settings: {} });
  r2.seatPlayers([]);
  r2.start();
  r2.restore(snap);
  assert.deepEqual(r2.publicState(), r.publicState());
  assert.equal(r2.seed, 77);
});
