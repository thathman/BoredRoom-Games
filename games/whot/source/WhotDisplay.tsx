import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import type { WhotPublicState, WhotShape } from '@/lib/transport/types';
import { WhotCardView, WhotCardBack } from '@/components/game/whot/WhotCard';
import { AIStatusChip } from '@/components/game/AIStatusChip';
import type { AIStatus } from '@/lib/realtimeRoom';

interface WhotDisplayProps {
  state: WhotPublicState;
  roomCode: string;
  joinUrl: string;
  commentaryLine?: string | null;
  aiStatus?: AIStatus;
}

const SHAPE_LABEL: Record<WhotShape, string> = {
  circle: 'Circles',
  triangle: 'Triangles',
  cross: 'Crosses',
  square: 'Squares',
  star: 'Stars',
  whot: 'Whot',
};

export function WhotDisplay({ state, roomCode, joinUrl, commentaryLine, aiStatus = 'active' }: WhotDisplayProps) {
  const current = state.players.find((p) => p.id === state.currentPlayerId);
  const [ticker, setTicker] = useState<string[]>([]);
  const [now, setNow] = useState(Date.now());
  const lastActionRef = useRef<string>('');

  useEffect(() => {
    if (!state.lastAction || state.lastAction === lastActionRef.current) return;
    lastActionRef.current = state.lastAction;
    setTicker((prev) => [state.lastAction, ...prev].slice(0, 5));
  }, [state.lastAction]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);

  const secsLeft = Math.max(
    0,
    Math.ceil(((state.turnDeadlineAt ?? now) - now) / 1000),
  );

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[radial-gradient(ellipse_at_top,_hsl(160_60%_10%/0.18),transparent_48%),radial-gradient(ellipse_at_bottom,_hsl(220_60%_10%/0.22),transparent_50%)]">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-5xl space-y-8"
      >
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Now playing</p>
            <h1 className="text-4xl md:text-5xl font-display font-bold neon-text">
              Whot
            </h1>
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
            className="glass rounded-2xl p-4 border border-primary/30 text-center"
          >
            <p className="text-xs uppercase tracking-wider text-primary mb-1">AI Commentary</p>
            <p className="text-xl font-display font-bold neon-text">{commentaryLine}</p>
          </motion.div>
        )}

        <details className="glass rounded-2xl p-4 border border-border/70">
          <summary className="cursor-pointer text-sm font-display font-bold uppercase tracking-wider text-primary">
            How Whot works
          </summary>
          <div className="mt-3 grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
            <p>Match the active shape or top-card value. Whot 20 lets the player call the next shape.</p>
            <p>2 starts pick two. 5 starts pick three. 8 suspends the next player.</p>
            <p>Turn timer: 10 seconds. If time runs out, player goes market.</p>
            <p>Announce LAST CARD when you are down to one card.</p>
            <p>14 (General Market) makes every other player draw one card.</p>
          </div>
        </details>

        <div className="grid md:grid-cols-3 gap-6">
          {/* Discard pile */}
          <div className="glass rounded-2xl p-6 flex flex-col items-center gap-3 border border-primary/20">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Top discard</p>
            {state.topDiscard ? (
              <WhotCardView card={state.topDiscard} size="lg" />
            ) : (
              <div className="w-24 h-36 rounded-lg bg-muted/40" />
            )}
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Active shape</p>
              <p className="text-lg font-display font-bold">{SHAPE_LABEL[state.activeShape]}</p>
            </div>
          </div>

          {/* Turn / status */}
          <div className={`glass rounded-2xl p-6 flex flex-col items-center justify-center gap-4 border ${state.pendingDrawCount ? 'border-destructive/60 bg-destructive/10' : state.mustCallSuit ? 'border-primary/60 bg-primary/10' : 'border-primary/20'}`}>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Current turn</p>
            <p className="text-3xl font-display font-bold neon-text">
              {current?.displayName ?? '—'}
            </p>
            <div className="text-center text-sm text-muted-foreground">
              <div>Turn #{state.turnNumber}</div>
              <div className="mt-1">Time left: {secsLeft}s</div>
              {state.pendingDrawCount ? (
                <div className="mt-2 text-sm px-3 py-1.5 rounded-full bg-destructive/20 text-destructive font-display font-bold">
                  {state.pendingDrawRank
                    ? `Pick penalty: ${state.pendingDrawCount} cards (${state.pendingDrawRank === '2' ? '2-chain' : '5-chain'})`
                    : 'General Market: every other player draws 1'}
                </div>
              ) : null}
              {state.mustCallSuit ? (
                <div className="mt-2 text-xs px-2 py-1 rounded-full bg-primary/20 text-primary">
                  Awaiting suit call
                </div>
              ) : null}
            </div>
          </div>

          {/* Draw pile + QR */}
          <div className="glass rounded-2xl p-6 flex flex-col items-center gap-3 border border-primary/20">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Draw pile</p>
            <div className="relative">
              <WhotCardBack size="lg" />
              <span className="absolute -bottom-2 -right-2 bg-primary text-primary-foreground rounded-full px-2 py-0.5 text-xs font-display font-bold">
                {state.drawPileCount}
              </span>
            </div>
            <div className="bg-card rounded-lg p-2 mt-2">
              <QRCodeSVG value={joinUrl} size={84} bgColor="transparent" fgColor="hsl(160, 100%, 50%)" />
            </div>
          </div>
        </div>

        <div className="glass rounded-2xl p-6 border border-border/60">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-4">Action ticker</p>
          <div className="space-y-2">
            {ticker.length === 0 ? (
              <div className="text-sm text-muted-foreground">Waiting for first move…</div>
            ) : (
              ticker.map((line, idx) => {
                const tone = classifyWhotAction(line);
                return (
                  <motion.div
                    key={`${line}-${idx}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`text-sm rounded-lg px-3 py-2 border ${idx === 0 ? tone.activeClass : tone.restClass}`}
                  >
                    <span className="mr-2 text-[10px] uppercase tracking-wider font-display opacity-80">
                      {tone.label}
                    </span>
                    {line}
                  </motion.div>
                );
              })
            )}
          </div>
        </div>

        {/* Hand counts */}
        <div className="glass rounded-2xl p-6 border border-border/60">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-4">Players</p>
          <div className="flex flex-wrap gap-3">
            {state.players.map((p) => {
              const isCurrent = p.id === state.currentPlayerId;
              return (
                <div
                  key={p.id}
                  className={`flex items-center gap-3 rounded-xl px-4 py-3 transition-all ${
                    isCurrent ? 'bg-primary/15 ring-2 ring-primary' : 'bg-muted/30'
                  }`}
                >
                  <span className="font-display font-bold text-lg">{p.displayName}</span>
                  {p.color && (
                    <span
                      className="w-3 h-3 rounded-full border border-border"
                      style={{ background: colorToHsl(p.color) }}
                    />
                  )}
                  <span className="text-xs px-2 py-0.5 rounded-full bg-card border border-border">
                    {p.handCount} cards
                  </span>
                  {p.isBot && (
                    <span className="text-[10px] uppercase tracking-wider text-secondary">Bot</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground">Whot live engine active.</p>
      </motion.div>
    </div>
  );
}

function classifyWhotAction(line: string): { label: string; activeClass: string; restClass: string } {
  const lower = line.toLowerCase();
  if (lower.includes('last card')) {
    return {
      label: 'Last card',
      activeClass: 'bg-secondary/20 text-foreground border-secondary/50',
      restClass: 'bg-secondary/10 text-muted-foreground border-secondary/25',
    };
  }
  if (lower.includes('general market') || lower.includes('pick') || lower.includes('draw')) {
    return {
      label: 'Penalty',
      activeClass: 'bg-destructive/20 text-foreground border-destructive/50',
      restClass: 'bg-destructive/10 text-muted-foreground border-destructive/25',
    };
  }
  if (lower.includes('call') || lower.includes('shape') || lower.includes('suit')) {
    return {
      label: 'Suit call',
      activeClass: 'bg-primary/15 text-foreground border-primary/40',
      restClass: 'bg-primary/10 text-muted-foreground border-primary/25',
    };
  }
  if (lower.includes('suspend') || lower.includes('skip')) {
    return {
      label: 'Suspension',
      activeClass: 'bg-accent/20 text-foreground border-accent/50',
      restClass: 'bg-accent/10 text-muted-foreground border-accent/25',
    };
  }
  return {
    label: 'Move',
    activeClass: 'bg-muted/35 text-foreground border-border/60',
    restClass: 'bg-muted/25 text-muted-foreground border-border/40',
  };
}

function colorToHsl(color: string): string {
  const map: Record<string, string> = {
    red: 'hsl(0, 80%, 55%)',
    green: 'hsl(140, 70%, 45%)',
    yellow: 'hsl(45, 100%, 55%)',
    blue: 'hsl(210, 80%, 55%)',
  };
  if (color.startsWith('#')) return color;
  return map[color] ?? 'hsl(var(--primary))';
}
