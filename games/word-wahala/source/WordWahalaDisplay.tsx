import { motion, AnimatePresence } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import type { WordWahalaPublicState, WordWahalaBoardCell, WordWahalaBoardBonus } from '@/lib/transport/types';
import { AIStatusChip } from '@/components/game/AIStatusChip';
import { WahalaTile } from '@/components/game/WahalaTile';
import type { TileLetter } from '../../../shared/src/games/wordwahala/tiles';
import type { AIStatus } from '@/lib/realtimeRoom';

interface WordWahalaDisplayProps {
  state: WordWahalaPublicState;
  roomCode: string;
  joinUrl: string;
  commentaryLine?: string | null;
  aiStatus?: AIStatus;
}

const SEAT_TOKEN_BG: Record<string, string> = {
  emerald: 'bg-gradient-to-br from-emerald-300 to-emerald-600',
  amber: 'bg-gradient-to-br from-amber-300 to-amber-600',
  rose: 'bg-gradient-to-br from-rose-300 to-rose-600',
  sky: 'bg-gradient-to-br from-sky-300 to-sky-600',
};

function tokenStyle(color?: string) {
  return SEAT_TOKEN_BG[color ?? 'emerald'] ?? SEAT_TOKEN_BG.emerald;
}

const BONUS_BG: Record<WordWahalaBoardBonus, string> = {
  none: 'bg-background/40',
  dl: 'bg-sky-500/25',
  tl: 'bg-blue-600/35',
  dw: 'bg-rose-500/25',
  tw: 'bg-rose-700/40',
  star: 'bg-rose-500/30',
};

const BONUS_LABEL: Record<WordWahalaBoardBonus, string> = {
  none: '',
  dl: 'Chin chin',
  tl: 'Suya',
  dw: 'Jollof',
  tw: 'Owambe',
  star: '★',
};

function tileGlyph(cell: WordWahalaBoardCell): string {
  if (!cell) return '';
  if (cell.wildAs) return cell.wildAs.toUpperCase();
  // digraph stays merged
  return cell.letter.toUpperCase();
}

export function WordWahalaDisplay({
  state,
  roomCode,
  joinUrl,
  commentaryLine,
  aiStatus = 'active',
}: WordWahalaDisplayProps) {
  const winner = state.winnerId
    ? state.players.find((p) => p.id === state.winnerId)
    : null;
  const banner = state.lastBanner;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-7xl space-y-6"
      >
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Now playing</p>
            <h1 className="text-4xl md:text-5xl font-display font-bold neon-text">Word Wahala</h1>
            <AIStatusChip status={aiStatus} className="mt-3" />
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Room</p>
            <p className="text-3xl font-display font-bold tracking-[0.2em]">{roomCode}</p>
          </div>
        </div>

        {commentaryLine && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass rounded-2xl px-5 py-3 text-sm text-foreground/90"
          >
            {commentaryLine}
          </motion.div>
        )}

        <div className="grid gap-6 lg:grid-cols-[1fr_auto]">
          {/* 15×15 board */}
          <div className="glass rounded-3xl border border-border/40 p-3 md:p-5 bg-gradient-to-br from-emerald-900/25 via-amber-900/15 to-rose-900/25">
            <div
              className="grid gap-[2px]"
              style={{
                gridTemplateColumns: 'repeat(15, minmax(0, 1fr))',
                aspectRatio: '1 / 1',
              }}
            >
              {state.board.flatMap((row, r) =>
                row.map((cell, c) => {
                  const bonus = state.bonusMap[r][c];
                  const isFilled = cell !== null;
                  return (
                    <div
                      key={`${r}-${c}`}
                      className={`relative rounded-sm flex items-center justify-center
                        ${isFilled ? '' : BONUS_BG[bonus]}
                        text-[10px] md:text-sm font-display font-bold
                      `}
                      title={isFilled ? tileGlyph(cell) : BONUS_LABEL[bonus]}
                    >
                      {isFilled ? (
                        <WahalaTile
                          letter={cell.letter as TileLetter}
                          wildAs={cell.wildAs}
                          size={28}
                          variant="placed"
                        />
                      ) : bonus !== 'none' ? (
                        <span className="text-[8px] md:text-[10px] opacity-80 text-center leading-tight px-0.5">
                          {bonus === 'star' ? '★' : BONUS_LABEL[bonus]}
                        </span>
                      ) : null}
                    </div>
                  );
                }),
              )}
            </div>
            <p className="mt-3 text-center text-xs text-foreground/70">{state.lastAction}</p>
          </div>

          {/* Side panel */}
          <aside className="space-y-4 lg:w-72">
            <div className="glass rounded-2xl border border-border/40 p-4">
              <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">Bag</p>
              <p className="mt-1 font-display text-2xl font-bold">{state.bagSize} tiles</p>
              <p className="text-[11px] text-muted-foreground">Turn {state.turnNumber}</p>
            </div>

            <div className="glass rounded-2xl border border-border/40 p-4 space-y-2">
              <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">Scoreboard</p>
              {state.players
                .slice()
                .sort((a, b) => b.score - a.score)
                .map((p) => {
                  const isTurn = state.players[state.currentPlayerIndex]?.id === p.id && state.phase !== 'finished';
                  return (
                    <div
                      key={p.id}
                      className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${
                        isTurn ? 'border-primary/60 bg-primary/10' : 'border-border/30 bg-background/30'
                      }`}
                    >
                      <div className={`h-6 w-6 rounded-full ${tokenStyle(p.color)}`} />
                      <div className="flex-1 min-w-0">
                        <p className="font-display text-sm font-bold truncate">{p.displayName}</p>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {p.rackSize} tiles
                        </p>
                      </div>
                      <p className="font-display text-lg font-bold">{p.score}</p>
                    </div>
                  );
                })}
            </div>

            <div className="glass rounded-2xl border border-border/40 p-4 flex items-center gap-3">
              <div className="rounded-lg bg-white p-2">
                <QRCodeSVG value={joinUrl} size={88} />
              </div>
              <div className="text-xs">
                <p className="uppercase tracking-[0.25em] text-muted-foreground">Join</p>
                <p className="font-display font-bold mt-1">Scan to play</p>
                <p className="text-muted-foreground mt-0.5">Code {roomCode}</p>
              </div>
            </div>
          </aside>
        </div>

        <AnimatePresence>
          {banner && (
            <motion.div
              key={`${banner.headline}-${state.turnNumber}`}
              initial={{ opacity: 0, y: 8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6 }}
              className={`glass rounded-2xl border px-5 py-3 text-center
                ${banner.kind === 'play' ? 'border-emerald-400/60 bg-emerald-400/10' : ''}
                ${banner.kind === 'pass' ? 'border-amber-400/60 bg-amber-400/10' : ''}
                ${banner.kind === 'reject' ? 'border-rose-400/60 bg-rose-400/10' : ''}
                ${banner.kind === 'win' ? 'border-yellow-300/60 bg-yellow-300/10' : ''}
                ${!['play','pass','reject','win'].includes(banner.kind) ? 'border-border/40' : ''}
              `}
            >
              <p className="font-display text-lg md:text-xl font-bold">{banner.headline}</p>
              <p className="text-xs md:text-sm text-foreground/80 mt-0.5">{banner.detail}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {state.phase === 'finished' && winner && (
          <div className="glass rounded-2xl border border-yellow-300/60 bg-yellow-300/10 p-4 text-center">
            <p className="font-display text-2xl font-bold">{winner.displayName} wins with {winner.score}!</p>
          </div>
        )}
      </motion.div>
    </div>
  );
}
