// LandlordController — phone view for Oga Landlord.
// Surfaces phase-specific actions for the active player:
//   rolling           → Roll Dice (+ jail Pay/Use Card if jailed)
//   awaiting_buy      → Buy / Pass
//   card_drawn        → OK (acknowledge)
//   turn_end          → End Turn
// On rolling/turn_end/awaiting_buy, the active player can also manage their
// portfolio (build/sell houses, mortgage/unmortgage). Other players see a
// "waiting on X" view + reactions.

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ReactionBar, ReactionAckEvent } from '@/components/game/Reactions';
import { SoundControls } from '@/components/system/SoundControls';
import { SpotlightOverlay } from '@/components/system/SpotlightOverlay';
import { sounds, vibrate } from '@/lib/sounds';
import { LANDLORD_BOARD, GROUP_BAND_CLASS } from '@/lib/landlordBoard';
import { LandlordTileGlyph } from '@/components/game/LandlordTileGlyph';
import type { LandlordPublicState, ReactionPolicy, TauntPolicy } from '@/lib/transport/types';

interface TradeOfferInput {
  toId: string;
  cashFromOfferer: number;
  offererPropertyIds: number[];
  targetPropertyIds: number[];
  offererJailCards: number;
  targetJailCards: number;
}

interface Props {
  state: LandlordPublicState;
  playerId: string;
  onRoll: () => void;
  onBuy: () => void;
  onDecline: () => void;
  onAckCard: () => void;
  onPayJailFine: () => void;
  onUseJailCard: () => void;
  onEndTurn: () => void;
  onBuild: (propertyId: number) => void;
  onSellHouse: (propertyId: number) => void;
  onMortgage: (propertyId: number) => void;
  onUnmortgage: (propertyId: number) => void;
  onBid: (amount: number) => void;
  onBidPass: () => void;
  onProposeTrade: (offer: TradeOfferInput) => void;
  onCancelTrade: () => void;
  onRespondTrade: (accept: boolean) => void;
  onReact: (emoji: string, clientNonce?: string) => void;
  reactionPolicy?: ReactionPolicy;
  tauntPolicy?: TauntPolicy;
  onReactionAck?: (fn: (ack: ReactionAckEvent) => void) => () => void;
  onRequestLeave?: () => void;
  syncPending?: boolean;
}

