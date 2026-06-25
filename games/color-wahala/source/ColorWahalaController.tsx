// ColorWahalaController — player phone view: 6-color tap pad.
// One tap per round. Wrong tap → locked out for the rest of the round.

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ReactionBar, ReactionAckEvent } from '@/components/game/Reactions';
import { SoundControls } from '@/components/system/SoundControls';
import { vibrate, sounds } from '@/lib/sounds';
import {
  COLOR_PALETTE,
  type ColorId,
  type ColorWahalaPrivateState,
  type ColorWahalaPublicState,
  type ReactionPolicy,
  type TauntPolicy,
} from '@/lib/transport/types';

interface Props {
  publicState: ColorWahalaPublicState;
  privateState: ColorWahalaPrivateState | null;
  playerId: string;
  onTap: (colorId: string) => void;
  onReact: (emoji: string, clientNonce?: string) => void;
  reactionPolicy?: ReactionPolicy;
  tauntPolicy?: TauntPolicy;
  onReactionAck?: (fn: (ack: ReactionAckEvent) => void) => () => void;
  onRequestLeave?: () => void;
  syncPending?: boolean;
}

export function ColorWahalaController({
  publicState,
  privateState,
  playerId,
  onTap,
  onReact,
  reactionPolicy,
  tauntPolicy,
  onReactionAck,
  onRequestLeave,
  syncPending = false,
}: Props) {
  const { t } = useTranslation();
  const { phase, currentPrompt, round } = publicState;
  const me = publicState.players.find((p) => p.id === playerId);
  const hasTapped = !!privateState?.hasTapped;
  const lockedOut = !!privateState?.lockedOut;
  const myResult = useMemo(
    () => publicState.lastRoundResults.find((r) => r.playerId === playerId) ?? null,
    [publicState.lastRoundResults, playerId],
  );

  const [pending, setPending] = useState<ColorId | null>(null);
  const lastRoundRef = useRef<number>(-1);
  useEffect(() => {
    if (round !== lastRoundRef.current) {
      setPending(null);
      lastRoundRef.current = round;
    }
  }, [round]);

  const handleTap = (id: ColorId) => {
    if (hasTapped || pending != null || syncPending) return;
    if (phase !== 'answer') return;
    setPending(id);
    sounds.click();
    vibrate([15, 25, 15]);
    onTap(id);
  };

  const modeHint = (mode: 'say_word' | 'say_color' | 'say_heard'): string => {
    if (mode === 'say_word') return t('colorWahala.modeWord') as string;
    if (mode === 'say_color') return t('colorWahala.modeColor') as string;
    return t('colorWahala.modeHeard') as string;
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-start p-4 pt-6 gap-4">
      <div className="w-full max-w-md flex items-center justify-between text-xs uppercase tracking-wider text-muted-foreground">
        <span>{me?.displayName ?? t('common.you')}</span>
        <span className="font-display font-bold text-primary text-base">{me?.score ?? 0} pts</span>
        {me && me.currentStreak >= 2 && <span className="text-accent">🔥 {me.currentStreak}</span>}
      </div>

      <div className="w-full max-w-md flex-1 flex flex-col">
        <AnimatePresence mode="wait">
          {phase === 'lobby' && (
            <motion.div key="lobby" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center mt-12 space-y-3">
              <p className="text-3xl font-display font-bold neon-text">{t('colorWahala.getReady')}</p>
              <p className="text-muted-foreground">{t('colorWahala.waitingHostStart')}</p>
            </motion.div>
          )}

          {phase === 'intro' && (
            <motion.div key="intro" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center mt-12 space-y-3">
              <p className="text-4xl font-display font-bold neon-text">{t('colorWahala.title')}</p>
              <p className="text-muted-foreground">{t('colorWahala.intro')}</p>
            </motion.div>
          )}

          {phase === 'prompt' && (
            <motion.div key="prompt" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center mt-12 space-y-3">
              <p className="text-3xl font-display font-bold neon-text">{t('colorWahala.lookAtScreen')}</p>
              <p className="text-muted-foreground">{t('colorWahala.padUnlock')}</p>
            </motion.div>
          )}

          {phase === 'answer' && currentPrompt && (
            <motion.div
              key={`tap-${round}`}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-3 mt-2"
            >
              <p className="text-sm text-muted-foreground text-center">
                {lockedOut
                  ? t('colorWahala.lockedOut')
                  : hasTapped
                    ? t('colorWahala.lockedHold')
                    : modeHint(currentPrompt.mode)}
              </p>
              <ColorPad
                disabled={hasTapped || lockedOut || syncPending}
                pending={pending}
                lockedColor={privateState?.tappedColor ?? null}
                onTap={handleTap}
              />
            </motion.div>
          )}

          {phase === 'reveal' && (
            <motion.div key="reveal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center mt-8 space-y-4">
              {myResult?.correct ? (
                <>
                  <p className="text-5xl font-display font-bold text-primary neon-text">{t('colorWahala.correct')}</p>
                  <p className="text-lg">{t('colorWahala.pts', { n: myResult.pointsAwarded })}</p>
                  {myResult.speedRank && (
                    <p className="text-sm text-muted-foreground">{t('colorWahala.fastest', { rank: myResult.speedRank })}</p>
                  )}
                </>
              ) : myResult && myResult.lockedOut ? (
                <>
                  <p className="text-5xl font-display font-bold text-destructive">{t('colorWahala.wrong')}</p>
                  <p className="text-muted-foreground">{t('colorWahala.streakReset')}</p>
                </>
              ) : (
                <>
                  <p className="text-3xl font-display font-bold text-muted-foreground">{t('colorWahala.timesUp')}</p>
                  <p className="text-muted-foreground">{t('colorWahala.noTap')}</p>
                </>
              )}
            </motion.div>
          )}

          {phase === 'finished' && (
            <motion.div key="done" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center mt-8 space-y-3">
              <p className="text-3xl font-display font-bold neon-text">{t('colorWahala.matchComplete')}</p>
              <p className="text-muted-foreground">{t('colorWahala.finalScore', { n: me?.score ?? 0 })}</p>
              {me && me.bestStreak >= 3 && (
                <p className="text-accent">{t('colorWahala.bestStreak', { n: me.bestStreak })}</p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="w-full max-w-md flex flex-col gap-3">
        <ReactionBar
          onReact={onReact}
          reactionPolicy={reactionPolicy}
          tauntPolicy={tauntPolicy}
          onReactionAck={onReactionAck}
        />
        <Button variant="ghost" size="sm" onClick={onRequestLeave} disabled={!onRequestLeave}>
          {t('colorWahala.leave')}
        </Button>
        <SoundControls />
      </div>
    </div>
  );
}

function ColorPad({
  disabled,
  pending,
  lockedColor,
  onTap,
}: {
  disabled: boolean;
  pending: ColorId | null;
  lockedColor: ColorId | null;
  onTap: (id: ColorId) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {COLOR_PALETTE.map((c) => {
        const isPending = pending === c.id;
        const isLocked = lockedColor === c.id;
        return (
          <motion.button
            key={c.id}
            type="button"
            whileTap={disabled ? undefined : { scale: 0.94 }}
            disabled={disabled}
            onClick={() => onTap(c.id)}
            className={`min-h-[110px] rounded-2xl flex flex-col items-center justify-center font-display font-black text-xl tracking-widest border-2 transition-all ${
              isLocked
                ? 'ring-4 ring-primary'
                : isPending
                  ? 'opacity-80'
                  : ''
            } disabled:opacity-50`}
            style={{
              background: `hsl(${c.hsl})`,
              color: `hsl(${c.textHsl})`,
              borderColor: `hsl(${c.hsl})`,
              boxShadow: `0 8px 28px -10px hsl(${c.hsl} / 0.6)`,
            }}
          >
            {c.word}
          </motion.button>
        );
      })}
    </div>
  );
}
