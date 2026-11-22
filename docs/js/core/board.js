// Board generation, solving and path-finding. Pure + deterministic (seeded RNG).
import { makeRng } from './rng.js';

export const MIN_WORD = 3;

// Letter weights, roughly tuned to how often letters appear in playable words.
// 'QU' is a single tile that spells two letters.
const LETTER_WEIGHTS = {
  E: 12, A: 9, I: 8, O: 8, U: 3.6, N: 7, R: 7, T: 7, S: 5.5, L: 5.2, D: 4.2, G: 3,
  C: 3.4, M: 3, P: 3, H: 3.2, B: 2.2, F: 2, Y: 2, W: 1.9, K: 1.4, V: 1.3, X: 0.5,
  J: 0.4, QU: 0.5, Z: 0.5,
};
const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);
const RARE = new Set(['J', 'K', 'QU', 'V', 'W', 'X', 'Y', 'Z', 'F', 'B']);
const LETTERS = Object.keys(LETTER_WEIGHTS);
const TOTAL_W = LETTERS.reduce((s, k) => s + LETTER_WEIGHTS[k], 0);

export const SIZES = {
  4: { vowels: [5, 7], minCommon: 75, minTotal: 115, minLongest: 6, maxS: 2 },
  5: { vowels: [8, 11], minCommon: 170, minTotal: 280, minLongest: 7, maxS: 2 },
};

const adjCache = new Map();
/** Neighbour lists for a size×size grid (8-way adjacency). */
export function adjacency(size) {
  if (adjCache.has(size)) return adjCache.get(size);
  const adj = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const list = [];
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < size && cc >= 0 && cc < size) list.push(rr * size + cc);
      }
      adj.push(list);
    }
  }
  adjCache.set(size, adj);
  return adj;
}

export function isAdjacent(size, a, b) {
  if (a === b) return false;
  const ra = Math.floor(a / size), ca = a % size, rb = Math.floor(b / size), cb = b % size;
  return Math.abs(ra - rb) <= 1 && Math.abs(ca - cb) <= 1;
}

function drawLetter(rng) {
  let x = rng.next() * TOTAL_W;
  for (const k of LETTERS) { x -= LETTER_WEIGHTS[k]; if (x < 0) return k; }
  return 'E';
}

/** Random tiles with dice-like constraints (vowel balance, caps on repeats). */
export function randomTiles(rng, size) {
  const cfg = SIZES[size];
  const n = size * size;
  for (;;) {
    const tiles = [];
    const counts = {};
    let vowels = 0;
    while (tiles.length < n) {
      const L = drawLetter(rng);
      const c = counts[L] || 0;
      const cap = L === 'E' ? 3 : L === 'S' ? cfg.maxS : RARE.has(L) ? 1 : 2;
      if (c >= cap) continue;
      counts[L] = c + 1;
      if (VOWELS.has(L)) vowels++;
      tiles.push(L);
    }
    if (vowels >= cfg.vowels[0] && vowels <= cfg.vowels[1]) return rng.shuffle(tiles);
  }
}

/**
 * Find every dictionary word on the board.
 * @returns {Array<{word:string, path:number[], common:boolean}>} sorted by length desc, then alpha
 */
export function solve(tiles, size, dict) {
  const adj = adjacency(size);
  const lower = tiles.map(t => t.toLowerCase());
  const found = new Map();
  const used = new Uint8Array(tiles.length);
  const path = [];
  const words = dict.words;

  function dfs(cell, prefix, lo, hi) {
    const p = prefix + lower[cell];
    const [a, b] = dict.narrow(p, lo, hi);
    if (a === b) return;
    used[cell] = 1;
    path.push(cell);
    if (p.length >= MIN_WORD && words[a] === p && !found.has(p)) {
      found.set(p, { word: p, path: path.slice(), common: dict.common[a] === 1 });
    }
    for (const nb of adj[cell]) if (!used[nb]) dfs(nb, p, a, b);
    path.pop();
    used[cell] = 0;
  }
  for (let i = 0; i < tiles.length; i++) dfs(i, '', 0, words.length);
  return [...found.values()].sort(compareWords);
}

export function compareWords(a, b) {
  const wa = a.word ?? a, wb = b.word ?? b;
  return wb.length - wa.length || (wa < wb ? -1 : wa > wb ? 1 : 0);
}

export function boardStats(solution) {
  let common = 0, longest = 0;
  for (const s of solution) {
    if (s.common) common++;
    if (s.word.length > longest) longest = s.word.length;
  }
  return { total: solution.length, common, longest };
}

/**
 * Deterministically generate a strong board from a seed.
 * Rejects weak boards (too few words / no long word).
 */
export function generateBoard(seed, size, dict, { maxAttempts = 400 } = {}) {
  const cfg = SIZES[size];
  if (!cfg) throw new Error('unsupported size ' + size);
  const rng = makeRng(`gridword:${size}:${seed}`);
  let best = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const tiles = randomTiles(rng, size);
    const solution = solve(tiles, size, dict);
    const stats = boardStats(solution);
    const ok = stats.common >= cfg.minCommon && stats.total >= cfg.minTotal && stats.longest >= cfg.minLongest;
    if (!best || stats.common > best.stats.common) best = { tiles, solution, stats, attempts: attempt };
    if (ok) return { seed, size, tiles, solution, stats, attempts: attempt };
  }
  return { seed, size, ...best, attempts: maxAttempts };
}

/** Word spelled by a path of tile indices (lowercase). */
export function wordFromPath(tiles, path) {
  return path.map(i => tiles[i]).join('').toLowerCase();
}

/** Is `path` a legal chain (adjacent, no repeats)? */
export function isValidPath(size, path) {
  const seen = new Set();
  for (let i = 0; i < path.length; i++) {
    if (seen.has(path[i]) || path[i] < 0 || path[i] >= size * size) return false;
    seen.add(path[i]);
    if (i > 0 && !isAdjacent(size, path[i - 1], path[i])) return false;
  }
  return true;
}

/**
 * Find a path spelling `letters` (lowercase, may be a partial word) on the board.
 * Prefers paths that start with `prefer` (keeps highlights stable while typing).
 * Returns null if impossible.
 */
export function findPath(tiles, size, letters, prefer = []) {
  letters = letters.toLowerCase();
  if (!letters) return [];
  const adj = adjacency(size);
  const lower = tiles.map(t => t.toLowerCase());
  const used = new Uint8Array(tiles.length);
  const path = [];
  function dfs(cell, pos) {
    const t = lower[cell];
    // allow a trailing lone 'q' to match a Qu tile while the user is mid-typing
    if (letters.startsWith(t, pos)) pos += t.length;
    else if (t === 'qu' && pos === letters.length - 1 && letters[pos] === 'q') pos += 1;
    else return false;
    used[cell] = 1; path.push(cell);
    if (pos === letters.length) return true;
    const order = orderNeighbours(adj[cell], path.length);
    for (const nb of order) if (!used[nb] && dfs(nb, pos)) return true;
    used[cell] = 0; path.pop();
    return false;
  }
  function orderNeighbours(list, depth) {
    const want = prefer[depth];
    if (want === undefined || !list.includes(want)) return list;
    return [want, ...list.filter(x => x !== want)];
  }
  const starts = [...tiles.keys()];
  if (prefer.length && prefer[0] < tiles.length) starts.unshift(prefer[0]);
  for (const s of starts) {
    if (dfs(s, 0)) return path;
  }
  return null;
}
