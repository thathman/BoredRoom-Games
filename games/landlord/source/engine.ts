// Oga Landlord — pure rules engine (Pass A2).
//
// Ported from christelbuchanan/Monopoly-Game's useGameState hook into
// pure functions (no React state), with our shell extensions:
//   - typed card actions are dispatched here (the source left them as TODO)
//   - rent groups: railroads (1..N owned) and utilities (×4 / ×10 dice)
//   - jail: 3-turn timeout auto-pays ₦50 fine; doubles roll free
//   - bankruptcy releases properties; last solvent player wins
//
// Houses + mortgage land in Pass C — current-houses=0 is treated as
// "base rent" everywhere.

import {
  COMMUNITY_POT_CARDS,
  CardAction,
  LandlordCard,
  OWAMBE_CARDS,
  shuffleDeck,
} from './cards.js';
import {
  LANDLORD_BOARD_SIZE,
  LANDLORD_GO_BONUS,
  LANDLORD_GOTO_JAIL_POSITION,
  LANDLORD_JAIL_FINE,
  LANDLORD_JAIL_POSITION,
  LANDLORD_PROPERTIES,
  LANDLORD_STARTING_CASH,
  LandlordPropertyDef,
  propertyAt,
  propertyById,
} from './properties.js';

export type LandlordPhase =
  | 'lobby'
  | 'rolling'        // active player must roll
  | 'awaiting_buy'   // landed on unowned purchasable; player chooses buy/decline
  | 'auction'        // declined property is being auctioned to all solvent players
  | 'card_drawn'     // a card was drawn and is awaiting acknowledgement
  | 'turn_end'       // player finished actions, must end turn (or roll again on doubles)
  | 'finished';

/** Live auction state when phase === 'auction'. */
export interface LandlordAuctionState {
  propertyId: number;
  /** ids of solvent players still eligible to bid (in seating order). */
  eligible: string[];
  /** Whose turn it is to bid (id). */
  currentBidderId: string;
  /** Highest bid placed so far (₦). 0 = no bids yet. */
  highBid: number;
  /** Player id with the current highest bid, or null. */
  highBidderId: string | null;
  /** Minimum next bid (₦). */
  minBid: number;
}

/** Trade offer in flight (only one at a time per room). */
export interface LandlordTradeOffer {
  id: string;
  fromId: string;
  toId: string;
  /** Cash flowing FROM offerer TO target (negative means target pays). */
  cashFromOfferer: number;
  offererPropertyIds: number[];
  targetPropertyIds: number[];
  offererJailCards: number;
  targetJailCards: number;
}

export interface LandlordPlayerState {
  id: string;
  displayName: string;
  color?: string;
  position: number;
  money: number;
  /** Owned property ids. */
  propertyIds: number[];
  jailed: boolean;
  jailTurnsLeft: number;
  /** "Get out of Kirikiri Free" cards held. */
  getOutOfJailCards: number;
  /** Bankrupt = removed from rotation, properties released. */
  bankrupt: boolean;
  totalRolls: number;
  totalDoubles: number;
  isBot?: boolean;
}

/** Per-property runtime overlay (ownership/houses/mortgage). Static def is in LANDLORD_PROPERTIES. */
export interface LandlordPropertyOwnership {
  id: number;
  ownerId: string | null;
  houses: number;       // 0..4 = houses, 5 = hotel
  mortgaged: boolean;
}

export interface LandlordCardEvent {
  deck: 'owambe' | 'community';
  card: LandlordCard;
}

export interface LandlordPublicState {
  phase: LandlordPhase;
  players: LandlordPlayerState[];
  ownership: LandlordPropertyOwnership[];
  currentPlayerIndex: number;
  currentPlayerId: string;
  dice: [number, number] | null;
  diceTotal: number | null;
  rolledDoubles: boolean;
  consecutiveDoubles: number;
  /** Position of the property the active player just landed on (for buy/rent UI). */
  pendingPurchasePropertyId: number | null;
  /** Card most recently drawn (active player must acknowledge before continuing). */
  lastCard: LandlordCardEvent | null;
  /** Live auction (when phase === 'auction'). */
  auction: LandlordAuctionState | null;
  /** Currently pending trade offer (single in-flight). */
  pendingTrade: LandlordTradeOffer | null;
  turnNumber: number;
  lastAction: string;
  winnerId: string | null;
}

export interface LandlordSettings {
  maxPlayers: number;
  startingCash: number;
}

export const DEFAULT_LANDLORD_SETTINGS: LandlordSettings = {
  maxPlayers: 4,
  startingCash: LANDLORD_STARTING_CASH,
};

interface InternalDecks {
  owambe: LandlordCard[];
  community: LandlordCard[];
}

/** Shuffled decks live alongside state; they're not part of public state to avoid leaking the order. */
export function createDecks(rng: () => number = Math.random): InternalDecks {
  return {
    owambe: shuffleDeck(OWAMBE_CARDS, rng),
    community: shuffleDeck(COMMUNITY_POT_CARDS, rng),
  };
}

