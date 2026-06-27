// Faith Feud tests — survey collection, faceoff buzzer, team control, strikes, steals and restore.

import assert from 'node:assert/strict';
import test from 'node:test';
import { FaithFeudRuntime } from '../../../runtime/games/faith-feud.js';

const PLAYERS = [
  { id: 'a1', name: 'Ada' }, { id: 'a2', name: 'Amaka' },
  { id: 'b1', name: 'Tobi' }, { id: 'b2', name: 'Bola' },
];

function makeFF(settings = {}, players = PLAYERS) {
  const runtime = new FaithFeudRuntime({
    id: 'faith-feud', name: 'Faith Feud', emoji: '📣', version: '1.2.0.0',
    minPlayers: 2, maxPlayers: 8, capabilities: { bots: true, audience: true, hints: true, restore: true },
  });
  runtime.configure({ sessionId: 's', gameRunId: 'r', settings: { seed: 5, rounds: 3, surveyCollection: false, ...settings } });
  runtime.seatPlayers(players);
  runtime.start();
  return runtime;
}

function surveyAnswers(runtime) { return runtime.surveys[runtime.ci][1]; }
function startTeamPlay(runtime, buzzer = 'a1') {
  assert.equal(runtime.handleIntent(buzzer, { type: 'buzz' }, false), true);
  const top = surveyAnswers(runtime)[0].text;
  assert.equal(runtime.handleIntent(buzzer, { type: 'answer_text', text: top }, false), true);
  assert.equal(runtime.phase, 'play');
}

test('splits players into teams and selects rotating faceoff representatives', () => {
  const runtime = makeFF();
  assert.deepEqual(runtime.publicState().team1Ids, ['a1', 'a2']);
  assert.deepEqual(runtime.publicState().team2Ids, ['b1', 'b2']);
  assert.deepEqual(runtime.publicState().faceoffPlayerIds, ['a1', 'b1']);
  assert.deepEqual(runtime.legalIntents('a2'), []);
});

test('optional private survey collection builds a ranked playable board', () => {
  const runtime = makeFF({ surveyCollection: true, surveyQuestions: ['Name party essentials'], rounds: 2 });
  assert.equal(runtime.publicState().phase, 'survey_collection');
  assert.equal(runtime.handleIntent('a1', { type: 'survey_answer', answers: ['Music', 'Food'] }, false), true);
  assert.equal(runtime.handleIntent('a2', { type: 'survey_answer', answers: ['Music', 'Friends'] }, false), true);
  assert.equal(runtime.handleIntent('b1', { type: 'survey_answer', answers: ['Food'] }, false), true);
  assert.equal(runtime.handleIntent('b2', { type: 'survey_answer', answers: ['Music'] }, false), true);
  assert.equal(runtime.publicState().phase, 'faceoff_buzz');
  assert.equal(runtime.surveys[0][0], 'Name party essentials');
  assert.equal(runtime.surveys[0][1][0].text, 'Music');
  assert.ok(runtime.surveys[0][1][0].points > runtime.surveys[0][1][1].points);
  assert.equal(JSON.stringify(runtime.publicState()).includes('Music'), false);
});

test('a collected board with one unique answer completes directly from faceoff', () => {
  const runtime = makeFF(
    { surveyCollection: true, surveyQuestions: ['Name the essential'], rounds: 1 },
    [{ id: 'a1', name: 'Ada' }, { id: 'b1', name: 'Tobi' }],
  );
  runtime.handleIntent('a1', { type: 'survey_answer', answers: ['Music'] }, false);
  runtime.handleIntent('b1', { type: 'survey_answer', answers: ['Music'] }, false);
  runtime.handleIntent('a1', { type: 'buzz' }, false);
  assert.equal(runtime.handleIntent('a1', { type: 'answer_text', text: 'Music' }, false), true);
  assert.equal(runtime.publicState().phase, 'round_reveal');
  assert.ok(runtime.publicState().teamScores[0] > 0);
});

test('faceoff accepts only representatives and locks the first buzzer', () => {
  const runtime = makeFF();
  assert.equal(runtime.handleIntent('a2', { type: 'buzz' }, false), false);
  assert.equal(runtime.handleIntent('a1', { type: 'buzz' }, false), true);
  assert.equal(runtime.handleIntent('b1', { type: 'buzz' }, false), false);
  assert.equal(runtime.publicState().buzzedPlayerId, 'a1');
  assert.equal(runtime.handleIntent('b1', { type: 'answer_text', text: surveyAnswers(runtime)[0].text }, false), false);
});

test('top faceoff answer immediately gives that team control', () => {
  const runtime = makeFF();
  startTeamPlay(runtime);
  assert.equal(runtime.publicState().activeTeam, 0);
  assert.equal(runtime.publicState().revealedAnswers.length, 1);
  assert.equal(runtime.publicState().roundBank, surveyAnswers(runtime)[0].points);
});

