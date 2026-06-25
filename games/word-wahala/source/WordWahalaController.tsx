import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { sounds, vibrate } from '@/lib/sounds';
import { WahalaTile } from '@/components/game/WahalaTile';
import { AccessibleModal } from '@/components/ui/AccessibleModal';
import type {
  WordWahalaPlacementIntent,
  WordWahalaPrivateState,
  WordWahalaPublicState,
} from '@/lib/transport/types';
import type { TileLetter } from '../../../shared/src/games/wordwahala/tiles';

interface WordWahalaControllerProps {
  publicState: WordWahalaPublicState;
  privateState: WordWahalaPrivateState | null;
  playerId: string;
  onPlay: (placements: WordWahalaPlacementIntent[]) => void;
  onPass: () => void;
  onSwap: (letters: string[]) => void;
  syncPending?: boolean;
}

interface PendingPlacement extends WordWahalaPlacementIntent {
  /** Index into the rack array, so we can return tiles cleanly. */
  rackIndex: number;
}

const SEAT_TOKEN_BG: Record<string, string> = {
  emerald: 'bg-gradient-to-br from-emerald-300 to-emerald-600',
  amber: 'bg-gradient-to-br from-amber-300 to-amber-600',
  rose: 'bg-gradient-to-br from-rose-300 to-rose-600',
  sky: 'bg-gradient-to-br from-sky-300 to-sky-600',
};

const tokenStyle = (color?: string) =>
  SEAT_TOKEN_BG[color ?? 'emerald'] ?? SEAT_TOKEN_BG.emerald;

const BONUS_BG: Record<string, string> = {
  none: 'bg-background/40',
  dl: 'bg-sky-500/30',
  tl: 'bg-blue-600/40',
  dw: 'bg-rose-500/30',
  tw: 'bg-rose-700/45',
  star: 'bg-rose-500/40',
};

function tileGlyph(letter: string): string {
  return letter.toUpperCase();
}

