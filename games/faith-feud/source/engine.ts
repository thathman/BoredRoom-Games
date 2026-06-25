// Pure Faith Feud engine (Phase 8). Family-feud style: a survey question has ranked answers each
// worth their poll count; teams guess answers to reveal them and bank points; wrong guesses cost a
// strike. No I/O, no timers — the server runs the loop and calls these helpers. Deterministic.

export type FaithFeudPhase = 'lobby' | 'guessing' | 'reveal' | 'finished';

export interface FeudAnswer {
  /** Canonical answer text. */
  text: string;
  /** Poll points this answer is worth. */
  points: number;
  /** Accepted normalized aliases for matching. */
  aliases?: string[];
}

export interface FeudQuestion {
  id: string;
  prompt: string;
  answers: FeudAnswer[]; // ranked high-to-low by points
}

export interface FaithFeudSettings {
  rounds: number;
  maxStrikes: number;
}

export const DEFAULT_FAITHFEUD_SETTINGS: FaithFeudSettings = {
  rounds: 5,
  maxStrikes: 3,
};

export interface FaithFeudTeam {
  id: string;
  name: string;
  score: number;
}

export interface FaithFeudState {
  phase: FaithFeudPhase;
  round: number;
  settings: FaithFeudSettings;
  teams: FaithFeudTeam[];
  currentQuestion: FeudQuestion | null;
  // indexes of revealed answers in the current question
  revealed: number[];
  strikes: number;
  // points banked this round (awarded on round end)
  roundPot: number;
}

export function createInitialFaithFeudState(
  teams: { id: string; name: string }[],
  settings: FaithFeudSettings = DEFAULT_FAITHFEUD_SETTINGS,
): FaithFeudState {
  return {
    phase: 'lobby',
    round: 0,
    settings,
    teams: teams.map((t) => ({ id: t.id, name: t.name, score: 0 })),
    currentQuestion: null,
    revealed: [],
    strikes: 0,
    roundPot: 0,
  };
}

export function startRound(state: FaithFeudState, question: FeudQuestion): FaithFeudState {
  if (state.phase === 'finished') return state;
  return {
    ...state,
    phase: 'guessing',
    round: state.round + 1,
    currentQuestion: question,
    revealed: [],
    strikes: 0,
    roundPot: 0,
  };
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Match a guess to an unrevealed answer index, or -1 if no match.
export function matchAnswer(question: FeudQuestion, guess: string, revealed: number[]): number {
  const g = normalize(guess);
  for (let i = 0; i < question.answers.length; i += 1) {
    if (revealed.includes(i)) continue;
    const a = question.answers[i];
    const candidates = [a.text, ...(a.aliases ?? [])].map(normalize);
    if (candidates.includes(g)) return i;
  }
  return -1;
}

// Submit a guess: reveal + bank points on a match, else add a strike. Round ends when all answers
// are revealed or strikes hit the cap.
export function submitGuess(state: FaithFeudState, guess: string): FaithFeudState {
  if (state.phase !== 'guessing' || !state.currentQuestion) return state;
  const idx = matchAnswer(state.currentQuestion, guess, state.revealed);
  let next: FaithFeudState;
  if (idx >= 0) {
    next = {
      ...state,
      revealed: [...state.revealed, idx],
      roundPot: state.roundPot + state.currentQuestion.answers[idx].points,
    };
  } else {
    next = { ...state, strikes: state.strikes + 1 };
  }
  const allRevealed = next.revealed.length >= next.currentQuestion!.answers.length;
  const outOfStrikes = next.strikes >= next.settings.maxStrikes;
  if (allRevealed || outOfStrikes) return next; // caller calls endRound to bank + advance
  return next;
}

export function roundOver(state: FaithFeudState): boolean {
  if (!state.currentQuestion) return false;
  return (
    state.revealed.length >= state.currentQuestion.answers.length ||
    state.strikes >= state.settings.maxStrikes
  );
}

// Bank the pot to the awarded team and advance (or finish).
export function endRound(state: FaithFeudState, teamId: string): FaithFeudState {
  if (state.phase !== 'guessing') return state;
  const teams = state.teams.map((t) => (t.id === teamId ? { ...t, score: t.score + state.roundPot } : t));
  const isLast = state.round >= state.settings.rounds;
  return { ...state, phase: isLast ? 'finished' : 'reveal', teams };
}

export function leaderboard(state: FaithFeudState): FaithFeudTeam[] {
  return [...state.teams].sort((a, b) => b.score - a.score);
}