export function LandlordController({
  state, playerId,
  onRoll, onBuy, onDecline, onAckCard, onPayJailFine, onUseJailCard, onEndTurn,
  onBuild, onSellHouse, onMortgage, onUnmortgage,
  onBid, onBidPass, onProposeTrade, onCancelTrade, onRespondTrade,
  onReact, reactionPolicy, tauntPolicy, onReactionAck, onRequestLeave, syncPending = false,
}: Props) {
  const { t } = useTranslation();
  const rollBtnRef = useRef<HTMLButtonElement>(null);
  const buyBtnRef = useRef<HTMLButtonElement>(null);
  const me = state.players.find((p) => p.id === playerId);
  const isMyTurn = state.currentPlayerId === playerId;
  const tile = me ? LANDLORD_BOARD[me.position] : null;
  const pending = state.pendingPurchasePropertyId != null ? LANDLORD_BOARD[state.pendingPurchasePropertyId] : null;
  const canRoll = isMyTurn && state.phase === 'rolling' && !syncPending;
  const canBuy = isMyTurn && state.phase === 'awaiting_buy' && !syncPending && !!me && !!pending && me.money >= pending.price;
  const canDecline = isMyTurn && state.phase === 'awaiting_buy' && !syncPending;
  const canAck = isMyTurn && state.phase === 'card_drawn' && !syncPending;
  const canEnd = isMyTurn && state.phase === 'turn_end' && !syncPending;
  const canPayFine = canRoll && !!me?.jailed && (me?.money ?? 0) >= 50;
  const canUseCard = canRoll && !!me?.jailed && (me?.getOutOfJailCards ?? 0) > 0;
  const canManage = isMyTurn && !syncPending && (state.phase === 'rolling' || state.phase === 'turn_end' || state.phase === 'awaiting_buy');

  const [showPortfolio, setShowPortfolio] = useState(false);
  const [showTradeBuilder, setShowTradeBuilder] = useState(false);
  const [bidAmount, setBidAmount] = useState<number>(0);

  // Trade builder state
  const otherPlayers = state.players.filter((p) => p.id !== playerId && !p.bankrupt);
  const [tradeTargetId, setTradeTargetId] = useState<string>(otherPlayers[0]?.id ?? '');
  const [tradeCash, setTradeCash] = useState<number>(0);
  const [tradeMyProps, setTradeMyProps] = useState<Set<number>>(new Set());
  const [tradeTheirProps, setTradeTheirProps] = useState<Set<number>>(new Set());
  const [tradeMyJail, setTradeMyJail] = useState<number>(0);
  const [tradeTheirJail, setTradeTheirJail] = useState<number>(0);

  const click = (fn: () => void) => () => {
    sounds.click();
    vibrate([10, 20, 10]);
    fn();
  };



  const myProps = (me?.propertyIds ?? [])
    .map((id) => ({ tile: LANDLORD_BOARD[id], own: state.ownership.find((o) => o.id === id) }))
    .filter((x) => x.tile && x.own);

  // ── Auction context ────────────────────────────────────────────────────
  const auction = state.auction;
  const auctionTile = auction ? LANDLORD_BOARD[auction.propertyId] : null;
  const isMyBid = !!auction && auction.currentBidderId === playerId;
  useEffect(() => {
    if (auction) setBidAmount(auction.minBid);
  }, [auction]);
  const canPlaceBid = isMyBid && !syncPending && !!me && bidAmount >= (auction?.minBid ?? 0) && me.money >= bidAmount;

  // ── Trade context ──────────────────────────────────────────────────────
  const trade = state.pendingTrade;
  const tradeTarget = trade ? state.players.find((p) => p.id === trade.toId) : null;
  const tradeFrom = trade ? state.players.find((p) => p.id === trade.fromId) : null;
  const incomingTrade = !!trade && trade.toId === playerId;
  const outgoingTrade = !!trade && trade.fromId === playerId;
  const canStartTrade = isMyTurn && !syncPending && !trade && (state.phase === 'rolling' || state.phase === 'turn_end' || state.phase === 'awaiting_buy') && otherPlayers.length > 0;

  const targetPlayer = state.players.find((p) => p.id === tradeTargetId);
  const targetProps = (targetPlayer?.propertyIds ?? [])
    .map((id) => ({ tile: LANDLORD_BOARD[id], own: state.ownership.find((o) => o.id === id) }))
    .filter((x) => x.tile && x.own && x.own!.houses === 0);
  const myTradableProps = myProps.filter((x) => x.own!.houses === 0);

  const submitTrade = () => {
    if (!tradeTargetId) return;
    onProposeTrade({
      toId: tradeTargetId,
      cashFromOfferer: tradeCash,
      offererPropertyIds: Array.from(tradeMyProps),
      targetPropertyIds: Array.from(tradeTheirProps),
      offererJailCards: tradeMyJail,
      targetJailCards: tradeTheirJail,
    });
    setShowTradeBuilder(false);
    setTradeMyProps(new Set());
    setTradeTheirProps(new Set());
    setTradeCash(0);
    setTradeMyJail(0);
    setTradeTheirJail(0);
  };

  const renderTradeLine = (label: string, p: { propertyIds: number[]; getOutOfJailCards: number }, propIds: number[], jailCards: number, cash: number) => {
    const propNames = propIds.map((id) => LANDLORD_BOARD[id]?.name).filter(Boolean);
    return (
      <div className="text-xs">
        <span className="text-muted-foreground uppercase tracking-wider">{label}: </span>
        {cash !== 0 && <span className="text-secondary">₦{cash} </span>}
        {propNames.length > 0 && <span>{propNames.join(', ')} </span>}
        {jailCards > 0 && <span>+ {jailCards} jail card</span>}
        {cash === 0 && propNames.length === 0 && jailCards === 0 && <span className="text-muted-foreground">nothing</span>}
      </div>
    );
  };
  void renderTradeLine; void tradeFrom; void tradeTarget; void useMemo;

  // ── SFX hooks (one cue per event change) ───────────────────────────────
  const lastAuctionKey = useRef<string | null>(null);
  useEffect(() => {
    if (!auction) { lastAuctionKey.current = null; return; }
    const key = `${auction.propertyId}:${auction.highBid}:${auction.currentBidderId}`;
    if (lastAuctionKey.current !== key) {
      lastAuctionKey.current = key;
      sounds.landlordAuction();
    }
  }, [auction]);

  const lastTradeKey = useRef<string | null>(null);
  useEffect(() => {
    if (!trade) { lastTradeKey.current = null; return; }
    const key = `${trade.fromId}->${trade.toId}:${trade.cashFromOfferer}`;
    if (lastTradeKey.current !== key && trade.toId === playerId) {
      lastTradeKey.current = key;
      sounds.landlordTradeAccept();
    }
  }, [trade, playerId]);

  const lastDiceKey = useRef<string | null>(null);
  useEffect(() => {
    if (!state.dice) { lastDiceKey.current = null; return; }
    const key = `${state.turnNumber}:${state.dice.join(',')}`;
    if (lastDiceKey.current !== key) {
      lastDiceKey.current = key;
      sounds.landlordRoll();
    }
  }, [state.dice, state.turnNumber]);


  return (
    <div className="min-h-screen flex flex-col items-center justify-start p-5 pt-8 gap-5">
      <div className="w-full max-w-md flex items-center justify-between text-xs uppercase tracking-wider text-muted-foreground">
        <span>{me?.displayName ?? 'You'}</span>
        <span className="text-secondary font-mono text-base">₦{me?.money ?? 0}</span>
        <span>Turn {state.turnNumber}</span>
      </div>

      {me?.jailed && (
        <div className="w-full max-w-md glass rounded-xl p-3 text-center border border-destructive/40">
          <div className="text-destructive font-display font-bold">🔒 In Kirikiri</div>
          <div className="text-xs text-muted-foreground">Roll doubles, pay ₦50, or use a card.</div>
        </div>
      )}

      {/* ── Auction banner (visible to all eligible bidders) ── */}
      {auction && auctionTile && (
        <div className="w-full max-w-md glass rounded-xl p-3 space-y-2 border border-secondary/60">
          <div className="flex items-center justify-between text-xs uppercase tracking-wider">
            <span className="text-secondary">🔨 Auction</span>
            <span className="text-muted-foreground">min ₦{auction.minBid}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`h-3 w-1 rounded ${GROUP_BAND_CLASS[auctionTile.group]}`} />
            <span className="text-secondary"><LandlordTileGlyph tile={auctionTile} size={20} /></span>
            <span className="font-display font-bold flex-1 truncate">{auctionTile.name}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            High bid: {auction.highBidderId
              ? `₦${auction.highBid} by ${state.players.find((p) => p.id === auction.highBidderId)?.displayName ?? '—'}`
              : 'no bids yet'}
          </div>
          <div className="text-xs">
            On the clock: <span className="text-secondary">{state.players.find((p) => p.id === auction.currentBidderId)?.displayName ?? '—'}</span>
          </div>
          {isMyBid && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Bid ₦</span>
                <input
                  type="number"
                  min={auction.minBid}
                  step={10}
                  value={bidAmount}
                  onChange={(e) => setBidAmount(Math.max(0, parseInt(e.target.value || '0', 10)))}
                  className="flex-1 bg-background border border-border rounded px-2 py-1 text-sm font-mono"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" onClick={click(() => onBid(bidAmount))} disabled={!canPlaceBid}>
                  Bid ₦{bidAmount}
                </Button>
                <Button size="sm" variant="ghost" onClick={click(onBidPass)}>Pass</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Incoming trade banner ── */}
      {incomingTrade && trade && (
        <div className="w-full max-w-md glass rounded-xl p-3 space-y-2 border border-primary/60">
          <div className="text-xs uppercase tracking-wider text-primary">
            ⇄ Trade offer from {state.players.find((p) => p.id === trade.fromId)?.displayName ?? '—'}
          </div>
          <div className="text-xs space-y-1">
            <div>
              <span className="text-muted-foreground">They give: </span>
              {trade.cashFromOfferer > 0 && <span>₦{trade.cashFromOfferer} </span>}
              {trade.offererPropertyIds.map((id) => LANDLORD_BOARD[id]?.name).filter(Boolean).join(', ')}
              {trade.offererJailCards > 0 && <span> + {trade.offererJailCards} jail card</span>}
              {trade.cashFromOfferer === 0 && trade.offererPropertyIds.length === 0 && trade.offererJailCards === 0 && (
                <span className="text-muted-foreground">nothing</span>
              )}
            </div>
            <div>
              <span className="text-muted-foreground">You give: </span>
              {trade.cashFromOfferer < 0 && <span>₦{-trade.cashFromOfferer} </span>}
              {trade.targetPropertyIds.map((id) => LANDLORD_BOARD[id]?.name).filter(Boolean).join(', ')}
              {trade.targetJailCards > 0 && <span> + {trade.targetJailCards} jail card</span>}
              {(trade.cashFromOfferer >= 0) && trade.targetPropertyIds.length === 0 && trade.targetJailCards === 0 && (
                <span className="text-muted-foreground">nothing</span>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" onClick={click(() => onRespondTrade(true))}>Accept</Button>
            <Button size="sm" variant="ghost" onClick={click(() => onRespondTrade(false))}>Reject</Button>
          </div>
        </div>
      )}

      {outgoingTrade && trade && (
        <div className="w-full max-w-md glass rounded-xl p-3 text-xs text-muted-foreground border border-primary/30 flex items-center justify-between">
          <span>⏳ Waiting on {state.players.find((p) => p.id === trade.toId)?.displayName ?? '—'} to respond.</span>
          <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={click(onCancelTrade)}>
            Cancel
          </Button>
        </div>
      )}


      <div className="w-full max-w-md flex-1 flex flex-col items-center justify-center gap-6">
        <AnimatePresence mode="wait">
          {!isMyTurn ? (
            <motion.div key="wait" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center space-y-2">
              <p className="text-sm uppercase tracking-wider text-muted-foreground">Now playing</p>
              <p className="text-3xl font-display font-bold neon-text">
                {state.players.find((p) => p.id === state.currentPlayerId)?.displayName ?? '—'}
              </p>
              <p className="text-xs text-muted-foreground italic max-w-xs">{state.lastAction}</p>
            </motion.div>
          ) : (
            <motion.div key="me" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center space-y-3 w-full">
              <p className="text-sm uppercase tracking-wider text-secondary">Your turn</p>
              {state.dice && (
                <div className="flex gap-3 justify-center">
                  {state.dice.map((d, i) => (
                    <div key={i} className="w-14 h-14 bg-background border-2 border-primary rounded-xl flex items-center justify-center text-3xl font-display font-bold neon-text">{d}</div>
                  ))}
                </div>
              )}

              {state.phase === 'awaiting_buy' && pending && (
                <div className="glass rounded-xl p-3 space-y-2 border border-secondary/40">
                  <div className={`h-1.5 rounded ${GROUP_BAND_CLASS[pending.group]}`} />
                  <div className="text-foreground/85 flex justify-center"><LandlordTileGlyph tile={pending} size={28} /></div>
                  <div className="font-display font-bold text-lg">{pending.name}</div>
                  <div className="text-secondary font-mono">Price: ₦{pending.price}</div>
                  <div className="text-xs text-muted-foreground">Base rent: ₦{pending.baseRent}</div>
                </div>
              )}

              {state.phase === 'card_drawn' && state.lastCard && (
                <div className={`glass rounded-xl p-4 space-y-2 border ${
                  state.lastCard.deck === 'owambe' ? 'border-orange-400/60' : 'border-blue-400/60'
                }`}>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    {state.lastCard.deck === 'owambe' ? 'Owambe' : 'Community Pot'}
                  </div>
                  <div className="font-display">{state.lastCard.card.text}</div>
                </div>
              )}

              {state.phase !== 'awaiting_buy' && state.phase !== 'card_drawn' && tile && (
                <div className="glass rounded-xl px-4 py-3">
                  <div className="text-foreground/85 flex justify-center"><LandlordTileGlyph tile={tile} size={22} /></div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">You're at</div>
                  <div className="font-display font-bold">{tile.name}</div>
                </div>
              )}

              <div className="flex flex-col gap-2 w-full">
                {state.phase === 'rolling' && (
                  <>
                    <Button ref={rollBtnRef} size="lg" onClick={click(onRoll)} disabled={!canRoll} className="w-full text-lg h-14">
                      {me?.jailed ? `${t('landlord.rollDice')} 🎲` : state.rolledDoubles ? `${t('landlord.rollDice')} (Doubles!)` : `${t('landlord.rollDice')} 🎲`}
                    </Button>
                    <SpotlightOverlay
                      storageKey="landlord:first-roll"
                      targetRef={rollBtnRef}
                      message={t('spotlight.tapToRoll') as string}
                      enabled={canRoll && (state.turnNumber ?? 0) <= 1}
                    />
                    {me?.jailed && (
                      <div className="grid grid-cols-2 gap-2">
                        <Button variant="secondary" onClick={click(onPayJailFine)} disabled={!canPayFine}>{t('landlord.payJailFine')}</Button>
                        <Button variant="secondary" onClick={click(onUseJailCard)} disabled={!canUseCard}>
                          {t('landlord.useJailCard')} ({me?.getOutOfJailCards ?? 0})
                        </Button>
                      </div>
                    )}
                  </>
                )}
                {state.phase === 'awaiting_buy' && (
                  <div className="grid grid-cols-2 gap-2">
                    <Button ref={buyBtnRef} size="lg" onClick={click(onBuy)} disabled={!canBuy} className="h-14">
                      {t('landlord.buy', { name: pending?.name ?? '', price: pending?.price ?? 0 })}
                    </Button>
                    <Button size="lg" variant="secondary" onClick={click(onDecline)} disabled={!canDecline} className="h-14">
                      {t('landlord.pass')}
                    </Button>
                    <SpotlightOverlay
                      storageKey="landlord:first-buy"
                      targetRef={buyBtnRef}
                      message={t('spotlight.tapToBuy') as string}
                      enabled={canBuy}
                    />
                  </div>
                )}
                {state.phase === 'card_drawn' && (
                  <Button size="lg" onClick={click(onAckCard)} disabled={!canAck} className="w-full text-lg h-14">
                    {t('landlord.ok')}
                  </Button>
                )}
                {state.phase === 'turn_end' && (
                  <Button size="lg" variant="secondary" onClick={click(onEndTurn)} disabled={!canEnd} className="w-full">
                    {t('landlord.endTurn')}
                  </Button>
                )}

                {canManage && myProps.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowPortfolio((s) => !s)}
                    className="w-full text-xs uppercase tracking-wider"
                  >
                    {showPortfolio ? 'Hide' : 'Manage'} portfolio ({myProps.length})
                  </Button>
                )}
                {canStartTrade && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowTradeBuilder((s) => !s)}
                    className="w-full text-xs uppercase tracking-wider"
                  >
                    {showTradeBuilder ? 'Close trade' : '⇄ Propose trade'}
                  </Button>
                )}
              </div>

              {/* Portfolio manager */}
              <AnimatePresence>
                {showPortfolio && canManage && myProps.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="w-full glass rounded-xl p-3 space-y-2 max-h-72 overflow-y-auto text-left"
                  >
                    {myProps.map(({ tile: t, own }) => {
                      if (!t || !own) return null;
                      const isProperty = t.type === 'property';
                      const buildCost = t.housePrice;
                      const sellCredit = Math.floor(t.housePrice / 2);
                      const unmortgageCost = t.mortgageValue + Math.ceil(t.mortgageValue / 10);
                      const housesLabel = own.houses === 5 ? 'Hotel' : `${own.houses}h`;
                      return (
                        <div key={t.id} className="rounded-lg border border-border/50 p-2 space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className={`h-3 w-1 rounded ${GROUP_BAND_CLASS[t.group]}`} />
                            <span className="font-display text-sm flex-1 truncate">{t.name}</span>
                            {isProperty && <span className="text-[10px] text-muted-foreground">{housesLabel}</span>}
                            {own.mortgaged && <span className="text-[10px] text-destructive">MORT</span>}
                          </div>
                          <div className="grid grid-cols-2 gap-1.5">
                            {isProperty && (
                              <>
                                <Button
                                  size="sm" variant="secondary"
                                  className="h-7 text-[10px]"
                                  onClick={click(() => onBuild(t.id))}
                                  disabled={own.houses >= 5 || own.mortgaged || (me?.money ?? 0) < buildCost}
                                >
                                  + house ₦{buildCost}
                                </Button>
                                <Button
                                  size="sm" variant="ghost"
                                  className="h-7 text-[10px]"
                                  onClick={click(() => onSellHouse(t.id))}
                                  disabled={own.houses <= 0}
                                >
                                  – house +₦{sellCredit}
                                </Button>
                              </>
                            )}
                            {!own.mortgaged ? (
                              <Button
                                size="sm" variant="ghost"
                                className={`h-7 text-[10px] ${isProperty ? 'col-span-2' : ''}`}
                                onClick={click(() => onMortgage(t.id))}
                                disabled={own.houses > 0}
                              >
                                Mortgage +₦{t.mortgageValue}
                              </Button>
                            ) : (
                              <Button
                                size="sm" variant="ghost"
                                className={`h-7 text-[10px] ${isProperty ? 'col-span-2' : ''}`}
                                onClick={click(() => onUnmortgage(t.id))}
                                disabled={(me?.money ?? 0) < unmortgageCost}
                              >
                                Unmortgage –₦{unmortgageCost}
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Trade builder */}
              <AnimatePresence>
                {showTradeBuilder && canStartTrade && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="w-full glass rounded-xl p-3 space-y-3 text-left max-h-[70vh] overflow-y-auto"
                  >
                    <div className="text-xs uppercase tracking-wider text-primary">⇄ Build trade offer</div>
                    <div>
                      <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Trade with</label>
                      <select
                        value={tradeTargetId}
                        onChange={(e) => {
                          setTradeTargetId(e.target.value);
                          setTradeTheirProps(new Set());
                          setTradeTheirJail(0);
                        }}
                        className="w-full mt-1 bg-background border border-border rounded px-2 py-1 text-sm"
                      >
                        {otherPlayers.map((p) => (
                          <option key={p.id} value={p.id}>{p.displayName} (₦{p.money})</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Cash flow (positive = you pay them, negative = they pay you)
                      </label>
                      <input
                        type="number"
                        step={10}
                        value={tradeCash}
                        onChange={(e) => setTradeCash(parseInt(e.target.value || '0', 10) || 0)}
                        className="w-full mt-1 bg-background border border-border rounded px-2 py-1 text-sm font-mono"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">You give</div>
                        {myTradableProps.length === 0 && (
                          <div className="text-[10px] text-muted-foreground italic">No tradable properties</div>
                        )}
                        {myTradableProps.map(({ tile: t }) => t && (
                          <label key={t.id} className="flex items-center gap-1 text-[11px]">
                            <input
                              type="checkbox"
                              checked={tradeMyProps.has(t.id)}
                              onChange={(e) => {
                                const s = new Set(tradeMyProps);
                                if (e.target.checked) s.add(t.id); else s.delete(t.id);
                                setTradeMyProps(s);
                              }}
                            />
                            <span className="truncate">{t.name}</span>
                          </label>
                        ))}
                        {(me?.getOutOfJailCards ?? 0) > 0 && (
                          <label className="flex items-center gap-1 text-[11px]">
                            Jail cards:
                            <input
                              type="number" min={0} max={me?.getOutOfJailCards ?? 0}
                              value={tradeMyJail}
                              onChange={(e) => setTradeMyJail(Math.max(0, Math.min(me?.getOutOfJailCards ?? 0, parseInt(e.target.value || '0', 10))))}
                              className="w-12 bg-background border border-border rounded px-1 text-[11px]"
                            />
                          </label>
                        )}
                      </div>
                      <div className="space-y-1">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">You get</div>
                        {targetProps.length === 0 && (
                          <div className="text-[10px] text-muted-foreground italic">Nothing to choose</div>
                        )}
                        {targetProps.map(({ tile: t }) => t && (
                          <label key={t.id} className="flex items-center gap-1 text-[11px]">
                            <input
                              type="checkbox"
                              checked={tradeTheirProps.has(t.id)}
                              onChange={(e) => {
                                const s = new Set(tradeTheirProps);
                                if (e.target.checked) s.add(t.id); else s.delete(t.id);
                                setTradeTheirProps(s);
                              }}
                            />
                            <span className="truncate">{t.name}</span>
                          </label>
                        ))}
                        {(targetPlayer?.getOutOfJailCards ?? 0) > 0 && (
                          <label className="flex items-center gap-1 text-[11px]">
                            Jail cards:
                            <input
                              type="number" min={0} max={targetPlayer?.getOutOfJailCards ?? 0}
                              value={tradeTheirJail}
                              onChange={(e) => setTradeTheirJail(Math.max(0, Math.min(targetPlayer?.getOutOfJailCards ?? 0, parseInt(e.target.value || '0', 10))))}
                              className="w-12 bg-background border border-border rounded px-1 text-[11px]"
                            />
                          </label>
                        )}
                      </div>
                    </div>
                    <Button size="sm" className="w-full" onClick={click(submitTrade)} disabled={!tradeTargetId}>
                      Send offer
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="w-full max-w-md flex flex-col gap-3">
        <ReactionBar onReact={onReact} reactionPolicy={reactionPolicy} tauntPolicy={tauntPolicy} onReactionAck={onReactionAck} />
        <Button variant="ghost" size="sm" onClick={onRequestLeave} disabled={!onRequestLeave}>Leave</Button>
        <SoundControls />
      </div>
    </div>
  );
}
