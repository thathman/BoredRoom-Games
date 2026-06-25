// Pure Pidgin Translator engine (Phase 8). Players translate between English and Nigerian Pidgin:
// a phrase is shown, players pick the correct translation from choices; faster correct answers
// score more. No I/O, no timers — the server runs the loop and calls these helpers. Deterministic
// given the supplied prompt order.

export type PidginPhase = 'lobby' | 'prompt' | 'answer' | 'reveal' | 'finished';

export interface PidginPrompt {
  id: string;
  /** The phrase shown to players. */
  source: string;
  /** Direction, for UI labelling. */
  direction: 'en_to_pcm' | 'pcm_to_en';
  /** Answer options (one correct). */
  options: string[];
  /** Index into options that is correct. */
  answerIndex: number;
}

export interface PidginSettings {
  rounds: number;
  basePoints: number;
  /** Bonus for the first correct answer in a round. */
  firstBonus: number;
}

export const DEFAULT_PIDGIN_SETTINGS: PidginSettings = {
  rounds: 8,
  basePoints: 100,
  firstBonus: 50,
};

export interface PidginPlayerState {
  id: string;
  name: string;
  score: number;
}

export interface PidginState {
  phase: PidginPhase;
  round: number;
  settings: PidginSettings;
  players: PidginPlayerState[];
  currentPrompt: PidginPrompt | null;
  // answers for the current round: playerId -> chosen option index
  answers: Record<string, number>;
  // order players answered correctly (playerIds), to award the first-correct bonus
  correctOrder: string[];
  lastDeltas: Record<string, number>;
}

export function createInitialPidginState(
  players: { id: string; name: string }[],
  settings: PidginSettings = DEFAULT_PIDGIN_SETTINGS,
): PidginState {
  return {
    phase: 'lobby',
    round: 0,
    settings,
    players: players.map((p) => ({ id: p.id, name: p.name, score: 0 })),
    currentPrompt: null,
    answers: {},
    correctOrder: [],
    lastDeltas: {},
  };
}

export function startRound(state: PidginState, prompt: PidginPrompt): PidginState {
  if (state.phase === 'finished') return state;
  return {
    ...state,
    phase: 'answer',
    round: state.round + 1,
    currentPrompt: prompt,
    answers: {},
    correctOrder: [],
    lastDeltas: {},
  };
}

// Submit an answer (first answer per player counts). Tracks correct-answer order for the bonus.
export function submitAnswer(state: PidginState, playerId: string, optionIndex: number): PidginState {
  if (state.phase !== 'answer' || !state.currentPrompt) return state;
  if (!state.players.some((p) => p.id === playerId)) return state;
  if (playerId in state.answers) return state; // locked after first answer
  if (optionIndex < 0 || optionIndex >= state.currentPrompt.options.length) return state;
  const answers = { ...state.answers, [playerId]: optionIndex };
  const correctOrder =
    optionIndex === state.currentPrompt.answerIndex
      ? [...state.correctOrder, playerId]
      : state.correctOrder;
  return { ...state, answers, correctOrder };
}

export function resolveRound(state: PidginState): PidginState {
  if (state.phase !== 'answer' || !state.currentPrompt) return state;
  const deltas: Record<string, number> = {};
  const firstCorrect = state.correctOrder[0];
  const players = state.players.map((p) => {
    const correct = state.answers[p.id] === state.currentPrompt!.answerIndex;
    let delta = 0;
    if (correct) {
      delta = state.settings.basePoints + (p.id === firstCorrect ? state.settings.firstBonus : 0);
    }
    deltas[p.id] = delta;
    return { ...p, score: p.score + delta };
  });
  const isLast = state.round >= state.settings.rounds;
  return { ...state, phase: isLast ? 'finished' : 'reveal', players, lastDeltas: deltas };
}

export function leaderboard(state: PidginState): PidginPlayerState[] {
  return [...state.players].sort((a, b) => b.score - a.score);
}
