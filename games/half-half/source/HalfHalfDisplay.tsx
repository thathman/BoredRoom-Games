// HalfHalfDisplay — host big-screen view for Half & Half.
import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { AIStatusChip } from '@/components/game/AIStatusChip';
import { getShapeRender } from '@/lib/halfHalfShapes';
import type { AIStatus, HalfHalfPublicState } from '@/lib/transport/types';

interface Props {
  state: HalfHalfPublicState;
  roomCode: string;
  joinUrl: string;
  commentaryLine?: string | null;
  aiStatus?: AIStatus;
}

export function HalfHalfDisplay({ state, roomCode, joinUrl, aiStatus = 'active' }: Props) {
  const { phase, currentObject, players, round, settings, revealedTruth, lockedGuesses, lastRoundResults } = state;
  const sortedPlayers = useMemo(() => [...players].sort((a, b) => b.score - a.score), [players]);
  const winner = state.winnerId ? players.find((p) => p.id === state.winnerId) : null;
  const render = currentObject ? getShapeRender(currentObject.shape) : null;
  const isVertical = currentObject?.axis === 'vertical';
  const viewBox = isVertical ? '0 0 400 1000' : '0 0 1000 400';

  return (
    <div className="min-h-screen flex flex-col items-center px-6 py-8 bg-[radial-gradient(ellipse_at_top,_hsl(220_60%_18%/0.6),transparent_60%),radial-gradient(ellipse_at_bottom,_hsl(280_60%_14%/0.6),transparent_60%)]">
      <div className="fixed top-4 right-4 z-30 glass rounded-2xl p-3 flex items-center gap-3 shadow-lg">
        <div className="bg-background/80 rounded-lg p-1.5">
          <QRCodeSVG value={joinUrl} size={64} bgColor="transparent" fgColor="hsl(160, 100%, 50%)" level="M" />
        </div>
        <div className="text-left pr-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground leading-none">Join code</div>
          <div className="font-display font-bold text-2xl tracking-widest neon-text leading-tight">{roomCode}</div>
        </div>
      </div>
      <div className="fixed top-4 left-4 z-30"><AIStatusChip status={aiStatus} /></div>

      <div className="w-full max-w-5xl text-center mb-4 mt-8">
        <div className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
          Round {round || '—'} of {settings.rounds}
        </div>
        <h1 className="text-4xl md:text-6xl font-display font-bold neon-text mt-1">
          Half &amp; <span className="text-secondary">Half</span>
        </h1>
        {currentObject && phase !== 'finished' && (
          <p className="text-2xl md:text-3xl font-display mt-2">{currentObject.name}</p>
        )}
      </div>

      <div className="w-full max-w-4xl flex-1 flex flex-col items-center justify-center">
        <AnimatePresence mode="wait">
          {phase === 'lobby' && (
            <motion.div key="lobby" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center space-y-3">
              <p className="text-2xl">Find the perfect midpoint. Closest cut wins.</p>
              <p className="text-muted-foreground">Waiting for host to start…</p>
            </motion.div>
          )}

          {(phase === 'intro') && (
            <motion.div key="intro" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center space-y-3">
              <p className="text-3xl font-display">Get ready…</p>
            </motion.div>
          )}

          {(phase === 'reveal_object' || phase === 'lock_in' || phase === 'reveal_truth') && currentObject && render && (
            <motion.div
              key={`obj-${currentObject.id}-${phase}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full flex flex-col items-center gap-4"
            >
              <div className={`relative ${isVertical ? 'w-[260px] h-[640px]' : 'w-full max-w-3xl aspect-[2.5/1]'}`}>
                <svg viewBox={viewBox} preserveAspectRatio="xMidYMid meet" className="w-full h-full">
                  <path d={render.path} fill="hsl(var(--primary) / 0.85)" stroke="hsl(var(--primary))" strokeWidth={4} />
                  {/* Player guesses appear on reveal */}
                  {phase === 'reveal_truth' && lockedGuesses.map((g) => {
                    const player = players.find((p) => p.id === g.playerId);
                    return (
                      <line
                        key={g.playerId}
                        x1={isVertical ? 0 : g.position * 1000}
                        y1={isVertical ? g.position * 1000 : 0}
                        x2={isVertical ? 400 : g.position * 1000}
                        y2={isVertical ? g.position * 1000 : 400}
                        stroke={player?.color ? `hsl(var(--${player.color}, 200 80% 60%))` : 'hsl(var(--secondary))'}
                        strokeWidth={4}
                        strokeDasharray="8,6"
                        opacity={0.85}
                      />
                    );
                  })}
                  {/* Truth line (only on reveal_truth) */}
                  {phase === 'reveal_truth' && revealedTruth !== null && (
                    <line
                      x1={isVertical ? 0 : revealedTruth * 1000}
                      y1={isVertical ? revealedTruth * 1000 : 0}
                      x2={isVertical ? 400 : revealedTruth * 1000}
                      y2={isVertical ? revealedTruth * 1000 : 400}
                      stroke="hsl(var(--accent))"
                      strokeWidth={6}
                    />
                  )}
                </svg>
              </div>

              {phase === 'lock_in' && (
                <p className="text-lg text-muted-foreground">
                  Locked in: {state.lockedInCount} / {players.length}
                </p>
              )}
              {phase === 'reveal_truth' && (
                <div className="text-center space-y-1">
                  <p className="text-xl">
                    True midpoint: <span className="font-bold text-accent">{revealedTruth !== null ? `${(revealedTruth * 100).toFixed(0)}%` : '—'}</span>
                  </p>
                  {(() => {
                    const closest = lastRoundResults.find((r) => r.closest);
                    if (!closest) return <p className="text-muted-foreground">No clear winner this round.</p>;
                    const p = players.find((x) => x.id === closest.playerId);
                    return <p className="text-lg">🎯 {p?.displayName ?? '—'} nailed it (+{closest.pointsAwarded})</p>;
                  })()}
                </div>
              )}
            </motion.div>
          )}

          {phase === 'finished' && (
            <motion.div key="done" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center space-y-4">
              <p className="text-5xl font-display font-bold neon-text">Match complete!</p>
              {winner && <p className="text-2xl">🏆 {winner.displayName} — {winner.score} pts</p>}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Leaderboard */}
      <div className="w-full max-w-3xl mt-6 grid grid-cols-2 md:grid-cols-4 gap-2">
        {sortedPlayers.map((p, i) => (
          <div key={p.id} className="glass rounded-xl px-3 py-2 flex items-center gap-2">
            <span className="text-xs text-muted-foreground">#{i + 1}</span>
            <span className="flex-1 truncate text-sm">{p.displayName}</span>
            <span className="font-display font-bold text-primary">{p.score}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
