import { motion } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import type { Connect4PublicState, Connect4Disc } from '@/lib/transport/types';
import { AIStatusChip } from '@/components/game/AIStatusChip';
import type { AIStatus } from '@/lib/realtimeRoom';

interface Connect4DisplayProps {
  state: Connect4PublicState;
  roomCode: string;
  joinUrl: string;
  commentaryLine?: string | null;
  aiStatus?: AIStatus;
}

const DISC_RING: Record<Connect4Disc, string> = {
  red: 'ring-red-300',
  yellow: 'ring-yellow-300',
};

const DISC_BG: Record<Connect4Disc, string> = {
  red: 'bg-gradient-to-br from-red-400 to-red-600 shadow-[0_0_24px_rgba(248,113,113,0.55)]',
  yellow: 'bg-gradient-to-br from-yellow-300 to-amber-500 shadow-[0_0_24px_rgba(250,204,21,0.55)]',
};

const DISC_LABEL: Record<Connect4Disc, string> = {
  red: 'Red',
  yellow: 'Yellow',
};

export function Connect4Display({
  state,
  roomCode,
  joinUrl,
  commentaryLine,
  aiStatus = 'active',
}: Connect4DisplayProps) {
  const current = state.players.find((p) => p.id === state.currentPlayerId);
  const winner = state.winnerId ? state.players.find((p) => p.id === state.winnerId) : null;
  const teamA = state.players.filter((p) => p.team === 'A');
  const teamB = state.players.filter((p) => p.team === 'B');
  const isTagTeam = teamA.length > 0 && teamB.length > 0;
  const isWinningCell = (row: number, col: number) =>
    state.winningCells?.some((c) => c.row === row && c.col === col) ?? false;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-5xl space-y-6"
      >
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Now playing</p>
            <h1 className="text-4xl md:text-5xl font-display font-bold neon-text">Connect 4</h1>
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
          <div className="glass rounded-3xl border border-border/40 p-5 md:p-7 bg-gradient-to-br from-blue-700/40 to-indigo-900/40">
            <div className="grid grid-cols-7 gap-2 md:gap-3">
              {state.board.map((row, rowIndex) =>
                row.map((cell, colIndex) => {
                  const winning = isWinningCell(rowIndex, colIndex);
                  return (
                    <div
                      key={`${rowIndex}-${colIndex}`}
                      className="aspect-square rounded-full bg-blue-900/60 ring-1 ring-blue-300/15 flex items-center justify-center"
                    >
                      {cell && (
                        <motion.div
                          initial={{ y: -200, opacity: 0 }}
                          animate={{ y: 0, opacity: 1 }}
                          transition={{ type: 'spring', stiffness: 220, damping: 18 }}
                          className={`h-[88%] w-[88%] rounded-full ${DISC_BG[cell]} ${
                            winning ? `ring-4 ${DISC_RING[cell]} ring-offset-2 ring-offset-blue-900` : ''
                          }`}
                          aria-label={`${DISC_LABEL[cell]} disc`}
                        />
                      )}
                    </div>
                  );
                }),
              )}
            </div>
            <p
              className="mt-4 text-center text-sm text-foreground/70"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {state.lastAction}
            </p>
          </div>

          {/* Side panel */}
          <aside className="space-y-4 lg:w-72">
            <div className="glass rounded-2xl border border-border/40 p-4">
              <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">Turn</p>
              {state.phase === 'playing' && current ? (
                <div className="mt-2 flex items-center gap-3">
                  <div className={`h-8 w-8 rounded-full ${DISC_BG[current.disc]}`} />
                  <div>
                    <p className="font-display text-lg font-bold leading-tight">
                      {isTagTeam ? `Team ${current.team} — ${current.displayName}` : current.displayName}
                    </p>
                    <p className="text-xs text-muted-foreground">{DISC_LABEL[current.disc]} to play</p>
                  </div>
                </div>
              ) : winner ? (
                <div className="mt-2">
                  <p className="font-display text-2xl font-bold">
                    {isTagTeam && state.winningTeam ? `Team ${state.winningTeam} wins!` : `${winner.displayName} wins!`}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {isTagTeam ? `${winner.displayName} connected four` : 'Connected four discs'}
                  </p>
                </div>
              ) : state.phase === 'finished' ? (
                <p className="mt-2 font-display text-xl">It's a draw.</p>
              ) : (
                <p className="mt-2 font-display text-lg text-muted-foreground">Waiting…</p>
              )}
            </div>

            <div className="glass rounded-2xl border border-border/40 p-4 space-y-3">
              <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
                {isTagTeam ? 'Teams' : 'Players'}
              </p>
              {isTagTeam ? (
                (['A', 'B'] as const).map((team) => {
                  const members = team === 'A' ? teamA : teamB;
                  const disc = team === 'A' ? 'red' : 'yellow';
                  const turnHere = current?.team === team && state.phase === 'playing';
                  return (
                    <div
                      key={team}
                      className={`rounded-xl border px-3 py-2 transition ${
                        turnHere ? 'border-primary/60 bg-primary/10' : 'border-border/30 bg-background/30'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <div className={`h-5 w-5 rounded-full ${DISC_BG[disc]}`} />
                        <p className="font-display text-sm font-bold">Team {team}</p>
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {DISC_LABEL[disc]}
                        </span>
                      </div>
                      <ul className="text-xs text-foreground/80 space-y-0.5">
                        {members.map((m) => (
                          <li
                            key={m.id}
                            className={m.id === state.currentPlayerId ? 'text-primary font-bold' : ''}
                          >
                            {m.id === state.currentPlayerId ? '▸ ' : '  '}{m.displayName}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })
              ) : (
                state.players.map((p) => {
                  const isTurn = p.id === state.currentPlayerId && state.phase === 'playing';
                  return (
                    <div
                      key={p.id}
                      className={`flex items-center gap-3 rounded-xl border px-3 py-2 transition ${
                        isTurn ? 'border-primary/60 bg-primary/10' : 'border-border/30 bg-background/30'
                      }`}
                    >
                      <div className={`h-7 w-7 rounded-full ${DISC_BG[p.disc]}`} />
                      <div className="flex-1 min-w-0">
                        <p className="font-display text-sm font-bold truncate">{p.displayName}</p>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {DISC_LABEL[p.disc]}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
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
      </motion.div>
    </div>
  );
}
