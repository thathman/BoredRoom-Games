// Hustle — 60-square Naija snakes & ladders board.
// Ladders are come-ups, snakes are setbacks. v1.1 adds:
//   - market squares: landing on them gives ₦ from the bank
//   - Japa endgame: three "exit" squares (58 UK, 59 Canada, 60 US) each
//     with their own win-cost requirement (see engine).
//
// Indices are 1-based (square 1 = start tile, square 60 = US exit).
// Players begin at position 0 (off-board).

export const HUSTLE_BOARD_SIZE = 60;
/** Legacy alias — final win square (US exact-roll). */
export const HUSTLE_WIN_SQUARE = HUSTLE_BOARD_SIZE;

/** Three Japa exits (positions on the board). UK is reachable first. */
export const HUSTLE_JAPA_EXITS = {
  uk: 58,        // pay ₦200, exact-roll preferred but not required
  canada: 59,    // requires 4 "documents" (markets crossed) + ₦150
  us: 60,        // exact-roll, free
} as const;

export interface HustleEvent {
  /** Square the token must land on to trigger this event (the "head"). */
  from: number;
  /** Square the token is moved to (the "tail"). */
  to: number;
  /** Short narrative shown in the on-display banner. */
  caption: string;
  /** Slug for SVG glyph selection on the display. */
  glyph: HustleGlyph;
}

export type HustleGlyph =
  // come-ups
  | 'nysc-lagos'
  | 'dollar-uncle'
  | 'visa-stamp'
  | 'viral-music'
  | 'pos-business'
  | 'right-marriage'
  // setbacks
  | 'nepa-light'
  | 'yahoo-scam'
  | 'aunty-stay'
  | 'mmm-crash'
  | 'naira-devalue'
  | 'bounced-cheque';

export const HUSTLE_LADDERS: HustleEvent[] = [
  { from: 4,  to: 14, caption: 'NYSC posted you to Lagos. Connect FM unlocked.',                glyph: 'nysc-lagos' },
  { from: 9,  to: 21, caption: 'Uncle for abroad sent dollar. Naira just dey shake.',            glyph: 'dollar-uncle' },
  { from: 17, to: 32, caption: 'POS biz blew. Cash dey enter from every corner.',                glyph: 'pos-business' },
  { from: 23, to: 38, caption: 'Your music video catch fire — TikTok no gree sleep.',           glyph: 'viral-music' },
  { from: 28, to: 44, caption: 'Visa stamped first try. Embassy man even smile for you.',        glyph: 'visa-stamp' },
  { from: 36, to: 50, caption: 'You marry well. In-laws connect dey work overtime.',             glyph: 'right-marriage' },
  { from: 47, to: 54, caption: 'Side hustle don pay — straight to checkpoint counter.',          glyph: 'pos-business' },
];

export const HUSTLE_SNAKES: HustleEvent[] = [
  { from: 12, to: 3,  caption: 'NEPA take light for middle of your Zoom interview.',            glyph: 'nepa-light' },
  { from: 19, to: 7,  caption: 'Yahoo boy don clear your account. Refresh and weep.',            glyph: 'yahoo-scam' },
  { from: 26, to: 11, caption: 'Aunty come "for two weeks" — three months don pass.',            glyph: 'aunty-stay' },
  { from: 33, to: 18, caption: 'Naira fall again overnight. Your plans don postpone.',           glyph: 'naira-devalue' },
  { from: 41, to: 24, caption: 'MMM crash — your "investment" don go meet ancestors.',           glyph: 'mmm-crash' },
  { from: 48, to: 30, caption: 'Bank reverse that dollar gift. Wahala don land.',                glyph: 'bounced-cheque' },
  { from: 53, to: 39, caption: 'NEPA strike at the airport. Slide back, my friend.',             glyph: 'nepa-light' },
];

/** Market squares — landing here pays ₦ from the bank. Crossing one ALSO
 *  counts as a "document" toward the Canada Japa exit. Hand-picked to spread
 *  the board and tell a Naija hustle story (Lagos → Abuja → SE → SW). */
export const HUSTLE_MARKETS: ReadonlyArray<{ position: number; reward: number; caption: string }> = [
  { position: 6,  reward: 100, caption: 'Computer Village — phone flip pays ₦100' },
  { position: 15, reward: 100, caption: 'Balogun Market — fabric run nets ₦100' },
  { position: 25, reward: 150, caption: 'Wuse Market — Abuja import gain ₦150' },
  { position: 35, reward: 150, caption: 'Onitsha Main Market — bulk profit ₦150' },
  { position: 45, reward: 200, caption: 'Idumota — wholesale move ₦200' },
];

export const HUSTLE_MARKET_LOOKUP = new Map(
  HUSTLE_MARKETS.map((m) => [m.position, m]),
);

/** Map from `from` square → event for fast lookup at resolution time. */
export const HUSTLE_LADDER_LOOKUP: Map<number, HustleEvent> = new Map(
  HUSTLE_LADDERS.map((e) => [e.from, e]),
);
export const HUSTLE_SNAKE_LOOKUP: Map<number, HustleEvent> = new Map(
  HUSTLE_SNAKES.map((e) => [e.from, e]),
);

/** All event squares (head squares). Used by the display to render markers. */
export const HUSTLE_EVENT_HEADS: ReadonlyArray<HustleEvent & { kind: 'ladder' | 'snake' }> = [
  ...HUSTLE_LADDERS.map((e) => ({ ...e, kind: 'ladder' as const })),
  ...HUSTLE_SNAKES.map((e) => ({ ...e, kind: 'snake' as const })),
];
