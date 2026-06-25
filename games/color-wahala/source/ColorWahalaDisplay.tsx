// ColorWahalaDisplay — host big-screen view for the Stroop-effect speed game.
//
// Shows the Stroop word LARGE in the wrong ink color. In say_color rounds the
// host instruction is "tap the COLOR". In say_word rounds the instruction is
// "tap the WORD". Reveal phase shows the correct answer + per-player results.

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { AIStatusChip } from '@/components/game/AIStatusChip';
import {
  COLOR_PALETTE,
  type AIStatus,
  type ColorId,
  type ColorWahalaPublicState,
} from '@/lib/transport/types';

interface Props {
  state: ColorWahalaPublicState;
  roomCode: string;
  joinUrl: string;
  commentaryLine?: string | null;
  aiStatus?: AIStatus;
}

function colorEntry(id: ColorId) {
  return COLOR_PALETTE.find((c) => c.id === id)!;
}

const MODE_LABEL: Record<string, { instruction: string; chip: string }> = {
  say_word: { instruction: 'TAP THE WORD', chip: 'Read the text · ignore the ink' },
  say_color: { instruction: 'TAP THE INK COLOR', chip: 'Match the color · ignore the text' },
  say_heard: { instruction: 'TAP WHAT YOU HEARD', chip: 'Audio cue overrides everything' },
};

