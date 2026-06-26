// Half & Half tests — split-vote minority scoring, midpoint median scoring, no-repeat, restore.

import assert from 'node:assert/strict';
import test from 'node:test';
import { HalfHalfRuntime } from '../../../runtime/games/half-half.js';

function makeHH(settings = {}, players = [
  { id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }, { id: 'p3', name: 'P3' },
]) {
  const r = new HalfHalfRuntime({
    id: 'half-half', name: 'Half & Half', emoji: '🪙', version: '1.2.0.0',
    minPlayers: 2, maxPlayers: 12, capabilities: { bots: true, audience: true, hints: false, restore: true },
  });
  r.configure({ sessionId: 's', gameRunId: 'r', settings: { seed: 2, rounds: 3, ...settings } });
  r.seatPlayers(players);
  r.start();
  return r;
}

test('split-vote rewards the riskier minority side more than the majority', () => {
  const r = makeHH({ mode: 'split_vote' });
  // p1 + p2 pick option 0 (majority), p3 picks option 1 (minority).
  r.handleIntent('p1', { type: 'answer', optionIndex: 0 }, false);
  r.handleIntent('p2', { type: 'answer', optionIndex: 0 }, false);
  r.handleIntent('p3', { type: 'answer', optionIndex: 1 }, false); // all submitted → reveal
  const s = r.publicState();
  assert.equal(s.phase, 'reveal');
  const p1 = s.players.find((p) => p.id === 'p1').score;
  const p3 = s.players.find((p) => p.id === 'p3').score;
  assert.equal(p1, 30); // majority
  assert.equal(p3, 100); // minority bonus
});

test('midpoint mode scores closeness to the median guess', () => {
  const r = makeHH({ mode: 'midpoint_guess' });
  r.handleIntent('p1', { type: 'guess', amount: 100 }, false);
  r.handleIntent('p2', { type: 'guess', amount: 200 }, false);
  r.handleIntent('p3', { type: 'guess', amount: 300 }, false); // median = 200
  const s = r.publicState();
  assert.equal(s.phase, 'reveal');
  // p2 hit the median exactly → full marks; p1/p3 are equidistant → fewer, equal points.
  const p2 = s.players.find((p) => p.id === 'p2').score;
  const p1 = s.players.find((p) => p.id === 'p1').score;
  const p3 = s.players.find((p) => p.id === 'p3').score;
  assert.equal(p2, 100);
  assert.equal(p1, p3);
  assert.ok(p1 < p2);
});

test('prompts do not repeat until the pool is exhausted', () => {
  const r = makeHH({ mode: 'split_vote', rounds: 5 });
  const seen = new Set();
  for (let round = 0; round < 5; round += 1) {
    const prompt = r.publicState().challenge.prompt;
    assert.equal(seen.has(prompt), false, `repeated prompt: ${prompt}`);
    seen.add(prompt);
    // everyone submits, host advances to the next round
    for (const id of ['p1', 'p2', 'p3']) r.handleIntent(id, { type: 'answer', optionIndex: 0 }, false);
    r.handleIntent('p1', { type: 'advance' }, true);
  }
});

test('a player cannot submit twice in one round', () => {
  const r = makeHH({ mode: 'split_vote' });
  assert.equal(r.handleIntent('p1', { type: 'answer', optionIndex: 0 }, false), true);
  assert.equal(r.handleIntent('p1', { type: 'answer', optionIndex: 1 }, false), false);
});

test('the bot draws deterministically from the seeded rng', () => {
  const a = makeHH({ mode: 'midpoint_guess' });
  const b = makeHH({ mode: 'midpoint_guess' });
  assert.deepEqual(a.rankBotIntent('p1'), b.rankBotIntent('p1'));
});

test('snapshot/restore preserves scores, round and used prompts', () => {
  const r = makeHH({ mode: 'split_vote' });
  for (const id of ['p1', 'p2', 'p3']) r.handleIntent(id, { type: 'answer', optionIndex: 0 }, false);
  const snap = r.snapshot();
  const r2 = new HalfHalfRuntime({ id: 'half-half', name: 'Half & Half', emoji: '🪙', version: '1.2.0.0', minPlayers: 2, maxPlayers: 12, capabilities: { bots: true, audience: true, hints: false, restore: true } });
  r2.configure({ sessionId: 's', gameRunId: 'r', settings: {} });
  r2.seatPlayers([]);
  r2.start();
  r2.restore(snap);
  assert.deepEqual(r2.publicState(), r.publicState());
  assert.deepEqual([...r2.usedPrompts], [...r.usedPrompts]);
});
