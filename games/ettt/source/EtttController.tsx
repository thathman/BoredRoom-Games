import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { EtttPublicState, EtttMark } from '@/lib/transport/types';

interface EtttControllerProps {
  state: EtttPublicState;
  playerId: string;
  onPlace: (row: number, col: number) => void;
  syncPending?: boolean;
}

const MARK_COLOR: Record<EtttMark, string> = {
  X: 'text-cyan-300',
  O: 'text-fuchsia-300',
};

const MARK_BG: Record<EtttMark, string> = {
  X: 'bg-cyan-400',
  O: 'bg-fuchsia-400',
};

export function EtttController({
  state,
  playerId,
  onPlace,
  syncPending,
}: EtttControllerProps) {
  const { t } = useTranslation();
  const me = state.players.find((p) => p.id === playerId);
  const isMyTurn = state.currentPlayerId === playerId && state.phase === 'playing';
  const current = state.players.find((p) => p.id === state.currentPlayerId);
  const currentName = current?.displayName ?? '…';
  const myTeammate = me?.team
    ? state.players.find((p) => p.id !== me.id && p.team === me.team)
    : null;
  const isTeammatesTurn = !!me?.team && current?.team === me.team && current?.id !== me.id;
  const turnLabel = isMyTurn
    ? t('controller.yourMove')
    : isTeammatesTurn
      ? t('controller.teammate', { name: currentName })
      : me?.team && current?.team
        ? t('controller.teamLabel', { team: current.team, name: currentName })
        : currentName;
  const disabled = !isMyTurn || syncPending || state.phase === 'finished';

  // In tag-team mode, the eviction pool is the TEAM's marks. Use that for the
  // "your oldest" hint so teammates see each other's pieces too.
  const myPool = me?.team
    ? (state.piecesByTeam?.[me.team] ?? [])
    : me ? (state.piecesByPlayer[me.id] ?? []) : [];
  const myOldest = myPool.length >= 3 ? myPool[0] : null;

  const isMyOldest = (row: number, col: number) =>
    !!myOldest && myOldest.row === row && myOldest.col === col;

  const handlePlace = (row: number, col: number) => {
    if (state.phase === 'finished') return;
    if (!isMyTurn) {
      toast(t('controller.waitingFor', { name: currentName }));
      return;
    }
    const cell = state.board[row]?.[col];
    if (cell !== null && !isMyOldest(row, col)) {
      toast(t('controller.draw'));
      return;
    }
    onPlace(row, col);
  };

  if (!me) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="glass max-w-sm rounded-2xl p-6 text-center space-y-3">
          <h2 className="font-display text-xl font-bold">{t('controller.joining')}</h2>
          <p className="text-sm text-muted-foreground">{t('controller.joiningBody')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-between p-5 gap-6">
      {/* Top: identity + turn */}
      <div className="w-full max-w-md space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`h-12 w-12 rounded-full ${MARK_BG[me.mark]} flex items-center justify-center font-display font-black text-background text-xl shadow-lg`}
            >
              {me.mark}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{t('ettt.youAre')}</p>
              <p className="font-display text-lg font-bold leading-tight">{me.displayName}</p>
              <p className="text-xs text-muted-foreground">
                {me.team ? `Team ${me.team}` : t('ettt.onBoard', { count: myPool.length })}
                {myTeammate ? ` · ${t('ettt.withTeammate', { name: myTeammate.displayName })}` : ''}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{t('ettt.turn')}</p>
            <p className={`font-display text-lg font-bold ${isMyTurn ? 'text-primary' : ''}`}>
              {turnLabel}
            </p>
          </div>
        </div>

        <motion.div
          key={state.lastAction}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass rounded-xl px-4 py-2 text-sm text-foreground/80 text-center"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {state.lastAction}
        </motion.div>

        {isMyTurn && myOldest && (
          <p className="text-center text-xs text-yellow-300">
            {t('ettt.oldestWillDisappear')}
          </p>
        )}
      </div>

      {/* Mid: 3x3 tap grid */}
      <div className="w-full max-w-sm">
        <div className="grid grid-cols-3 gap-2" role="grid" aria-label="Endless tic tac toe board">
          {state.board.map((row, rowIndex) =>
            row.map((cell, colIndex) => {
              const taken = cell !== null;
              const myOldHere = isMyOldest(rowIndex, colIndex);
              const tapDisabled = disabled || (taken && !myOldHere);
              return (
                <button
                  key={`${rowIndex}-${colIndex}`}
                  type="button"
                  onClick={() => handlePlace(rowIndex, colIndex)}
                  disabled={tapDisabled}
                  role="gridcell"
                  aria-label={`Row ${rowIndex + 1}, column ${colIndex + 1}: ${cell ?? 'empty'}${myOldHere ? ' — your oldest, will be replaced' : ''}`}
                  aria-disabled={tapDisabled}
                  className={`aspect-square rounded-2xl flex items-center justify-center font-display font-black text-5xl transition active:scale-95
                    ${tapDisabled
                      ? 'bg-muted/20 text-muted-foreground/40 cursor-not-allowed'
                      : 'bg-card/60 hover:bg-card border border-border/60'}
                    ${myOldHere ? 'opacity-60 animate-pulse ring-2 ring-yellow-300' : ''}
                  `}
                >
                  {cell && <span className={MARK_COLOR[cell]} aria-hidden>{cell}</span>}
                </button>
              );
            }),
          )}
        </div>
      </div>

      {state.phase === 'finished' && (
        <div className="w-full max-w-md text-center space-y-2">
          {state.winningTeam && me?.team === state.winningTeam ? (
            <p className="font-display text-2xl font-bold text-primary">{t('controller.teamWins', { team: state.winningTeam })}</p>
          ) : state.winningTeam ? (
            <p className="font-display text-2xl font-bold">{t('controller.teamWins', { team: state.winningTeam })}</p>
          ) : state.winnerId === playerId ? (
            <p className="font-display text-2xl font-bold text-primary">{t('controller.youWon')}</p>
          ) : state.winnerId ? (
            <p className="font-display text-2xl font-bold">{t('controller.wins', { name: currentName })}</p>
          ) : (
            <p className="font-display text-2xl font-bold">{t('controller.matchEnded')}</p>
          )}
          <Button variant="outline" size="sm" disabled>
            {t('controller.waitingHostNewRound')}
          </Button>
        </div>
      )}
    </div>
  );
}
