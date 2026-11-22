// Scoring rules. Longer words score big.
const TABLE = [0, 0, 0, 1, 2, 4, 6, 10, 15]; // index = word length

export function wordPoints(word) {
  const n = typeof word === 'number' ? word : word.length;
  if (n < 3) return 0;
  if (n < TABLE.length) return TABLE[n];
  return 15 + (n - 8) * 6; // 9 → 21, 10 → 27, ...
}

/** Rows for the how-to / legend. */
export const POINTS_LEGEND = [3, 4, 5, 6, 7, 8].map(n => ({ len: n === 8 ? '8+' : String(n), pts: wordPoints(n) }));
