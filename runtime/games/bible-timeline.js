// Bible Timeline Rush — order biblical events chronologically.
//
// Hidden canonical order. Shuffled visible order.
// Players drag/drop to arrange events. Scoring by exact + relative position.
//
// Settings:
//   contentSet (string, default 'old_testament') — content bank
//   questionCount (number, default 5) — events per round
//   rounds (number, default 3)
//   timer (number, default 30) — seconds per round
//   seed (number, optional)

import { RuntimeBase, makeRng, shuffleInPlace, clone, topPlayers, deprioritizeRecent } from '../helpers.js';

const EVENT_BANKS = {
  old_testament: [
    { event: 'Creation', reference: 'Genesis 1', position: 1 },
    { event: 'The Fall of Man', reference: 'Genesis 3', position: 2 },
    { event: "Noah's Flood", reference: 'Genesis 6-9', position: 3 },
    { event: "Tower of Babel", reference: 'Genesis 11', position: 4 },
    { event: "God's Promise to Abraham", reference: 'Genesis 12', position: 5 },
    { event: "Birth of Isaac", reference: 'Genesis 21', position: 6 },
    { event: "Joseph Sold into Slavery", reference: 'Genesis 37', position: 7 },
    { event: "Moses and the Burning Bush", reference: 'Exodus 3', position: 8 },
    { event: 'The Ten Plagues', reference: 'Exodus 7-12', position: 9 },
    { event: 'The Exodus from Egypt', reference: 'Exodus 14', position: 10 },
    { event: 'The Ten Commandments', reference: 'Exodus 20', position: 11 },
    { event: 'The Golden Calf', reference: 'Exodus 32', position: 12 },
    { event: 'Walls of Jericho Fall', reference: 'Joshua 6', position: 13 },
    { event: 'David and Goliath', reference: '1 Samuel 17', position: 14 },
    { event: "David Becomes King", reference: '2 Samuel 5', position: 15 },
    { event: "Solomon's Temple Built", reference: '1 Kings 6', position: 16 },
    { event: 'Elijah on Mount Carmel', reference: '1 Kings 18', position: 17 },
    { event: "Isaiah's Vision", reference: 'Isaiah 6', position: 18 },
    { event: 'Daniel in the Lions Den', reference: 'Daniel 6', position: 19 },
    { event: "Jonah and the Great Fish", reference: 'Jonah 1-2', position: 20 },
  ],
  new_testament: [
    { event: 'The Birth of Jesus', reference: 'Matthew 1-2', position: 1 },
    { event: "Jesus' Baptism", reference: 'Matthew 3', position: 2 },
    { event: 'The Temptation of Jesus', reference: 'Matthew 4', position: 3 },
    { event: 'The Sermon on the Mount', reference: 'Matthew 5-7', position: 4 },
    { event: 'Jesus Walks on Water', reference: 'Matthew 14', position: 5 },
    { event: 'The Transfiguration', reference: 'Matthew 17', position: 6 },
    { event: 'Jesus Raises Lazarus', reference: 'John 11', position: 7 },
    { event: 'The Last Supper', reference: 'Matthew 26', position: 8 },
    { event: "Jesus' Crucifixion", reference: 'Matthew 27', position: 9 },
    { event: 'The Resurrection', reference: 'Matthew 28', position: 10 },
    { event: 'The Ascension', reference: 'Acts 1', position: 11 },
    { event: 'Pentecost', reference: 'Acts 2', position: 12 },
    { event: "Stephen's Martyrdom", reference: 'Acts 7', position: 13 },
    { event: "Paul's Conversion", reference: 'Acts 9', position: 14 },
    { event: "Peter's Vision", reference: 'Acts 10', position: 15 },
    { event: "Paul's First Missionary Journey", reference: 'Acts 13-14', position: 16 },
    { event: 'The Council at Jerusalem', reference: 'Acts 15', position: 17 },
    { event: "Paul's Shipwreck", reference: 'Acts 27', position: 18 },
    { event: "Paul's Letters from Prison", reference: 'Philippians/Ephesians', position: 19 },
    { event: "John's Revelation on Patmos", reference: 'Revelation 1', position: 20 },
  ],
};

