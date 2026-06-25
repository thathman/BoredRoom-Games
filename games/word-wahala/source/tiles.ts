// Word Wahala — tile system.
// Recalibrated Scrabble distribution for Naija context:
//   - Boost A/O/I/W (common in pidgin/yoruba/igbo phonemes)
//   - Drop V/X/Z (rare in NG word base)
//   - Add `gb` and `kp` digraph tiles (single-tile, common in indigenous)
//   - Add 2 "Pidgin tiles" (wild — only score in pidgin/slang/indigenous tier).

export type TileLetter =
  // a–z
  | 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i'
  | 'j' | 'k' | 'l' | 'm' | 'n' | 'o' | 'p' | 'q' | 'r'
  | 's' | 't' | 'u' | 'v' | 'w' | 'x' | 'y' | 'z'
  // digraphs (count as one tile, two letters when forming a word)
  | 'gb' | 'kp'
  // pidgin wildcard — chooses any letter, but only scores in non-standard tier
  | '*p';

export interface TileDef {
  letter: TileLetter;
  /** Display glyph (uppercased, digraph kept together: GB / KP / ★). */
  glyph: string;
  /** Letter sequence this tile contributes to a word (e.g. 'gb' -> 'gb'). */
  chars: string;
  /** Base point value before bonuses. */
  points: number;
  /** Number of copies in a fresh bag. */
  count: number;
  /** True for blank-style wildcards (player chooses letter on placement). */
  isWild: boolean;
  /**
   * Tier restriction for wilds. 'pidgin' means the placed word must score in
   * pidgin / slang / indigenous tier or the placement is rejected.
   */
  wildTier?: 'standard' | 'pidgin';
}

export const TILE_DEFS: TileDef[] = [
  // Vowels — boosted A/O/I
  { letter: 'a', glyph: 'A', chars: 'a', points: 1, count: 11, isWild: false },
  { letter: 'e', glyph: 'E', chars: 'e', points: 1, count: 12, isWild: false },
  { letter: 'i', glyph: 'I', chars: 'i', points: 1, count: 10, isWild: false },
  { letter: 'o', glyph: 'O', chars: 'o', points: 1, count: 10, isWild: false },
  { letter: 'u', glyph: 'U', chars: 'u', points: 1, count: 5, isWild: false },
  // Consonants — boosted W (Wahala/Wetin), boosted N (common in NG names/words)
  { letter: 'b', glyph: 'B', chars: 'b', points: 3, count: 3, isWild: false },
  { letter: 'c', glyph: 'C', chars: 'c', points: 3, count: 2, isWild: false },
  { letter: 'd', glyph: 'D', chars: 'd', points: 2, count: 4, isWild: false },
  { letter: 'f', glyph: 'F', chars: 'f', points: 4, count: 2, isWild: false },
  { letter: 'g', glyph: 'G', chars: 'g', points: 2, count: 4, isWild: false },
  { letter: 'h', glyph: 'H', chars: 'h', points: 4, count: 2, isWild: false },
  { letter: 'j', glyph: 'J', chars: 'j', points: 8, count: 2, isWild: false },
  { letter: 'k', glyph: 'K', chars: 'k', points: 5, count: 2, isWild: false },
  { letter: 'l', glyph: 'L', chars: 'l', points: 1, count: 4, isWild: false },
  { letter: 'm', glyph: 'M', chars: 'm', points: 3, count: 3, isWild: false },
  { letter: 'n', glyph: 'N', chars: 'n', points: 1, count: 8, isWild: false },
  { letter: 'p', glyph: 'P', chars: 'p', points: 3, count: 3, isWild: false },
  { letter: 'q', glyph: 'Q', chars: 'q', points: 10, count: 1, isWild: false },
  { letter: 'r', glyph: 'R', chars: 'r', points: 1, count: 6, isWild: false },
  { letter: 's', glyph: 'S', chars: 's', points: 1, count: 5, isWild: false },
  { letter: 't', glyph: 'T', chars: 't', points: 1, count: 6, isWild: false },
  { letter: 'v', glyph: 'V', chars: 'v', points: 5, count: 1, isWild: false }, // dropped from 2->1
  { letter: 'w', glyph: 'W', chars: 'w', points: 4, count: 4, isWild: false }, // boosted 2->4
  { letter: 'x', glyph: 'X', chars: 'x', points: 10, count: 1, isWild: false },
  { letter: 'y', glyph: 'Y', chars: 'y', points: 4, count: 3, isWild: false },
  { letter: 'z', glyph: 'Z', chars: 'z', points: 10, count: 1, isWild: false },
  // Digraphs
  { letter: 'gb', glyph: 'GB', chars: 'gb', points: 6, count: 2, isWild: false },
  { letter: 'kp', glyph: 'KP', chars: 'kp', points: 6, count: 2, isWild: false },
  // Pidgin wild — chooses letter, only scores when word is non-standard tier
  { letter: '*p', glyph: '★', chars: '', points: 0, count: 2, isWild: true, wildTier: 'pidgin' },
];

/** Build a fresh bag (multiset of tile letters) honoring `count`. */
export function buildTileBag(): TileLetter[] {
  const bag: TileLetter[] = [];
  for (const def of TILE_DEFS) {
    for (let i = 0; i < def.count; i++) bag.push(def.letter);
  }
  return bag;
}

/** Total tiles in a fresh bag (sanity-check helper). */
export function tileBagSize(): number {
  return TILE_DEFS.reduce((sum, d) => sum + d.count, 0);
}

const TILE_INDEX: Record<TileLetter, TileDef> = TILE_DEFS.reduce((acc, def) => {
  acc[def.letter] = def;
  return acc;
}, {} as Record<TileLetter, TileDef>);

export function tileDef(letter: TileLetter): TileDef {
  const def = TILE_INDEX[letter];
  if (!def) throw new Error(`unknown tile: ${letter}`);
  return def;
}

/** Standard rack size. */
export const RACK_SIZE = 7;

/** Bonus for using all 7 tiles in a single play (Bingo / "Owambe" bonus). */
export const BINGO_BONUS = 50;
