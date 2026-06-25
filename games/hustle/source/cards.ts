// Hustle — Hustle Card definitions.
//
// v1.1 — five abilities: connection, side_hustle, owambe_invite (MVP) +
// bribe, village_people. All effects resolve immediately when played
// from the controller. The server is authoritative.

export type HustleCardId =
  | 'connection'
  | 'side_hustle'
  | 'owambe_invite'
  | 'bribe'
  | 'village_people';

export interface HustleCardDef {
  id: HustleCardId;
  name: string;
  /** Short flavor caption shown when the card is broadcast. */
  caption: string;
  /** UI hint copy for the controller hand. */
  description: string;
  /** Whether the card requires the player to pick a target seat. */
  needsTarget: boolean;
  /** Whether the card is playable on your own turn only, or any time. */
  timing: 'own_turn' | 'reactive';
  /** Optional ₦ cost to play (defaults to 0). */
  cost?: number;
}

export const HUSTLE_CARDS: Record<HustleCardId, HustleCardDef> = {
  connection: {
    id: 'connection',
    name: 'Connection',
    caption: 'pulled strings to dodge the next setback.',
    description: 'Skip your next snake automatically. One-shot.',
    needsTarget: false,
    timing: 'reactive',
  },
  side_hustle: {
    id: 'side_hustle',
    name: 'Side hustle',
    caption: 'cashed in a side hustle for a re-roll.',
    description: 'Re-roll the dice on your turn. Take the better result.',
    needsTarget: false,
    timing: 'own_turn',
  },
  owambe_invite: {
    id: 'owambe_invite',
    name: 'Owambe invite',
    caption: 'sent an Owambe invite — somebody is on the dance floor.',
    description: 'Force a chosen player to skip their next turn.',
    needsTarget: true,
    timing: 'reactive',
  },
  bribe: {
    id: 'bribe',
    name: 'Bribe',
    caption: 'slipped envelope ya — paid to skip a snake or auction.',
    description: 'Pay ₦80 to skip your next snake AND get ₦100 GO bonus immediately.',
    needsTarget: false,
    timing: 'reactive',
    cost: 80,
  },
  village_people: {
    id: 'village_people',
    name: 'Village people',
    caption: 'invoked village people on a rival.',
    description: 'Send a target back 8 squares. Costs ₦40.',
    needsTarget: true,
    timing: 'reactive',
    cost: 40,
  },
};

/** Stable, shuffleable list of card ids for dealing. */
export const HUSTLE_CARD_POOL: HustleCardId[] = [
  'connection',
  'side_hustle',
  'owambe_invite',
  'bribe',
  'village_people',
];

/** A card instance held by a player. The `instanceId` is unique per card so
 *  the controller can reference a specific tap target without collisions. */
export interface HustleCardInstance {
  instanceId: string;
  cardId: HustleCardId;
}
