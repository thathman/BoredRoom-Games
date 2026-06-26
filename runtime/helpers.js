// Shared helpers for BoredRoom game runtimes.
// Extracted from game-runtime.js — every runtime imports from here.

// Deterministic RNG (mulberry32) so a stored seed reproduces the same shuffle across snapshots.
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleInPlace(array, rng) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

export function clone(value) {
  return structuredClone(value);
}

export function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function topPlayers(players) {
  const top = Math.max(0, ...players.map((player) => player.score ?? 0));
  return players.filter((player) => (player.score ?? 0) === top).map((player) => player.id);
}

// Base class that every game runtime extends.
// Implements the full runtime contract with sensible defaults.
export class RuntimeBase {
  constructor(manifest) {
    this.gameType = manifest.id;
    this.manifest = manifest;
    this.context = null;
    this.players = [];
    this.state = null;
  }

  get metadata() {
    return {
      gameType: this.gameType,
      capabilities: {
        playerCount: { min: this.manifest.minPlayers, max: this.manifest.maxPlayers },
        bots: this.manifest.capabilities.bots,
        audience: this.manifest.capabilities.audience,
        hints: this.manifest.capabilities.hints,
        voice: false,
        restore: this.manifest.capabilities.restore,
      },
      rules: this.manifest.rules,
    };
  }

  configure(context) {
    this.context = clone(context);
  }

  seatPlayers(players) {
    this.players = players.slice(0, this.manifest.maxPlayers).map((player, index) => ({
      id: player.id,
      name: player.name,
      score: 0,
      seat: index,
    }));
    if (this.context?.settings?.allowBots && this.manifest.capabilities.bots) {
      while (this.players.length < this.manifest.minPlayers) {
        const number = this.players.length + 1;
        this.players.push({ id: `bot-${number}`, name: `Bot ${number}`, score: 0, seat: number - 1, bot: true });
      }
    }
  }

  seated(playerId) {
    return this.players.some((player) => player.id === playerId);
  }

  // Role-specific state — override in subclasses
  companionState() {
    return this.publicState();
  }

  crowdState() {
    const state = this.publicState();
    return { ...state, private: undefined };
  }

  snapshot() {
    return clone({ context: this.context, players: this.players, state: this.state, extra: this.extraSnapshot?.() });
  }

  restore(snapshot) {
    this.context = clone(snapshot.context);
    this.players = clone(snapshot.players);
    this.state = clone(snapshot.state);
    this.restoreExtra?.(clone(snapshot.extra));
  }

  finish() {
    if (this.state && this.state.phase !== 'finished') {
      this.state.phase = 'finished';
      this.state.winnerPlayerIds = topPlayers(this.players);
      this.state.lastAction = 'Game complete.';
    }
    return { winnerPlayerIds: clone(this.state?.winnerPlayerIds ?? []) };
  }

  dispose() {
    this.context = null;
    this.players = [];
    this.state = null;
  }

  explainIntent(intent) {
    return `${this.manifest.name} rejected ${String(intent?.type ?? 'that action')} because it is not legal in the current state.`;
  }

  recapSignals() {
    return { mode: this.state?.mode, scores: this.players.map(({ id, score }) => ({ playerId: id, score })) };
  }
}
