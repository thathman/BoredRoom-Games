import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { SpotlightOverlay } from '@/components/system/SpotlightOverlay';
import { sounds, vibrate } from '@/lib/sounds';
import type { HustlePublicState } from '@/lib/transport/types';
import { HUSTLE_CARDS } from '../../../shared/src/games/hustle/cards';
import { JAPA_EXIT_REQUIREMENTS } from '../../../shared/src/games/hustle/engine';

interface HustleControllerProps {
  state: HustlePublicState;
  playerId: string;
  onRoll: () => void;
  onPlayCard: (instanceId: string, targetPlayerId?: string | null) => void;
  onClaimJapa: () => void;
  onDeclineJapa: () => void;
  syncPending?: boolean;
}

const SEAT_TOKEN_BG: Record<string, string> = {
  emerald: 'bg-gradient-to-br from-emerald-300 to-emerald-600',
  amber: 'bg-gradient-to-br from-amber-300 to-amber-600',
  rose: 'bg-gradient-to-br from-rose-300 to-rose-600',
  sky: 'bg-gradient-to-br from-sky-300 to-sky-600',
};

const tokenStyle = (color?: string) =>
  SEAT_TOKEN_BG[color ?? 'emerald'] ?? SEAT_TOKEN_BG.emerald;

export function HustleController({
  state,
  playerId,
  onRoll,
  onPlayCard,
  onClaimJapa,
  onDeclineJapa,
  syncPending,
}: HustleControllerProps) {
  const { t } = useTranslation();
  const me = state.players.find((p) => p.id === playerId);
  const isMyTurn =
    state.players[state.currentPlayerIndex]?.id === playerId &&
    state.phase !== 'finished';
  const currentName =
    state.players[state.currentPlayerIndex]?.displayName ?? '…';
  const [pendingTarget, setPendingTarget] = useState<{
    instanceId: string;
  } | null>(null);
  const rollBtnRef = useRef<HTMLButtonElement>(null);

  // Banner sound effects — declared before the early return below so hook
  // order stays stable when `me` goes undefined -> defined (React #310).
  const lastBannerKey = useRef<string | null>(null);
  useEffect(() => {
    const b = state.lastBanner;
    if (!b) return;
    const key = `${b.kind}-${state.turnNumber}-${b.headline}`;
    if (lastBannerKey.current === key) return;
    lastBannerKey.current = key;
    if (b.kind === 'ladder') sounds.hustleLadder();
    else if (b.kind === 'snake') sounds.hustleSnake();
    else if (b.kind === 'japa' || b.kind === 'win') sounds.hustleJapa();
  }, [state.lastBanner, state.turnNumber]);

  if (!me) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="glass max-w-sm rounded-2xl p-6 text-center space-y-3">
          <h2 className="font-display text-xl font-bold">{t('hustle.joining')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('hustle.joiningBody')}
          </p>
        </div>
      </div>
    );
  }

  const isJapaPrompt = state.phase === 'japaPrompt' && isMyTurn && state.pendingJapaExit;
  const canRoll =
    isMyTurn &&
    state.lastDie == null &&
    !syncPending &&
    state.phase !== 'finished' &&
    state.phase !== 'japaPrompt';

  const handleRoll = () => {
    if (!isMyTurn) {
      toast(t('hustle.waitingFor', { name: currentName }) as string);
      return;
    }
    if (state.lastDie != null) {
      toast(t('hustle.alreadyRolled') as string);
      return;
    }
    sounds.hustleRoll();
    vibrate(20);
    onRoll();
  };

  const handleCardTap = (instanceId: string) => {
    if (state.phase === 'finished') return;
    const card = me.hand.find((c) => c.instanceId === instanceId);
    if (!card) return;
    const def = HUSTLE_CARDS[card.cardId];
    if (def.timing === 'own_turn' && !isMyTurn) {
      toast(t('hustle.playOnTurn') as string);
      return;
    }
    const cost = def.cost ?? 0;
    if (cost > 0 && me.money < cost) {
      toast(t('hustle.needCash', { cost, have: me.money }) as string);
      return;
    }
    if (def.needsTarget) {
      setPendingTarget({ instanceId });
      return;
    }
    sounds.hustleCard();
    onPlayCard(instanceId, null);
  };

  const confirmTarget = (targetId: string) => {
    if (!pendingTarget) return;
    sounds.hustleCard();
    onPlayCard(pendingTarget.instanceId, targetId);
    setPendingTarget(null);
  };

  const targets = state.players.filter((p) => p.id !== playerId);

  const japaReq = state.pendingJapaExit ? JAPA_EXIT_REQUIREMENTS[state.pendingJapaExit] : null;
  const canAffordJapa = japaReq
    ? me.money >= japaReq.cost && me.documents >= japaReq.documentsRequired
    : false;

  return (
    <div className="min-h-screen flex flex-col items-center justify-between p-5 gap-6">
      <div className="w-full max-w-md space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`h-12 w-12 rounded-full shadow-lg ${tokenStyle(me.color)}`} />
            <div>
              <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{t('hustle.youAre')}</p>
              <p className="font-display text-lg font-bold leading-tight">{me.displayName}</p>
              <p className="text-xs text-muted-foreground">{t('hustle.square', { n: me.position })}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{t('hustle.turn')}</p>
            <p className={`font-display text-lg font-bold ${isMyTurn ? 'text-primary' : ''}`}>
              {isMyTurn ? t('hustle.yourMove') : currentName}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="glass rounded-xl px-3 py-2 text-center">
            <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{t('hustle.wallet')}</p>
            <p className="font-display text-lg font-bold text-emerald-400">₦{me.money}</p>
          </div>
          <div className="glass rounded-xl px-3 py-2 text-center">
            <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{t('hustle.documents')}</p>
            <p className="font-display text-lg font-bold text-amber-400">{me.documents}</p>
          </div>
        </div>

        <motion.div
          key={state.lastAction}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass rounded-xl px-4 py-2 text-sm text-foreground/80 text-center"
        >
          {state.lastAction}
        </motion.div>
      </div>

      {isJapaPrompt && japaReq && (
        <div className="w-full max-w-md glass rounded-2xl border border-primary/40 p-5 space-y-4">
          <div className="text-center space-y-1">
            <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{t('hustle.japaGate')}</p>
            <p className="font-display text-2xl font-bold text-primary">
              {t('hustle.flyTo', { label: japaReq.label })}
            </p>
            <p className="text-sm text-muted-foreground">
              {japaReq.cost > 0 && <>{t('hustle.cost')}: <span className="text-emerald-400 font-bold">₦{japaReq.cost}</span></>}
              {japaReq.documentsRequired > 0 && (
                <> · {t('hustle.docs')}: <span className="text-amber-400 font-bold">{japaReq.documentsRequired}</span></>
              )}
              {japaReq.cost === 0 && japaReq.documentsRequired === 0 && t('hustle.freeFlight')}
            </p>
          </div>
          {!canAffordJapa && (
            <p className="text-xs text-rose-400 text-center">
              {t('hustle.notEligible')}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              size="lg"
              className="flex-1"
              onClick={onClaimJapa}
              disabled={!canAffordJapa || syncPending}
            >
              {t('hustle.japaNow')}
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="flex-1"
              onClick={onDeclineJapa}
              disabled={syncPending}
            >
              {t('hustle.stay')}
            </Button>
          </div>
        </div>
      )}

      {!isJapaPrompt && (
        <div className="w-full max-w-md flex flex-col items-center gap-4">
          <div
            className={`h-28 w-28 rounded-2xl border-2 flex items-center justify-center font-display text-6xl font-bold transition-all
              ${state.lastDie != null ? 'bg-primary/10 border-primary/60 text-primary' : 'bg-background/40 border-border/40 text-muted-foreground'}
            `}
          >
            {state.lastDie ?? '–'}
          </div>
          <Button
            ref={rollBtnRef}
            size="lg"
            onClick={handleRoll}
            disabled={!canRoll}
            className="w-full max-w-xs"
          >
            {canRoll
              ? t('hustle.rollDie')
              : state.phase === 'finished'
                ? t('hustle.matchOver')
                : isMyTurn
                  ? t('hustle.waitingBoard')
                  : t('hustle.waitingFor', { name: currentName })}
          </Button>
          <SpotlightOverlay
            storageKey="hustle:first-roll"
            targetRef={rollBtnRef}
            message={t('spotlight.tapToRoll') as string}
            enabled={canRoll && state.turnNumber <= 1}
          />
        </div>
      )}

      <div className="w-full max-w-md">
        <p className="text-center text-xs uppercase tracking-[0.25em] text-muted-foreground mb-3">
          {t('hustle.yourCards')}
        </p>
        {me.hand.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground/70">
            {t('hustle.noCardsYet')}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {me.hand.map((c) => {
              const def = HUSTLE_CARDS[c.cardId];
              const cost = def.cost ?? 0;
              const tooPoor = cost > 0 && me.money < cost;
              return (
                <button
                  key={c.instanceId}
                  type="button"
                  onClick={() => handleCardTap(c.instanceId)}
                  disabled={state.phase === 'finished' || syncPending || tooPoor}
                  className="text-left rounded-xl border border-border/40 bg-background/40 p-3 hover:border-primary/60 transition disabled:opacity-50"
                >
                  <div className="flex items-start justify-between gap-1">
                    <p className="font-display text-sm font-bold">{def.name}</p>
                    {cost > 0 && (
                      <span className={`text-[10px] font-bold ${tooPoor ? 'text-rose-400' : 'text-emerald-400'}`}>
                        ₦{cost}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">
                    {def.description}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {pendingTarget && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-6">
          <div className="glass rounded-2xl border border-border/40 p-5 w-full max-w-sm space-y-3">
            <p className="font-display text-lg font-bold text-center">{t('hustle.pickTarget')}</p>
            <div className="space-y-2">
              {targets.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center">
                  {t('hustle.noTargets')}
                </p>
              ) : (
                targets.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => confirmTarget(p.id)}
                    className="w-full flex items-center gap-3 rounded-xl border border-border/40 bg-background/40 px-3 py-2 hover:border-primary/60"
                  >
                    <div className={`h-7 w-7 rounded-full ${tokenStyle(p.color)}`} />
                    <span className="font-display text-sm font-bold flex-1 text-left">
                      {p.displayName}
                    </span>
                    <span className="text-[10px] uppercase text-muted-foreground">
                      {t('hustle.square', { n: p.position })}
                    </span>
                  </button>
                ))
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={() => setPendingTarget(null)} className="w-full">
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}

      {state.phase === 'finished' && (
        <div className="w-full max-w-md text-center space-y-2">
          {state.winnerId === playerId ? (
            <p className="font-display text-2xl font-bold text-primary">
              {t('hustle.youJapad', { suffix: state.winnerExit ? ` → ${JAPA_EXIT_REQUIREMENTS[state.winnerExit].label}` : '' })}
            </p>
          ) : (
            <p className="font-display text-2xl font-bold">
              {t('hustle.playerWon', {
                name: state.players.find((p) => p.id === state.winnerId)?.displayName ?? t('hustle.someone'),
                suffix: state.winnerExit ? ` (${JAPA_EXIT_REQUIREMENTS[state.winnerExit].label})` : '',
              })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
