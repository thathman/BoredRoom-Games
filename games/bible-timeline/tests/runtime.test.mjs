// Bible Timeline Rush tests — shuffle, scoring, no-repeat, restore

import assert from 'node:assert/strict';
import test from 'node:test';
import { BibleTimelineRuntime } from '../../../runtime/games/bible-timeline.js';

function makeTimeline(settings = {}) {
  const runtime = new BibleTimelineRuntime({
    id: 'bible-timeline', name: 'Bible Timeline Rush', emoji: '📜', version: '1.0.0.0',
    minPlayers: 2, maxPlayers: 8,
    capabilities: { bots: true, audience: true, hints: false, restore: true },
  });
  runtime.configure({ sessionId: 's', gameRunId: 'r', settings: { seed: 42, rounds: 2, ...settings } });
  runtime.seatPlayers([{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }]);
  runtime.start();
  return runtime;
}

test('shuffled order differs from canonical', () => {
  const runtime = makeTimeline();
  const state = runtime.publicState();
  const options = state.challenge?.options ?? [];
  const canonical = (state.canonicalOrder ?? []).map((e) => e.event);
  assert.notDeepEqual(options, canonical);
});

test('options contain all canonical events', () => {
  const runtime = makeTimeline();
  const state = runtime.publicState();
  const options = (state.challenge?.options ?? []).slice().sort();
  const canonical = (state.canonicalOrder ?? []).map((e) => e.event).sort();
  assert.deepEqual(options, canonical);
});

test('exact order scores and auto-reveals', () => {
  const runtime = makeTimeline({ questionCount: 5 });
  const initialState = runtime.publicState();
  const canonical = initialState.canonicalOrder;
  const options = initialState.challenge.options;
  const orderedIndexes = canonical.map((e) => options.indexOf(e.event));

  assert.equal(runtime.handleIntent('p1', { type: 'submit_order', orderedIndexes }, false), true);
  // p1 submitted, phase still playing — p2 hasn't submitted yet
  let state = runtime.publicState();
  assert.equal(state.submittedCount, 1);

  assert.equal(runtime.handleIntent('p2', { type: 'submit_order', orderedIndexes }, false), true);
  // All submitted — auto-reveal
  state = runtime.publicState();
  assert.equal(state.phase, 'reveal');
});

test('reversed order scores lower than correct order', () => {
  const runtime = makeTimeline({ questionCount: 5 });
  const initialState = runtime.publicState();
  const options = initialState.challenge.options;
  const canonical = initialState.canonicalOrder;

  // Reversed index array
  const reversed = options.map((_, i) => options.length - 1 - i);
  const correct = canonical.map((e) => options.indexOf(e.event));

  runtime.handleIntent('p1', { type: 'submit_order', orderedIndexes: reversed }, false);
  runtime.handleIntent('p2', { type: 'submit_order', orderedIndexes: correct }, false);

  const state = runtime.publicState();
  const results = state.lastResults ?? [];
  const p2Result = results.find((r) => r.playerId === 'p2');
  const p1Result = results.find((r) => r.playerId === 'p1');
  assert.ok(p2Result, 'p2 should have a result');
  assert.ok(p1Result, 'p1 should have a result');
  assert.ok(p2Result.points > p1Result.points, `p2 points ${p2Result.points} should exceed p1 ${p1Result.points}`);
});

test('perfect bonus for all exact matches', () => {
  const runtime = makeTimeline({ questionCount: 3, seed: 42 });
  const initialState = runtime.publicState();
  const options = initialState.challenge.options;
  const canonical = initialState.canonicalOrder;
  const correct = canonical.map((e) => options.indexOf(e.event));

  runtime.handleIntent('p1', { type: 'submit_order', orderedIndexes: correct }, false);
  runtime.handleIntent('p2', { type: 'submit_order', orderedIndexes: correct }, false);

  const state = runtime.publicState();
  const results = state.lastResults ?? [];
  const p1Result = results.find((r) => r.playerId === 'p1');
  assert.ok(p1Result, 'p1 should have a score');
  assert.ok(p1Result.points >= 500, `Expected >=500 for perfect, got ${p1Result.points}`);
});

test('rejects incomplete submission', () => {
  const runtime = makeTimeline();
  assert.equal(runtime.handleIntent('p1', { type: 'submit_order', orderedIndexes: [0, 1] }, false), false);
});

test('rejects duplicate submission', () => {
  const runtime = makeTimeline();
  const state = runtime.publicState();
  const options = state.challenge.options;
  const canonical = state.canonicalOrder;
  const correct = canonical.map((e) => options.indexOf(e.event));
  assert.equal(runtime.handleIntent('p1', { type: 'submit_order', orderedIndexes: correct }, false), true);
  assert.equal(runtime.handleIntent('p1', { type: 'submit_order', orderedIndexes: correct }, false), false);
});

test('advance to next round after reveal', () => {
  const runtime = makeTimeline({ rounds: 3 });
  const state = runtime.publicState();
  const options = state.challenge.options;
  const canonical = state.canonicalOrder;
  const correct = canonical.map((e) => options.indexOf(e.event));
  runtime.handleIntent('p1', { type: 'submit_order', orderedIndexes: correct }, false);
  runtime.handleIntent('p2', { type: 'submit_order', orderedIndexes: correct }, false);
  assert.equal(runtime.publicState().phase, 'reveal');
  assert.equal(runtime.handleIntent('p1', { type: 'advance' }, true), true);
  assert.equal(runtime.publicState().round, 2);
  assert.equal(runtime.publicState().phase, 'playing');
});

test('finish after final round', () => {
  const runtime = makeTimeline({ rounds: 1 });
  const state = runtime.publicState();
  const options = state.challenge.options;
  const canonical = state.canonicalOrder;
  const correct = canonical.map((e) => options.indexOf(e.event));
  runtime.handleIntent('p1', { type: 'submit_order', orderedIndexes: correct }, false);
  runtime.handleIntent('p2', { type: 'submit_order', orderedIndexes: correct }, false);
  runtime.handleIntent('p1', { type: 'advance' }, true);
  assert.equal(runtime.publicState().phase, 'finished');
});

test('snapshot and restore preserves submissions', () => {
  const a = makeTimeline();
  const state = a.publicState();
  const options = state.challenge.options;
  const canonical = state.canonicalOrder;
  const correct = canonical.map((e) => options.indexOf(e.event));
  a.handleIntent('p1', { type: 'submit_order', orderedIndexes: correct }, false);
  const snap = a.snapshot();
  const b = makeTimeline();
  b.restore(snap);
  assert.equal(b.publicState().round, a.publicState().round);
  assert.equal(b.publicState().submittedCount, a.publicState().submittedCount);
});

test('merges AI-generated events into the ordering bank, with fallback', () => {
  const r = makeTimeline({ aiEvents: [
    { event: 'AI: The Exodus from Egypt', position: 250 },
    { event: 'AI: Building of Solomon temple', position: 450 },
    { event: 'AI: Babylonian exile', position: 600 },
  ], questionCount: 5 });
  const allEvents = r.publicState().challenge.options;
  assert.ok(Array.isArray(allEvents) && allEvents.length === 5);
  const noai = makeTimeline({ questionCount: 4 });
  assert.equal(noai.publicState().challenge.options.length, 4); // fallback
});
