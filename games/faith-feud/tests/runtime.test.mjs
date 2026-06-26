// Faith Feud tests — team split, answer matching/scoring, strikes, steal, bot, restore.

import assert from 'node:assert/strict';
import test from 'node:test';
import { FaithFeudRuntime } from '../../../runtime/games/faith-feud.js';

function makeFF(settings = {}, players = [
  { id: 'a1', name: 'A1' }, { id: 'a2', name: 'A2' }, { id: 'b1', name: 'B1' }, { id: 'b2', name: 'B2' },
]) {
  const r = new FaithFeudRuntime({
    id: 'faith-feud', name: 'Faith Feud', emoji: '📣', version: '1.2.0.0',
    minPlayers: 2, maxPlayers: 8, capabilities: { bots: true, audience: true, hints: true, restore: true },
  });
  r.configure({ sessionId: 's', gameRunId: 'r', settings: { seed: 3, rounds: 2, ...settings } });
  r.seatPlayers(players);
  r.start();
  return r;
}

// The current round's answers (white-box) so tests do not depend on shuffle order.
function answers(r) { return r.surveys[r.ci][1]; }
function topAnswer(r) { return [...answers(r)].sort((x, y) => y.points - x.points)[0]; }

test('splits players into two teams', () => {
  const r = makeFF();
  assert.deepEqual(r.publicState().team1Ids, ['a1', 'a2']);
  assert.deepEqual(r.publicState().team2Ids, ['b1', 'b2']);
  assert.equal(r.privateState('a1').team, 0);
  assert.equal(r.privateState('b1').team, 1);
});

test('a correct answer scores its points to the whole active team', () => {
  const r = makeFF();
  const ans = topAnswer(r);
  assert.equal(r.handleIntent('a1', { type: 'answer_text', text: ans.text }, false), true);
  const a1 = r.publicState().players.find((p) => p.id === 'a1').score;
  const a2 = r.publicState().players.find((p) => p.id === 'a2').score;
  assert.equal(a1, ans.points);
  assert.equal(a2, ans.points); // teammate credited too
  assert.equal(r.publicState().revealedAnswers.some((x) => x.text === ans.text), true);
});

test('a wrong answer adds a strike; the same wrong answer again is a no-op', () => {
  const r = makeFF();
  assert.equal(r.handleIntent('a1', { type: 'answer_text', text: 'zzz-not-an-answer' }, false), true);
  assert.equal(r.publicState().strikes, 1);
  assert.equal(r.handleIntent('a1', { type: 'answer_text', text: 'zzz-not-an-answer' }, false), false);
  assert.equal(r.publicState().strikes, 1); // unchanged
});

test('three strikes hand the steal to the other team', () => {
  const r = makeFF({ steals: true });
  r.handleIntent('a1', { type: 'answer_text', text: 'wrong-one' }, false);
  r.handleIntent('a1', { type: 'answer_text', text: 'wrong-two' }, false);
  r.handleIntent('a1', { type: 'answer_text', text: 'wrong-three' }, false);
  assert.equal(r.publicState().stealActive, true);
  // Now team 2 can answer even though it was team 1's turn.
  const ans = topAnswer(r);
  assert.equal(r.handleIntent('b1', { type: 'answer_text', text: ans.text }, false), true);
});

test('the non-active team cannot answer before a steal', () => {
  const r = makeFF();
  const ans = topAnswer(r);
  assert.equal(r.handleIntent('b1', { type: 'answer_text', text: ans.text }, false), false);
});

test('bot guesses a real unrevealed answer, never gibberish', () => {
  const r = makeFF();
  const intent = r.rankBotIntent();
  assert.equal(answers(r).some((a) => a.text === intent.text), true);
});

test('snapshot/restore preserves board, strikes and tried guesses', () => {
  const r = makeFF();
  r.handleIntent('a1', { type: 'answer_text', text: 'a-wrong-guess' }, false);
  const snap = r.snapshot();
  const r2 = new FaithFeudRuntime({ id: 'faith-feud', name: 'Faith Feud', emoji: '📣', version: '1.2.0.0', minPlayers: 2, maxPlayers: 8, capabilities: { bots: true, audience: true, hints: true, restore: true } });
  r2.configure({ sessionId: 's', gameRunId: 'r', settings: {} });
  r2.seatPlayers([]);
  r2.start();
  r2.restore(snap);
  assert.deepEqual(r2.publicState(), r.publicState());
  // The already-tried wrong guess stays a no-op after restore.
  assert.equal(r2.handleIntent('a1', { type: 'answer_text', text: 'a-wrong-guess' }, false), false);
});
