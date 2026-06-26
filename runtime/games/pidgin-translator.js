// Pidgin Translator — voice-first translation game.
// Modes: speed_voice (default), accuracy_voice, text_only.
// Fastest correct wins. Privacy: no raw audio broadcast, no room mic, server timestamp decides speed.

import { RuntimeBase, makeRng, shuffleInPlace, clone, topPlayers } from '../helpers.js';

const PHRASE_BANK = [
  { source: 'How you dey?', target: 'How are you?', category: 'Everyday', difficulty: 'easy' },
  { source: 'I wan chop', target: 'I want to eat', category: 'Everyday', difficulty: 'easy' },
  { source: 'Wetin be this?', target: 'What is this?', category: 'Everyday', difficulty: 'easy' },
  { source: 'No wahala', target: 'No problem', category: 'Everyday', difficulty: 'easy' },
  { source: 'Abeg, help me', target: 'Please, help me', category: 'Everyday', difficulty: 'easy' },
  { source: 'E don do', target: 'It is enough', category: 'Everyday', difficulty: 'easy' },
  { source: 'Na so e be', target: 'That is how it is', category: 'Everyday', difficulty: 'easy' },
  { source: 'Oya make we go', target: 'Let us go', category: 'Everyday', difficulty: 'easy' },
  { source: 'Wetin you talk?', target: 'What did you say?', category: 'Everyday', difficulty: 'easy' },
  { source: 'Make una calm down', target: 'Everyone should calm down', category: 'Everyday', difficulty: 'easy' },
  { source: 'I no get money', target: 'I have no money', category: 'Everyday', difficulty: 'easy' },
  { source: 'E sweet me well well', target: 'I really enjoyed it', category: 'Everyday', difficulty: 'medium' },
  { source: 'No be small thing', target: 'It is not a small matter', category: 'Everyday', difficulty: 'medium' },
  { source: 'God don butter my bread', target: 'God has blessed me', category: 'Church', difficulty: 'medium' },
  { source: 'Omo see gobe', target: 'Child, see trouble', category: 'Slang', difficulty: 'medium' },
  { source: 'Shine your eye', target: 'Be alert/watchful', category: 'Slang', difficulty: 'medium' },
  { source: 'Body dey inside cloth', target: 'I am well and alive', category: 'Slang', difficulty: 'medium' },
  { source: 'E choke', target: 'It is overwhelming/intense', category: 'Slang', difficulty: 'medium' },
  { source: 'Who no know go know', target: 'Those who do not know will learn', category: 'Slang', difficulty: 'hard' },
  { source: 'Water don pass garri', target: 'Trouble has passed the limit', category: 'Slang', difficulty: 'hard' },
];

export class PidginTranslatorRuntime extends RuntimeBase {
  start() {
    const seed = Number(this.context?.settings?.seed) || (Date.now() & 0xffffffff);
    const rng = makeRng(seed);
    this.mode = String(this.context?.settings?.mode || 'text_only'); // voice_mode is opt-in due to privacy
    this.questionCount = Math.min(15, Math.max(5, Number(this.context?.settings?.questionCount) || 10));
    this.direction = String(this.context?.settings?.direction || 'pidgin_to_english');

    this.questions = shuffleInPlace(clone(PHRASE_BANK), rng).slice(0, this.questionCount);
    this.currentIndex = 0;
    this.roundStartTime = 0;

    this.state = {
      gameType: this.gameType, name: this.manifest.name, emoji: this.manifest.emoji,
      mode: 'challenge', phase: 'playing', round: 1, totalRounds: this.questionCount,
      challenge: this.buildChallenge(), players: clone(this.players.map((p) => ({ ...p }))),
      submittedCount: 0, submissions: {}, lastResults: [], winnerPlayerIds: [],
      lastAction: 'Translate the phrase as fast as you can!',
    };
  }

  buildChallenge() {
    const q = this.questions[this.currentIndex];
    if (!q) return null;
    const prompt = this.direction === 'pidgin_to_english'
      ? `Translate this Pidgin: "${q.source}"`
      : `Translate to Pidgin: "${q.target}"`;
    return { kind: 'text', prompt };
  }

