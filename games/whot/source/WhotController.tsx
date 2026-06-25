import { useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Hand, Layers, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type {
  WhotCard as WhotCardType,
  WhotPrivateState,
  WhotPublicState,
  WhotShape,
} from '@/lib/transport/types';
import { WhotCardView } from '@/components/game/whot/WhotCard';

interface WhotControllerProps {
  publicState: WhotPublicState;
  privateState: WhotPrivateState | null;
  playerId: string;
  onDraw: () => void;
  onPlay: (cardId: string, calledShape?: WhotShape) => void;
  onCallSuit: (shape: WhotShape) => void;
  onAnnounceLastCard: () => void;
  syncPending?: boolean;
}

const SHAPES: WhotShape[] = ['circle', 'triangle', 'cross', 'square', 'star'];

export function WhotController({
  publicState,
  privateState,
  playerId,
  onDraw,
  onPlay,
  onCallSuit,
  onAnnounceLastCard,
  syncPending,
}: WhotControllerProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<WhotCardType | null>(null);
  const [shapeDialogFor, setShapeDialogFor] = useState<WhotCardType | null>(null);

  const shapeLabel = (s: WhotShape | 'whot'): string =>
    t(`whot.shapes.${s}`) as string;

  const isMyTurn = publicState.currentPlayerId === playerId;
  const currentName =
    publicState.players.find((p) => p.id === publicState.currentPlayerId)?.displayName ?? '…';
  const hand = privateState?.hand ?? [];
  const disabled = !isMyTurn || syncPending;
  const legalSet = new Set(
    hand
      .filter((card) => isPlayableCard(card, publicState))
      .map((card) => card.id),
  );
  const hasCalledLastCard = (publicState.lastCardAnnounced ?? []).includes(playerId);
  const canAnnounceLastCard = isMyTurn && hand.length === 1 && !hasCalledLastCard && !syncPending;
  const legalCount = legalSet.size;

  const deriveInvalidReason = (card: WhotCardType, state: WhotPublicState): string => {
    if (state.mustCallSuit) return t('whot.invalid.mustCall') as string;
    if ((state.pendingDrawCount ?? 0) > 0) {
      if (state.pendingDrawRank === '2') return t('whot.invalid.pickChain2') as string;
      if (state.pendingDrawRank === '3') return t('whot.invalid.pickChain3') as string;
      return t('whot.invalid.generalMarket') as string;
    }
    const topValue = state.topDiscard?.value;
    return t('whot.invalid.illegal', {
      shape: shapeLabel(state.activeShape),
      value: topValue ?? '?',
    }) as string;
  };

  const handlePlay = (card: WhotCardType) => {
    if (disabled) {
      if (!isMyTurn) toast(t('whot.waitingFor', { name: currentName }) as string);
      return;
    }
    if (!legalSet.has(card.id)) {
      toast(deriveInvalidReason(card, publicState));
      return;
    }
    if (card.isWhot) {
      setShapeDialogFor(card);
      return;
    }
    setSelected(card);
    onPlay(card.id);
  };

  const handleShapePicked = (shape: WhotShape) => {
    const card = shapeDialogFor;
    setShapeDialogFor(null);
    if (!card) return;
    setSelected(card);
    onPlay(card.id, shape);
  };

  return (
    <div className="min-h-screen flex flex-col p-4 pb-8">
      <header className="flex items-start justify-between gap-4 mb-4">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('whot.title')}</p>
          <p
            className={`text-base font-display font-bold ${
              isMyTurn ? 'text-primary' : 'text-muted-foreground'
            }`}
          >
            {isMyTurn ? t('whot.yourTurn') : t('whot.waitingFor', { name: currentName })}
          </p>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          {t('whot.turnNum', { n: publicState.turnNumber })}
          <div>{t('whot.active', { shape: shapeLabel(publicState.activeShape) })}</div>
        </div>
      </header>

      <div className={`glass rounded-2xl p-3 mb-3 border ${publicState.pendingDrawCount ? 'border-destructive/60 bg-destructive/10' : publicState.mustCallSuit ? 'border-primary/60 bg-primary/10' : 'border-border/70'}`}>
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="font-display font-bold">
            {t('whot.legalMoves', { count: legalCount })}
          </span>
          {publicState.pendingDrawCount ? (
            <span className="text-destructive font-display font-bold">
              {publicState.pendingDrawRank ? t('whot.pickCount', { n: publicState.pendingDrawCount }) : t('whot.goMarket')}
            </span>
          ) : publicState.mustCallSuit ? (
            <span className="text-primary font-display font-bold">{t('whot.chooseShape')}</span>
          ) : (
            <span className="text-muted-foreground">{t('whot.playOrDraw')}</span>
          )}
        </div>
      </div>

      <div className="glass rounded-2xl p-4 mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Layers className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs uppercase tracking-wider text-muted-foreground">{t('whot.onTable')}</span>
        </div>
        {publicState.topDiscard ? (
          <WhotCardView card={publicState.topDiscard} size="sm" />
        ) : (
          <div className="w-11 h-16 rounded bg-muted/40" />
        )}
      </div>

      <div className="flex-1 pb-28">
        <div className="flex items-center gap-2 mb-2">
          <Hand className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            {t('whot.yourHand', { n: hand.length })}
          </span>
        </div>

        {hand.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12">
            {t('whot.noCardsYet')}
          </p>
        ) : (
          <motion.div
            layout
            className="grid grid-cols-5 sm:grid-cols-6 gap-2"
          >
            {hand.map((card) => (
              <WhotCardView
                key={card.id}
                card={card}
                size="md"
                disabled={disabled}
                selected={selected?.id === card.id}
                highlight={
                  disabled
                    ? 'none'
                    : legalSet.has(card.id)
                      ? 'legal'
                      : 'blocked'
                }
                onClick={() => handlePlay(card)}
              />
            ))}
          </motion.div>
        )}

        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          {t('whot.legendHelp')}
        </p>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 bg-background/85 border-t border-border p-3 backdrop-blur md:static md:bg-transparent md:border-0 md:p-0 md:backdrop-blur-none">
        <div className="mx-auto flex max-w-xl gap-2">
          <Button
            onClick={() => {
              if (disabled) return;
              onDraw();
            }}
            disabled={disabled || Boolean(publicState.mustCallSuit)}
            className="flex-1 gap-2"
            variant="outline"
          >
            <Layers className="w-4 h-4" />
            {t('whot.draw', { n: publicState.drawPileCount })}
          </Button>
          <Button
            onClick={() => {
              if (disabled || !publicState.mustCallSuit) return;
              onCallSuit(publicState.activeShape);
              toast(t('whot.calledShape', { shape: shapeLabel(publicState.activeShape) }) as string);
            }}
            disabled={disabled || !publicState.mustCallSuit}
            variant="ghost"
            className="gap-2"
            title={publicState.mustCallSuit
              ? (t('whot.confirmShapeTip', { shape: shapeLabel(publicState.activeShape) }) as string)
              : (t('whot.confirmShapeUnavailable') as string)}
          >
            <Sparkles className="w-4 h-4" />
            {t('whot.confirmShape')}
          </Button>
          <Button
            onClick={() => {
              if (!canAnnounceLastCard) return;
              onAnnounceLastCard();
              toast(t('whot.lastCardAnnounced') as string);
            }}
            disabled={!canAnnounceLastCard}
            variant={hasCalledLastCard ? 'secondary' : 'default'}
            className="gap-2"
          >
            {t('whot.lastCard')}
          </Button>
        </div>
      </div>

      <Dialog open={!!shapeDialogFor} onOpenChange={(o) => !o && setShapeDialogFor(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('whot.callShapeTitle')}</DialogTitle>
            <DialogDescription>
              {t('whot.callShapeBody')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2 mt-2">
            {SHAPES.map((s) => (
              <Button key={s} variant="outline" onClick={() => handleShapePicked(s)}>
                {shapeLabel(s)}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function isPlayableCard(card: WhotCardType, state: WhotPublicState): boolean {
  if (state.mustCallSuit) return false;
  if ((state.pendingDrawCount ?? 0) > 0) {
    if (state.pendingDrawRank === '2') return card.value === 2;
    if (state.pendingDrawRank === '3') return card.value === 5;
    return false;
  }
  if (card.isWhot) return true;
  if (card.shape === state.activeShape) return true;
  if (state.topDiscard && card.value === state.topDiscard.value) return true;
  return false;
}
