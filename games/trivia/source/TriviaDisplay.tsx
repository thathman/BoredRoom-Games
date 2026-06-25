// TriviaDisplay — the big-screen WWTBAM-style host view.
// Shows the question, lifeline-free 4 options, locked-in counter, leaderboard,
// and orchestrates the suspense audio bed in tandem with phase transitions.

import { useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { AIStatusChip } from '@/components/game/AIStatusChip';
import { triviaAudio } from '@/lib/triviaAudio';
import type { AIStatus, TriviaPublicState } from '@/lib/transport/types';

interface TriviaDisplayProps {
  state: TriviaPublicState;
  roomCode: string;
  joinUrl: string;
  commentaryLine?: string | null;
  aiStatus?: AIStatus;
}

const CATEGORY_LABEL: Record<string, string> = {
  history: 'History',
  geography: 'Geography',
  culture: 'Culture',
  music: 'Music',
  nollywood: 'Nollywood',
  sports: 'Sports',
  food: 'Food',
  language: 'Language',
  literature: 'Literature',
  general: 'General',
};

const OPTION_PREFIX = ['A', 'B', 'C', 'D'] as const;

export function TriviaDisplay({
  state,
  roomCode,
  joinUrl,
  commentaryLine,
  aiStatus = 'active',
}: TriviaDisplayProps) {
  const { phase, currentQuestion, players, round, settings } = state;

  // ── Audio orchestration tied to phase ────────────────────────────────
  const lastPhaseRef = useRef<string>('');
  useEffect(() => {
    triviaAudio.unlock();
    if (phase === lastPhaseRef.current) return;
    const prev = lastPhaseRef.current;
    lastPhaseRef.current = phase;

    if (phase === 'intro') {
      triviaAudio.roundIntro();
      triviaAudio.startBed('low');
    } else if (phase === 'question') {
      triviaAudio.startBed('mid');
    } else if (phase === 'options') {
      triviaAudio.startBed('high');
    } else if (phase === 'reveal') {
      triviaAudio.finalAnswer();
      // Fade bed out during reveal so stinger lands.
      triviaAudio.stopBed();
      // Play correct/wrong stinger after a beat based on majority outcome.
      const anyCorrect = state.lastQuestionResults.some((r) => r.correct);
      window.setTimeout(() => {
        if (anyCorrect) triviaAudio.correct();
        else triviaAudio.wrong();
      }, 700);
    } else if (phase === 'leaderboard' || phase === 'finished' || phase === 'lobby') {
      if (prev !== 'reveal') triviaAudio.stopBed();
    }
  }, [phase, state.lastQuestionResults]);

  // Hard cleanup on unmount (e.g. leaving the trivia route).
  useEffect(() => {
    return () => {
      triviaAudio.destroyBed();
    };
  }, []);

  const sortedPlayers = useMemo(
    () => [...players].sort((a, b) => b.score - a.score),
    [players],
  );
  const winner = state.winnerId ? players.find((p) => p.id === state.winnerId) : null;
  const totalQuestions = settings.questionsPerRound;

  return (
    <div className="min-h-screen flex flex-col items-center px-6 py-8 bg-[radial-gradient(ellipse_at_top,_hsl(220_60%_18%/0.6),transparent_60%),radial-gradient(ellipse_at_bottom,_hsl(280_60%_14%/0.6),transparent_60%)]">
      {/* Persistent join + room badge */}
      <div className="fixed top-4 right-4 z-30 glass rounded-2xl p-3 flex items-center gap-3 shadow-lg">
        <div className="bg-background/80 rounded-lg p-1.5">
          <QRCodeSVG value={joinUrl} size={64} bgColor="transparent" fgColor="hsl(160, 100%, 50%)" level="M" />
        </div>
        <div className="text-left pr-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground leading-none">Join code</div>
          <div className="font-display font-bold text-2xl tracking-widest neon-text leading-tight">{roomCode}</div>
        </div>
      </div>
      <div className="fixed top-4 left-4 z-30">
        <AIStatusChip status={aiStatus} />
      </div>

      {/* Header / round banner */}
      <div className="w-full max-w-5xl text-center mb-6 mt-8">
        <div className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
          Round {round || '—'} of {settings.rounds}
          {state.activeCategory && (
            <> · <span className="text-primary">{CATEGORY_LABEL[state.activeCategory] ?? state.activeCategory}</span></>
          )}
        </div>
        <h1 className="text-4xl md:text-6xl font-display font-bold neon-text mt-1">
          Who Sabi <span className="text-secondary">Pass?</span>
        </h1>
      </div>

      {/* Phase content */}
      <div className="w-full max-w-5xl flex-1 flex flex-col items-center justify-center">
        <AnimatePresence mode="wait">
          {phase === 'intro' && (
            <motion.div
              key="intro"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="text-center space-y-4"
            >
              <p className="text-2xl font-display text-muted-foreground">Get ready…</p>
              <p className="text-6xl md:text-8xl font-display font-bold neon-text">
                {state.activeCategory ? CATEGORY_LABEL[state.activeCategory] ?? state.activeCategory : ''}
              </p>
              <p className="text-lg text-muted-foreground">
                {totalQuestions} questions · fastest finger wins big
              </p>
            </motion.div>
          )}

          {(phase === 'question' || phase === 'options' || phase === 'reveal') && currentQuestion && (
            <motion.div
              key={`q-${currentQuestion.id}`}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="w-full space-y-6"
            >
              <div className="flex items-center justify-between text-xs uppercase tracking-wider text-muted-foreground">
                <span>
                  Q{state.questionIndex} / {totalQuestions}
                </span>
                <PhaseTimer phase={phase} phaseEndsAt={state.phaseEndsAt} />
                <span>
                  Locked in: <span className="text-primary font-display font-bold">{state.lockedInCount}</span>/{players.length}
                </span>
              </div>

              <motion.div
                key={`text-${currentQuestion.id}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="glass rounded-3xl p-8 md:p-12 text-center border border-primary/30 neon-box"
              >
                <p className="text-2xl md:text-4xl font-display font-bold leading-tight">
                  {currentQuestion.question}
                </p>
              </motion.div>

              {(phase === 'options' || phase === 'reveal') && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                  {currentQuestion.options.map((opt, idx) => {
                    const isCorrect =
                      phase === 'reveal' && state.revealedCorrectIndex === idx;
                    const isWrong = phase === 'reveal' && state.revealedCorrectIndex !== idx;
                    return (
                      <motion.div
                        key={`${currentQuestion.id}-${idx}`}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.08 }}
                        className={`rounded-2xl px-5 py-5 md:py-6 text-lg md:text-2xl font-display font-bold flex items-center gap-4 border transition-colors ${
                          isCorrect
                            ? 'bg-primary text-primary-foreground border-primary neon-box'
                            : isWrong
                              ? 'bg-card/40 text-muted-foreground border-border/40'
                              : 'bg-card/70 text-foreground border-border'
                        }`}
                      >
                        <span
                          className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-base ${
                            isCorrect ? 'bg-primary-foreground text-primary' : 'bg-muted text-foreground'
                          }`}
                        >
                          {OPTION_PREFIX[idx]}
                        </span>
                        <span className="flex-1 text-left">{opt}</span>
                      </motion.div>
                    );
                  })}
                </div>
              )}

              {phase === 'options' && state.crowdConsensus && state.crowdConsensus.total > 0 && (
                <CrowdConsensusBar
                  questionOptions={currentQuestion.options}
                  consensus={state.crowdConsensus}
                />
              )}
            </motion.div>
          )}

          {phase === 'leaderboard' && (
            <motion.div
              key="lb"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full space-y-4"
            >
              <h2 className="text-3xl md:text-4xl font-display font-bold text-center neon-text">
                End of Round {round}
              </h2>
              <Leaderboard players={sortedPlayers} />
            </motion.div>
          )}

          {phase === 'finished' && (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="w-full space-y-6 text-center"
            >
              <p className="text-xl uppercase tracking-[0.3em] text-muted-foreground">Champion</p>
              <p className="text-6xl md:text-8xl font-display font-bold neon-text">
                {winner?.displayName ?? '—'}
              </p>
              <p className="text-lg text-muted-foreground">
                {winner?.score ?? 0} pts · {winner?.correctCount ?? 0} correct answers
              </p>
              <Leaderboard players={sortedPlayers} />
            </motion.div>
          )}

          {phase === 'lobby' && (
            <motion.div
              key="lobby"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center space-y-4"
            >
              <p className="text-2xl font-display text-muted-foreground">
                Waiting for the host to start…
              </p>
              <Leaderboard players={sortedPlayers} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {commentaryLine && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 glass rounded-full px-5 py-2 text-sm font-display border border-primary/30"
        >
          {commentaryLine}
        </motion.div>
      )}
    </div>
  );
}

