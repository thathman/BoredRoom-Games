// Word Wahala — 15×15 board with classic Scrabble bonus layout, re-skinned.
//
// Bonus naming (theme):
//   TW = Owambe (Triple Word)  -> ×3 word
//   DW = Jollof (Double Word)  -> ×2 word, also doubles as center star
//   TL = Suya   (Triple Letter)-> ×3 letter
//   DL = Chin chin (Double Letter) -> ×2 letter

export type BoardBonus = 'none' | 'dl' | 'tl' | 'dw' | 'tw' | 'star';

export const BOARD_SIZE = 15;
export const CENTER = 7; // 0-indexed

/** Symmetric Scrabble bonus layout, encoded once for one quadrant + mirrored. */
function buildBoard(): BoardBonus[][] {
  const grid: BoardBonus[][] = Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => 'none' as BoardBonus),
  );
  const set = (r: number, c: number, b: BoardBonus) => {
    // 4-fold symmetry across center
    const mirrors = [
      [r, c],
      [r, BOARD_SIZE - 1 - c],
      [BOARD_SIZE - 1 - r, c],
      [BOARD_SIZE - 1 - r, BOARD_SIZE - 1 - c],
    ];
    for (const [mr, mc] of mirrors) grid[mr][mc] = b;
  };
  // Triple word (corners + 0,7)
  set(0, 0, 'tw'); set(0, 7, 'tw'); set(7, 0, 'tw');
  // Double word along diagonals
  for (let i = 1; i <= 4; i++) set(i, i, 'dw');
  set(7, 7, 'star');
  // Triple letter
  set(1, 5, 'tl'); set(5, 1, 'tl'); set(5, 5, 'tl');
  // Double letter
  set(0, 3, 'dl'); set(2, 6, 'dl'); set(3, 0, 'dl'); set(3, 7, 'dl');
  set(6, 2, 'dl'); set(6, 6, 'dl'); set(7, 3, 'dl');
  return grid;
}

export const BOARD_BONUSES: BoardBonus[][] = buildBoard();

export const BONUS_LABEL: Record<BoardBonus, string> = {
  none: '',
  dl: 'Chin chin',
  tl: 'Suya',
  dw: 'Jollof',
  tw: 'Owambe',
  star: 'Jollof',
};

export const BONUS_SHORT: Record<BoardBonus, string> = {
  none: '',
  dl: 'DL',
  tl: 'TL',
  dw: 'DW',
  tw: 'TW',
  star: '★',
};

export function bonusAt(row: number, col: number): BoardBonus {
  if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return 'none';
  return BOARD_BONUSES[row][col];
}
