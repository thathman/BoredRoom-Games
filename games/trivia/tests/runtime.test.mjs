// Who Sabi Pass / Trivia tests — option shuffling (no index-0 leak), scoring, reveal, no-repeat, restore.

import assert from 'node:assert/strict';
import test from 'node:test';
import { WhoSabiPassRuntime } from '../../../runtime/games/who-sabi-pass.js';

function makeTrivia(settings = {}, players = [{ id: 'p1', name: 'Ada' }, { id: 'p2', name: 'Tobi' }]) {
  const r = new WhoSabiPassRuntime({
    id: 'trivia', name: 'Who Sabi Pass', emoji: '🧠', version: '1.2.0.0',
    minPlayers: 1, maxPlayers: 12, capabilities: { bots: true, audience: true, hints: true, restore: true },
  });
  r.configure({ sessionId: 's', gameRunId: 'r', settings: { seed: 4, questionCount: 8, ...settings } });
  r.seatPlayers(players);
  r.start();
  return r;
}

test('correct answers are NOT always option 0 (options are shuffled)', () => {
  const r = makeTrivia();
  const answerIndexes = r.questions.map((q) => q.answer);
  // With shuffling, the correct index varies — it must not be all zeros.
  assert.equal(answerIndexes.every((a) => a === 0), false);
});

test('always picking option 0 does not always score', () => {
  const r = makeTrivia();
  let correctCount = 0;
  for (let i = 0; i < r.questions.length; i += 1) {
    if (r.questions[i].answer === 0) correctCount += 1;
  }
  assert.ok(correctCount < r.questions.length); // index-0 strategy is not a guaranteed win
});

test('the correct option still scores 100 and reveal shows the answer', () => {
  const r = makeTrivia();
  const correct = r.questions[0].answer;
  r.handleIntent('p1', { type: 'answer', optionIndex: correct }, false);
  r.handleIntent('p2', { type: 'answer', optionIndex: (correct + 1) % 4 }, false);
  const s = r.publicState();
  assert.equal(s.phase, 'reveal');
  assert.equal(s.players.find((p) => p.id === 'p1').score, 100);
  assert.equal(s.players.find((p) => p.id === 'p2').score, 0);
  assert.ok(s.lastAction.includes('Correct answer'));
});

test('questions do not repeat within a session', () => {
  const r = makeTrivia({ questionCount: 8 });
  const prompts = r.questions.map((q) => q.prompt);
  assert.equal(new Set(prompts).size, prompts.length);
});

test('the public state never leaks the answer index', () => {
  const r = makeTrivia();
  assert.equal('answer' in r.publicState().challenge, false);
});

test('bot answers are deterministic and differ between players', () => {
  const a = makeTrivia();
  const b = makeTrivia();
  assert.deepEqual(a.rankBotIntent('p1'), b.rankBotIntent('p1'));
  // Two different players usually pick differently (not a hard guarantee, but for this seed they do).
  assert.notDeepEqual(a.rankBotIntent('p1'), a.rankBotIntent('p2'));
});

test('snapshot/restore preserves questions, index and seed', () => {
  const r = makeTrivia();
  r.handleIntent('p1', { type: 'answer', optionIndex: 0 }, false);
  const snap = r.snapshot();
  const r2 = new WhoSabiPassRuntime({ id: 'trivia', name: 'Who Sabi Pass', emoji: '🧠', version: '1.2.0.0', minPlayers: 1, maxPlayers: 12, capabilities: { bots: true, audience: true, hints: true, restore: true } });
  r2.configure({ sessionId: 's', gameRunId: 'r', settings: {} });
  r2.seatPlayers([]);
  r2.start();
  r2.restore(snap);
  assert.deepEqual(r2.publicState(), r.publicState());
  assert.equal(r2.seed, r.seed);
});

test('merges AI-generated questions ahead of the local bank, validating them', () => {
  const ai = [
    { prompt: 'AI: Capital of Lagos State?', options: ['Ikeja', 'Lagos Island', 'Epe', 'Badagry'], answer: 0, explanation: 'Ikeja is the capital.' },
    { prompt: 'Bad AI question', options: ['only one'], answer: 0 }, // invalid: <2 options, dropped
    { prompt: 'Bad index', options: ['a', 'b'], answer: 5 }, // invalid index, dropped
  ];
  const r = makeTrivia({ aiQuestions: ai, questionCount: 10 });
  const prompts = r.questions.map((q) => q.prompt);
  assert.ok(prompts.includes('AI: Capital of Lagos State?')); // valid AI question used
  assert.ok(!prompts.includes('Bad AI question')); // invalid dropped
  assert.ok(!prompts.includes('Bad index'));
});

test('falls back to the local bank when no AI questions are supplied', () => {
  const r = makeTrivia({ questionCount: 8 });
  assert.equal(r.questions.length, 8); // still fully populated from the local bank
});

test('avoidPrompts sinks recently-used questions to the back of the pool', () => {
  // Build once with no avoid to learn which prompts the seed picks first.
  const base = makeTrivia({ questionCount: 4, seed: 11 });
  const firstFour = base.questions.map((q) => q.prompt);
  // Now mark those as recently used; a fresh run with the same seed should avoid them up front.
  const next = makeTrivia({ questionCount: 4, seed: 11, avoidPrompts: firstFour });
  const overlap = next.questions.map((q) => q.prompt).filter((p) => firstFour.includes(p));
  // With a bank larger than 4, the avoided ones should be pushed back (fewer than 4 overlap).
  assert.ok(overlap.length < firstFour.length);
});
