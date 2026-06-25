import { motion } from 'framer-motion';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { SpotlightOverlay } from '@/components/system/SpotlightOverlay';
import type { Connect4PublicState, Connect4Disc } from '@/lib/transport/types';

interface Connect4ControllerProps {
  state: Connect4PublicState;
  playerId: string;
  onDrop: (column: number) => void;
  syncPending?: boolean;
}

const DISC_BG: Record<Connect4Disc, string> = {
  red: 'bg-gradient-to-br from-red-400 to-red-600',
  yellow: 'bg-gradient-to-br from-yellow-300 to-amber-500',
};

const DISC_LABEL: Record<Connect4Disc, string> = {
  red: 'Red',
  yellow: 'Yellow',
};

export function Connect4Controller({
  state,
  playerId,
  onDrop,
  syncPending,
}: Connect4ControllerProps) {
  const { t } = useTranslation();
  const firstColRef = useRef<HTMLButtonElement>(null);
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

  const columnFull = (col: number) => {
    // top row at index 0; if it's filled the whole column is full.
    return state.board[0]?.[col] !== null;
  };

  const handleDrop = (col: number) => {
    if (state.phase === 'finished') return;
    if (!isMyTurn) {
      toast(t('controller.waitingFor', { name: currentName }));
      return;
    }
    if (columnFull(col)) {
      toast(t('controller.tapColumnToDrop'));
      return;
    }
    onDrop(col);
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
            <div className={`h-12 w-12 rounded-full ${DISC_BG[me.disc]} shadow-lg`} />
            <div>
              <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">You are</p>
              <p className="font-display text-lg font-bold leading-tight">{me.displayName}</p>
              <p className="text-xs text-muted-foreground">
                {me.team ? `Team ${me.team} · ` : ''}{DISC_LABEL[me.disc]}
                {myTeammate ? ` · with ${myTeammate.displayName}` : ''}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Turn</p>
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
      </div>

      {/* Mid: column drop buttons */}
      <div className="w-full max-w-md">
        <p className="text-center text-xs uppercase tracking-[0.25em] text-muted-foreground mb-3">
          {t('controller.tapColumnToDrop')}
        </p>
        <div
          className="grid grid-cols-7 gap-1.5"
          role="group"
          aria-label="Connect 4 column drop buttons"
        >
          {Array.from({ length: 7 }, (_, col) => {
            const full = columnFull(col);
            const buttonDisabled = disabled || full;
            return (
              <button
                key={col}
                ref={col === 3 ? firstColRef : undefined}
                type="button"
                onClick={() => handleDrop(col)}
                disabled={buttonDisabled}
                aria-label={`Drop in column ${col + 1}${full ? ', full' : ''}`}
                aria-disabled={buttonDisabled}
                className={`aspect-square rounded-lg flex items-center justify-center font-display text-lg font-bold transition active:scale-95
                  ${buttonDisabled
                    ? 'bg-muted/30 text-muted-foreground/50 cursor-not-allowed'
                    : `${DISC_BG[me.disc]} text-white shadow-md hover:brightness-110`}
                `}
              >
                {full ? '×' : col + 1}
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom: read-only mini board so they can see state */}
      <div className="w-full max-w-md glass rounded-2xl p-3 bg-blue-900/30 border border-border/40" aria-label="Connect 4 board state" role="img">
        <div className="grid grid-cols-7 gap-1">
          {state.board.map((row, rowIndex) =>
            row.map((cell, colIndex) => (
              <div
                key={`${rowIndex}-${colIndex}`}
                className="aspect-square rounded-full bg-blue-950/70 flex items-center justify-center"
                aria-label={`Row ${rowIndex + 1}, column ${colIndex + 1}: ${cell ? DISC_LABEL[cell] : 'empty'}`}
              >
                {cell && <div className={`h-[80%] w-[80%] rounded-full ${DISC_BG[cell]}`} />}
              </div>
            )),
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
            <p className="font-display text-2xl font-bold">{t('controller.draw')}</p>
          )}
          <Button variant="outline" size="sm" disabled>
            {t('controller.waitingHostNewRound')}
          </Button>
        </div>
      )}

      <SpotlightOverlay
        storageKey="connect-4:first-drop"
        targetRef={firstColRef}
        enabled={isMyTurn && state.phase === 'playing' && !state.lastAction}
        message={t('spotlight.tapHere') as string}
      />
    </div>
  );
}
