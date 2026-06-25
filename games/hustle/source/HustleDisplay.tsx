import { motion, AnimatePresence } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import type { HustlePublicState } from '@/lib/transport/types';
import {
  HUSTLE_BOARD_SIZE,
  HUSTLE_EVENT_HEADS,
  HUSTLE_MARKET_LOOKUP,
  HUSTLE_JAPA_EXITS,
} from '../../../shared/src/games/hustle/board';
import { JAPA_EXIT_REQUIREMENTS } from '../../../shared/src/games/hustle/engine';
import { AIStatusChip } from '@/components/game/AIStatusChip';
import {
  LadderMark, SnakeMark, MarketMark,
  FlagUkMark, FlagCaMark, FlagUsMark,
} from '@/components/game/HustleBoardMarkers';
import type { AIStatus } from '@/lib/realtimeRoom';

interface HustleDisplayProps {
  state: HustlePublicState;
  roomCode: string;
  joinUrl: string;
  commentaryLine?: string | null;
  aiStatus?: AIStatus;
}

const SEAT_TOKEN_BG: Record<string, string> = {
  emerald: 'bg-gradient-to-br from-emerald-300 to-emerald-600 ring-emerald-200',
  amber: 'bg-gradient-to-br from-amber-300 to-amber-600 ring-amber-200',
  rose: 'bg-gradient-to-br from-rose-300 to-rose-600 ring-rose-200',
  sky: 'bg-gradient-to-br from-sky-300 to-sky-600 ring-sky-200',
};

function tokenStyle(color?: string) {
  return SEAT_TOKEN_BG[color ?? 'emerald'] ?? SEAT_TOKEN_BG.emerald;
}

/**
 * Render the 60-square serpentine board. Square 1 is the bottom-left,
 * row 1 fills left→right, row 2 right→left, etc. (classic boustrophedon).
 */
function squareToCoords(square: number, cols = 10): { row: number; col: number } {
  const idx = square - 1; // 0-based
  const row = Math.floor(idx / cols); // 0 = bottom row
  const colInRow = idx % cols;
  const col = row % 2 === 0 ? colInRow : cols - 1 - colInRow;
  return { row, col };
}