export class BibleTimelineRuntime extends RuntimeBase {
  start() {
    const seed = Number(this.context?.settings?.seed) || (Date.now() & 0xffffffff);
    this.rng = makeRng(seed);
    this.contentSet = String(this.context?.settings?.contentSet || 'old_testament');
    this.questionCount = Math.min(10, Math.max(3, Number(this.context?.settings?.questionCount) || 5));
    this.totalRounds = Math.min(5, Math.max(1, Number(this.context?.settings?.rounds) || 3));
    this.roundDuration = Number(this.context?.settings?.timer) || 30;

    // Start round 1 with shuffled events — NOT in canonical order
    this.prepareRound();

    this.state = {
      gameType: this.gameType,
      name: this.manifest.name,
      emoji: this.manifest.emoji,
      mode: 'challenge',
      phase: 'playing',
      round: 1,
      totalRounds: this.totalRounds,
      challenge: this.currentChallenge,
      canonicalOrder: this.currentCanonical, // hidden from players
      players: clone(this.players.map((p) => ({ ...p }))),
      submittedCount: 0,
      submissions: {},
      lastResults: [],
      winnerPlayerIds: [],
      lastAction: 'Arrange the events in chronological order.',
    };
    this.currentCanonical = null;
    this.currentChallenge = null;
  }

  prepareRound() {
    let bank = EVENT_BANKS[this.contentSet] ?? EVENT_BANKS.old_testament;
    // Merge AI-generated events (server-validated) into the bank; local bank is the fail-soft
    // fallback. Each AI event needs an event label and a chronological position.
    const aiEvents = Array.isArray(this.context?.settings?.aiEvents) ? this.context.settings.aiEvents : [];
    const validEvents = aiEvents.filter((e) => e && typeof e.event === 'string' && Number.isFinite(e.position));
    if (validEvents.length) bank = [...validEvents, ...bank];
    // Pick random events — not the first N which are always correct. Sink session-recent events
    // to the back first so consecutive rounds/plays avoid repeating the same set.
    const ordered = deprioritizeRecent(shuffleInPlace(clone(bank), this.rng), this.context?.settings?.avoidPrompts, (e) => e.event);
    const pool = ordered.slice(0, this.questionCount);
    pool.sort((a, b) => a.position - b.position); // canonical order
    this.currentCanonical = pool.map((e) => ({
      event: e.event,
      reference: e.reference,
      position: e.position,
    }));
    // Shuffle visible order so it's NEVER correct by default
    this.currentChallenge = {
      kind: 'order',
      prompt: `Arrange these ${this.contentSet === 'new_testament' ? 'New' : 'Old'} Testament events in chronological order.`,
      options: shuffleInPlace(clone(pool.map((e) => e.event)), this.rng),
    };
  }

  handleIntent(playerId, intent, isHost) {
    if (!this.state || this.state.phase === 'finished') return false;
    if (intent?.type === 'advance' && isHost) {
      if (this.state.phase === 'reveal') {
        this.nextRound();
        return true;
      }
      // Force reveal if all submitted or host wants to move on
      this.revealRound();
      return true;
    }
    if (this.state.phase !== 'playing') return false;
    if (this.state.submissions?.[playerId]) return false;
    if (intent?.type === 'submit_order') {
      const orderedIndexes = (intent?.orderedIndexes ?? []).map(Number);
      if (!Array.isArray(orderedIndexes) || orderedIndexes.length !== (this.state.challenge?.options?.length ?? 0)) return false;
      const player = this.state.players.find((p) => p.id === playerId);
      if (!player) return false;

      const options = this.state.challenge?.options ?? [];
      const submittedOrder = orderedIndexes.map((idx) => options[idx]);
      this.state.submissions[playerId] = { orderedIndexes, submittedOrder };
      this.state.submittedCount = Object.keys(this.state.submissions).length;
      this.state.players = clone(this.state.players);
      this.state.lastAction = `${player.name} submitted their timeline.`;

      if (this.state.submittedCount >= this.players.length) {
        this.revealRound();
      }
      return true;
    }
    return false;
  }

