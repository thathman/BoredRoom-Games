// Money Trivia runtime tests — ladder, fastest finger + ties, hot-seat outcomes, safety nets,
// walk-away, timeout, every lifeline, answer-isolation, no bots, and snapshot/restore.

import assert from 'node:assert/strict';
import test from 'node:test';
import { MoneyTriviaRuntime, generateLadder } from '../../../runtime/games/money-trivia.js';

const MANIFEST = {
  id: 'trivia', name: 'Money Trivia', emoji: '💰', version: '1.7.0.0',
  minPlayers: 2, maxPlayers: 8, capabilities: { bots: false, audience: true, hints: false, restore: true },
};

// 20 deterministic approved questions: index 0 of options is always correct (runtime shuffles).
function bank(n = 20) {
  return Array.from({ length: n }, (_, i) => ({
    prompt: `Q${i}: pick the right one?`,
    options: [`right${i}`, `wrong${i}a`, `wrong${i}b`, `wrong${i}c`],
    answer: 0,
    explanation: `Because right${i}.`,
    order: [0, 1, 2, 3],
  }));
}

function make(settings = {}, players = [{ id: 'p1', name: 'Ada' }, { id: 'p2', name: 'Tobi' }, { id: 'p3', name: 'Uche' }]) {
  const r = new MoneyTriviaRuntime(MANIFEST);
  r._now = 1_000_000;
  r.configure({ sessionId: 's', gameRunId: 'g', settings: { seed: 7, questions: bank(), ...settings } });
  r.seatPlayers(players);
  r.start();
  return r;
}

// Drive fastest finger so a specific player wins, then return the runtime in hot seat.
function winFastestFinger(r, winnerId = 'p1') {
  const correct = r.ffQuestion.correctOrder;
  const wrong = [...correct].reverse();
  for (const pid of r.ffEligible) {
    r._now += pid === winnerId ? 50 : 400; // winner submits earliest
    r.handleIntent(pid, { type: 'fastest_finger_submit', order: pid === winnerId ? correct : wrong }, false);
  }
  return r;
}

// Answer the current hot-seat question correctly and advance.
function answerCorrect(r) {
  const q = r.hotSeatQuestions[r.level];
  r.handleIntent(r.contestantId, { type: 'select_answer', optionIndex: q.answer }, false);
  r.handleIntent(r.contestantId, { type: 'lock_answer' }, false);
  r.handleIntent('host', { type: 'reveal_answer' }, true);
  if (r.state.phase === 'hot_seat') r.handleIntent('host', { type: 'advance' }, true);
}

test('default ₦100→₦5,000 ladder is the canonical 15-step list', () => {
  assert.deepEqual(generateLadder(100, 5000),
    [100, 200, 300, 400, 500, 700, 900, 1200, 1600, 2000, 2500, 3100, 3600, 4300, 5000]);
});

test('arbitrary ladder is strictly increasing with exact endpoints', () => {
  const l = generateLadder(500, 1_000_000);
  assert.equal(l.length, 15);
  assert.equal(l[0], 500);
  assert.equal(l[14], 1_000_000);
  for (let i = 1; i < l.length; i += 1) assert.ok(l[i] > l[i - 1], `not increasing at ${i}: ${l[i - 1]}→${l[i]}`);
});

test('fastest correct finger becomes the sole contestant', () => {
  const r = make();
  winFastestFinger(r, 'p2');
  assert.equal(r.state.phase, 'hot_seat');
  assert.equal(r.contestantId, 'p2');
  assert.equal(r.privateState('p2').isContestant, true);
  assert.equal(r.privateState('p1').role, 'audience');
});