export function createInitialLandlordState(
  players: { id: string; displayName: string; color?: string; isBot?: boolean }[],
  settings: LandlordSettings = DEFAULT_LANDLORD_SETTINGS,
): LandlordPublicState {
  return {
    phase: 'lobby',
    players: players.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      color: p.color,
      position: 0,
      money: settings.startingCash,
      propertyIds: [],
      jailed: false,
      jailTurnsLeft: 0,
      getOutOfJailCards: 0,
      bankrupt: false,
      totalRolls: 0,
      totalDoubles: 0,
      isBot: p.isBot,
    })),
    ownership: LANDLORD_PROPERTIES.map((p) => ({ id: p.id, ownerId: null, houses: 0, mortgaged: false })),
    currentPlayerIndex: 0,
    currentPlayerId: players[0]?.id ?? '',
    dice: null,
    diceTotal: null,
    rolledDoubles: false,
    consecutiveDoubles: 0,
    pendingPurchasePropertyId: null,
    lastCard: null,
    auction: null,
    pendingTrade: null,
    turnNumber: 1,
    lastAction: 'Lobby — waiting for the host to start.',
    winnerId: null,
  };
}

export function startLandlord(state: LandlordPublicState): LandlordPublicState {
  if (state.players.length === 0) return state;
  return {
    ...state,
    phase: 'rolling',
    currentPlayerIndex: 0,
    currentPlayerId: state.players[0].id,
    turnNumber: 1,
    lastAction: `${state.players[0].displayName} to roll.`,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────

function ownerOf(state: LandlordPublicState, propertyId: number): LandlordPlayerState | null {
  const o = state.ownership.find((x) => x.id === propertyId);
  if (!o || !o.ownerId) return null;
  return state.players.find((p) => p.id === o.ownerId) ?? null;
}

function countOwnedInGroup(
  state: LandlordPublicState,
  ownerId: string,
  groupKey: 'railroad' | 'utility',
): number {
  return state.ownership.filter((o) => {
    if (o.ownerId !== ownerId) return false;
    const def = propertyById(o.id);
    return def?.type === groupKey;
  }).length;
}

function rentFor(
  state: LandlordPublicState,
  prop: LandlordPropertyDef,
  ownership: LandlordPropertyOwnership,
  diceTotal: number,
): number {
  if (ownership.mortgaged || !ownership.ownerId) return 0;
  if (prop.type === 'property') {
    const base = prop.rent[ownership.houses] ?? prop.rent[0];
    // Monopoly rule: own the whole color group + no houses → double base rent.
    if (ownership.houses === 0) {
      const groupAll = LANDLORD_PROPERTIES.filter((p) => p.group === prop.group);
      const ownedAll = groupAll.every((p) => {
        const o = state.ownership.find((x) => x.id === p.id);
        return o?.ownerId === ownership.ownerId && !o.mortgaged;
      });
      if (ownedAll && groupAll.length > 1) return base * 2;
    }
    return base;
  }
  if (prop.type === 'railroad') {
    const owned = countOwnedInGroup(state, ownership.ownerId, 'railroad');
    return prop.rent[Math.max(0, owned - 1)] ?? prop.rent[0];
  }
  if (prop.type === 'utility') {
    const owned = countOwnedInGroup(state, ownership.ownerId, 'utility');
    const mult = owned >= 2 ? prop.rent[1] : prop.rent[0];
    return diceTotal * mult;
  }
  return 0;
}

function appendAction(prev: string, msg: string): string {
  return msg.startsWith('—') || prev.length === 0 ? msg : `${prev} · ${msg}`;
}

/** Mark `payerId` paying `amount` to `payeeId` (or bank if null). Mutates passed players array. */
function transfer(
  players: LandlordPlayerState[],
  payerId: string,
  payeeId: string | null,
  amount: number,
): void {
  const payer = players.find((p) => p.id === payerId);
  if (!payer) return;
  payer.money -= amount;
  if (payeeId) {
    const payee = players.find((p) => p.id === payeeId);
    if (payee) payee.money += amount;
  }
}

function nextActiveIndex(state: LandlordPublicState, fromIdx: number): number {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (fromIdx + step) % n;
    if (!state.players[idx].bankrupt) return idx;
  }
  return fromIdx;
}

/** Settle landed-on tile. Returns next phase + updated card/pending-purchase pointers. */
interface LandResult {
  phase: LandlordPhase;
  pendingPurchasePropertyId: number | null;
  lastCard: LandlordCardEvent | null;
  message: string;
}

function applyLanding(
  state: LandlordPublicState,
  decks: InternalDecks,
  active: LandlordPlayerState,
  diceTotal: number,
): LandResult {
  const def = propertyAt(active.position);
  // GO/Free Parking/Just Visiting Kirikiri — nothing to do.
  if (def.type === 'corner') {
    return { phase: 'turn_end', pendingPurchasePropertyId: null, lastCard: null, message: '' };
  }
  if (def.type === 'tax') {
    transfer(state.players, active.id, null, def.rent[0]);
    return {
      phase: 'turn_end',
      pendingPurchasePropertyId: null,
      lastCard: null,
      message: `Paid ₦${def.rent[0]} ${def.name.toLowerCase()}.`,
    };
  }
  if (def.type === 'chance' || def.type === 'community') {
    const deckKey = def.type === 'chance' ? 'owambe' : 'community';
    const deck = decks[deckKey];
    const card = deck.shift()!;
    deck.push(card);
    return {
      phase: 'card_drawn',
      pendingPurchasePropertyId: null,
      lastCard: { deck: deckKey, card },
      message: `Drew ${deckKey === 'owambe' ? 'Owambe' : 'Community Pot'}: "${card.text}"`,
    };
  }
  // property / railroad / utility
  const ownership = state.ownership.find((o) => o.id === def.id)!;
  if (!ownership.ownerId) {
    if (active.money >= def.price) {
      return {
        phase: 'awaiting_buy',
        pendingPurchasePropertyId: def.id,
        lastCard: null,
        message: `Landed on ${def.name} (₦${def.price}). Buy or pass.`,
      };
    }
    return {
      phase: 'turn_end',
      pendingPurchasePropertyId: null,
      lastCard: null,
      message: `Landed on ${def.name} but cannot afford ₦${def.price}.`,
    };
  }
  if (ownership.ownerId === active.id) {
    return { phase: 'turn_end', pendingPurchasePropertyId: null, lastCard: null, message: `Landed on your own ${def.name}.` };
  }
  // Pay rent
  const owner = state.players.find((p) => p.id === ownership.ownerId)!;
  const rent = rentFor(state, def, ownership, diceTotal);
  transfer(state.players, active.id, owner.id, rent);
  return {
    phase: 'turn_end',
    pendingPurchasePropertyId: null,
    lastCard: null,
    message: `Paid ₦${rent} rent to ${owner.displayName} for ${def.name}.`,
  };
}

// ─── Public actions ─────────────────────────────────────────────────────

interface RollResult {
  state: LandlordPublicState;
  passedGo: boolean;
  sentToJail: boolean;
}

export function rollAndMove(
  state: LandlordPublicState,
  decks: InternalDecks,
  rng: () => number = Math.random,
): RollResult {
  if (state.phase !== 'rolling') {
    return { state, passedGo: false, sentToJail: false };
  }
  // Clone players for mutation safety.
  const players = state.players.map((p) => ({ ...p, propertyIds: p.propertyIds.slice() }));
  const ownership = state.ownership.map((o) => ({ ...o }));
  const idx = state.currentPlayerIndex;
  const active = players[idx];
  let working: LandlordPublicState = { ...state, players, ownership };

  const d1 = 1 + Math.floor(rng() * 6);
  const d2 = 1 + Math.floor(rng() * 6);
  const total = d1 + d2;
  const isDouble = d1 === d2;
  active.totalRolls += 1;
  if (isDouble) active.totalDoubles += 1;

  // Jail handling
  if (active.jailed) {
    if (isDouble) {
      active.jailed = false;
      active.jailTurnsLeft = 0;
      // Continue to movement below using these dice (no extra roll on jail break).
    } else {
      active.jailTurnsLeft += 1;
      if (active.jailTurnsLeft >= 3) {
        // Forced to pay fine and move with this roll.
        transfer(players, active.id, null, LANDLORD_JAIL_FINE);
        active.jailed = false;
        active.jailTurnsLeft = 0;
        working = {
          ...working,
          players,
          dice: [d1, d2],
          diceTotal: total,
          rolledDoubles: false,
          consecutiveDoubles: 0,
          lastAction: `${active.displayName} paid ₦${LANDLORD_JAIL_FINE} after 3 turns in Kirikiri.`,
        };
      } else {
        const next = advanceTurn({
          ...working,
          players,
          dice: [d1, d2],
          diceTotal: total,
          rolledDoubles: false,
          consecutiveDoubles: 0,
          phase: 'rolling',
          lastAction: `${active.displayName} stays in Kirikiri (${3 - active.jailTurnsLeft} turns left).`,
        });
        return { state: next, passedGo: false, sentToJail: false };
      }
    }
  }

  const consecutive = isDouble ? state.consecutiveDoubles + 1 : 0;

  // 3 doubles → straight to jail.
  if (consecutive >= 3) {
    active.position = LANDLORD_JAIL_POSITION;
    active.jailed = true;
    active.jailTurnsLeft = 0;
    const next = advanceTurn({
      ...working,
      players,
      dice: [d1, d2],
      diceTotal: total,
      rolledDoubles: true,
      consecutiveDoubles: 0,
      phase: 'rolling',
      lastAction: `${active.displayName} rolled three doubles — off to Kirikiri!`,
    });
    return { state: next, passedGo: false, sentToJail: true };
  }

  const prevPos = active.position;
  const newPos = (prevPos + total) % LANDLORD_BOARD_SIZE;
  const passedGo = newPos < prevPos || (prevPos !== 0 && newPos === 0 && total > 0);
  if (passedGo) active.money += LANDLORD_GO_BONUS;
  active.position = newPos;

  let landMsg = `${active.displayName} rolled ${d1}+${d2}=${total}${isDouble ? ' (doubles!)' : ''}${
    passedGo ? `, passed GO (+₦${LANDLORD_GO_BONUS})` : ''
  } → ${propertyAt(newPos).name}.`;

  // "Go to Kirikiri" tile teleports.
  if (propertyAt(newPos).type === 'corner' && newPos === LANDLORD_GOTO_JAIL_POSITION) {
    active.position = LANDLORD_JAIL_POSITION;
    active.jailed = true;
    active.jailTurnsLeft = 0;
    const next = advanceTurn({
      ...working,
      players,
      dice: [d1, d2],
      diceTotal: total,
      rolledDoubles: isDouble,
      consecutiveDoubles: 0,
      phase: 'rolling',
      lastAction: `${active.displayName} got carried — off to Kirikiri!`,
    });
    return { state: next, passedGo, sentToJail: true };
  }

  const land = applyLanding({ ...working, players, ownership }, decks, active, total);
  landMsg = appendAction(landMsg, land.message);

  // Bankruptcy check after rent/tax payment.
  let after: LandlordPublicState = {
    ...working,
    players,
    ownership,
    dice: [d1, d2],
    diceTotal: total,
    rolledDoubles: isDouble,
    consecutiveDoubles: consecutive,
    pendingPurchasePropertyId: land.pendingPurchasePropertyId,
    lastCard: land.lastCard,
    phase: land.phase,
    lastAction: landMsg,
  };
  after = checkBankruptcy(after, active.id);
  if (after.winnerId) return { state: after, passedGo, sentToJail: false };

  // If player landed on awaiting_buy or card_drawn, stay; otherwise turn_end logic.
  if (after.phase === 'awaiting_buy' || after.phase === 'card_drawn') {
    return { state: after, passedGo, sentToJail: false };
  }
  // Doubles + not jailed → keep the turn.
  if (isDouble) {
    return { state: { ...after, phase: 'rolling' }, passedGo, sentToJail: false };
  }
  return { state: advanceTurn(after), passedGo, sentToJail: false };
}

export function buyProperty(state: LandlordPublicState): LandlordPublicState {
  if (state.phase !== 'awaiting_buy' || state.pendingPurchasePropertyId == null) return state;
  const def = propertyById(state.pendingPurchasePropertyId);
  if (!def) return state;
  const players = state.players.map((p) => ({ ...p, propertyIds: p.propertyIds.slice() }));
  const ownership = state.ownership.map((o) => ({ ...o }));
  const active = players[state.currentPlayerIndex];
  if (active.money < def.price) return { ...state, lastAction: `${active.displayName} cannot afford ${def.name}.` };
  active.money -= def.price;
  active.propertyIds.push(def.id);
  const o = ownership.find((x) => x.id === def.id)!;
  o.ownerId = active.id;
  const isDouble = state.rolledDoubles && state.consecutiveDoubles > 0;
  const next: LandlordPublicState = {
    ...state,
    players,
    ownership,
    pendingPurchasePropertyId: null,
    phase: isDouble ? 'rolling' : 'turn_end',
    lastAction: `${active.displayName} bought ${def.name} for ₦${def.price}.`,
  };
  return next;
}

export function declinePurchase(state: LandlordPublicState): LandlordPublicState {
  if (state.phase !== 'awaiting_buy' || state.pendingPurchasePropertyId == null) return state;
  const propertyId = state.pendingPurchasePropertyId;
  const def = propertyById(propertyId);
  const decliner = state.players[state.currentPlayerIndex];

  // Eligible bidders = all solvent players (active too — Monopoly auction rules).
  const eligible = state.players.filter((p) => !p.bankrupt).map((p) => p.id);
  if (eligible.length >= 2 && def) {
    const auction: LandlordAuctionState = {
      propertyId,
      eligible,
      currentBidderId: eligible[0],
      highBid: 0,
      highBidderId: null,
      minBid: 10,
    };
    return {
      ...state,
      phase: 'auction',
      pendingPurchasePropertyId: null,
      auction,
      lastAction: `${decliner.displayName} declined ${def.name}. Auction opens at ₦${auction.minBid}.`,
    };
  }

  // Solo / no-auction fallback: behave like the old decline.
  const isDouble = state.rolledDoubles && state.consecutiveDoubles > 0;
  return {
    ...state,
    pendingPurchasePropertyId: null,
    phase: isDouble ? 'rolling' : 'turn_end',
    lastAction: `${decliner.displayName} passed on the property.`,
  };
}

/** Apply the current `lastCard` action and clear it. */
export function acknowledgeCard(
  state: LandlordPublicState,
  decks: InternalDecks,
  rng: () => number = Math.random,
): LandlordPublicState {
  if (state.phase !== 'card_drawn' || !state.lastCard) return state;
  const players = state.players.map((p) => ({ ...p, propertyIds: p.propertyIds.slice() }));
  const ownership = state.ownership.map((o) => ({ ...o }));
  const active = players[state.currentPlayerIndex];
  const action = state.lastCard.card.action;
  let phase: LandlordPhase = 'turn_end';
  let pendingPurchasePropertyId: number | null = null;
  let extraMsg = '';

  const movePlayerTo = (targetPos: number, allowGoBonus: boolean) => {
    const prev = active.position;
    if (allowGoBonus && targetPos < prev) {
      active.money += LANDLORD_GO_BONUS;
      extraMsg = ` (+₦${LANDLORD_GO_BONUS} GO bonus)`;
    }
    active.position = targetPos;
  };

  switch (action.kind) {
    case 'collect':
      active.money += action.amount;
      break;
    case 'pay':
      active.money -= action.amount;
      break;
    case 'collect_from_each_player':
      for (const p of players) if (p.id !== active.id && !p.bankrupt) {
        p.money -= action.amount; active.money += action.amount;
      }
      break;
    case 'pay_each_player':
      for (const p of players) if (p.id !== active.id && !p.bankrupt) {
        active.money -= action.amount; p.money += action.amount;
      }
      break;
    case 'get_out_of_jail':
      active.getOutOfJailCards += 1;
      break;
    case 'go_to_jail':
      active.position = LANDLORD_JAIL_POSITION;
      active.jailed = true;
      active.jailTurnsLeft = 0;
      break;
    case 'move_to':
      movePlayerTo(action.position, !!action.passGo);
      break;
    case 'move_back': {
      const back = (active.position - action.spaces + LANDLORD_BOARD_SIZE) % LANDLORD_BOARD_SIZE;
      active.position = back;
      break;
    }
    case 'move_nearest': {
      const targets = LANDLORD_PROPERTIES.filter((p) => p.type === action.kind_target);
      const fromPos = active.position;
      let nearest = targets[0];
      for (const t of targets) {
        const dist = (t.position - fromPos + LANDLORD_BOARD_SIZE) % LANDLORD_BOARD_SIZE;
        const ndist = (nearest.position - fromPos + LANDLORD_BOARD_SIZE) % LANDLORD_BOARD_SIZE;
        if (dist > 0 && (ndist === 0 || dist < ndist)) nearest = t;
      }
      movePlayerTo(nearest.position, true);
      break;
    }
    case 'repairs': {
      let houses = 0;
      let hotels = 0;
      for (const o of ownership) {
        if (o.ownerId !== active.id) continue;
        if (o.houses === 5) hotels += 1;
        else houses += o.houses;
      }
      const cost = houses * action.perHouse + hotels * action.perHotel;
      active.money -= cost;
      extraMsg = ` (₦${cost} for ${houses}h/${hotels}H)`;
      break;
    }
  }

  // After moving (move_*, go_to_jail), trigger landing logic if applicable.
  let working: LandlordPublicState = {
    ...state,
    players,
    ownership,
    pendingPurchasePropertyId: null,
    lastCard: null,
    phase: 'turn_end',
    lastAction: `${active.displayName}: ${state.lastCard.card.text}${extraMsg}`,
  };

  if (
    action.kind === 'move_to' ||
    action.kind === 'move_back' ||
    action.kind === 'move_nearest'
  ) {
    const land = applyLanding(working, decks, active, state.diceTotal ?? 0);
    phase = land.phase;
    pendingPurchasePropertyId = land.pendingPurchasePropertyId;
    working = {
      ...working,
      phase,
      pendingPurchasePropertyId,
      lastCard: land.lastCard, // chained card draw if landed on chance/community
      lastAction: appendAction(working.lastAction, land.message),
    };
  }

  working = checkBankruptcy(working, active.id);
  if (working.winnerId) return working;

  // Doubles still pending? After resolving card, if it's not a buy/card prompt,
  // honour the doubles rule and let the player roll again.
  const isDouble = working.rolledDoubles && working.consecutiveDoubles > 0;
  if (working.phase === 'turn_end' && isDouble) {
    return { ...working, phase: 'rolling' };
  }
  return working;
}

export function payJailFine(state: LandlordPublicState): LandlordPublicState {
  if (state.phase !== 'rolling') return state;
  const active = state.players[state.currentPlayerIndex];
  if (!active.jailed) return state;
  if (active.money < LANDLORD_JAIL_FINE) return state;
  const players = state.players.map((p) => ({ ...p }));
  const me = players[state.currentPlayerIndex];
  me.money -= LANDLORD_JAIL_FINE;
  me.jailed = false;
  me.jailTurnsLeft = 0;
  return {
    ...state,
    players,
    lastAction: `${me.displayName} paid ₦${LANDLORD_JAIL_FINE} to leave Kirikiri.`,
  };
}

export function useJailCard(state: LandlordPublicState): LandlordPublicState {
  if (state.phase !== 'rolling') return state;
  const active = state.players[state.currentPlayerIndex];
  if (!active.jailed || active.getOutOfJailCards <= 0) return state;
  const players = state.players.map((p) => ({ ...p }));
  const me = players[state.currentPlayerIndex];
  me.jailed = false;
  me.jailTurnsLeft = 0;
  me.getOutOfJailCards -= 1;
  return {
    ...state,
    players,
    lastAction: `${me.displayName} used a Get-Out-of-Kirikiri card.`,
  };
}

export function endTurn(state: LandlordPublicState): LandlordPublicState {
  if (state.phase !== 'turn_end') return state;
  return advanceTurn(state);
}

// ─── Pass C: houses + mortgage ──────────────────────────────────────────
//
// Building rules (Monopoly):
//   • Must own the entire color group, none mortgaged.
//   • Even-build: cannot exceed the group min by more than 0.
//   • Houses: 1..4. Hotel = 5 (built atop the 4th house).
//
// Mortgage:
//   • Cannot mortgage if any property in the group has houses.
//   • No rent collected while mortgaged. Unmortgage = mortgageValue + 10%.

function isManageNow(phase: LandlordPhase): boolean {
  return phase === 'rolling' || phase === 'turn_end' || phase === 'awaiting_buy';
}

function ownsWholeGroup(state: LandlordPublicState, playerId: string, propId: number): boolean {
  const def = propertyById(propId);
  if (!def || def.type !== 'property') return false;
  const groupAll = LANDLORD_PROPERTIES.filter((p) => p.group === def.group);
  return groupAll.every((p) => {
    const o = state.ownership.find((x) => x.id === p.id);
    return o?.ownerId === playerId && !o.mortgaged;
  });
}

function groupHouseCounts(ownership: LandlordPropertyOwnership[], group: string): number[] {
  return LANDLORD_PROPERTIES.filter((p) => p.group === group).map((p) => {
    const o = ownership.find((x) => x.id === p.id);
    return o?.houses ?? 0;
  });
}

export function buildHouse(state: LandlordPublicState, propertyId: number): LandlordPublicState {
  if (!isManageNow(state.phase)) return state;
  const def = propertyById(propertyId);
  if (!def || def.type !== 'property' || def.housePrice <= 0) return state;
  const players = state.players.map((p) => ({ ...p }));
  const ownership = state.ownership.map((o) => ({ ...o }));
  const active = players[state.currentPlayerIndex];
  const o = ownership.find((x) => x.id === propertyId)!;
  if (o.ownerId !== active.id || o.mortgaged || o.houses >= 5) return state;
  if (!ownsWholeGroup({ ...state, ownership }, active.id, propertyId)) return state;
  const counts = groupHouseCounts(ownership, def.group);
  if (o.houses > Math.min(...counts)) return state;
  if (active.money < def.housePrice) return state;
  active.money -= def.housePrice;
  o.houses += 1;
  return {
    ...state,
    players,
    ownership,
    lastAction: `${active.displayName} built ${o.houses === 5 ? 'a hotel' : `house #${o.houses}`} on ${def.name}.`,
  };
}

export function sellHouse(state: LandlordPublicState, propertyId: number): LandlordPublicState {
  if (!isManageNow(state.phase)) return state;
  const def = propertyById(propertyId);
  if (!def || def.type !== 'property') return state;
  const players = state.players.map((p) => ({ ...p }));
  const ownership = state.ownership.map((o) => ({ ...o }));
  const active = players[state.currentPlayerIndex];
  const o = ownership.find((x) => x.id === propertyId)!;
  if (o.ownerId !== active.id || o.houses <= 0) return state;
  const counts = groupHouseCounts(ownership, def.group);
  if (o.houses < Math.max(...counts)) return state;
  o.houses -= 1;
  active.money += Math.floor(def.housePrice / 2);
  return {
    ...state,
    players,
    ownership,
    lastAction: `${active.displayName} sold a house on ${def.name}.`,
  };
}

export function mortgageProperty(state: LandlordPublicState, propertyId: number): LandlordPublicState {
  if (!isManageNow(state.phase)) return state;
  const def = propertyById(propertyId);
  if (!def || def.mortgageValue <= 0) return state;
  const players = state.players.map((p) => ({ ...p }));
  const ownership = state.ownership.map((o) => ({ ...o }));
  const active = players[state.currentPlayerIndex];
  const o = ownership.find((x) => x.id === propertyId)!;
  if (o.ownerId !== active.id || o.mortgaged) return state;
  if (def.type === 'property') {
    const counts = groupHouseCounts(ownership, def.group);
    if (counts.some((c) => c > 0)) return state;
  }
  o.mortgaged = true;
  active.money += def.mortgageValue;
  return {
    ...state,
    players,
    ownership,
    lastAction: `${active.displayName} mortgaged ${def.name} for ₦${def.mortgageValue}.`,
  };
}

export function unmortgageProperty(state: LandlordPublicState, propertyId: number): LandlordPublicState {
  if (!isManageNow(state.phase)) return state;
  const def = propertyById(propertyId);
  if (!def || def.mortgageValue <= 0) return state;
  const players = state.players.map((p) => ({ ...p }));
  const ownership = state.ownership.map((o) => ({ ...o }));
  const active = players[state.currentPlayerIndex];
  const o = ownership.find((x) => x.id === propertyId)!;
  if (o.ownerId !== active.id || !o.mortgaged) return state;
  const cost = def.mortgageValue + Math.ceil(def.mortgageValue / 10);
  if (active.money < cost) return state;
  active.money -= cost;
  o.mortgaged = false;
  return {
    ...state,
    players,
    ownership,
    lastAction: `${active.displayName} unmortgaged ${def.name} for ₦${cost}.`,
  };
}

// ─── Auctions ───────────────────────────────────────────────────────────

function nextAuctionBidder(eligible: string[], fromId: string): string | null {
  if (eligible.length === 0) return null;
  const idx = eligible.indexOf(fromId);
  if (idx < 0) return eligible[0];
  return eligible[(idx + 1) % eligible.length];
}

function finishAuction(state: LandlordPublicState): LandlordPublicState {
  const a = state.auction;
  if (!a) return state;
  const def = propertyById(a.propertyId);
  const players = state.players.map((p) => ({ ...p, propertyIds: p.propertyIds.slice() }));
  const ownership = state.ownership.map((o) => ({ ...o }));
  let lastAction: string;

  if (a.highBidderId && def) {
    const winner = players.find((p) => p.id === a.highBidderId);
    if (winner && winner.money >= a.highBid) {
      winner.money -= a.highBid;
      winner.propertyIds.push(def.id);
      const o = ownership.find((x) => x.id === def.id)!;
      o.ownerId = winner.id;
      lastAction = `${winner.displayName} won the auction for ${def.name} at ₦${a.highBid}.`;
    } else {
      lastAction = `Auction for ${def?.name ?? 'property'} cancelled — winner cannot pay.`;
    }
  } else {
    lastAction = `No bids — ${def?.name ?? 'property'} stays unowned.`;
  }

  const isDouble = state.rolledDoubles && state.consecutiveDoubles > 0;
  return {
    ...state,
    players,
    ownership,
    auction: null,
    phase: isDouble ? 'rolling' : 'turn_end',
    lastAction,
  };
}

export function placeAuctionBid(
  state: LandlordPublicState,
  bidderId: string,
  amount: number,
): LandlordPublicState {
  if (state.phase !== 'auction' || !state.auction) return state;
  const a = state.auction;
  if (a.currentBidderId !== bidderId) return state;
  if (!a.eligible.includes(bidderId)) return state;
  if (amount < a.minBid) return state;
  const bidder = state.players.find((p) => p.id === bidderId);
  if (!bidder || bidder.bankrupt || bidder.money < amount) return state;
  const next = nextAuctionBidder(a.eligible, bidderId);
  return {
    ...state,
    auction: {
      ...a,
      highBid: amount,
      highBidderId: bidderId,
      minBid: amount + 10,
      currentBidderId: next ?? bidderId,
    },
    lastAction: `${bidder.displayName} bid ₦${amount}.`,
  };
}

export function passAuctionBid(state: LandlordPublicState, bidderId: string): LandlordPublicState {
  if (state.phase !== 'auction' || !state.auction) return state;
  const a = state.auction;
  if (a.currentBidderId !== bidderId) return state;
  const bidder = state.players.find((p) => p.id === bidderId);
  const remaining = a.eligible.filter((id) => id !== bidderId);

  // If only one bidder remains and they hold the high bid, end the auction.
  if (remaining.length === 0 || (remaining.length === 1 && remaining[0] === a.highBidderId)) {
    return finishAuction({
      ...state,
      auction: { ...a, eligible: remaining },
      lastAction: `${bidder?.displayName ?? 'Player'} passed.`,
    });
  }

  const next = nextAuctionBidder(remaining, bidderId);
  return {
    ...state,
    auction: { ...a, eligible: remaining, currentBidderId: next ?? remaining[0] },
    lastAction: `${bidder?.displayName ?? 'Player'} passed.`,
  };
}

// ─── Trades ─────────────────────────────────────────────────────────────

function isTradePhase(phase: LandlordPhase): boolean {
  return phase === 'rolling' || phase === 'turn_end' || phase === 'awaiting_buy';
}

function validateTradeSide(
  state: LandlordPublicState,
  playerId: string,
  propertyIds: number[],
  jailCards: number,
): boolean {
  const p = state.players.find((x) => x.id === playerId);
  if (!p || p.bankrupt) return false;
  if (jailCards < 0 || jailCards > p.getOutOfJailCards) return false;
  for (const pid of propertyIds) {
    const o = state.ownership.find((x) => x.id === pid);
    if (!o || o.ownerId !== playerId) return false;
    if (o.houses > 0) return false; // sell houses before trading
  }
  return true;
}

export function proposeTrade(
  state: LandlordPublicState,
  offer: Omit<LandlordTradeOffer, 'id'>,
  newId: string,
): LandlordPublicState {
  if (!isTradePhase(state.phase)) return state;
  if (state.pendingTrade) return state;
  if (offer.fromId === offer.toId) return state;
  if (offer.fromId !== state.currentPlayerId) return state; // active player initiates
  if (!validateTradeSide(state, offer.fromId, offer.offererPropertyIds, offer.offererJailCards)) return state;
  if (!validateTradeSide(state, offer.toId, offer.targetPropertyIds, offer.targetJailCards)) return state;
  const from = state.players.find((p) => p.id === offer.fromId)!;
  const to = state.players.find((p) => p.id === offer.toId)!;
  if (offer.cashFromOfferer > 0 && from.money < offer.cashFromOfferer) return state;
  if (offer.cashFromOfferer < 0 && to.money < -offer.cashFromOfferer) return state;
  return {
    ...state,
    pendingTrade: { ...offer, id: newId },
    lastAction: `${from.displayName} offered a trade to ${to.displayName}.`,
  };
}

export function cancelTrade(state: LandlordPublicState, byPlayerId: string): LandlordPublicState {
  if (!state.pendingTrade) return state;
  if (state.pendingTrade.fromId !== byPlayerId) return state;
  return {
    ...state,
    pendingTrade: null,
    lastAction: `Trade cancelled.`,
  };
}

export function respondToTrade(
  state: LandlordPublicState,
  byPlayerId: string,
  accept: boolean,
): LandlordPublicState {
  const t = state.pendingTrade;
  if (!t) return state;
  if (t.toId !== byPlayerId) return state;
  if (!accept) {
    return {
      ...state,
      pendingTrade: null,
      lastAction: `Trade rejected.`,
    };
  }
  // Re-validate (state may have changed since proposal).
  if (!validateTradeSide(state, t.fromId, t.offererPropertyIds, t.offererJailCards)) {
    return { ...state, pendingTrade: null, lastAction: `Trade voided — invalid offer.` };
  }
  if (!validateTradeSide(state, t.toId, t.targetPropertyIds, t.targetJailCards)) {
    return { ...state, pendingTrade: null, lastAction: `Trade voided — invalid acceptance.` };
  }

  const players = state.players.map((p) => ({ ...p, propertyIds: p.propertyIds.slice() }));
  const ownership = state.ownership.map((o) => ({ ...o }));
  const from = players.find((p) => p.id === t.fromId)!;
  const to = players.find((p) => p.id === t.toId)!;

  if (t.cashFromOfferer > 0 && from.money < t.cashFromOfferer) {
    return { ...state, pendingTrade: null, lastAction: `Trade voided — insufficient cash.` };
  }
  if (t.cashFromOfferer < 0 && to.money < -t.cashFromOfferer) {
    return { ...state, pendingTrade: null, lastAction: `Trade voided — insufficient cash.` };
  }

  // Cash
  from.money -= t.cashFromOfferer;
  to.money += t.cashFromOfferer;
  // Jail cards
  from.getOutOfJailCards -= t.offererJailCards;
  to.getOutOfJailCards += t.offererJailCards;
  to.getOutOfJailCards -= t.targetJailCards;
  from.getOutOfJailCards += t.targetJailCards;
  // Properties: offerer → target
  for (const pid of t.offererPropertyIds) {
    from.propertyIds = from.propertyIds.filter((x) => x !== pid);
    to.propertyIds.push(pid);
    const o = ownership.find((x) => x.id === pid)!;
    o.ownerId = to.id;
  }
  // Properties: target → offerer
  for (const pid of t.targetPropertyIds) {
    to.propertyIds = to.propertyIds.filter((x) => x !== pid);
    from.propertyIds.push(pid);
    const o = ownership.find((x) => x.id === pid)!;
    o.ownerId = from.id;
  }

  return {
    ...state,
    players,
    ownership,
    pendingTrade: null,
    lastAction: `${from.displayName} ⇄ ${to.displayName} trade completed.`,
  };
}

// ─── Turn flow ──────────────────────────────────────────────────────────

function advanceTurn(state: LandlordPublicState): LandlordPublicState {
  const solvent = state.players.filter((p) => !p.bankrupt);
  if (solvent.length === 0) return state;
  const nextIdx = nextActiveIndex(state, state.currentPlayerIndex);
  const nextPlayer = state.players[nextIdx];
  return {
    ...state,
    currentPlayerIndex: nextIdx,
    currentPlayerId: nextPlayer.id,
    phase: 'rolling',
    consecutiveDoubles: 0,
    pendingPurchasePropertyId: null,
    turnNumber: state.turnNumber + 1,
    lastAction: `${nextPlayer.displayName} to roll.`,
  };
}

function checkBankruptcy(state: LandlordPublicState, playerId: string): LandlordPublicState {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.bankrupt || player.money >= 0) return state;
  // Player is bankrupt. Release all properties.
  const players = state.players.map((p) => (p.id === playerId ? { ...p, bankrupt: true, money: 0, propertyIds: [] } : p));
  const ownership = state.ownership.map((o) =>
    o.ownerId === playerId ? { ...o, ownerId: null, houses: 0, mortgaged: false } : o,
  );
  const solvent = players.filter((p) => !p.bankrupt);
  if (solvent.length === 1) {
    return {
      ...state,
      players,
      ownership,
      phase: 'finished',
      winnerId: solvent[0].id,
      lastAction: `${player.displayName} is bankrupt — ${solvent[0].displayName} wins!`,
    };
  }
  return {
    ...state,
    players,
    ownership,
    lastAction: `${player.displayName} is bankrupt and out of the game.`,
  };
}