  revealRound() {
    const submissions = this.state.submissions ?? {};
    const canonical = this.state.canonicalOrder ?? [];
    const results = [];

    for (const [playerId, { submittedOrder }] of Object.entries(submissions)) {
      let points = 0;
      let exactMatch = 0;
      const details = [];

      for (let i = 0; i < canonical.length; i += 1) {
        const eventName = submittedOrder[i];
        const canonicalEvent = canonical.find((e) => e.event === eventName);
        if (canonicalEvent) {
          const correctIndex = canonical.findIndex((e) => e.event === eventName);
          if (correctIndex === i) {
            points += 100;
            exactMatch += 1;
            details.push({ event: eventName, correct: true, exact: true });
          } else {
            const dist = Math.abs(correctIndex - i);
            points += Math.max(0, 50 - dist * 10);
            details.push({ event: eventName, correct: false, offset: correctIndex - i });
          }
        } else {
          details.push({ event: eventName, correct: false });
        }
      }
      if (exactMatch === canonical.length) points += 200; // perfect bonus

      const player = this.state.players.find((p) => p.id === playerId);
      if (player) {
        player.score += points;
      }
      results.push({ playerId, points, details });
    }

    results.sort((a, b) => b.points - a.points);
    this.state.phase = 'reveal';
    this.state.lastResults = results.map((r) => ({ playerId: r.playerId, points: r.points }));
    this.state.players = clone(this.state.players);
    this.state.lastAction = `Round ${this.state.round} revealed. ${results[0]?.playerId ? `${this.playerName(results[0].playerId)} scored ${results[0].points}!` : ''}`;
  }

  nextRound() {
    if (this.state.round >= this.totalRounds) {
      this.state.phase = 'finished';
      this.state.winnerPlayerIds = topPlayers(this.state.players);
      this.state.lastAction = this.state.winnerPlayerIds.length > 1
        ? 'Game ends in a draw!'
        : `${this.playerName(this.state.winnerPlayerIds[0])} wins!`;
      return;
    }
    this.state.round += 1;
    this.state.phase = 'playing';
    this.state.submittedCount = 0;
    this.state.submissions = {};
    this.state.lastResults = [];
    this.prepareRound();
    this.state.challenge = this.currentChallenge;
    this.state.canonicalOrder = this.currentCanonical;
    this.state.lastAction = `Round ${this.state.round}: Rearrange the timeline.`;
  }

  playerName(playerId) {
    return this.state?.players?.find((p) => p.id === playerId)?.name ?? 'A player';
  }

  publicState() { return clone(this.state); }

  privateState(playerId) {
    return {
      seated: this.seated(playerId),
      submitted: this.state?.submissions?.[playerId] != null,
      legalIntents: this.legalIntents(playerId),
    };
  }

  legalIntents(playerId) {
    if (!this.state || this.state.phase !== 'playing') return [];
    if (this.state.submissions?.[playerId]) return [];
    if (!this.seated(playerId)) return [];
    const options = this.state.challenge?.options ?? [];
    const defaultOrder = options.map((_, i) => i);
    return [{ type: 'submit_order', orderedIndexes: defaultOrder, label: 'Submit timeline order' }];
  }

  rankBotIntent(playerId) {
    if (!this.state || this.state.phase !== 'playing' || this.state.submissions?.[playerId]) return null;
    const options = this.state.challenge?.options ?? [];
    // Bot makes a random shuffle — sometimes bad, sometimes lucky
    const order = options.map((_, i) => i);
    shuffleInPlace(order, makeRng(Date.now() & 0xffffffff));
    return { type: 'submit_order', orderedIndexes: order };
  }

  recapSignals() {
    return {
      mode: 'bible-timeline',
      scores: this.players.map(({ id, score }) => ({ playerId: id, score })),
      round: this.state?.round,
    };
  }

  extraSnapshot() {
    return {
      contentSet: this.contentSet,
      questionCount: this.questionCount,
      totalRounds: this.totalRounds,
    };
  }

  restoreExtra(extra) {
    this.contentSet = extra?.contentSet ?? 'old_testament';
    this.questionCount = extra?.questionCount ?? 5;
    this.totalRounds = extra?.totalRounds ?? 3;
  }
}