export function WordWahalaController({
  publicState,
  privateState,
  playerId,
  onPlay,
  onPass,
  onSwap,
  syncPending,
}: WordWahalaControllerProps) {
  const { t } = useTranslation();
  const me = publicState.players.find((p) => p.id === playerId);
  const isMyTurn =
    publicState.players[publicState.currentPlayerIndex]?.id === playerId &&
    publicState.phase !== 'finished';
  const currentName =
    publicState.players[publicState.currentPlayerIndex]?.displayName ?? '…';

  const rack = privateState?.rack ?? [];
  const rackKey = rack.join(',');

  const [selectedRackIdx, setSelectedRackIdx] = useState<number | null>(null);
  const [pending, setPending] = useState<PendingPlacement[]>([]);
  const [wildPrompt, setWildPrompt] = useState<{
    rackIndex: number;
    row: number;
    col: number;
  } | null>(null);
  const [wildInput, setWildInput] = useState('');
  const [swapOpen, setSwapOpen] = useState(false);
  const [swapPicks, setSwapPicks] = useState<Set<number>>(new Set());

  // Live countdown for the turn timer (Yarn Battle).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (publicState.turnEndsAt == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [publicState.turnEndsAt]);
  const remainingSec = publicState.turnEndsAt
    ? Math.max(0, Math.ceil((publicState.turnEndsAt - now) / 1000))
    : null;
  const timerTotal = publicState.settings?.turnTimerSec ?? 0;
  const timerPct =
    timerTotal > 0 && publicState.turnEndsAt
      ? Math.max(0, Math.min(100, ((publicState.turnEndsAt - now) / (timerTotal * 1000)) * 100))
      : 0;

  // Reset pending placements whenever turn advances or rack changes.
  useEffect(() => {
    setPending([]);
    setSelectedRackIdx(null);
    setSwapPicks(new Set());
    setSwapOpen(false);
  }, [publicState.turnNumber, rackKey]);

  const occupiedByPending = useMemo(() => {
    const map = new Map<string, PendingPlacement>();
    for (const p of pending) map.set(`${p.row}:${p.col}`, p);
    return map;
  }, [pending]);

  const usedRackIndices = useMemo(
    () => new Set(pending.map((p) => p.rackIndex)),
    [pending],
  );

  const handleSquareTap = (row: number, col: number) => {
    if (!isMyTurn) {
      toast(t('wordWahala.waitingFor', { name: currentName }) as string);
      return;
    }
    const existingPending = occupiedByPending.get(`${row}:${col}`);
    if (existingPending) {
      setPending(pending.filter((p) => !(p.row === row && p.col === col)));
      return;
    }
    if (publicState.board[row][col] !== null) {
      toast(t('wordWahala.squareFilled') as string);
      return;
    }
    if (selectedRackIdx == null) {
      toast(t('wordWahala.pickTileFirst') as string);
      return;
    }
    const letter = rack[selectedRackIdx];
    if (!letter) return;
    if (letter === '*p') {
      setWildPrompt({ rackIndex: selectedRackIdx, row, col });
      setWildInput('');
      return;
    }
    setPending([...pending, { rackIndex: selectedRackIdx, row, col, letter }]);
    setSelectedRackIdx(null);
    sounds.wahalaTilePlace();
  };

  const confirmWild = () => {
    if (!wildPrompt) return;
    const ch = wildInput.trim().toLowerCase();
    if (!/^[a-z]$/.test(ch)) {
      toast(t('wordWahala.pickLetter') as string);
      return;
    }
    setPending([
      ...pending,
      {
        rackIndex: wildPrompt.rackIndex,
        row: wildPrompt.row,
        col: wildPrompt.col,
        letter: '*p',
        wildAs: ch,
      },
    ]);
    setSelectedRackIdx(null);
    setWildPrompt(null);
    sounds.wahalaTilePlace();
  };

  const handleSubmit = () => {
    if (pending.length === 0) {
      toast(t('wordWahala.placeAtLeastOne') as string);
      return;
    }
    sounds.wahalaSubmit();
    vibrate(15);
    onPlay(pending.map(({ rackIndex: _i, ...p }) => p));
  };

  const handleClear = () => {
    setPending([]);
    setSelectedRackIdx(null);
  };

  const handlePass = () => {
    if (!isMyTurn) {
      toast(t('wordWahala.waitingFor', { name: currentName }) as string);
      return;
    }
    if (pending.length > 0) {
      toast(t('wordWahala.clearBeforePass') as string);
      return;
    }
    onPass();
  };

  const toggleSwapPick = (idx: number) => {
    const next = new Set(swapPicks);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    setSwapPicks(next);
  };

  const handleConfirmSwap = () => {
    if (!isMyTurn) {
      toast(t('wordWahala.waitingFor', { name: currentName }) as string);
      return;
    }
    if (swapPicks.size === 0) {
      toast(t('wordWahala.pickTilesToSwap') as string);
      return;
    }
    if (publicState.bagSize < swapPicks.size) {
      toast(t('wordWahala.bagTooLow', { n: publicState.bagSize }) as string);
      return;
    }
    const letters = Array.from(swapPicks).map((i) => rack[i]).filter(Boolean);
    sounds.wahalaSwap();
    onSwap(letters);
    setSwapPicks(new Set());
    setSwapOpen(false);
  };

  // Banner reactions (reject buzz, win cheer, timeout warn)
  const lastBannerKey = useRef<string | null>(null);
  useEffect(() => {
    const b = publicState.lastBanner;
    if (!b) return;
    const key = `${b.kind}-${publicState.turnNumber}-${b.actorId}`;
    if (lastBannerKey.current === key) return;
    lastBannerKey.current = key;
    if (b.kind === 'reject') sounds.wahalaReject();
    else if (b.kind === 'win') sounds.win();
    else if (b.kind === 'timeout') sounds.timerWarn();
  }, [publicState.lastBanner, publicState.turnNumber]);

  // Last-5s tick
  const lastWarnSec = useRef<number | null>(null);
  useEffect(() => {
    if (remainingSec == null) return;
    if (!isMyTurn) return;
    if (remainingSec <= 5 && remainingSec > 0 && lastWarnSec.current !== remainingSec) {
      lastWarnSec.current = remainingSec;
      sounds.timerWarn();
    }
    if (remainingSec > 5) lastWarnSec.current = null;
  }, [remainingSec, isMyTurn]);

  if (!me) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="glass max-w-sm rounded-2xl p-6 text-center space-y-3">
          <h2 className="font-display text-xl font-bold">{t('wordWahala.joining')}</h2>
          <p className="text-sm text-muted-foreground">{t('wordWahala.joiningBody')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-stretch p-3 gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`h-11 w-11 rounded-full shadow-lg ${tokenStyle(me.color)}`} />
          <div>
            <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{t('wordWahala.you')}</p>
            <p className="font-display text-base font-bold leading-tight">{me.displayName}</p>
            <p className="text-xs text-muted-foreground">{t('wordWahala.score', { n: me.score })}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{t('wordWahala.turn')}</p>
          <p className={`font-display text-base font-bold ${isMyTurn ? 'text-primary' : ''}`}>
            {isMyTurn ? t('wordWahala.yourMove') : currentName}
          </p>
          <p className="text-xs text-muted-foreground">{t('wordWahala.bag', { n: publicState.bagSize })}</p>
        </div>
      </div>

      <motion.div
        key={publicState.lastAction}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass rounded-xl px-3 py-2 text-xs text-foreground/80 text-center"
      >
        {publicState.lastAction}
      </motion.div>

      {/* Yarn Battle countdown */}
      {remainingSec != null && timerTotal > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
            <span>{publicState.settings?.mode === 'yarn_battle' ? t('wordWahala.yarnBattle') : t('wordWahala.turnTimer')}</span>
            <span className={remainingSec <= 5 ? 'text-rose-400 font-bold' : ''}>
              {remainingSec}s
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-background/40 overflow-hidden">
            <div
              className={`h-full transition-all ${remainingSec <= 5 ? 'bg-rose-500' : 'bg-primary'}`}
              style={{ width: `${timerPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Mini-board (taps for placement) */}
      <div className="glass rounded-2xl border border-border/40 p-2 bg-gradient-to-br from-emerald-900/20 via-amber-900/10 to-rose-900/20">
        <div
          className="grid gap-[1px]"
          style={{
            gridTemplateColumns: 'repeat(15, minmax(0, 1fr))',
            aspectRatio: '1 / 1',
          }}
        >
          {publicState.board.flatMap((row, r) =>
            row.map((cell, c) => {
              const bonus = publicState.bonusMap[r][c];
              const pendingHere = occupiedByPending.get(`${r}:${c}`);
              const isFilled = cell !== null;
              const isPending = !!pendingHere;
              return (
                <button
                  key={`${r}-${c}`}
                  type="button"
                  onClick={() => handleSquareTap(r, c)}
                  disabled={syncPending || publicState.phase === 'finished' || (isFilled && !isPending)}
                  aria-label={
                    isFilled
                      ? `Filled, ${cell.wildAs ? cell.wildAs.toUpperCase() : tileGlyph(cell.letter)}`
                      : isPending
                        ? `Pending tile ${(pendingHere.wildAs ?? pendingHere.letter).toUpperCase()} at row ${r + 1} col ${c + 1}`
                        : `Empty square row ${r + 1} col ${c + 1}${bonus !== 'none' ? `, ${bonus} bonus` : ''}`
                  }
                  className={`relative rounded-[2px] flex items-center justify-center
                    text-[8px] sm:text-[10px] font-display font-bold transition
                    ${!isFilled && !isPending ? `${BONUS_BG[bonus] ?? BONUS_BG.none} hover:ring-1 hover:ring-primary/50` : ''}
                  `}
                >
                  {isFilled ? (
                    <WahalaTile letter={cell.letter as TileLetter} wildAs={cell.wildAs} size={20} variant="placed" />
                  ) : isPending ? (
                    <WahalaTile letter={pendingHere.letter as TileLetter} wildAs={pendingHere.wildAs} size={20} variant="pending" />
                  ) : bonus === 'star' ? (
                    <span className="opacity-70">★</span>
                  ) : null}
                </button>
              );
            }),
          )}
        </div>
      </div>

      {/* Rack */}
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Your rack</p>
        <div className="flex gap-1.5 overflow-x-auto py-1">
          {rack.length === 0 && (
            <p className="text-xs text-muted-foreground">Rack is empty.</p>
          )}
          {rack.map((letter, idx) => {
            const used = usedRackIndices.has(idx);
            const selected = selectedRackIdx === idx;
            return (
              <WahalaTile
                key={`${letter}-${idx}`}
                letter={letter as TileLetter}
                size={48}
                variant="rack"
                selected={selected}
                disabled={used || syncPending || !isMyTurn}
                onClick={() => {
                  if (used) return;
                  setSelectedRackIdx(selected ? null : idx);
                }}
                ariaLabel={`Rack tile ${idx + 1} of ${rack.length}, ${letter === '*p' ? 'wildcard' : letter.toUpperCase()}${selected ? ', selected' : ''}`}
              />
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          onClick={handleSubmit}
          disabled={!isMyTurn || pending.length === 0 || syncPending}
          className="flex-1"
        >
          Submit ({pending.length})
        </Button>
        <Button
          variant="outline"
          onClick={handleClear}
          disabled={pending.length === 0 || syncPending}
        >
          Clear
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            if (!isMyTurn) return toast(`Waiting for ${currentName}`);
            if (pending.length > 0) return toast('Clear placements first.');
            if (publicState.bagSize < 1) return toast('Bag is empty — can\'t swap.');
            setSwapPicks(new Set());
            setSwapOpen(true);
          }}
          disabled={!isMyTurn || syncPending || rack.length === 0}
        >
          Swap
        </Button>
        <Button variant="ghost" onClick={handlePass} disabled={!isMyTurn || syncPending}>
          Pass
        </Button>
      </div>

      {/* Wild prompt — accessible modal with focus trap + Esc-to-close */}
      <AccessibleModal
        open={!!wildPrompt}
        onClose={() => setWildPrompt(null)}
        title="Wildcard letter"
      >
        <p className="text-xs text-center text-muted-foreground">
          Pidgin wild — only scores in pidgin / slang / indigenous tier.
        </p>
        <Input
          autoFocus
          maxLength={1}
          value={wildInput}
          onChange={(e) => setWildInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') confirmWild(); }}
          placeholder="a–z"
          aria-label="Choose a letter from a to z"
          className="text-center text-2xl font-display"
        />
        <div className="flex gap-2">
          <Button onClick={confirmWild} className="flex-1">Place</Button>
          <Button variant="ghost" onClick={() => setWildPrompt(null)}>Cancel</Button>
        </div>
      </AccessibleModal>

      {/* Swap dialog — accessible modal */}
      <AccessibleModal
        open={swapOpen}
        onClose={() => setSwapOpen(false)}
        title="Swap tiles"
      >
        <p className="text-xs text-center text-muted-foreground">
          Pick tiles to return. Bag has {publicState.bagSize}. You'll lose your turn.
        </p>
        <div role="group" aria-label="Tiles to swap" className="flex flex-wrap gap-1.5 justify-center">
          {rack.map((letter, idx) => {
            const picked = swapPicks.has(idx);
            return (
              <WahalaTile
                key={`swap-${idx}`}
                letter={letter as TileLetter}
                size={48}
                variant={picked ? 'swap-pick' : 'rack'}
                onClick={() => toggleSwapPick(idx)}
                ariaLabel={`Swap-pick tile ${(letter === '*p' ? 'wildcard' : letter.toUpperCase())}, ${picked ? 'selected' : 'not selected'}`}
              />
            );
          })}
        </div>
        <div className="flex gap-2">
          <Button onClick={handleConfirmSwap} className="flex-1" disabled={swapPicks.size === 0}>
            Swap ({swapPicks.size})
          </Button>
          <Button variant="ghost" onClick={() => setSwapOpen(false)}>Cancel</Button>
        </div>
      </AccessibleModal>

      {publicState.phase === 'finished' && (
        <div className="glass rounded-xl border border-border/40 p-3 text-center">
          {publicState.winnerId === playerId ? (
            <p className="font-display text-xl font-bold text-primary">You won! 🎉</p>
          ) : (
            <p className="font-display text-lg font-bold">
              {publicState.players.find((p) => p.id === publicState.winnerId)?.displayName ?? 'Someone'} won.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