export function HustleDisplay({
  state,
  roomCode,
  joinUrl,
  commentaryLine,
  aiStatus = 'active',
}: HustleDisplayProps) {
  const cols = 10;
  const rows = HUSTLE_BOARD_SIZE / cols; // 6
  const current = state.players[state.currentPlayerIndex];
  const winner = state.winnerId
    ? state.players.find((p) => p.id === state.winnerId)
    : null;
  const banner = state.lastBanner;

  // Group players by their square so we can stack tokens visually.
  const tokensBySquare = new Map<number, typeof state.players>();
  for (const p of state.players) {
    if (p.position < 1) continue;
    const arr = tokensBySquare.get(p.position) ?? [];
    arr.push(p);
    tokensBySquare.set(p.position, arr);
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-6xl space-y-6"
      >
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Now playing</p>
            <h1 className="text-4xl md:text-5xl font-display font-bold neon-text">Hustle</h1>
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
          {/* Board */}
          <div className="glass rounded-3xl border border-border/40 p-4 md:p-6 bg-gradient-to-br from-emerald-900/30 via-amber-900/20 to-rose-900/30">
            <div
              className="grid gap-1.5"
              style={{
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
                aspectRatio: `${cols} / ${rows}`,
              }}
            >
              {Array.from({ length: HUSTLE_BOARD_SIZE }, (_, i) => {
                const square = i + 1;
                const { row, col } = squareToCoords(square, cols);
                // CSS grid is top-down; flip rows so square 1 sits at bottom.
                const gridRow = rows - row;
                const gridCol = col + 1;
                const head = HUSTLE_EVENT_HEADS.find((e) => e.from === square);
                const isLadder = head?.kind === 'ladder';
                const isSnake = head?.kind === 'snake';
                const market = HUSTLE_MARKET_LOOKUP.get(square);
                const isMarket = !!market;
                const isUk = square === HUSTLE_JAPA_EXITS.uk;
                const isCa = square === HUSTLE_JAPA_EXITS.canada;
                const isUs = square === HUSTLE_JAPA_EXITS.us;
                const isExit = isUk || isCa || isUs;
                const tokens = tokensBySquare.get(square) ?? [];
                return (
                  <div
                    key={square}
                    style={{ gridRow, gridColumn: gridCol }}
                    className={`relative rounded-md border text-[10px] font-display
                      ${isUs ? 'bg-yellow-400/25 border-yellow-300/70' : ''}
                      ${isCa ? 'bg-red-500/20 border-red-300/60' : ''}
                      ${isUk ? 'bg-blue-500/20 border-blue-300/60' : ''}
                      ${isLadder ? 'bg-emerald-500/15 border-emerald-300/40' : ''}
                      ${isSnake ? 'bg-rose-500/15 border-rose-300/40' : ''}
                      ${isMarket && !isExit ? 'bg-amber-500/15 border-amber-300/40' : ''}
                      ${!head && !isExit && !isMarket ? 'bg-background/30 border-border/20' : ''}
                    `}
                    title={
                      isExit
                        ? `${JAPA_EXIT_REQUIREMENTS[isUk ? 'uk' : isCa ? 'canada' : 'us'].label} — Japa exit`
                        : market?.caption ?? head?.caption ?? `Square ${square}`
                    }
                  >
                    <span className="absolute top-0.5 left-1 text-[10px] text-muted-foreground/80">
                      {square}
                    </span>
                    {isLadder && (
                      <span className="absolute top-0.5 right-0.5 text-emerald-300" aria-label="Ladder">
                        <LadderMark size={11} />
                      </span>
                    )}
                    {isSnake && (
                      <span className="absolute top-0.5 right-0.5 text-rose-300" aria-label="Snake">
                        <SnakeMark size={11} />
                      </span>
                    )}
                    {isMarket && !isExit && (
                      <span className="absolute top-0.5 right-0.5 text-amber-300" aria-label="Market">
                        <MarketMark size={11} />
                      </span>
                    )}
                    {isUk && (
                      <span className="absolute top-0.5 right-0.5 text-blue-300" aria-label="UK exit">
                        <FlagUkMark size={12} />
                      </span>
                    )}
                    {isCa && (
                      <span className="absolute top-0.5 right-0.5 text-red-300" aria-label="Canada exit">
                        <FlagCaMark size={12} />
                      </span>
                    )}
                    {isUs && (
                      <span className="absolute top-0.5 right-0.5 text-yellow-300" aria-label="US exit">
                        <FlagUsMark size={12} />
                      </span>
                    )}
                    {tokens.length > 0 && (
                      <div className="absolute inset-x-0 bottom-0.5 flex justify-center gap-0.5 flex-wrap">
                        {tokens.map((p) => (
                          <motion.div
                            key={p.id}
                            layoutId={`hustle-token-${p.id}`}
                            transition={{ type: 'spring', stiffness: 240, damping: 22 }}
                            className={`h-3 w-3 md:h-4 md:w-4 rounded-full ring-2 ring-offset-1 ring-offset-background ${tokenStyle(p.color)}`}
                            aria-label={`${p.displayName} token`}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-center text-xs text-foreground/70">{state.lastAction}</p>
          </div>

          {/* Side panel */}
          <aside className="space-y-4 lg:w-72">
            <div className="glass rounded-2xl border border-border/40 p-4">
              <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">Turn</p>
              {state.phase === 'finished' && winner ? (
                <div className="mt-2">
                  <p className="font-display text-2xl font-bold">
                    {winner.displayName} japa'd
                    {state.winnerExit ? ` to ${JAPA_EXIT_REQUIREMENTS[state.winnerExit].label}` : ''}!
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Wheels up. Game over.</p>
                </div>
              ) : state.phase === 'japaPrompt' && current && state.pendingJapaExit ? (
                <div className="mt-2">
                  <p className="font-display text-lg font-bold leading-tight">
                    {current.displayName} at {JAPA_EXIT_REQUIREMENTS[state.pendingJapaExit].label} gate
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Choosing whether to japa…</p>
                </div>
              ) : current ? (
                <div className="mt-2 flex items-center gap-3">
                  <div className={`h-8 w-8 rounded-full ${tokenStyle(current.color)}`} />
                  <div>
                    <p className="font-display text-lg font-bold leading-tight">{current.displayName}</p>
                    <p className="text-xs text-muted-foreground">
                      {state.lastDie != null ? `Rolled ${state.lastDie}` : 'To roll'}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-muted-foreground">Waiting…</p>
              )}
            </div>

            <div className="glass rounded-2xl border border-border/40 p-4 space-y-2">
              <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">Players</p>
              {state.players.map((p, i) => {
                const isTurn = i === state.currentPlayerIndex && state.phase !== 'finished';
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
                        Sq {p.position} · ₦{p.money} · 📄{p.documents}
                      </p>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/80">
                        {p.hand.length} card{p.hand.length === 1 ? '' : 's'}
                        {p.skipsNextTurn ? ' · ⏭ skip' : ''}
                        {p.hasSnakeShield ? ' · 🛡' : ''}
                      </p>
                    </div>
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
                ${banner.kind === 'ladder' ? 'border-emerald-400/60 bg-emerald-400/10' : ''}
                ${banner.kind === 'snake' ? 'border-rose-400/60 bg-rose-400/10' : ''}
                ${banner.kind === 'collision' ? 'border-amber-400/60 bg-amber-400/10' : ''}
                ${banner.kind === 'win' ? 'border-yellow-300/60 bg-yellow-300/10' : ''}
                ${banner.kind === 'market' ? 'border-amber-400/60 bg-amber-400/10' : ''}
                ${banner.kind === 'japa' ? 'border-blue-400/60 bg-blue-400/10' : ''}
                ${!['ladder','snake','collision','win','market','japa'].includes(banner.kind) ? 'border-border/40' : ''}
              `}
            >
              <p className="font-display text-lg md:text-xl font-bold">{banner.headline}</p>
              <p className="text-xs md:text-sm text-foreground/80 mt-0.5">{banner.detail}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
