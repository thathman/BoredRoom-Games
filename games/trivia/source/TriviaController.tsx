// TriviaController — the player's lock-in pad.
// Renders shuffled options (per-seat order from privateState) and confirms a
// pick with a tactile "lock in" affirm. Plays light sound cues that mirror
// the host display.

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ReactionBar, ReactionAckEvent } from '@/components/game/Reactions';
import { SoundControls } from '@/components/system/SoundControls';
import { SpotlightOverlay } from '@/components/system/SpotlightOverlay';
import { vibrate, sounds } from '@/lib/sounds';
import { triviaAudio } from '@/lib/triviaAudio';
import type {
  ReactionPolicy,
  TauntPolicy,
  TriviaPrivateState,
  TriviaPublicState,
} from '@/lib/transport/types';

interface TriviaControllerProps {
  publicState: TriviaPublicState;
  privateState: TriviaPrivateState | null;
  playerId: string;
  onLockAnswer: (pickedIndex: 0 | 1 | 2 | 3) => void;
  onReact: (emoji: string, clientNonce?: string) => void;
  reactionPolicy?: ReactionPolicy;
  tauntPolicy?: TauntPolicy;
  onReactionAck?: (fn: (ack: ReactionAckEvent) => void) => () => void;
  onRequestLeave?: () => void;
  syncPending?: boolean;
}

const OPTION_LABELS = ['A', 'B', 'C', 'D'] as const;

