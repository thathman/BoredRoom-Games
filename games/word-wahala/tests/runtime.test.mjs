// Word Wahala tests — tile bag, dictionary scoring, pass, swap, no-repeat, restore.

import assert from 'node:assert/strict';
import test from 'node:test';
import { WordWahalaRuntime } from '../../../runtime/games/word-wahala.js';

function makeWW(settings = {}, players = [{ id: 'p1', name: 'Ada' }, { id: 'p2', name: 'Tobi' }]) {
  const r = new WordWahalaRuntime({
    id: 'word-wahala', name: 'Word Wahala', emoji: '🔡', version: '1.2.0.0',
    minPlayers: 2, maxPlayers: 8, capabilities: { bots: true, audience: true, hints: true, restore: true },
  });
  r.configure({ sessionId: 's', gameRunId: 'r', settings: { seed: 5, ...settings } });
  r.seatPlayers(players);
  r.start();
  return r;
}

test('deals a 7-tile rack to each player and conserves the tile bag', () => {
  const r = makeWW();
  assert.equal(r.privateState('p1').rack.length, 7);
  assert.equal(r.privateState('p2').rack.length, 7);
  // Full bag (98 tiles) minus the 14 dealt remains available.
  assert.equal(r.publicState().bagCount + 14, 98);
});

test('a dictionary word scores the sum of its rack tile values', () => {
  const r = makeWW();
  // White-box a known rack so the score is deterministic. AMEN is in the dictionary.
  r.racks.p1 = [
    { letter: 'A', value: 1, id: 'A-0' }, { letter: 'M', value: 3, id: 'M-0' },
    { letter: 'E', value: 1, id: 'E-0' }, { letter: 'N', value: 1, id: 'N-0' },
    { letter: 'X', value: 8, id: 'X-0' }, { letter: 'Q', value: 10, id: 'Q-0' }, { letter: 'Z', value: 10, id: 'Z-0' },
  ];
  assert.equal(r.handleIntent('p1', { type: 'answer_text', text: 'AMEN' }, false), true);
  // A1 + M3 + E1 + N1 = 6
  assert.equal(r.publicState().players.find((p) => p.id === 'p1').score, 6);
});

test('a non-dictionary word is accepted but scores zero', () => {
  const r = makeWW();
  assert.equal(r.handleIntent('p1', { type: 'answer_text', text: 'ZZZZ' }, false), true);
  assert.equal(r.publicState().players.find((p) => p.id === 'p1').score, 0);
});

test('the same word cannot be reused in the session', () => {
  const r = makeWW();
  r.racks.p1 = [{ letter: 'A', value: 1, id: 'A-0' }, { letter: 'M', value: 3, id: 'M-0' }, { letter: 'E', value: 1, id: 'E-0' }, { letter: 'N', value: 1, id: 'N-0' }];
  r.racks.p2 = [{ letter: 'A', value: 1, id: 'A-9' }, { letter: 'M', value: 3, id: 'M-9' }, { letter: 'E', value: 1, id: 'E-9' }, { letter: 'N', value: 1, id: 'N-9' }];
  assert.equal(r.handleIntent('p1', { type: 'answer_text', text: 'AMEN' }, false), true);
  assert.equal(r.handleIntent('p2', { type: 'answer_text', text: 'AMEN' }, false), false); // already used
});

test('pass forfeits the turn for zero points', () => {
  const r = makeWW();
  assert.equal(r.handleIntent('p1', { type: 'pass' }, false), true);
  assert.equal(r.privateState('p1').submitted, true);
  assert.equal(r.publicState().players.find((p) => p.id === 'p1').score, 0);
});

test('swap exchanges tiles and returns the old ones to the bag', () => {
  const r = makeWW();
  const before = r.privateState('p1').rack.map((t) => t.id);
  const bagBefore = r.publicState().bagCount;
  assert.equal(r.handleIntent('p1', { type: 'swap', tileIds: [before[0], before[1]] }, false), true);
  const after = r.privateState('p1').rack.map((t) => t.id);
  assert.equal(after.length, 7);
  // The two swapped tiles are no longer in the rack.
  assert.equal(after.includes(before[0]) || after.includes(before[1]), false);
  // Bag size is conserved (took 2, returned 2).
  assert.equal(r.publicState().bagCount, bagBefore);
});

test('legal intents offer spell, swap and pass while it is the round', () => {
  const r = makeWW();
  const kinds = r.legalIntents('p1').map((i) => i.type).sort();
  assert.deepEqual(kinds, ['answer_text', 'pass', 'swap']);
});

test('snapshot/restore preserves bag, racks and used words', () => {
  const r = makeWW();
  r.racks.p1 = [{ letter: 'A', value: 1, id: 'A-0' }, { letter: 'M', value: 3, id: 'M-0' }, { letter: 'E', value: 1, id: 'E-0' }, { letter: 'N', value: 1, id: 'N-0' }];
  r.handleIntent('p1', { type: 'answer_text', text: 'AMEN' }, false);
  const snap = r.snapshot();
  const r2 = new WordWahalaRuntime({ id: 'word-wahala', name: 'Word Wahala', emoji: '🔡', version: '1.2.0.0', minPlayers: 2, maxPlayers: 8, capabilities: { bots: true, audience: true, hints: true, restore: true } });
  r2.configure({ sessionId: 's', gameRunId: 'r', settings: {} });
  r2.seatPlayers([]);
  r2.start();
  r2.restore(snap);
  assert.deepEqual(r2.publicState(), r.publicState());
  // The used word survives restore (cannot be replayed).
  assert.equal(r2.handleIntent('p2', { type: 'answer_text', text: 'AMEN' }, false), false);
});
