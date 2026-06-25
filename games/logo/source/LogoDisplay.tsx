// LogoDisplay — host big-screen view for Logo Guesser.
// Phase loop:
//   intro      → round banner
//   question   → silhouette (heavy blur + grayscale + black tint)
//   options    → progressive un-blur as the answer window ticks down +
//                MC options (if MC mode) or "type your guess" prompt (free-text)
//   reveal     → fully crisp logo + canonical name + per-player results strip
//   leaderboard / finished → standings

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { AIStatusChip } from '@/components/game/AIStatusChip';
import { logoUrl } from '@/lib/logoAsset';
import type { AIStatus, LogoPublicState } from '@/lib/transport/types';

interface LogoDisplayProps {
  state: LogoPublicState;
  roomCode: string;
  joinUrl: string;
  commentaryLine?: string | null;
  aiStatus?: AIStatus;
}

const OPTION_PREFIX = ['A', 'B', 'C', 'D'] as const;

export function LogoDisplay({ state, roomCode, joinUrl, commentaryLine, aiStatus = 'active' }: LogoDisplayProps) {
  const { phase, currentQuestion, players, round, settings, revealedAnswer } = state;

  const sortedPlayers = useMemo(
    () => [...players].sort((a, b) => b.score - a.score),
    [players],
  );
  const winner = state.winnerId ? players.find((p) => p.id === state.winnerId) : null;

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

      {/* Header */}
      <div className="w-full max-w-5xl text-center mb-6 mt-8">
        <div className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
          Round {round || '—'} of {settings.rounds}
          {' · '}
          <span className="text-primary">{settings.inputMode === 'multiple_choice' ? 'Multiple Choice' : 'Type the brand'}</span>
        </div>
        <h1 className="text-4xl md:text-6xl font-display font-bold neon-text mt-1">
          Logo <span className="text-secondary">Guesser</span>
        </h1>
      </div>

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
              <p className="text-6xl md:text-8xl font-display font-bold neon-text">{settings.rounds} rounds</p>
              <p className="text-lg text-muted-foreground">
                Fastest correct guess scores the most. Streaks multiply your points.
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
                <span>Round {state.round} / {settings.rounds}</span>
                <PhaseTimer phase={phase} phaseEndsAt={state.phaseEndsAt} />
                <span>
                  Locked in: <span className="text-primary font-display font-bold">{state.lockedInCount}</span>/{players.length}
                </span>
              </div>

              <LogoArtwork
                domain={currentQuestion.domain}
                phase={phase}
                phaseEndsAt={state.phaseEndsAt}
                answerWindowMs={settings.answerWindowMs}
                questionRevealMs={settings.questionRevealMs}
              />

              {/* MC options */}
              {settings.inputMode === 'multiple_choice' && currentQuestion.options && (phase === 'options' || phase === 'reveal') && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                  {currentQuestion.options.map((opt, idx) => {
                    const isCorrect = phase === 'reveal' && revealedAnswer && opt === revealedAnswer.name;
                    const isWrong = phase === 'reveal' && revealedAnswer && opt !== revealedAnswer.name;
                    return (
                      <motion.div
                        key={`${currentQuestion.id}-${idx}`}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.06 }}
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

              {/* Free-text prompt */}
              {settings.inputMode === 'free_text' && (phase === 'options' || phase === 'question') && (
                <div className="text-center text-muted-foreground text-lg">
                  Type the brand name on your phone — fuzzy matches still score.
                </div>
              )}

              {phase === 'reveal' && revealedAnswer && (
                <motion.div
                  key="answer"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-center space-y-2"
                >
                  <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Answer</p>
                  <p className="text-4xl md:text-6xl font-display font-bold neon-text">{revealedAnswer.name}</p>
                </motion.div>
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
                After Round {round}
              </h2>
              <LogoLeaderboard players={sortedPlayers} />
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
              <p className="text-6xl md:text-8xl font-display font-bold neon-text">{winner?.displayName ?? '—'}</p>
              <p className="text-lg text-muted-foreground">
                {winner?.score ?? 0} pts · {winner?.correctCount ?? 0} correct
              </p>
              <LogoLeaderboard players={sortedPlayers} />
            </motion.div>
          )}

          {phase === 'lobby' && (
            <motion.div key="lobby" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center space-y-4">
              <p className="text-2xl font-display text-muted-foreground">Waiting for the host to start…</p>
              <LogoLeaderboard players={sortedPlayers} />
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

// ── Logo artwork with progressive un-blur ───────────────────────────────────

function LogoArtwork({
  domain,
  phase,
  phaseEndsAt,
  answerWindowMs,
  questionRevealMs,
}: {
  domain: string;
  phase: LogoPublicState['phase'];
  phaseEndsAt: number | null;
  answerWindowMs: number;
  questionRevealMs: number;
}) {
  const [failed, setFailed] = useState(false);
  // Progress 0..1 inside the options window — drives the blur fade-out.
  const [, force] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => force((t) => t + 1), 200);
    return () => window.clearInterval(id);
  }, []);

  const { blurPx, grayscale, brightness } = useMemo(() => {
    if (phase === 'reveal') return { blurPx: 0, grayscale: 0, brightness: 1 };
    if (phase === 'question') return { blurPx: 24, grayscale: 1, brightness: 0.0001 }; // pure silhouette
    if (phase === 'options' && phaseEndsAt) {
      const remaining = Math.max(0, phaseEndsAt - Date.now());
      const ratio = 1 - Math.min(1, remaining / answerWindowMs); // 0 at start, 1 at end
      // Un-blur from 24 → 0; restore color from grayscale 1 → 0; lift brightness from 0 → 1.
      return {
        blurPx: 24 * (1 - ratio),
        grayscale: 1 - ratio,
        brightness: Math.max(0.0001, ratio),
      };
    }
    return { blurPx: 16, grayscale: 1, brightness: 0.2 };
  }, [phase, phaseEndsAt, answerWindowMs]);
  void questionRevealMs;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="glass rounded-3xl p-8 md:p-12 flex items-center justify-center border border-primary/30 neon-box"
      style={{ minHeight: 280 }}
    >
      <div
        className="w-[220px] h-[220px] md:w-[300px] md:h-[300px] flex items-center justify-center"
        style={{
          filter: `blur(${blurPx}px) grayscale(${grayscale}) brightness(${brightness})`,
          transition: 'filter 200ms linear',
        }}
      >
        {failed ? (
          <div className="w-full h-full rounded-2xl border border-border/70 bg-card/70 flex items-center justify-center">
            <span className="text-2xl md:text-3xl font-display font-bold uppercase tracking-widest text-muted-foreground">
              {domain.split('.')[0]}
            </span>
          </div>
        ) : (
          <img
            src={logoUrl(domain, 512)}
            alt=""
            aria-hidden="true"
            className="max-w-full max-h-full object-contain"
            loading="eager"
            draggable={false}
            onError={() => setFailed(true)}
          />
        )}
      </div>
    </motion.div>
  );
}

// ── Phase timer ─────────────────────────────────────────────────────────────

function PhaseTimer({ phase, phaseEndsAt }: { phase: LogoPublicState['phase']; phaseEndsAt: number | null }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => force((t) => t + 1), 250);
    return () => window.clearInterval(id);
  }, []);
  if (!phaseEndsAt || phase !== 'options') return <span>&nbsp;</span>;
  const ms = Math.max(0, phaseEndsAt - Date.now());
  const sec = Math.ceil(ms / 1000);
  const danger = sec <= 5;
  return (
    <span className={`font-display font-bold tabular-nums ${danger ? 'text-destructive' : 'text-primary'}`}>
      {sec}s
    </span>
  );
}

// ── Leaderboard ─────────────────────────────────────────────────────────────

function LogoLeaderboard({ players }: { players: LogoPublicState['players'] }) {
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
            <span className="font-display font-bold text-lg w-6 text-muted-foreground">{i + 1}</span>
            <span className="font-display font-bold text-lg">{p.displayName}</span>
            {p.streak >= 3 && (
              <span className="text-xs uppercase tracking-wider text-accent">🔥 {p.streak} streak</span>
            )}
          </div>
          <div className="font-display font-bold text-xl tabular-nums neon-text">{p.score}</div>
        </div>
      ))}
    </div>
  );
}