export function TriviaController({
  publicState,
  privateState,
  playerId,
  onLockAnswer,
  onReact,
  reactionPolicy,
  tauntPolicy,
  onReactionAck,
  onRequestLeave,
  syncPending = false,
}: TriviaControllerProps) {
  const { t } = useTranslation();
  const { phase, currentQuestion } = publicState;
  const me = publicState.players.find((p) => p.id === playerId);
  const optionOrder = privateState?.optionOrder ?? null;
  const hasLockedIn = !!privateState?.hasLockedIn;
  const myResult = useMemo(
    () => publicState.lastQuestionResults.find((r) => r.playerId === playerId) ?? null,
    [publicState.lastQuestionResults, playerId],
  );

  const [pendingPick, setPendingPick] = useState<number | null>(null);
  const lastQuestionIdRef = useRef<string | null>(null);
  const firstOptionRef = useRef<HTMLButtonElement>(null);
  const totalQuestionsAnswered = (publicState.players.find((p) => p.id === playerId)?.score ?? 0) +
    publicState.lastQuestionResults.length;

  useEffect(() => {
    if (currentQuestion?.id && currentQuestion.id !== lastQuestionIdRef.current) {
      setPendingPick(null);
      lastQuestionIdRef.current = currentQuestion.id;
    }
  }, [currentQuestion?.id]);

  // Reveal stings on the controller too (lighter than display).
  const lastPhaseRef = useRef<string>('');
  useEffect(() => {
    if (phase === lastPhaseRef.current) return;
    lastPhaseRef.current = phase;
    if (phase === 'reveal' && myResult) {
      if (myResult.correct) {
        triviaAudio.correct();
        vibrate([30, 40, 30, 40, 100]);
      } else if (privateState?.hasLockedIn) {
        triviaAudio.wrong();
        vibrate([200]);
      }
    }
  }, [phase, myResult, privateState?.hasLockedIn]);

  // Map shuffled→canonical option labels using optionOrder.
  // optionOrder[shuffledIndex] = canonicalIndex
  const renderedOptions = useMemo(() => {
    if (!currentQuestion) return [];
    const order = optionOrder ?? ([0, 1, 2, 3] as const);
    return order.map((canonicalIdx, shuffledIdx) => ({
      shuffledIdx,
      canonicalIdx,
      text: currentQuestion.options[canonicalIdx],
      label: OPTION_LABELS[shuffledIdx],
    }));
  }, [currentQuestion, optionOrder]);

  const handlePick = (shuffledIdx: number) => {
    if (hasLockedIn || pendingPick != null || syncPending) return;
    if (phase !== 'options') return;
    setPendingPick(shuffledIdx);
    triviaAudio.lockIn();
    sounds.click();
    vibrate([15, 25, 15]);
    onLockAnswer(shuffledIdx as 0 | 1 | 2 | 3);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-start p-5 pt-8 gap-5">
      {/* Header — score + state */}
      <div className="w-full max-w-md flex items-center justify-between text-xs uppercase tracking-wider text-muted-foreground">
        <span>{me?.displayName ?? t('common.you')}</span>
        <span className="font-display font-bold text-primary text-base">{t('trivia.pts', { n: me?.score ?? 0 })}</span>
        {me && me.streak >= 3 && <span className="text-accent">🔥 {me.streak}</span>}
      </div>

      {/* Phase content */}
      <div className="w-full max-w-md flex-1 flex flex-col">
        <AnimatePresence mode="wait">
          {phase === 'lobby' && (
            <motion.div
              key="lobby"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center mt-12 space-y-3"
            >
              <p className="text-3xl font-display font-bold neon-text">{t('trivia.getReady')}</p>
              <p className="text-muted-foreground">{t('trivia.waitingHostStart')}</p>
            </motion.div>
          )}

          {phase === 'intro' && (
            <motion.div
              key="intro"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center mt-12 space-y-3"
            >
              <p className="text-sm uppercase tracking-wider text-muted-foreground">{t('trivia.round', { n: publicState.round })}</p>
              <p className="text-4xl font-display font-bold neon-text">{prettyCategory(publicState.activeCategory)}</p>
              <p className="text-muted-foreground">{t('trivia.questionsIncoming', { n: publicState.settings.questionsPerRound })}</p>
            </motion.div>
          )}

          {phase === 'question' && (
            <motion.div
              key="q-pre"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center mt-12 space-y-3"
            >
              <p className="text-3xl font-display font-bold neon-text">{t('trivia.readCarefully')}</p>
              <p className="text-muted-foreground">{t('trivia.optionsUnlock')}</p>
            </motion.div>
          )}

          {phase === 'options' && currentQuestion && (
            <motion.div
              key={`opt-${currentQuestion.id}`}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-3 mt-2"
            >
              <p className="text-sm text-muted-foreground text-center">
                {hasLockedIn ? t('trivia.lockedHold') : t('trivia.tapFastest')}
              </p>
              <div className="grid grid-cols-1 gap-3">
                {renderedOptions.map((o) => {
                  const isPending = pendingPick === o.shuffledIdx && !hasLockedIn;
                  const isLocked = hasLockedIn && privateState?.lockedPick === o.shuffledIdx;
                  return (
                    <motion.button
                      ref={o.shuffledIdx === 0 ? (firstOptionRef as React.RefObject<HTMLButtonElement>) : undefined}
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
              <SpotlightOverlay
                storageKey="trivia:first-answer"
                targetRef={firstOptionRef}
                message={t('spotlight.tapToAnswer') as string}
                enabled={!hasLockedIn && totalQuestionsAnswered === 0}
              />
            </motion.div>
          )}

          {phase === 'reveal' && currentQuestion && (
            <motion.div
              key="reveal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center mt-8 space-y-4"
            >
              {myResult?.correct ? (
                <>
                  <p className="text-5xl font-display font-bold text-primary neon-text">{t('trivia.correct')}</p>
                  <p className="text-lg">+{t('trivia.pts', { n: myResult.pointsAwarded })}</p>
                  {myResult.speedRank && (
                    <p className="text-sm text-muted-foreground">
                      {t('trivia.fastest', { rank: myResult.speedRank })}
                    </p>
                  )}
                </>
              ) : privateState?.hasLockedIn ? (
                <>
                  <p className="text-5xl font-display font-bold text-destructive">{t('trivia.wrong')}</p>
                  <p className="text-muted-foreground">{t('trivia.streakReset')}</p>
                </>
              ) : (
                <>
                  <p className="text-3xl font-display font-bold text-muted-foreground">{t('trivia.timesUp')}</p>
                  <p className="text-muted-foreground">{t('trivia.noLockIn')}</p>
                </>
              )}
            </motion.div>
          )}

          {phase === 'leaderboard' && (
            <motion.div
              key="lb"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center mt-8 space-y-3"
            >
              <p className="text-3xl font-display font-bold neon-text">{t('trivia.endOfRound', { n: publicState.round })}</p>
              <p className="text-muted-foreground">{t('trivia.checkHost')}</p>
            </motion.div>
          )}

          {phase === 'finished' && (
            <motion.div
              key="done"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center mt-8 space-y-3"
            >
              <p className="text-3xl font-display font-bold neon-text">{t('trivia.matchComplete')}</p>
              <p className="text-muted-foreground">{t('trivia.finalScore', { n: me?.score ?? 0 })}</p>
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
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" onClick={() => triviaAudio.unlock()}>
            {t('trivia.enableSound')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onRequestLeave} disabled={!onRequestLeave}>
            {t('trivia.leave')}
          </Button>
        </div>
        <SoundControls />
      </div>
    </div>
  );
}

function prettyCategory(c: string | null): string {
  if (!c) return '';
  return c.charAt(0).toUpperCase() + c.slice(1);
}
