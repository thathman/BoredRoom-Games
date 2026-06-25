// Oga Landlord — Owambe (Chance) + Community Pot (Community Chest) decks.
// Ported from christelbuchanan/Monopoly-Game with Lagos re-theming and
// Naira (₦) currency. Card actions are typed so the engine can apply effects
// (the source repo left effect application as a TODO; we implement them).

export type CardDeck = 'owambe' | 'community';

export type CardAction =
  /** Move to absolute board position. If `passGo` allowed, collect ₦200 when wrapping. */
  | { kind: 'move_to'; position: number; passGo?: boolean }
  /** Move backwards by N tiles (no GO bonus). */
  | { kind: 'move_back'; spaces: number }
  /** Move to nearest tile of a kind. Pay double rent if owned. */
  | { kind: 'move_nearest'; kind_target: 'railroad' | 'utility' }
  /** Receive ₦amount from the bank. */
  | { kind: 'collect'; amount: number }
  /** Pay ₦amount to the bank. */
  | { kind: 'pay'; amount: number }
  /** Pay ₦amount to every other player. */
  | { kind: 'pay_each_player'; amount: number }
  /** Collect ₦amount from every other player. */
  | { kind: 'collect_from_each_player'; amount: number }
  /** Get-out-of-jail-free card; player keeps it. */
  | { kind: 'get_out_of_jail' }
  /** Direct to jail; do not pass GO. */
  | { kind: 'go_to_jail' }
  /** Pay per house/hotel owned. (Pass C will use this; safe no-op until then.) */
  | { kind: 'repairs'; perHouse: number; perHotel: number };

export interface LandlordCard {
  id: string;
  text: string;
  action: CardAction;
}

export const OWAMBE_CARDS: LandlordCard[] = [
  { id: 'ow-1',  text: 'Advance to GO. Collect ₦200.',                                                   action: { kind: 'move_to', position: 0, passGo: true } },
  { id: 'ow-2',  text: 'Advance to Ojuelegba. If you pass GO, collect ₦200.',                            action: { kind: 'move_to', position: 1, passGo: true } },
  { id: 'ow-3',  text: 'Advance to Banana Island. If you pass GO, collect ₦200.',                        action: { kind: 'move_to', position: 39, passGo: true } },
  { id: 'ow-4',  text: 'Advance to the nearest Terminal. If unowned, you may buy it. Otherwise pay double rent.', action: { kind: 'move_nearest', kind_target: 'railroad' } },
  { id: 'ow-5',  text: 'Advance to the nearest Utility. If unowned, you may buy it. Otherwise roll & pay 10×.',   action: { kind: 'move_nearest', kind_target: 'utility' } },
  { id: 'ow-6',  text: 'Bank pays you a dividend of ₦50.',                                               action: { kind: 'collect', amount: 50 } },
  { id: 'ow-7',  text: 'Get Out of Kirikiri Free.',                                                       action: { kind: 'get_out_of_jail' } },
  { id: 'ow-8',  text: 'Go Back 3 Spaces.',                                                              action: { kind: 'move_back', spaces: 3 } },
  { id: 'ow-9',  text: 'Go to Kirikiri. Do not pass GO. Do not collect ₦200.',                            action: { kind: 'go_to_jail' } },
  { id: 'ow-10', text: 'General repairs: ₦25 per house, ₦100 per hotel.',                                action: { kind: 'repairs', perHouse: 25, perHotel: 100 } },
  { id: 'ow-11', text: 'Pay LASMA fine of ₦15.',                                                         action: { kind: 'pay', amount: 15 } },
  { id: 'ow-12', text: 'Take a trip to Apapa Port. If you pass GO, collect ₦200.',                       action: { kind: 'move_to', position: 25, passGo: true } },
  { id: 'ow-13', text: 'You have been elected Chairman. Pay each player ₦50.',                            action: { kind: 'pay_each_player', amount: 50 } },
  { id: 'ow-14', text: 'Your building loan matures. Collect ₦150.',                                       action: { kind: 'collect', amount: 150 } },
  { id: 'ow-15', text: 'You won an Owambe dance-off. Collect ₦100.',                                     action: { kind: 'collect', amount: 100 } },
];

export const COMMUNITY_POT_CARDS: LandlordCard[] = [
  { id: 'cp-1',  text: 'Advance to GO. Collect ₦200.',                              action: { kind: 'move_to', position: 0, passGo: true } },
  { id: 'cp-2',  text: 'Bank error in your favour. Collect ₦200.',                  action: { kind: 'collect', amount: 200 } },
  { id: 'cp-3',  text: "Doctor's fee. Pay ₦50.",                                    action: { kind: 'pay', amount: 50 } },
  { id: 'cp-4',  text: 'From sale of stock you get ₦50.',                            action: { kind: 'collect', amount: 50 } },
  { id: 'cp-5',  text: 'Get Out of Kirikiri Free.',                                  action: { kind: 'get_out_of_jail' } },
  { id: 'cp-6',  text: 'Go to Kirikiri. Do not pass GO. Do not collect ₦200.',       action: { kind: 'go_to_jail' } },
  { id: 'cp-7',  text: 'Grand Owambe Night. Collect ₦50 from every player.',         action: { kind: 'collect_from_each_player', amount: 50 } },
  { id: 'cp-8',  text: 'Holiday Fund matures. Collect ₦100.',                        action: { kind: 'collect', amount: 100 } },
  { id: 'cp-9',  text: 'Tax refund. Collect ₦20.',                                  action: { kind: 'collect', amount: 20 } },
  { id: 'cp-10', text: 'It is your birthday. Collect ₦10 from every player.',        action: { kind: 'collect_from_each_player', amount: 10 } },
  { id: 'cp-11', text: 'Life insurance matures. Collect ₦100.',                      action: { kind: 'collect', amount: 100 } },
  { id: 'cp-12', text: 'Pay hospital fees of ₦100.',                                 action: { kind: 'pay', amount: 100 } },
  { id: 'cp-13', text: 'Pay school fees of ₦150.',                                   action: { kind: 'pay', amount: 150 } },
  { id: 'cp-14', text: 'Receive ₦25 consultancy fee.',                               action: { kind: 'collect', amount: 25 } },
  { id: 'cp-15', text: 'Street repairs assessment: ₦40 per house, ₦115 per hotel.',  action: { kind: 'repairs', perHouse: 40, perHotel: 115 } },
  { id: 'cp-16', text: 'Won second prize at the Lagos Carnival. Collect ₦10.',       action: { kind: 'collect', amount: 10 } },
  { id: 'cp-17', text: 'You inherit ₦100.',                                         action: { kind: 'collect', amount: 100 } },
];

/** Fisher–Yates shuffle using an injected RNG. Returns a new array. */
export function shuffleDeck<T>(deck: readonly T[], rng: () => number = Math.random): T[] {
  const out = deck.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
