// Color Wahala palette. 6-color tap pad with explicit, high-contrast HSL inks.
// IDs are stable strings used in protocol payloads; never localize.

export type ColorId = 'red' | 'blue' | 'green' | 'yellow' | 'purple' | 'orange';

export interface ColorEntry {
  id: ColorId;
  /** Word the user reads aloud / sees on the display. */
  word: string;
  /** CSS HSL value (no `hsl()` wrapper) for ink. */
  hsl: string;
  /** Foreground text color for contrast on top of the ink fill. */
  textHsl: string;
}

export const COLOR_PALETTE: readonly ColorEntry[] = [
  { id: 'red',    word: 'RED',    hsl: '0 85% 55%',   textHsl: '0 0% 100%' },
  { id: 'blue',   word: 'BLUE',   hsl: '220 90% 55%', textHsl: '0 0% 100%' },
  { id: 'green',  word: 'GREEN',  hsl: '140 70% 42%', textHsl: '0 0% 100%' },
  { id: 'yellow', word: 'YELLOW', hsl: '48 95% 55%',  textHsl: '0 0% 10%'  },
  { id: 'purple', word: 'PURPLE', hsl: '280 70% 55%', textHsl: '0 0% 100%' },
  { id: 'orange', word: 'ORANGE', hsl: '24 95% 55%',  textHsl: '0 0% 10%'  },
] as const;

export const COLOR_IDS = COLOR_PALETTE.map((c) => c.id) as ColorId[];

export function colorById(id: ColorId): ColorEntry {
  const c = COLOR_PALETTE.find((x) => x.id === id);
  if (!c) throw new Error(`unknown_color_${id}`);
  return c;
}

export function isColorId(v: unknown): v is ColorId {
  return typeof v === 'string' && COLOR_IDS.includes(v as ColorId);
}
