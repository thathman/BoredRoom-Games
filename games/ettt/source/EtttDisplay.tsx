import { motion } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import type { EtttPublicState, EtttMark } from '@/lib/transport/types';
import { AIStatusChip } from '@/components/game/AIStatusChip';
import type { AIStatus } from '@/lib/realtimeRoom';

interface EtttDisplayProps {
  state: EtttPublicState;
  roomCode: string;
  joinUrl: string;
  commentaryLine?: string | null;
  aiStatus?: AIStatus;
}

const MARK_COLOR: Record<EtttMark, string> = {
  X: 'text-cyan-300 drop-shadow-[0_0_18px_rgba(34,211,238,0.65)]',
  O: 'text-fuchsia-300 drop-shadow-[0_0_18px_rgba(232,121,249,0.65)]',
};

const MARK_BG: Record<EtttMark, string> = {
  X: 'bg-cyan-400',
  O: 'bg-fuchsia-400',
};

export function EtttDisplay({
  state,
  roomCode,
  joinUrl,
  commentaryLine,
  aiStatus = 'active',
}: EtttDisplayProps) {
  const current = state.players.find((p) => p.id === state.currentPlayerId);
  const winner = state.winnerId ? state.players.find((p) => p.id === state.winnerId) : null;
  const teamA = state.players.filter((p) => p.team === 'A');
  const teamB = state.players.filter((p) => p.team === 'B');
  const isTagTeam = teamA.length > 0 && teamB.length > 0;
  const isWinningCell = (row: number, col: number) =>
    state.winningCells?.some((c) => c.row === row && c.col === col) ?? false;
  const isOldestForCurrent = (row: number, col: number) =>
    state.oldestForCurrent?.row === row && state.oldestForCurrent?.col === col;

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
            <h1 className="text-4xl md:text-5xl font-display font-bold neon-text">
              Endless Tic Tac Toe
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Each player keeps only 3 pieces — the oldest disappears.
            </p>
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
          <div className="glass rounded-3xl border border-border/40 p-6 md:p-8 bg-gradient-to-br from-indigo-900/40 to-violet-900/40">
            <div className="grid grid-cols-3 gap-3 md:gap-4 mx-auto max-w-md">
              {state.board.map((row, rowIndex) =>
                row.map((cell, colIndex) => {
                  const winning = isWinningCell(rowIndex, colIndex);
                  const willEvict = isOldestForCurrent(rowIndex, colIndex);
                  return (
                    <div
                      key={`${rowIndex}-${colIndex}`}
                      className={`aspect-square rounded-2xl bg-indigo-950/60 ring-1 ring-indigo-300/15 flex items-center justify-center relative ${
                        winning ? 'ring-4 ring-yellow-300 bg-yellow-500/10' : ''
                      }`}
                    >
                      {cell && (
                        <motion.span
                          key={`${rowIndex}-${colIndex}-${cell}-${state.turnNumber}`}
                          initial={{ scale: 0.4, opacity: 0 }}
                          animate={{ scale: 1, opacity: willEvict ? 0.45 : 1 }}
                          transition={{ type: 'spring', stiffness: 240, damping: 18 }}
                          className={`font-display font-black text-6xl md:text-7xl leading-none ${MARK_COLOR[cell]} ${
                            willEvict ? 'animate-pulse' : ''
                          }`}
                        >
                          {cell}
                        </motion.span>
                      )}
                      {willEvict && (
                        <span className="absolute top-1 right-2 text-[10px] uppercase tracking-wider text-yellow-300">
                          next out
                        </span>
                      )}
                    </div>
                  );
                }),
              )}
            </div>
            <p className="mt-5 text-center text-sm text-foreground/70">{state.lastAction}</p>
          </div>

          {/* Side panel */}
          <aside className="space-y-4 lg:w-72">
            <div className="glass rounded-2xl border border-border/40 p-4">
              <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">Turn</p>
              {state.phase === 'playing' && current ? (
                <div className="mt-2 flex items-center gap-3">
                  <div
                    className={`h-9 w-9 rounded-full ${MARK_BG[current.mark]} flex items-center justify-center font-display font-black text-background`}
                  >
                    {current.mark}
                  </div>
                  <div>
                    <p className="font-display text-lg font-bold leading-tight">
                      {isTagTeam ? `Team ${current.team} — ${current.displayName}` : current.displayName}
                    </p>
                    <p className="text-xs text-muted-foreground">to play</p>
                  </div>
                </div>
              ) : winner ? (
                <p className="mt-2 font-display text-2xl font-bold">
                  {isTagTeam && state.winningTeam ? `Team ${state.winningTeam} wins!` : `${winner.displayName} wins!`}
                </p>
              ) : state.phase === 'finished' ? (
                <p className="mt-2 font-display text-xl">Match ended.</p>
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
                  const mark = team === 'A' ? 'X' : 'O';
                  const turnHere = current?.team === team && state.phase === 'playing';
                  const teamPieceCount = state.piecesByTeam?.[team]?.length ?? 0;
                  return (
                    <div
                      key={team}
                      className={`rounded-xl border px-3 py-2 transition ${
                        turnHere ? 'border-primary/60 bg-primary/10' : 'border-border/30 bg-background/30'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <div className={`h-6 w-6 rounded-full ${MARK_BG[mark]} flex items-center justify-center font-display font-black text-background text-sm`}>{mark}</div>
                        <p className="font-display text-sm font-bold">Team {team}</p>
                        <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">
                          {teamPieceCount}/3
                        </span>
                      </div>
                      <ul className="text-xs text-foreground/80 space-y-0.5">
                        {members.map((m) => (
                          <li key={m.id} className={m.id === state.currentPlayerId ? 'text-primary font-bold' : ''}>
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
                  const pieceCount = state.piecesByPlayer[p.id]?.length ?? 0;
                  return (
                    <div
                      key={p.id}
                      className={`flex items-center gap-3 rounded-xl border px-3 py-2 transition ${
                        isTurn ? 'border-primary/60 bg-primary/10' : 'border-border/30 bg-background/30'
                      }`}
                    >
                      <div
                        className={`h-8 w-8 rounded-full ${MARK_BG[p.mark]} flex items-center justify-center font-display font-black text-background`}
                      >
                        {p.mark}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-display text-sm font-bold truncate">{p.displayName}</p>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {pieceCount}/3 on board
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
