// Pidgin Translator tests — text + voice transcript, fastest-correct, no-leak, privacy, restore.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PidginTranslatorRuntime } from '../../../runtime/games/pidgin-translator.js';

function makePidgin(settings = {}, players = [{ id: 'p1', name: 'Ada' }, { id: 'p2', name: 'Tobi' }]) {
  const r = new PidginTranslatorRuntime({
    id: 'pidgin-translator', name: 'Pidgin Translator', emoji: '🗣️', version: '1.2.0.0',
    minPlayers: 1, maxPlayers: 12, capabilities: { bots: true, audience: true, hints: true, restore: true },
  });
  r.configure({ sessionId: 's', gameRunId: 'r', settings: { seed: 9, questionCount: 6, ...settings } });
  r.seatPlayers(players);
  r.start();
  return r;
}

test('the public challenge shows the source phrase, never the expected answer', () => {
  const r = makePidgin();
  const expected = r.questions[0].target.toLowerCase();
  assert.equal(JSON.stringify(r.publicState().challenge).toLowerCase().includes(expected), false);
});

test('a correct translation scores; the fastest correct gets the most', () => {
  // Three seats so two submissions do not auto-reveal; we set times then host-reveal.
  const r = makePidgin({}, [{ id: 'p1', name: 'Ada' }, { id: 'p2', name: 'Tobi' }, { id: 'p3', name: 'Uche' }]);
  const expected = r.questions[0].target;
  r.handleIntent('p1', { type: 'answer_text', text: expected }, false);
  r.handleIntent('p2', { type: 'answer_text', text: expected }, false);
  // White-box submit times so the speed ranking is deterministic.
  r.state.submissions.p1.time = 1000;
  r.state.submissions.p2.time = 2000;
  r.handleIntent('p3', { type: 'advance' }, true); // host reveals
  const s = r.publicState();
  const p1 = s.players.find((p) => p.id === 'p1').score;
  const p2 = s.players.find((p) => p.id === 'p2').score;
  assert.equal(p1, 100); // fastest correct
  assert.ok(p2 > 0 && p2 < p1); // also correct but slower
});

test('voice submissions are accepted as a transcript (no raw audio stored)', () => {
  const r = makePidgin({ mode: 'speed_voice' });
  const expected = r.questions[0].target;
  assert.equal(r.handleIntent('p1', { type: 'voice_submission', transcript: expected }, false), true);
  const sub = r.publicState().submissions.p1;
  assert.equal('text' in sub, true);
  assert.equal('audio' in sub, false); // only the transcript is kept
});

test('a wrong translation scores zero', () => {
  const r = makePidgin();
  r.handleIntent('p1', { type: 'answer_text', text: 'completely wrong answer' }, false);
  r.handleIntent('p2', { type: 'answer_text', text: r.questions[0].target }, false);
  assert.equal(r.publicState().players.find((p) => p.id === 'p1').score, 0);
});

test('phrases do not repeat within a session', () => {
  const r = makePidgin({ questionCount: 6 });
  const sources = r.questions.map((q) => q.source);
  assert.equal(new Set(sources).size, sources.length);
});

test('snapshot/restore preserves phrases, index, mode and direction', () => {
  const r = makePidgin({ mode: 'speed_voice', direction: 'english_to_pidgin' });
  r.handleIntent('p1', { type: 'answer_text', text: 'x' }, false);
  const snap = r.snapshot();
  const r2 = new PidginTranslatorRuntime({ id: 'pidgin-translator', name: 'Pidgin Translator', emoji: '🗣️', version: '1.2.0.0', minPlayers: 1, maxPlayers: 12, capabilities: { bots: true, audience: true, hints: true, restore: true } });
  r2.configure({ sessionId: 's', gameRunId: 'r', settings: {} });
  r2.seatPlayers([]);
  r2.start();
  r2.restore(snap);
  assert.deepEqual(r2.publicState(), r.publicState());
  assert.equal(r2.mode, 'speed_voice');
  assert.equal(r2.direction, 'english_to_pidgin');
});
