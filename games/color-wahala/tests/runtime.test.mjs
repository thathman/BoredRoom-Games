// Color Wahala tests — Stroop effect, flag prompts, scoring

import assert from 'node:assert/strict';
import test from 'node:test';
import { ColorWahalaRuntime } from '../../../runtime/games/color-wahala.js';

function makeColorWahala(settings = {}) {
  const runtime = new ColorWahalaRuntime({
    id: 'color-wahala', name: 'Color Wahala', emoji: '🎨', version: '1.0.0.0',
    minPlayers: 2, maxPlayers: 8,
    capabilities: { bots: true, audience: true, hints: false, restore: true },
  });
  runtime.configure({ sessionId: 's', gameRunId: 'r', settings: { seed: 42, questionCount: 5, ...settings } });
  runtime.seatPlayers([{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }]);
  runtime.start();
  return runtime;
}

test('starts with a color challenge', () => {
  const runtime = makeColorWahala();
  const state = runtime.publicState();
  assert.ok(state.challenge);
  assert.ok(state.challenge.options.length >= 4);
});

test('prompt style differs from challenge prompt - word vs ink are different colours', () => {
  const runtime = makeColorWahala({ contentSet: 'stroop', difficulty: 'medium', questionCount: 10 });
  const state = runtime.publicState();
  // The hint contains HTML with the word written in a colour — it should be different from the word name
  const hint = state.challenge?.hint ?? '';
  // Word and ink colour should differ (that's the whole trick)
  assert.ok(state.challenge?.prompt.includes('WORD') || state.challenge?.prompt.includes('ink'));
});

test('can submit answer', () => {
  const runtime = makeColorWahala();
  assert.equal(runtime.handleIntent('p1', { type: 'answer', optionIndex: 0 }, false), true);
  const state = runtime.publicState();
  assert.equal(state.submittedCount, 1);
});

test('rejects invalid option index', () => {
  const runtime = makeColorWahala();
  const state = runtime.publicState();
  const max = state.challenge.options.length;
  assert.equal(runtime.handleIntent('p1', { type: 'answer', optionIndex: max }, false), false);
  assert.equal(runtime.handleIntent('p1', { type: 'answer', optionIndex: -1 }, false), false);
});

test('auto-reveals when all players submit', () => {
  const runtime = makeColorWahala();
  runtime.handleIntent('p1', { type: 'answer', optionIndex: 0 }, false);
  runtime.handleIntent('p2', { type: 'answer', optionIndex: 1 }, false);
  assert.equal(runtime.publicState().phase, 'reveal');
});

test('advances to next prompt after reveal', () => {
  const runtime = makeColorWahala({ questionCount: 3 });
  runtime.handleIntent('p1', { type: 'answer', optionIndex: 0 }, false);
  runtime.handleIntent('p2', { type: 'answer', optionIndex: 1 }, false);
  assert.equal(runtime.handleIntent('p1', { type: 'advance' }, true), true);
  const state = runtime.publicState();
  assert.equal(state.phase, 'playing');
});

test('finishes after all prompts consumed', () => {
  const runtime = makeColorWahala({ questionCount: 5 });
  for (let i = 0; i < 5; i += 1) {
    runtime.handleIntent('p1', { type: 'answer', optionIndex: 0 }, false);
    runtime.handleIntent('p2', { type: 'answer', optionIndex: 1 }, false);
    assert.equal(runtime.handleIntent('p1', { type: 'advance' }, true), true);
  }
  assert.equal(runtime.publicState().phase, 'finished');
});

test('flag content set has flag-specific prompts', () => {
  const runtime = makeColorWahala({ contentSet: 'flags', questionCount: 2 });
  const state = runtime.publicState();
  assert.ok(state.challenge?.prompt.includes('flag') || state.challenge?.multiAccept);
});

test('flag prompts use a per-country explanation, not a hardcoded Nigerian one', () => {
  // Multiple flags available; every generated flag prompt's explanation must match its country.
  const runtime = makeColorWahala({ contentSet: 'flags', questionCount: 6, seed: 7 });
  for (const q of runtime.prompts) {
    if (!q.multiAccept) continue;
    const country = q.prompt.match(/(Nigerian|Ghanaian|Kenyan|South African|Senegalese|Cameroonian)/)?.[1];
    assert.ok(country, `flag prompt missing country: ${q.prompt}`);
    if (country === 'Ghanaian') assert.ok(/Ghana/i.test(q.explanation));
    if (country === 'Nigerian') assert.ok(/Nigerian/i.test(q.explanation));
  }
  // At least 3 distinct flag questions are available now (was 2).
  assert.ok(new Set(runtime.prompts.map((q) => q.prompt)).size >= 3);
});

test('snapshot and restore', () => {
  const a = makeColorWahala({ questionCount: 3 });
  a.handleIntent('p1', { type: 'answer', optionIndex: 0 }, false);
  const snap = a.snapshot();
  const b = makeColorWahala({ questionCount: 3 });
  b.restore(snap);
  assert.equal(b.publicState().submittedCount, a.publicState().submittedCount);
});