test('a tie within 100ms triggers a tie-breaker between the tied players', () => {
  const r = make();
  const correct = r.ffQuestion.correctOrder;
  r._now += 50; r.handleIntent('p1', { type: 'fastest_finger_submit', order: correct }, false);
  r._now += 30; r.handleIntent('p2', { type: 'fastest_finger_submit', order: correct }, false); // within 100ms of p1
  r._now += 300; r.handleIntent('p3', { type: 'fastest_finger_submit', order: correct }, false);
  assert.equal(r.state.phase, 'fastest_finger');
  assert.equal(r.state.fastestFinger.tieBreak, true);
  assert.deepEqual([...r.ffEligible].sort(), ['p1', 'p2']);
});

test('nobody correct loads another fastest-finger question', () => {
  const r = make();
  const wrong = [...r.ffQuestion.correctOrder].reverse();
  for (const pid of ['p1', 'p2', 'p3']) r.handleIntent(pid, { type: 'fastest_finger_submit', order: wrong }, false);
  assert.equal(r.state.phase, 'fastest_finger');
  assert.equal(r.state.fastestFinger.submittedCount, 0); // fresh question, submissions reset
});

test('wrong answer drops to the latest safety net (₦500 after Q5)', () => {
  const r = make();
  winFastestFinger(r);
  for (let i = 0; i < 5; i += 1) answerCorrect(r); // pass safety net at level 5
  assert.equal(r.level, 5);
  const q = r.hotSeatQuestions[r.level];
  const wrongIdx = (q.answer + 1) % 4;
  r.handleIntent(r.contestantId, { type: 'select_answer', optionIndex: wrongIdx }, false);
  r.handleIntent(r.contestantId, { type: 'lock_answer' }, false);
  r.handleIntent('host', { type: 'reveal_answer' }, true);
  assert.equal(r.state.phase, 'finished');
  assert.equal(r.result.outcome, 'wrong_answer');
  assert.equal(r.result.earnedAmount, 500); // ladder[4]
});

test('walk away banks the last completed amount', () => {
  const r = make();
  winFastestFinger(r);
  answerCorrect(r); answerCorrect(r); // completed 2 questions → ₦200
  r.handleIntent(r.contestantId, { type: 'walk_away' }, false);
  assert.equal(r.state.phase, 'finished');
  assert.equal(r.result.outcome, 'walked_away');
  assert.equal(r.result.earnedAmount, 200);
});

test('answering all 15 wins the top prize', () => {
  const r = make();
  winFastestFinger(r);
  for (let i = 0; i < 15; i += 1) answerCorrect(r);
  assert.equal(r.state.phase, 'finished');
  assert.equal(r.result.outcome, 'top_prize');
  assert.equal(r.result.earnedAmount, 5000);
  assert.deepEqual(r.state.winnerPlayerIds, [r.contestantId]);
});

test('timeout default walks away; configurable to wrong answer', () => {
  const walk = make();
  winFastestFinger(walk);
  answerCorrect(walk); // ₦100 completed
  walk.handleIntent('host', { type: 'resolve_timeout' }, true);
  assert.equal(walk.result.outcome, 'timeout_walk');
  assert.equal(walk.result.earnedAmount, 100);

  const strict = make({ timeoutOutcome: 'wrong_answer' });
  winFastestFinger(strict);
  answerCorrect(strict); // below first safety net → 0
  strict.handleIntent('host', { type: 'resolve_timeout' }, true);
  assert.equal(strict.result.outcome, 'timeout_wrong');
  assert.equal(strict.result.earnedAmount, 0);
});

test('50:50 removes exactly two wrong options, keeping the correct one', () => {
  const r = make();
  winFastestFinger(r);
  const q = r.hotSeatQuestions[r.level];
  r.handleIntent(r.contestantId, { type: 'use_lifeline', lifeline: 'fifty_fifty' }, false);
  assert.equal(r.activeFifty.length, 2);
  assert.equal(r.activeFifty.includes(q.answer), false);
  const removed = r.state.question.options.filter((o) => o.removed).length;
  assert.equal(removed, 2);
});