  handleIntent(playerId, intent, isHost) {
    if (!this.state || this.state.phase === 'finished') return false;
    if (intent?.type === 'advance' && isHost) {
      if (this.state.phase === 'reveal') { this.nextPhrase(); return true; }
      this.revealPhrase(); return true;
    }
    if (this.state.phase !== 'playing' || this.state.submissions?.[playerId]) return false;
    if (intent?.type === 'answer_text' && intent?.text) {
      // Record submission time with server timestamp
      this.state.submissions[playerId] = { text: String(intent.text), time: Date.now() };
    } else if (intent?.type === 'voice_submission' && intent?.transcript) {
      this.state.submissions[playerId] = { text: String(intent.transcript), time: Date.now() };
    } else return false;

    this.state.submittedCount = Object.keys(this.state.submissions).length;
    this.state.players = clone(this.state.players);
    const player = this.state.players.find((p) => p.id === playerId);
    this.state.lastAction = `${player?.name ?? 'Player'} submitted.`;
    if (this.state.submittedCount >= this.players.length) this.revealPhrase();
    return true;
  }

  revealPhrase() {
    const q = this.questions[this.currentIndex];
    const expected = this.direction === 'pidgin_to_english' ? q.target : q.source;
    const acceptable = [expected.toLowerCase()];
    if (q.difficulty === 'easy') acceptable.push(expected.toLowerCase().replace(/,/g, ''));

    const submissions = this.state.submissions ?? {};
    const entries = Object.entries(submissions).map(([playerId, { text, time }]) => ({ playerId, text, time }));
    entries.sort((a, b) => a.time - b.time);

    const results = [];
    for (const { playerId, text, time } of entries) {
      const norm = text.toLowerCase().trim();
      const correct = acceptable.some((a) => norm === a || (norm.length > 3 && a.includes(norm)));
      const rank = entries.filter((e) => e.time < time).length + 1;
      let points = 0;
      if (correct) {
        if (rank === 1) points = 100;
        else if (rank === 2) points = 75;
        else if (rank === 3) points = 50;
        else points = 25;
      }
      const player = this.state.players.find((p) => p.id === playerId);
      if (player) player.score += points;
      results.push({ playerId, points, answer: text, rank });
    }

    this.state.phase = 'reveal';
    this.state.lastResults = results;
    this.state.lastAction = `Expected: "${expected}". Fastest correct wins!`;
  }

  nextPhrase() {
    this.currentIndex += 1;
    if (this.currentIndex >= this.questions.length) {
      this.state.phase = 'finished';
      this.state.winnerPlayerIds = topPlayers(this.state.players);
      this.state.players = clone(this.state.players);
      this.state.lastAction = this.state.winnerPlayerIds.length > 1 ? 'Draw!' : `${this.playerName(this.state.winnerPlayerIds[0])} wins!`;
      return;
    }
    this.state.phase = 'playing';
    this.state.round = this.currentIndex + 1;
    this.state.challenge = this.buildChallenge();
    this.state.submittedCount = 0; this.state.submissions = {}; this.state.lastResults = [];
    this.state.lastAction = this.questions[this.currentIndex]?.source ?? 'Next phrase!';
  }

  playerName(id) { return this.state?.players?.find((p) => p.id === id)?.name ?? 'A player'; }
  publicState() { return clone(this.state); }
  privateState(id) {
    return { seated: this.seated(id), submitted: this.state?.submissions?.[id] != null, legalIntents: this.legalIntents(id) };
  }
  legalIntents(id) {
    if (!this.state || this.state.phase !== 'playing' || this.state.submissions?.[id] || !this.seated(id)) return [];
    return [{ type: 'answer_text', label: 'Type your translation' }];
  }
  rankBotIntent(id) {
    if (!this.state || this.state.phase !== 'playing' || this.state.submissions?.[id]) return null;
    const q = this.questions[this.currentIndex];
    return { type: 'answer_text', text: this.direction === 'pidgin_to_english' ? q?.target ?? 'ok' : q?.source ?? 'ok' };
  }
  extraSnapshot() { return { questions: this.questions, currentIndex: this.currentIndex, mode: this.mode, direction: this.direction }; }
  restoreExtra(extra) { this.questions = extra?.questions ?? []; this.currentIndex = extra?.currentIndex ?? 0; this.mode = extra?.mode ?? 'text_only'; this.direction = extra?.direction ?? 'pidgin_to_english'; }
}