function PhaseTimer({
  phase,
  phaseEndsAt,
}: {
  phase: TriviaPublicState['phase'];
  phaseEndsAt: number | null;
}) {
  const targetRef = useRef<number | null>(phaseEndsAt);
  const [, force] = useTickEverySecond();
  useEffect(() => {
    targetRef.current = phaseEndsAt;
  }, [phaseEndsAt]);
  if (!phaseEndsAt || phase !== 'options') return <span>&nbsp;</span>;
  const ms = Math.max(0, phaseEndsAt - Date.now());
  const sec = Math.ceil(ms / 1000);
  const danger = sec <= 5;
  return (
    <span
      className={`font-display font-bold tabular-nums ${danger ? 'text-destructive' : 'text-primary'}`}
      data-tick={force}
    >
      {sec}s
    </span>
  );
}

function useTickEverySecond() {
  const [tick, setTick] = useStateLite(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 250);
    return () => window.clearInterval(id);
  }, [setTick]);
  return [tick, setTick] as const;
}

// Tiny local useState clone to avoid extra import noise.
import { useState as useStateLite } from 'react';

function Leaderboard({ players }: { players: TriviaPublicState['players'] }) {
  return (
    <div className="space-y-2 max-w-xl mx-auto">
      {players.map((p, i) => (
        <div
          key={p.id}
          className={`flex items-center justify-between glass rounded-xl px-4 py-3 ${
            i === 0 ? 'border-primary/50 neon-border' : ''
          }`}
        >
          <div className="flex items-center gap-3">
            <span className="font-display font-bold text-lg w-6 text-muted-foreground">
              {i + 1}
            </span>
            <span className="font-display font-bold text-lg">{p.displayName}</span>
            {p.streak >= 3 && (
              <span className="text-xs uppercase tracking-wider text-accent">
                🔥 {p.streak} streak
              </span>
            )}
          </div>
          <div className="font-display font-bold text-xl tabular-nums neon-text">{p.score}</div>
        </div>
      ))}
    </div>
  );
}

// CrowdConsensusBar — visualises audience-mode votes for the current question.
// Crowd votes never affect player scoring — purely social signal.
function CrowdConsensusBar({
  questionOptions,
  consensus,
}: {
  questionOptions: readonly string[];
  consensus: NonNullable<TriviaPublicState['crowdConsensus']>;
}) {
  const { tally, total } = consensus;
  return (
    <div className="glass rounded-2xl p-4 border border-secondary/30">
      <div className="text-xs uppercase tracking-[0.3em] text-muted-foreground mb-2 flex items-center justify-between">
        <span>👀 The Crowd thinks…</span>
        <span>{total} {total === 1 ? 'vote' : 'votes'}</span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {questionOptions.map((_, idx) => {
          const count = tally[String(idx)] ?? 0;
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          return (
            <div key={idx} className="space-y-1">
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-secondary transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span className="font-display font-bold">{OPTION_PREFIX[idx]}</span>
                <span>{pct}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
