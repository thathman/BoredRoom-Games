// Logo Guesser tests — progressive reveal, answer matching, no-leak, no-repeat, restore.

import assert from 'node:assert/strict';
import test from 'node:test';
import { LogoGuesserRuntime } from '../../../runtime/games/logo-guesser.js';

function makeLogo(settings = {}, players = [{ id: 'p1', name: 'Ada' }, { id: 'p2', name: 'Tobi' }]) {
  const r = new LogoGuesserRuntime({
    id: 'logo', name: 'Logo Guesser', emoji: '🔵', version: '1.2.0.0',
    minPlayers: 1, maxPlayers: 12, capabilities: { bots: true, audience: true, hints: true, restore: true },
  });
  r.configure({ sessionId: 's', gameRunId: 'r', settings: { seed: 6, questionCount: 6, ...settings } });
  r.seatPlayers(players);
  r.start();
  return r;
}

test('the public challenge never leaks the brand name', () => {
  const r = makeLogo();
  const name = r.questions[0].name.toLowerCase();
  assert.equal(JSON.stringify(r.publicState().challenge).toLowerCase().includes(name), false);
});

test('a correct guess scores and reveals the answer', () => {
  const r = makeLogo();
  const name = r.questions[0].name;
  assert.equal(r.handleIntent('p1', { type: 'answer_text', text: name }, false), true);
  const s = r.publicState();
  assert.equal(s.phase, 'reveal');
  assert.equal(s.players.find((p) => p.id === 'p1').score, 100);
  assert.ok(s.lastAction.includes(name));
});

test('the host can advance reveal stages before revealing', () => {
  const r = makeLogo();
  assert.equal(r.publicState().currentStage, 0);
  r.handleIntent('p1', { type: 'advance' }, true);
  assert.equal(r.publicState().currentStage, 1);
});

test('logos do not repeat within a session', () => {
  const r = makeLogo({ questionCount: 6 });
  const names = r.questions.map((q) => q.name);
  assert.equal(new Set(names).size, names.length);
});

test('snapshot/restore preserves questions, index and stage', () => {
  const r = makeLogo();
  r.handleIntent('p1', { type: 'advance' }, true); // advance a stage
  const snap = r.snapshot();
  const r2 = new LogoGuesserRuntime({ id: 'logo', name: 'Logo Guesser', emoji: '🔵', version: '1.2.0.0', minPlayers: 1, maxPlayers: 12, capabilities: { bots: true, audience: true, hints: true, restore: true } });
  r2.configure({ sessionId: 's', gameRunId: 'r', settings: {} });
  r2.seatPlayers([]);
  r2.start();
  r2.restore(snap);
  assert.deepEqual(r2.publicState(), r.publicState());
});

test('merges AI-generated brands ahead of the local bank, with fallback', () => {
  // Several AI brands so at least some land in the (capped) question set regardless of shuffle.
  const aiLogos = ['Jumia', 'Bolt', 'Konga', 'Paystack', 'GIGM', 'Filmhouse'].map((name) => ({ name, hint: 'Naija brand', category: 'Tech' }));
  const r = makeLogo({ aiLogos, questionCount: 15 });
  const names = r.questions.map((q) => q.name);
  assert.ok(aiLogos.some((l) => names.includes(l.name)), 'expected at least one AI brand in the set');
  const noai = makeLogo({ questionCount: 6 });
  assert.equal(noai.questions.length, 6); // local bank fallback
});
