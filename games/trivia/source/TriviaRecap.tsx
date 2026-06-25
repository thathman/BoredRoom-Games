// TriviaRecap — end-of-match podium and per-player breakdown.
// Rendered when a trivia match reaches `phase === 'finished'`.
// Mirrors the WWTBAM-vibe of TriviaDisplay but with podium + stats focus.

import { motion } from 'framer-motion';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { Home, RotateCcw, Sparkles, Trophy } from 'lucide-react';
import type { RecapPayload } from '@/lib/ai';
import type { TriviaPublicState } from '@/lib/transport/types';

interface TriviaRecapProps {
  state: TriviaPublicState;
  isHost: boolean;
  onPlayAgain?: () => void;
  recap?: RecapPayload | null;
}

export function TriviaRecap({ state, isHost, onPlayAgain, recap }: TriviaRecapProps) {
  const navigate = useNavigate();
  const sorted = useMemo(
    () => [...state.players].sort((a, b) => b.score - a.score || b.correctCount - a.correctCount),
    [state.players],
  );
  const champion = sorted[0];
  const totalQuestions = state.settings.rounds * state.settings.questionsPerRound;

  // Podium order: 2nd, 1st, 3rd
  const podium = [sorted[1], sorted[0], sorted[2]].filter(Boolean);
  const podiumHeights = ['h-28', 'h-40', 'h-20'];
  const podiumGlow = ['border-muted', 'border-primary neon-border', 'border-secondary/60'];

  return (
    <div className="min-h-screen px-6 py-10 flex flex-col items-center bg-[radial-gradient(ellipse_at_top,_hsl(220_60%_18%/0.6),transparent_60%),radial-gradient(ellipse_at_bottom,_hsl(280_60%_14%/0.6),transparent_60%)]">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-8"
      >
        <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Match complete</p>
        <h1 className="text-4xl md:text-6xl font-display font-bold neon-text mt-1 flex items-center gap-3 justify-center">
          <Trophy className="w-10 h-10 text-primary" />
          {champion?.displayName ?? 'Champion'}
        </h1>
        <p className="text-base text-muted-foreground mt-2">
          {champion?.score ?? 0} pts · {champion?.correctCount ?? 0} of {totalQuestions} correct
        </p>
      </motion.div>

      {/* Podium */}
      {sorted.length > 0 && (
        <div className="flex items-end gap-4 md:gap-8 mb-10">
          {podium.map((p, i) => {
            if (!p) return null;
            const place = sorted.indexOf(p) + 1;
            return (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + i * 0.15 }}
                className="flex flex-col items-center"
              >
                <div className="text-center mb-2">
                  <div className="font-display font-bold text-lg">{p.displayName}</div>
                  <div className="font-display text-2xl neon-text tabular-nums">{p.score}</div>
                </div>
                <div
                  className={`glass rounded-t-xl border-t-2 ${podiumGlow[i]} ${podiumHeights[i]} w-24 md:w-32 flex items-start justify-center pt-2`}
                >
                  <span className="font-display font-bold text-3xl text-muted-foreground">
                    {place === 1 ? '🥇' : place === 2 ? '🥈' : '🥉'}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* AI recap (if present) */}
      {recap && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="glass rounded-2xl p-5 max-w-2xl w-full mb-8 border border-primary/30"
        >
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-primary mb-2">
            <Sparkles className="w-3.5 h-3.5" /> AI Recap
          </div>
          <h3 className="font-display font-bold text-xl mb-1">{recap.headline}</h3>
          <p className="text-sm text-muted-foreground">{recap.paragraph}</p>
          {recap.mvp && (
            <p className="text-xs text-accent mt-2 font-display uppercase tracking-wider">MVP: {recap.mvp}</p>
          )}
        </motion.div>
      )}

      {/* Full leaderboard */}
      <div className="w-full max-w-xl space-y-2 mb-8">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2 text-center">
          Final standings
        </div>
        {sorted.map((p, i) => {
          const accuracy = totalQuestions > 0 ? Math.round((p.correctCount / totalQuestions) * 100) : 0;
          return (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4 + i * 0.05 }}
              className={`flex items-center justify-between glass rounded-xl px-4 py-3 ${
                i === 0 ? 'border-primary/50 neon-border' : ''
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="font-display font-bold text-lg w-6 text-muted-foreground tabular-nums">
                  {i + 1}
                </span>
                <span className="font-display font-bold text-lg truncate">{p.displayName}</span>
              </div>
              <div className="flex items-center gap-4 text-sm">
                <span className="text-muted-foreground tabular-nums">{p.correctCount} ✓</span>
                <span className="text-muted-foreground tabular-nums hidden sm:inline">{accuracy}%</span>
                <span className="font-display font-bold text-xl tabular-nums neon-text">{p.score}</span>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Actions */}
      <div className="flex gap-3 flex-wrap justify-center">
        {isHost && onPlayAgain && (
          <Button onClick={onPlayAgain} size="lg" className="gap-2">
            <RotateCcw className="w-4 h-4" />
            Play Again
          </Button>
        )}
        <Button variant="outline" size="lg" onClick={() => navigate('/')} className="gap-2">
          <Home className="w-4 h-4" />
          Home
        </Button>
      </div>
    </div>
  );
}
