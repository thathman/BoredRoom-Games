// LogoController — player phone view for Logo Guesser.

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ReactionBar, ReactionAckEvent } from '@/components/game/Reactions';
import { SoundControls } from '@/components/system/SoundControls';
import { vibrate, sounds } from '@/lib/sounds';
import type {
  LogoPrivateState,
  LogoPublicState,
  ReactionPolicy,
  TauntPolicy,
} from '@/lib/transport/types';

interface LogoControllerProps {
  publicState: LogoPublicState;
  privateState: LogoPrivateState | null;
  playerId: string;
  onLockPick: (pickedIndex: 0 | 1 | 2 | 3) => void;
  onLockText: (guess: string) => void;
  onReact: (emoji: string, clientNonce?: string) => void;
  reactionPolicy?: ReactionPolicy;
  tauntPolicy?: TauntPolicy;
  onReactionAck?: (fn: (ack: ReactionAckEvent) => void) => () => void;
  onRequestLeave?: () => void;
  syncPending?: boolean;
}

const OPTION_LABELS = ['A', 'B', 'C', 'D'] as const;

export function LogoController({
  publicState,
  privateState,
  playerId,
  onLockPick,
  onLockText,
  onReact,
  reactionPolicy,
  tauntPolicy,
  onReactionAck,
  onRequestLeave,
  syncPending = false,
}: LogoControllerProps) {
  const { t } = useTranslation();
  const { phase, currentQuestion, settings } = publicState;
  const me = publicState.players.find((p) => p.id === playerId);
  const optionOrder = privateState?.optionOrder ?? null;
  const hasLockedIn = !!privateState?.hasLockedIn;
  const myResult = useMemo(
    () => publicState.lastQuestionResults.find((r) => r.playerId === playerId) ?? null,
    [publicState.lastQuestionResults, playerId],
  );

  const [pendingPick, setPendingPick] = useState<number | null>(null);
  const [textGuess, setTextGuess] = useState('');
  const lastQuestionIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (currentQuestion?.id && currentQuestion.id !== lastQuestionIdRef.current) {
      setPendingPick(null);
      setTextGuess('');
      lastQuestionIdRef.current = currentQuestion.id;
    }
  }, [currentQuestion?.id]);

  const renderedOptions = useMemo(() => {
    if (!currentQuestion?.options) return [];
    const order = optionOrder ?? ([0, 1, 2, 3] as const);
    return order.map((canonicalIdx, shuffledIdx) => ({
      shuffledIdx,
      canonicalIdx,
      text: currentQuestion.options![canonicalIdx],
      label: OPTION_LABELS[shuffledIdx],
    }));
  }, [currentQuestion, optionOrder]);

  const handlePick = (shuffledIdx: number) => {
    if (hasLockedIn || pendingPick != null || syncPending) return;
    if (phase !== 'options') return;
    setPendingPick(shuffledIdx);
    sounds.click();
    vibrate([15, 25, 15]);
    onLockPick(shuffledIdx as 0 | 1 | 2 | 3);
  };

  const handleSubmitText = () => {
    if (hasLockedIn || syncPending) return;
    if (phase !== 'options') return;
    const trimmed = textGuess.trim();
    if (!trimmed) return;
    sounds.click();
    vibrate([15, 25, 15]);
    onLockText(trimmed);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-start p-5 pt-8 gap-5">
      <div className="w-full max-w-md flex items-center justify-between text-xs uppercase tracking-wider text-muted-foreground">
        <span>{me?.displayName ?? t('common.you')}</span>
        <span className="font-display font-bold text-primary text-base">{me?.score ?? 0} pts</span>
        {me && me.streak >= 3 && <span className="text-accent">🔥 {me.streak}</span>}
      </div>

      <div className="w-full max-w-md flex-1 flex flex-col">
        <AnimatePresence mode="wait">
          {phase === 'lobby' && (
            <motion.div key="lobby" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center mt-12 space-y-3">
              <p className="text-3xl font-display font-bold neon-text">{t('logo.getReady')}</p>
              <p className="text-muted-foreground">{t('logo.waitingHostStart')}</p>
            </motion.div>
          )}

          {phase === 'intro' && (
            <motion.div key="intro" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center mt-12 space-y-3">
              <p className="text-sm uppercase tracking-wider text-muted-foreground">{t('logo.round', { n: publicState.round })}</p>
              <p className="text-4xl font-display font-bold neon-text">{t('logo.title')}</p>
              <p className="text-muted-foreground">{t('logo.roundsIncoming', { n: settings.rounds })}</p>
            </motion.div>
          )}

          {phase === 'question' && (
            <motion.div key="q-pre" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center mt-12 space-y-3">
              <p className="text-3xl font-display font-bold neon-text">{t('logo.lookAtScreen')}</p>
              <p className="text-muted-foreground">{t('logo.inputUnlock')}</p>
            </motion.div>
          )}

          {phase === 'options' && currentQuestion && settings.inputMode === 'multiple_choice' && (
            <motion.div
              key={`opt-${currentQuestion.id}`}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-3 mt-2"
            >
              <p className="text-sm text-muted-foreground text-center">
                {hasLockedIn ? t('logo.lockedHold') : t('logo.tapFastest')}
              </p>
              <div className="grid grid-cols-1 gap-3">
                {renderedOptions.map((o) => {
                  const isPending = pendingPick === o.shuffledIdx && !hasLockedIn;
                  const isLocked = hasLockedIn && privateState?.lockedPick === o.shuffledIdx;
                  return (
                    <motion.button
                      key={`${currentQuestion.id}-${o.shuffledIdx}`}
                      type="button"
                      whileTap={hasLockedIn ? undefined : { scale: 0.97 }}
                      disabled={hasLockedIn || syncPending}
                      onClick={() => handlePick(o.shuffledIdx)}
                      className={`w-full min-h-[64px] rounded-2xl px-4 py-3 flex items-center gap-3 text-left font-display border transition-colors ${
                        isLocked
                          ? 'bg-primary text-primary-foreground border-primary neon-box'
                          : isPending
                            ? 'bg-secondary/30 text-foreground border-secondary'
                            : 'bg-card/80 text-foreground border-border active:bg-muted'
                      } disabled:opacity-60`}
                    >
                      <span
                        className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold ${
                          isLocked ? 'bg-primary-foreground text-primary' : 'bg-muted text-foreground'
                        }`}
                      >
                        {o.label}
                      </span>
                      <span className="flex-1 text-base font-bold leading-tight">{o.text}</span>
                    </motion.button>
                  );
                })}
              </div>
            </motion.div>
          )}

          {phase === 'options' && currentQuestion && settings.inputMode === 'free_text' && (
            <motion.div key={`txt-${currentQuestion.id}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 mt-2">
              <p className="text-sm text-muted-foreground text-center">
                {hasLockedIn ? t('logo.lockedHold') : t('logo.typeBrand')}
              </p>
              <Input
                value={hasLockedIn ? (privateState?.lastGuess ?? '') : textGuess}
                onChange={(e) => setTextGuess(e.target.value)}
                placeholder={t('logo.guessPlaceholder') as string}
                disabled={hasLockedIn || syncPending}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSubmitText();
                }}
                autoFocus
                inputMode="text"
                autoCapitalize="words"
                autoCorrect="off"
                spellCheck={false}
                className="h-14 text-lg font-display"
              />
              <Button
                type="button"
                size="lg"
                className="w-full"
                disabled={hasLockedIn || syncPending || !textGuess.trim()}
                onClick={handleSubmitText}
              >
                {hasLockedIn ? t('logo.lockedIn') : t('logo.lockGuess')}
              </Button>
            </motion.div>
          )}

          {phase === 'reveal' && (
            <motion.div key="reveal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center mt-8 space-y-4">
              {myResult?.correct ? (
                <>
                  <p className="text-5xl font-display font-bold text-primary neon-text">{t('logo.correct')}</p>
                  <p className="text-lg">{t('logo.pts', { n: myResult.pointsAwarded })}</p>
                  {myResult.speedRank && (
                    <p className="text-sm text-muted-foreground">{t('logo.fastest', { rank: myResult.speedRank })}</p>
                  )}
                </>
              ) : myResult?.pointsAwarded ? (
                <>
                  <p className="text-3xl font-display font-bold text-secondary">{t('logo.close')}</p>
                  <p className="text-lg">{t('logo.ptsPartial', { n: myResult.pointsAwarded })}</p>
                </>
              ) : privateState?.hasLockedIn ? (
                <>
                  <p className="text-5xl font-display font-bold text-destructive">{t('logo.wrong')}</p>
                  <p className="text-muted-foreground">{t('logo.streakReset')}</p>
                </>
              ) : (
                <>
                  <p className="text-3xl font-display font-bold text-muted-foreground">{t('logo.timesUp')}</p>
                  <p className="text-muted-foreground">{t('logo.noLockIn')}</p>
                </>
              )}
            </motion.div>
          )}

          {phase === 'leaderboard' && (
            <motion.div key="lb" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center mt-8 space-y-3">
              <p className="text-3xl font-display font-bold neon-text">{t('logo.afterRound', { n: publicState.round })}</p>
              <p className="text-muted-foreground">{t('logo.checkHost')}</p>
            </motion.div>
          )}

          {phase === 'finished' && (
            <motion.div key="done" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center mt-8 space-y-3">
              <p className="text-3xl font-display font-bold neon-text">{t('logo.matchComplete')}</p>
              <p className="text-muted-foreground">{t('logo.finalScore', { n: me?.score ?? 0 })}</p>
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
          {t('logo.leave')}
        </Button>
        <SoundControls />
      </div>
    </div>
  );
}
