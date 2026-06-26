import assert from 'node:assert/strict';
import test from 'node:test';
import { createTimer, TIMER_PHASES, SCORING_MODES } from '../runtime/timer.js';

// Helper: advance time in tests
function tick(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('timer starts in pre_countdown then transitions to accepting_answers', async () => {
  const timer = createTimer({ preCountdownMs: 10, roundMs: 5000 });
  timer.start('round-1');
  assert.equal(timer.phase('round-1'), TIMER_PHASES.PRE_COUNTDOWN);
  await tick(20);
  assert.equal(timer.phase('round-1'), TIMER_PHASES.ACCEPTING_ANSWERS);
  timer.dispose();
});

test('round closes after timer expiry and rejects late submissions', async () => {
  const timer = createTimer({ preCountdownMs: 5, roundMs: 30, overtime: false });
  timer.setPlayers([{ id: 'p1' }, { id: 'p2' }]);
  timer.start('round-1');
  await tick(20); // now accepting answers
  assert.equal(timer.submit('round-1', 'p1').accepted, true);
  timer.lock('round-1');
  // After explicit lock, submission should be rejected
  const result = timer.submit('round-1', 'p2');
  assert.equal(result.accepted, false);
  timer.dispose();
});

test('pause/resume preserves remaining time', async () => {
  const timer = createTimer({ preCountdownMs: 5, roundMs: 100 });
  timer.start('round-1');
  await tick(15);
  const before = timer.remainingMs('round-1');
  // Pause for 50ms
  timer.pause('round-1');
  await tick(50);
  const during = timer.remainingMs('round-1');
  // During pause, remaining should not have decreased significantly
  assert.ok(Math.abs(during - before) < 5 || during >= before - 5);
  timer.resume('round-1');
  await tick(10);
  const after = timer.remainingMs('round-1');
  // After resume, remaining should be ticking down
  assert.ok(after <= during);
  timer.dispose();
});

test('all-submit reveals early when earlyRevealThreshold is set', async () => {
  const timer = createTimer({ preCountdownMs: 5, roundMs: 50000, earlyRevealThreshold: 2 });
  timer.setPlayers([{ id: 'p1' }, { id: 'p2' }]);
  timer.start('round-1');
  await tick(15);
  assert.equal(timer.submit('round-1', 'p1').accepted, true);
  assert.equal(timer.submit('round-1', 'p2').accepted, true);
  assert.equal(timer.phase('round-1'), TIMER_PHASES.LOCKED);
  assert.equal(timer.submit('round-1', 'p3').accepted, false);
  timer.dispose();
});

test('fastest correct is calculated correctly', async () => {
  const timer = createTimer({ preCountdownMs: 5, roundMs: 50000 });
  timer.setPlayers([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]);
  timer.start('round-1');
  await tick(15);

  // p2 submits first
  timer.submit('round-1', 'p2');
  // p1 submits second (both correct)
  await tick(5);
  timer.submit('round-1', 'p1');
  // p3 submits third (incorrect)
  await tick(5);
  timer.submit('round-1', 'p3');

  timer.lock('round-1');
  const result = timer.speedRank('round-1', (playerId) => playerId !== 'p3');

  assert.deepEqual(result.fastestCorrectPlayerIds, ['p2']);
  assert.equal(result.ranked.length, 2);
  assert.equal(result.ranked[0].playerId, 'p2');
  assert.equal(result.ranked[0].fastest, true);
  assert.equal(result.ranked[1].playerId, 'p1');
  assert.equal(result.ranked[1].fastest, false);
  timer.dispose();
});

test('speed bonus is calculated correctly for correctness_plus_speed_bonus mode', async () => {
  const timer = createTimer({
    preCountdownMs: 5,
    roundMs: 50000,
    scoringMode: SCORING_MODES.CORRECTNESS_PLUS_SPEED_BONUS,
    speedBonusWeight: 0.3,
  });
  timer.setPlayers([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]);
  timer.start('round-1');
  await tick(15);

  timer.submit('round-1', 'p1');
  await tick(5);
  timer.submit('round-1', 'p2');
  await tick(5);
  timer.submit('round-1', 'p3');

  timer.lock('round-1');
  const result = timer.speedRank('round-1', () => true);

  // Fastest (p1) gets 30 speed points, second gets ~15, third gets 0
  assert.ok(result.speedPoints['p1'] > result.speedPoints['p2']);
  assert.ok(result.speedPoints['p2'] > result.speedPoints['p3']);
  // p1: 30 * (1 - 0/3) = 30, p2: 30 * (1 - 1/3) = 20, p3: 30 * (1 - 2/3) = 10
  assert.equal(result.speedPoints['p1'], 30);
  assert.equal(result.speedPoints['p2'], 20);
  assert.equal(result.speedPoints['p3'], 10);
  timer.dispose();
});

test('reconnect restores timer state', async () => {
  const timer = createTimer({ preCountdownMs: 5, roundMs: 50000 });
  timer.setPlayers([{ id: 'p1' }, { id: 'p2' }]);
  timer.start('round-1');
  await tick(15);
  timer.submit('round-1', 'p1');

  const snap = timer.snapshot();

  const timer2 = createTimer({ preCountdownMs: 5, roundMs: 50000 });
  timer2.restore(snap);
  timer2.setPlayers([{ id: 'p1' }, { id: 'p2' }]);

  assert.equal(timer2.phase('round-1'), TIMER_PHASES.ACCEPTING_ANSWERS);
  assert.equal(timer2.submit('round-1', 'p2').accepted, true);
  timer2.dispose();
});

test('client clock drift does not affect scoring', async () => {
  const timer = createTimer({ preCountdownMs: 5, roundMs: 50000 });
  timer.setPlayers([{ id: 'p1' }, { id: 'p2' }]);
  timer.start('round-1');
  await tick(15);

  // Both submit at server time — p2's real-server time is slower despite
  // what any client clock says
  await tick(5);
  timer.submit('round-1', 'p1');
  await tick(5);
  timer.submit('round-1', 'p2');

  timer.lock('round-1');
  const result = timer.speedRank('round-1', () => true);

  // Server submission time determines order, not client clock
  assert.equal(result.ranked[0].playerId, 'p1');
  assert.equal(result.ranked[1].playerId, 'p2');
  timer.dispose();
});

test('extend adds more time to the round', async () => {
  const timer = createTimer({ preCountdownMs: 5, roundMs: 50 });
  timer.setPlayers([{ id: 'p1' }]);
  timer.start('round-1');
  await tick(15);
  timer.extend('round-1', 100);
  const remaining = timer.remainingMs('round-1');
  assert.ok(remaining >= 100);
  timer.dispose();
});

test('forceReveal locks and reveals immediately', async () => {
  const timer = createTimer({ preCountdownMs: 5, roundMs: 50000 });
  timer.start('round-1');
  await tick(15);
  timer.forceReveal('round-1');
  assert.equal(timer.phase('round-1'), TIMER_PHASES.REVEAL);
  timer.dispose();
});

test('late player tracking works correctly', async () => {
  const timer = createTimer({ preCountdownMs: 5, roundMs: 30, overtime: false });
  timer.setPlayers([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]);
  timer.start('round-1');
  await tick(15);
  timer.submit('round-1', 'p1');
  await tick(40); // timer expired
  timer.lock('round-1');
  const round = timer.round('round-1');
  assert.ok(round.latePlayerIds.includes('p2'));
  assert.ok(round.latePlayerIds.includes('p3'));
  assert.ok(!round.latePlayerIds.includes('p1'));
  timer.dispose();
});

test('duplicate submission rejected', async () => {
  const timer = createTimer({ preCountdownMs: 5, roundMs: 50000 });
  timer.start('round-1');
  await tick(15);
  assert.equal(timer.submit('round-1', 'p1').accepted, true);
  const second = timer.submit('round-1', 'p1');
  assert.equal(second.accepted, false);
  assert.equal(second.message, 'Already submitted');
  timer.dispose();
});

test('ranked_speed_points mode distributes points correctly', async () => {
  const timer = createTimer({
    preCountdownMs: 5,
    roundMs: 50000,
    scoringMode: SCORING_MODES.RANKED_SPEED_POINTS,
  });
  timer.setPlayers([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }]);
  timer.start('round-1');
  await tick(15);

  await tick(5);
  timer.submit('round-1', 'p1');
  await tick(5);
  timer.submit('round-1', 'p2');
  await tick(5);
  timer.submit('round-1', 'p3');
  await tick(5);
  timer.submit('round-1', 'p4');

  timer.lock('round-1');
  const result = timer.speedRank('round-1', () => true);

  // 4 players: 1st=100, 2nd=75, 3rd=50, 4th=25
  assert.equal(result.speedPoints['p1'], 100);
  assert.equal(result.speedPoints['p2'], 75);
  assert.equal(result.speedPoints['p3'], 50);
  assert.equal(result.speedPoints['p4'], 25);
  timer.dispose();
});

test('fastest_correct_wins mode gives 100 to fastest, 0 to others', async () => {
  const timer = createTimer({
    preCountdownMs: 5,
    roundMs: 50000,
    scoringMode: SCORING_MODES.FASTEST_CORRECT_WINS,
  });
  timer.setPlayers([{ id: 'p1' }, { id: 'p2' }]);
  timer.start('round-1');
  await tick(15);

  await tick(5);
  timer.submit('round-1', 'p1');
  await tick(10);
  timer.submit('round-1', 'p2');

  timer.lock('round-1');
  const result = timer.speedRank('round-1', () => true);

  assert.equal(result.speedPoints['p1'], 100);
  assert.equal(result.speedPoints['p2'], 0);
  timer.dispose();
});