test('non-top faceoff answer gives the other representative a comparison answer', () => {
  const runtime = makeFF();
  const answers = surveyAnswers(runtime);
  runtime.handleIntent('a1', { type: 'buzz' }, false);
  runtime.handleIntent('a1', { type: 'answer_text', text: answers[2].text }, false);
  assert.equal(runtime.publicState().phase, 'faceoff_answer');
  assert.equal(runtime.publicState().buzzedPlayerId, 'b1');
  runtime.handleIntent('b1', { type: 'answer_text', text: answers[1].text }, false);
  assert.equal(runtime.publicState().phase, 'play');
  assert.equal(runtime.publicState().activeTeam, 1);
});

test('active team builds the round bank while the other team is blocked', () => {
  const runtime = makeFF();
  startTeamPlay(runtime);
  const next = surveyAnswers(runtime)[1];
  assert.equal(runtime.handleIntent('b1', { type: 'answer_text', text: next.text }, false), false);
  assert.equal(runtime.handleIntent('a2', { type: 'answer_text', text: next.text }, false), true);
  assert.equal(runtime.publicState().roundBank, surveyAnswers(runtime)[0].points + next.points);
  assert.equal(runtime.publicState().teamScores[0], 0); // bank is awarded only when round ends
});

test('three unique strikes open one steal answer and award the bank correctly', () => {
  const runtime = makeFF();
  startTeamPlay(runtime);
  for (const wrong of ['wrong one', 'wrong two', 'wrong three']) assert.equal(runtime.handleIntent('a1', { type: 'answer_text', text: wrong }, false), true);
  assert.equal(runtime.publicState().phase, 'steal');
  assert.equal(runtime.handleIntent('a2', { type: 'answer_text', text: surveyAnswers(runtime)[1].text }, false), false);
  assert.equal(runtime.handleIntent('b1', { type: 'answer_text', text: surveyAnswers(runtime)[1].text }, false), true);
  assert.equal(runtime.publicState().phase, 'round_reveal');
  assert.equal(runtime.publicState().teamScores[1], runtime.publicState().roundBank);
  assert.equal(runtime.publicState().revealedAnswers.length, runtime.publicState().totalSlots);
});

test('duplicate wrong guesses do not create extra strikes', () => {
  const runtime = makeFF();
  startTeamPlay(runtime);
  assert.equal(runtime.handleIntent('a1', { type: 'answer_text', text: 'nonsense' }, false), true);
  assert.equal(runtime.handleIntent('a2', { type: 'answer_text', text: 'nonsense' }, false), false);
  assert.equal(runtime.publicState().strikes, 1);
});

test('host advances a revealed round and final round produces team winners', () => {
  const runtime = makeFF({ rounds: 1, steals: false });
  startTeamPlay(runtime);
  for (const wrong of ['x one', 'x two', 'x three']) runtime.handleIntent('a1', { type: 'answer_text', text: wrong }, false);
  assert.equal(runtime.publicState().phase, 'round_reveal');
  assert.equal(runtime.handleIntent('host', { type: 'advance' }, true), true);
  assert.equal(runtime.publicState().phase, 'finished');
  assert.deepEqual(runtime.publicState().winnerPlayerIds.sort(), ['a1', 'a2']);
});

test('bot follows buzzer and answer legal intents using real survey answers', () => {
  const runtime = makeFF({}, [{ id: 'bot-1', name: 'Bot', bot: true }, { id: 'p2', name: 'Tobi' }]);
  assert.deepEqual(runtime.rankBotIntent('bot-1'), { type: 'buzz' });
  runtime.handleIntent('bot-1', { type: 'buzz' }, false);
  const answerIntent = runtime.rankBotIntent('bot-1');
  assert.equal(answerIntent.type, 'answer_text');
  assert.equal(surveyAnswers(runtime).some((answer) => answer.text === answerIntent.text), true);
});

test('snapshot restore preserves collection, buzzer, bank and team state', () => {
  const runtime = makeFF();
  runtime.handleIntent('a1', { type: 'buzz' }, false);
  runtime.handleIntent('a1', { type: 'answer_text', text: surveyAnswers(runtime)[2].text }, false);
  const snapshot = runtime.snapshot();
  const restored = makeFF();
  restored.restore(snapshot);
  assert.deepEqual(restored.publicState(), runtime.publicState());
  assert.deepEqual(restored.privateState('b1'), runtime.privateState('b1'));
});

test('merges validated AI surveys ahead of local fallback packs', () => {
  const aiSurvey = { question: 'AI: Name a Nigerian city', answers: [
    { text: 'Lagos', aliases: [], points: 50 }, { text: 'Abuja', aliases: [], points: 30 }, { text: 'Kano', aliases: [], points: 20 },
  ] };
  const runtime = makeFF({ aiSurveys: [aiSurvey], rounds: 10 });
  assert.equal(runtime.surveys.some((survey) => survey[0] === aiSurvey.question), true);
  assert.ok(runtime.surveys.length >= 3);
});
