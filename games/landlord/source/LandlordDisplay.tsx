// LandlordDisplay — host big-screen view for Oga Landlord.
// Renders the 40-tile board, ownership color bands, player tokens, dice,
// turn indicator, money rail, and last-action ticker. Card draws and
// purchase prompts are surfaced at the centre.

import { motion, AnimatePresence } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { AIStatusChip } from '@/components/game/AIStatusChip';
import {
  LANDLORD_BOARD,
  GROUP_BAND_CLASS,
  type LandlordTile,
} from '@/lib/landlordBoard';
import type { LandlordPublicState, AIStatus } from '@/lib/transport/types';
import { LandlordTileGlyph, HotelGlyph } from '@/components/game/LandlordTileGlyph';

const SEAT_HEX: Record<string, string> = {
  red: '#ef4444', green: '#22c55e', yellow: '#eab308', blue: '#3b82f6',
};

interface Props {
  state: LandlordPublicState;
  roomCode: string;
  joinUrl: string;
  commentaryLine?: string | null;
  aiStatus?: AIStatus;
}

export function LandlordDisplay({ state, roomCode, joinUrl, commentaryLine, aiStatus = 'active' }: Props) {
  const active = state.players.find((p) => p.id === state.currentPlayerId);
  const pending = state.pendingPurchasePropertyId != null
    ? LANDLORD_BOARD[state.pendingPurchasePropertyId]
    : null;

  // Layout: 11×11 perimeter
  const cellFor = (idx: number): { row: number; col: number } => {
    if (idx === 0) return { row: 11, col: 11 };
    if (idx >= 1 && idx <= 9) return { row: 11, col: 11 - idx };
    if (idx === 10) return { row: 11, col: 1 };
    if (idx >= 11 && idx <= 19) return { row: 11 - (idx - 10), col: 1 };
    if (idx === 20) return { row: 1, col: 1 };
    if (idx >= 21 && idx <= 29) return { row: 1, col: 1 + (idx - 20) };
    if (idx === 30) return { row: 1, col: 11 };
    return { row: 1 + (idx - 30), col: 11 };
  };

  const ownerOf = (tileId: number) => {
    const o = state.ownership.find((x) => x.id === tileId);
    if (!o?.ownerId) return null;
    return state.players.find((p) => p.id === o.ownerId) ?? null;
  };

  return (
    <div className="min-h-screen flex flex-col items-center px-6 py-8 bg-[radial-gradient(ellipse_at_top,_hsl(160_50%_15%/0.5),transparent_60%),radial-gradient(ellipse_at_bottom,_hsl(40_60%_12%/0.5),transparent_60%)]">
      <div className="fixed top-4 right-4 z-30 glass rounded-2xl p-3 flex items-center gap-3 shadow-lg">
        <div className="bg-background/80 rounded-lg p-1.5">
          <QRCodeSVG value={joinUrl} size={64} bgColor="transparent" fgColor="hsl(160, 100%, 50%)" level="M" />
        </div>
        <div className="text-left pr-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground leading-none">Join code</div>
          <div className="font-display font-bold text-2xl tracking-widest neon-text leading-tight">{roomCode}</div>
        </div>
      </div>
      <div className="fixed top-4 left-4 z-30"><AIStatusChip status={aiStatus} /></div>

      <div className="w-full max-w-5xl text-center mb-4 mt-8">
        <div className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Turn {state.turnNumber}</div>
        <h1 className="text-3xl md:text-5xl font-display font-bold neon-text mt-1">
          Oga <span className="text-secondary">Landlord</span>
        </h1>
      </div>

      {/* Board */}
      <div
        className="grid bg-card/40 backdrop-blur rounded-2xl border border-primary/30 p-2 shadow-xl"
        style={{
          gridTemplateColumns: 'repeat(11, minmax(0, 1fr))',
          gridTemplateRows: 'repeat(11, minmax(0, 1fr))',
          width: 'min(82vh, 720px)',
          height: 'min(82vh, 720px)',
          gap: '4px',
        }}
      >
        {LANDLORD_BOARD.map((tile: LandlordTile) => {
          const { row, col } = cellFor(tile.id);
          const isCorner = tile.type === 'corner';
          const tokens = state.players.filter((p) => p.position === tile.id && !p.bankrupt);
          const owner = ownerOf(tile.id);
          const ownership = state.ownership.find((o) => o.id === tile.id);
          const houses = ownership?.houses ?? 0;
          const mortgaged = ownership?.mortgaged ?? false;
          const bandClass = GROUP_BAND_CLASS[tile.group];
          return (
            <div
              key={tile.id}
              style={{ gridRow: row, gridColumn: col }}
              className={`relative rounded-md flex flex-col items-stretch text-[9px] md:text-[10px] leading-tight border overflow-hidden transition-colors ${
                isCorner ? 'bg-primary/10 border-primary/50' : 'bg-background/70 border-border/40'
              } ${tile.id === active?.position ? 'ring-2 ring-secondary' : ''} ${
                owner ? 'shadow-[inset_0_0_0_2px_var(--owner-color)]' : ''
              }`}
              {
                ...(owner ? { style: { gridRow: row, gridColumn: col, ['--owner-color' as never]: SEAT_HEX[owner.color ?? 'red'] } as React.CSSProperties } : {})
              }
            >
              {!isCorner && tile.type === 'property' && (
                <div className={`h-1.5 w-full ${bandClass}`} />
              )}
              <div className="flex-1 flex flex-col items-center justify-center text-center px-1">
                <div className="text-foreground/80 leading-none flex items-center justify-center"><LandlordTileGlyph tile={tile} size={16} /></div>
                <div className="font-display font-bold text-foreground/85 truncate w-full">{tile.name.split(' ')[0]}</div>
                {tile.price > 0 && (
                  <div className="text-[8px] text-muted-foreground">₦{tile.price}</div>
                )}
                {houses > 0 && houses < 5 && (
                  <div className="flex gap-[2px] mt-0.5">
                    {Array.from({ length: houses }).map((_, i) => (
                      <span key={i} className="block w-1.5 h-1.5 rounded-sm bg-primary border border-primary/60" />
                    ))}
                  </div>
                )}
                {houses === 5 && (
                  <div className="mt-0.5 text-foreground/80"><HotelGlyph size={12} /></div>
                )}
              </div>
              {mortgaged && (
                <div className="absolute inset-0 bg-destructive/20 flex items-center justify-center pointer-events-none">
                  <span className="text-[8px] font-bold text-destructive rotate-[-15deg] tracking-widest">MORT</span>
                </div>
              )}
              {tokens.length > 0 && (
                <div className="absolute bottom-0.5 left-0.5 right-0.5 flex flex-wrap gap-[2px]">
                  {tokens.map((t) => (
                    <motion.span
                      key={t.id}
                      layoutId={`token-${t.id}`}
                      className="block w-2.5 h-2.5 rounded-full border border-background"
                      style={{ background: SEAT_HEX[t.color ?? 'red'] ?? '#888' }}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Center: dice + turn + active prompt */}
        <div
          className="flex flex-col items-center justify-center gap-3"
          style={{ gridRow: '2 / span 9', gridColumn: '2 / span 9' }}
        >
          {state.dice ? (
            <div className="flex gap-3">
              {state.dice.map((d, i) => (
                <div key={i} className="w-16 h-16 md:w-20 md:h-20 bg-background border-2 border-primary rounded-xl flex items-center justify-center text-3xl md:text-5xl font-display font-bold neon-text">
                  {d}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-muted-foreground text-sm">Awaiting first roll…</div>
          )}
          <div className="text-center space-y-1">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Active</div>
            <div className="text-2xl md:text-3xl font-display font-bold neon-text" style={{ color: SEAT_HEX[active?.color ?? 'red'] }}>
              {active?.displayName ?? '—'}
            </div>
            {state.rolledDoubles && state.phase === 'rolling' && (
              <div className="text-xs text-secondary">Doubles! Roll again.</div>
            )}
          </div>

          <AnimatePresence mode="wait">
            {pending && (
              <motion.div
                key="buy"
                initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                className="glass rounded-xl px-4 py-2 text-center"
              >
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Buy?</div>
                <div className="font-display font-bold">{pending.name}</div>
                <div className="text-sm text-secondary">₦{pending.price}</div>
              </motion.div>
            )}
            {state.lastCard && state.phase === 'card_drawn' && (
              <motion.div
                key="card"
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className={`glass rounded-xl px-4 py-3 text-center max-w-xs border ${
                  state.lastCard.deck === 'owambe' ? 'border-orange-400/60' : 'border-blue-400/60'
                }`}
              >
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  {state.lastCard.deck === 'owambe' ? 'Owambe' : 'Community Pot'}
                </div>
                <div className="font-display text-sm">{state.lastCard.card.text}</div>
              </motion.div>
            )}
            {state.auction && (
              <motion.div
                key="auction"
                initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                className="glass rounded-xl px-4 py-3 text-center border border-secondary/60"
              >
                <div className="text-xs uppercase tracking-wider text-secondary">🔨 Auction</div>
                <div className="font-display font-bold">
                  {LANDLORD_BOARD[state.auction.propertyId]?.name}
                </div>
                <div className="text-sm">
                  High: {state.auction.highBidderId
                    ? `₦${state.auction.highBid} · ${state.players.find((p) => p.id === state.auction!.highBidderId)?.displayName}`
                    : 'no bids'}
                </div>
                <div className="text-xs text-muted-foreground">
                  On clock: {state.players.find((p) => p.id === state.auction!.currentBidderId)?.displayName}
                </div>
              </motion.div>
            )}
            {state.pendingTrade && (
              <motion.div
                key="trade"
                initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                className="glass rounded-xl px-4 py-2 text-center border border-primary/60"
              >
                <div className="text-xs uppercase tracking-wider text-primary">⇄ Trade pending</div>
                <div className="text-sm">
                  {state.players.find((p) => p.id === state.pendingTrade!.fromId)?.displayName}
                  {' → '}
                  {state.players.find((p) => p.id === state.pendingTrade!.toId)?.displayName}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="text-xs text-muted-foreground italic max-w-md text-center px-3">
            {state.lastAction}
          </div>
        </div>
      </div>

      {/* Player rail */}
      <div className="mt-6 flex flex-wrap gap-3 justify-center">
        {state.players.map((p) => (
          <div
            key={p.id}
            className={`glass rounded-xl px-3 py-2 flex items-center gap-2 ${
              p.id === state.currentPlayerId ? 'border-secondary neon-border' : ''
            } ${p.bankrupt ? 'opacity-40' : ''}`}
          >
            <span className="w-3 h-3 rounded-full" style={{ background: SEAT_HEX[p.color ?? 'red'] }} />
            <span className="font-display font-bold">{p.displayName}</span>
            <span className="text-secondary font-mono text-sm">₦{p.money}</span>
            <span className="text-[10px] text-muted-foreground">{p.propertyIds.length} props</span>
            {p.jailed && <span className="text-xs text-destructive">🔒</span>}
            {p.bankrupt && <span className="text-xs text-destructive">💀</span>}
          </div>
        ))}
      </div>

      {commentaryLine && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 glass rounded-full px-5 py-2 text-sm font-display border border-primary/30"
        >
          {commentaryLine}
        </motion.div>
      )}
    </div>
  );
}
