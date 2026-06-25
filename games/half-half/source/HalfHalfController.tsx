// HalfHalfController — player phone view: drag a slider over the object,
// lock in your cut.
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { ReactionBar, ReactionAckEvent } from '@/components/game/Reactions';
import { SoundControls } from '@/components/system/SoundControls';
import { vibrate, sounds } from '@/lib/sounds';
import { getShapeRender } from '@/lib/halfHalfShapes';
import type {
  HalfHalfPrivateState,
  HalfHalfPublicState,
  ReactionPolicy,
  TauntPolicy,
} from '@/lib/transport/types';

interface Props {
  publicState: HalfHalfPublicState;
  privateState: HalfHalfPrivateState | null;
  playerId: string;
  onLockGuess: (position: number) => void;
  onReact: (emoji: string, clientNonce?: string) => void;
  reactionPolicy?: ReactionPolicy;
  tauntPolicy?: TauntPolicy;
  onReactionAck?: (fn: (ack: ReactionAckEvent) => void) => () => void;
  onRequestLeave?: () => void;
  syncPending?: boolean;
}

export function HalfHalfController({
  publicState,
  privateState,
  playerId,
  onLockGuess,
  onReact,
  reactionPolicy,
  tauntPolicy,
  onReactionAck,
  onRequestLeave,
  syncPending = false,
}: Props) {
  const { t } = useTranslation();
  const { phase, currentObject } = publicState;
  const me = publicState.players.find((p) => p.id === playerId);
  const hasLockedIn = !!privateState?.hasLockedIn;
  const myResult = useMemo(
    () => publicState.lastRoundResults.find((r) => r.playerId === playerId) ?? null,
    [publicState.lastRoundResults, playerId],
  );

  const [pos, setPos] = useState(0.5);
  const lastObjectIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (currentObject?.id && currentObject.id !== lastObjectIdRef.current) {
      setPos(0.5);
      lastObjectIdRef.current = currentObject.id;
    }
  }, [currentObject?.id]);

  const render = currentObject ? getShapeRender(currentObject.shape) : null;
  const isVertical = currentObject?.axis === 'vertical';
  const viewBox = isVertical ? '0 0 400 1000' : '0 0 1000 400';

  const handleLockIn = () => {
    if (hasLockedIn || syncPending) return;
    if (phase !== 'lock_in') return;
    sounds.click();
    vibrate([15, 25, 15]);
    onLockGuess(pos);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-start p-5 pt-8 gap-5">
      <div className="w-full max-w-md flex items-center justify-between text-xs uppercase tracking-wider text-muted-foreground">
        <span>{me?.displayName ?? t('common.you')}</span>
        <span className="font-display font-bold text-primary text-base">{t('halfHalf.pts', { n: me?.score ?? 0 })}</span>
        {!!me?.bullseyes && <span className="text-accent">🎯 {me.bullseyes}</span>}
      </div>

      <div className="w-full max-w-md flex-1 flex flex-col">
        <AnimatePresence mode="wait">
          {phase === 'lobby' && (
            <motion.div key="lobby" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center mt-12 space-y-3">
              <p className="text-3xl font-display font-bold neon-text">{t('halfHalf.title')}</p>
              <p className="text-muted-foreground">{t('halfHalf.tagline')}</p>
            </motion.div>
          )}

          {phase === 'intro' && (
            <motion.div key="intro" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center mt-12 space-y-3">
              <p className="text-sm uppercase tracking-wider text-muted-foreground">{t('halfHalf.round', { n: publicState.round })}</p>
              <p className="text-3xl font-display font-bold neon-text">{t('halfHalf.getReady')}</p>
            </motion.div>
          )}

          {phase === 'reveal_object' && currentObject && (
            <motion.div key="reveal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center mt-8 space-y-3">
              <p className="text-2xl font-display">{currentObject.name}</p>
              <p className="text-muted-foreground">{t('halfHalf.sliderUnlock')}</p>
            </motion.div>
          )}

          {phase === 'lock_in' && currentObject && render && (
            <motion.div key="lock" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 mt-2">
              <p className="text-center text-sm text-muted-foreground">
                {hasLockedIn ? t('halfHalf.lockedHold') : t('halfHalf.dragLock')}
              </p>
              <div className={`relative ${isVertical ? 'h-[400px] w-[160px] mx-auto' : 'w-full aspect-[2.5/1]'}`}>
                <svg viewBox={viewBox} preserveAspectRatio="xMidYMid meet" className="w-full h-full">
                  <path d={render.path} fill="hsl(var(--primary) / 0.85)" stroke="hsl(var(--primary))" strokeWidth={4} />
                  <line
                    x1={isVertical ? 0 : pos * 1000}
                    y1={isVertical ? pos * 1000 : 0}
                    x2={isVertical ? 400 : pos * 1000}
                    y2={isVertical ? pos * 1000 : 400}
                    stroke="hsl(var(--accent))"
                    strokeWidth={6}
                  />
                </svg>
              </div>
              <Slider
                value={[pos * 1000]}
                onValueChange={(v) => !hasLockedIn && setPos(v[0] / 1000)}
                min={0}
                max={1000}
                step={1}
                disabled={hasLockedIn || syncPending}
              />
              <div className="text-center text-xs text-muted-foreground">{(pos * 100).toFixed(1)}%</div>
              <Button
                type="button"
                size="lg"
                className="w-full"
                disabled={hasLockedIn || syncPending}
                onClick={handleLockIn}
              >
                {hasLockedIn ? t('halfHalf.lockedIn') : t('halfHalf.lockCut')}
              </Button>
            </motion.div>
          )}

          {phase === 'reveal_truth' && (
            <motion.div key="truth" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center mt-8 space-y-3">
              {myResult?.closest ? (
                <>
                  <p className="text-5xl font-display font-bold text-primary neon-text">{t('halfHalf.bullseye')}</p>
                  <p className="text-lg">{t('halfHalf.pts', { n: myResult.pointsAwarded })}</p>
                </>
              ) : myResult?.position != null ? (
                <>
                  <p className="text-3xl font-display font-bold text-secondary">{t('halfHalf.pts', { n: myResult.pointsAwarded })}</p>
                  <p className="text-muted-foreground">{t('halfHalf.offBy', { pct: ((myResult.delta ?? 0) * 100).toFixed(1) })}</p>
                </>
              ) : (
                <>
                  <p className="text-3xl font-display font-bold text-muted-foreground">{t('halfHalf.noGuess')}</p>
                  <p className="text-muted-foreground">{t('halfHalf.zeroPts')}</p>
                </>
              )}
            </motion.div>
          )}

          {phase === 'finished' && (
            <motion.div key="done" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center mt-8 space-y-3">
              <p className="text-3xl font-display font-bold neon-text">{t('halfHalf.matchComplete')}</p>
              <p className="text-muted-foreground">{t('halfHalf.finalScore', { n: me?.score ?? 0 })}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="w-full max-w-md flex flex-col gap-3">
        <ReactionBar onReact={onReact} reactionPolicy={reactionPolicy} tauntPolicy={tauntPolicy} onReactionAck={onReactionAck} />
        <Button variant="ghost" size="sm" onClick={onRequestLeave} disabled={!onRequestLeave}>{t('halfHalf.leave')}</Button>
        <SoundControls />
      </div>
    </div>
  );
}