export function ColorWahalaDisplay({ state, roomCode, joinUrl, commentaryLine, aiStatus = 'active' }: Props) {
  const { phase, currentPrompt, players, round, settings, revealedAnswer, lastRoundResults } = state;

  const sortedPlayers = useMemo(
    () => [...players].sort((a, b) => b.score - a.score),
    [players],
  );
  const winner = state.winnerId ? players.find((p) => p.id === state.winnerId) : null;

  return (
    <div className="min-h-screen flex flex-col items-center px-6 py-8 bg-[radial-gradient(ellipse_at_top,_hsl(280_60%_18%/0.6),transparent_60%),radial-gradient(ellipse_at_bottom,_hsl(220_60%_14%/0.6),transparent_60%)]">
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
        </div>
        <h1 className="text-4xl md:text-6xl font-display font-bold neon-text mt-1">
          Color <span className="text-secondary">Wahala</span>
        </h1>
      </div>

      <div className="w-full max-w-5xl flex-1 flex flex-col items-center justify-center">
        <AnimatePresence mode="wait">
          {phase === 'lobby' && (
            <motion.div key="lobby" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center space-y-4">
              <p className="text-2xl font-display text-muted-foreground">Waiting for the host to start…</p>
              <Leaderboard players={sortedPlayers} />
            </motion.div>
          )}

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
              <p className="text-lg text-muted-foreground max-w-xl mx-auto">
                Read the WORD, ignore the ink. Or match the INK, ignore the word. Watch closely.
              </p>
            </motion.div>
          )}

          {(phase === 'prompt' || phase === 'answer' || phase === 'reveal') && currentPrompt && (
            <motion.div
              key={`p-${round}`}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="w-full space-y-6"
            >
              <div className="flex items-center justify-between text-xs uppercase tracking-wider text-muted-foreground">
                <span>Round {round} / {settings.rounds}</span>
                <PhaseTimer phase={phase} phaseEndsAt={state.phaseEndsAt} />
                <span>
                  Tapped: <span className="text-primary font-display font-bold">{lastRoundResults.length || (state.players.length - countNotTapped(state))}</span>/{players.length}
                </span>
              </div>

              {/* Mode chip */}
              <div className="flex items-center justify-center">
                <div className="glass rounded-full px-5 py-2 text-xs md:text-sm uppercase tracking-[0.25em] font-display border border-primary/30">
                  {MODE_LABEL[currentPrompt.mode]?.instruction ?? 'TAP'}
                  <span className="text-muted-foreground ml-3 normal-case tracking-normal">
                    {MODE_LABEL[currentPrompt.mode]?.chip}
                  </span>
                </div>
              </div>

              {/* The Stroop word */}
              <StroopWord
                word={colorEntry(currentPrompt.word).word}
                inkHsl={colorEntry(currentPrompt.ink).hsl}
                heardId={currentPrompt.mode === 'say_heard' ? currentPrompt.heard : null}
                phase={phase}
              />

              {phase === 'reveal' && revealedAnswer && (
                <motion.div
                  key="answer"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-center space-y-3"
                >
                  <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Answer</p>
                  <div
                    className="inline-flex items-center gap-3 rounded-2xl px-6 py-3 border-2"
                    style={{
                      background: `hsl(${colorEntry(revealedAnswer).hsl})`,
                      color: `hsl(${colorEntry(revealedAnswer).textHsl})`,
                      borderColor: `hsl(${colorEntry(revealedAnswer).hsl})`,
                    }}
                  >
                    <span className="text-3xl md:text-5xl font-display font-bold tracking-widest">
                      {colorEntry(revealedAnswer).word}
                    </span>
                  </div>
                  <ResultsStrip state={state} />
                </motion.div>
              )}
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
                {winner?.score ?? 0} pts · {winner?.correctCount ?? 0} correct · best streak {winner?.bestStreak ?? 0}
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

function countNotTapped(state: ColorWahalaPublicState): number {
  // We don't expose per-seat hasTapped on the public state — fallback to 0.
  // The "Tapped: x/y" label leans on lastRoundResults.length during reveal,
  // and is approximate during the answer phase.
  void state;
  return state.players.length;
}

// ── The Stroop word block ───────────────────────────────────────────────────

function StroopWord({
  word,
  inkHsl,
  heardId,
  phase,
}: {
  word: string;
  inkHsl: string;
  heardId: ColorId | null;
  phase: ColorWahalaPublicState['phase'];
}) {
  // Speak the heard color once when answer phase starts (say_heard mode).
  useEffect(() => {
    if (!heardId || phase !== 'answer') return;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(colorEntry(heardId).word);
      u.rate = 1.05;
      u.pitch = 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch {
      // ignore
    }
  }, [heardId, phase]);

  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className="glass rounded-3xl px-8 py-12 md:py-16 flex items-center justify-center border border-primary/30 neon-box"
      style={{ minHeight: 240 }}
    >
      <motion.span
        key={`${word}-${inkHsl}`}
        initial={{ scale: 1.1 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 220, damping: 18 }}
        className="font-display font-black tracking-tight select-none"
        style={{
          color: `hsl(${inkHsl})`,
          fontSize: 'clamp(72px, 16vw, 220px)',
          lineHeight: 1,
          textShadow: `0 0 40px hsl(${inkHsl} / 0.45)`,
        }}
      >
        {word}
      </motion.span>
    </motion.div>
  );
}

// ── Per-round results strip + leaderboard ───────────────────────────────────

function ResultsStrip({ state }: { state: ColorWahalaPublicState }) {
  const fastest = [...state.lastRoundResults]
    .filter((r) => r.correct)
    .sort((a, b) => (a.latencyMs ?? Infinity) - (b.latencyMs ?? Infinity))
    .slice(0, 3);

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
      {fastest.length === 0 && (
        <span className="text-sm text-muted-foreground">No one tapped correctly.</span>
      )}
      {fastest.map((r, i) => {
        const p = state.players.find((pl) => pl.id === r.playerId);
        if (!p) return null;
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';
        return (
          <div
            key={r.playerId}
            className="glass rounded-full px-4 py-1.5 text-sm font-display flex items-center gap-2"
          >
            <span>{medal}</span>
            <span className="font-bold">{p.displayName}</span>
            <span className="text-muted-foreground tabular-nums">+{r.pointsAwarded}</span>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {r.latencyMs != null ? `${(r.latencyMs / 1000).toFixed(2)}s` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Leaderboard({ players }: { players: ColorWahalaPublicState['players'] }) {
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
            {p.bestStreak >= 3 && (
              <span className="text-xs uppercase tracking-wider text-accent">🔥 best {p.bestStreak}</span>
            )}
          </div>
          <div className="font-display font-bold text-xl tabular-nums neon-text">{p.score}</div>
        </div>
      ))}
    </div>
  );
}

function PhaseTimer({ phase, phaseEndsAt }: { phase: ColorWahalaPublicState['phase']; phaseEndsAt: number | null }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => force((t) => t + 1), 100);
    return () => window.clearInterval(id);
  }, []);
  if (!phaseEndsAt || phase !== 'answer') return <span>&nbsp;</span>;
  const ms = Math.max(0, phaseEndsAt - Date.now());
  const sec = (ms / 1000).toFixed(1);
  const danger = ms <= 1500;
  return (
    <span className={`font-display font-bold tabular-nums ${danger ? 'text-destructive' : 'text-primary'}`}>
      {sec}s
    </span>
  );
}