test('Ask the Room tallies one anonymous vote per non-contestant', () => {
  const r = make();
  winFastestFinger(r, 'p1');
  r.handleIntent('p1', { type: 'use_lifeline', lifeline: 'ask_room' }, false);
  assert.equal(r.handleIntent('p1', { type: 'audience_vote', optionIndex: 0 }, false), false); // contestant can't vote
  r.handleIntent('p2', { type: 'audience_vote', optionIndex: 1 }, false);
  assert.equal(r.handleIntent('p2', { type: 'audience_vote', optionIndex: 2 }, false), false); // one vote only
  r.handleIntent('p3', { type: 'audience_vote', optionIndex: 1 }, false);
  const pub = r.publicState();
  assert.equal(pub.lifeline.votesCast, 2);
  assert.equal(pub.lifeline.percentages[1], 100);
  assert.equal('votes' in pub.lifeline, false); // no voter identity exposed
});

test('Ask One Player records the chosen helper recommendation', () => {
  const r = make();
  winFastestFinger(r, 'p1');
  r.handleIntent('p1', { type: 'use_lifeline', lifeline: 'ask_player', targetPlayerId: 'p2' }, false);
  assert.equal(r.privateState('p2').isHelper, true);
  assert.equal(r.handleIntent('p3', { type: 'friend_answer', optionIndex: 0, confidence: 90 }, false), false); // only helper
  r.handleIntent('p2', { type: 'friend_answer', optionIndex: 2, confidence: 80 }, false);
  assert.deepEqual(r.publicState().lifeline.recommendation, { optionIndex: 2, confidence: 80 });
});

test('Ask Host records a concealed host recommendation', () => {
  const r = make();
  winFastestFinger(r, 'p1');
  r.handleIntent('p1', { type: 'use_lifeline', lifeline: 'ask_host' }, false);
  r.handleIntent('host', { type: 'host_answer', optionIndex: 0, confidence: 70 }, true);
  assert.deepEqual(r.publicState().lifeline.recommendation, { optionIndex: 0, confidence: 70 });
});

test('the correct answer never leaks before reveal in any projection', () => {
  const r = make();
  winFastestFinger(r, 'p1');
  const q = r.hotSeatQuestions[r.level];
  for (const projection of [r.publicState(), r.companionState(), r.crowdState(), r.privateState('p1'), r.privateState('p2')]) {
    const json = JSON.stringify(projection);
    assert.equal(json.includes('"answer"'), false, 'answer index must not appear');
    assert.equal(/"correct"\s*:\s*true/.test(json), false);
  }
  r.handleIntent('p1', { type: 'select_answer', optionIndex: q.answer }, false);
  r.handleIntent('p1', { type: 'lock_answer' }, false);
  r.handleIntent('host', { type: 'reveal_answer' }, true);
  assert.equal(r.publicState().reveal.correctIndex, q.answer);
});

test('no bots are ever seated and rankBotIntent is null', () => {
  const r = make({}, [{ id: 'p1', name: 'Solo' }]);
  assert.equal(r.players.every((p) => !p.bot), true);
  assert.equal(r.rankBotIntent('p1'), null);
});

test('select does not commit; final answer is required to reveal', () => {
  const r = make();
  winFastestFinger(r, 'p1');
  const q = r.hotSeatQuestions[r.level];
  r.handleIntent('p1', { type: 'select_answer', optionIndex: q.answer }, false);
  assert.equal(r.handleIntent('host', { type: 'reveal_answer' }, true), false); // no lock yet
  assert.equal(r.state.phase, 'hot_seat');
});

test('snapshot/restore preserves an in-progress hot seat', () => {
  const r = make();
  winFastestFinger(r, 'p1');
  answerCorrect(r); answerCorrect(r);
  const snap = r.snapshot();
  const r2 = new MoneyTriviaRuntime(MANIFEST);
  r2._now = r._now;
  r2.restore(snap);
  assert.equal(r2.contestantId, r.contestantId);
  assert.equal(r2.level, r.level);
  assert.deepEqual(r2.ladder, r.ladder);
  answerCorrect(r2);
  assert.equal(r2.level, 3);
});
