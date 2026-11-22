// Match state machine. Pure + deterministic: time is always passed in (seconds since start),
// so the same code can run in the browser (solo / vs bots) or on an authoritative server.
import { generateBoard, MIN_WORD, compareWords } from './board.js';
import { wordPoints } from './scoring.js';
import { botSchedule } from './bots.js';

export const DURATIONS = { 4: 90, 5: 120 };

/**
 * @param {object} opts
 * @param {string} opts.seed       board seed (daily key, random id, room id…)
 * @param {4|5}   [opts.size=4]
 * @param {number} [opts.duration]
 * @param {Array}  opts.players    [{id, name, kind:'human'|'bot', ...botFields}]
 * @param {Dictionary} opts.dict
 * @param {object} [opts.board]    pre-generated board (skips generation)
 */
export function createMatch({ seed, size = 4, duration, players, dict, board, mode = 'solo' }) {
  board = board || generateBoard(seed, size, dict);
  duration = duration ?? DURATIONS[size] ?? 90;
  const solutionMap = new Map(board.solution.map(s => [s.word, s]));
  const found = {};
  const scores = {};
  for (const p of players) { found[p.id] = []; scores[p.id] = 0; }
  const botEvents = [];
  for (const p of players) {
    if (p.kind !== 'bot') continue;
    for (const e of botSchedule(p, board.solution, duration, board.seed, size)) botEvents.push({ ...e, playerId: p.id });
  }
  botEvents.sort((a, b) => a.t - b.t || (a.playerId < b.playerId ? -1 : 1));
  return {
    mode, seed: board.seed, size, duration, tiles: board.tiles, solution: board.solution,
    stats: board.stats, solutionMap, players, found, scores, botEvents, botCursor: 0,
    finished: false, dict,
  };
}

/**
 * Submit a word for a player at time t.
 * @returns {{status:'ok'|'dup'|'short'|'invalid'|'notonboard'|'over', word, points}}
 */
export function submitWord(m, playerId, rawWord, t) {
  const word = String(rawWord || '').toLowerCase().replace(/[^a-z]/g, '');
  if (m.finished || t > m.duration) return { status: 'over', word, points: 0 };
  if (word.length < MIN_WORD) return { status: 'short', word, points: 0 };
  const list = m.found[playerId];
  if (!list) throw new Error('unknown player ' + playerId);
  if (list.some(f => f.word === word)) return { status: 'dup', word, points: 0 };
  const entry = m.solutionMap.get(word);
  if (!entry) {
    const inDict = m.dict ? m.dict.has(word) : false;
    return { status: inDict ? 'notonboard' : 'invalid', word, points: 0 };
  }
  const points = wordPoints(word);
  list.push({ word, t, points });
  m.scores[playerId] += points;
  return { status: 'ok', word, points, path: entry.path };
}

/** Advance bots to time t. Returns newly-applied bot events. */
export function advanceBots(m, t) {
  const out = [];
  while (m.botCursor < m.botEvents.length && m.botEvents[m.botCursor].t <= t) {
    const e = m.botEvents[m.botCursor++];
    const list = m.found[e.playerId];
    if (list.some(f => f.word === e.word)) continue;
    list.push({ word: e.word, t: e.t, points: e.points });
    m.scores[e.playerId] += e.points;
    out.push(e);
  }
  return out;
}

export function isOver(m, t) { return m.finished || t >= m.duration; }

/** Finish the match (applies all remaining bot finds) and build the results summary. */
export function finishMatch(m) {
  advanceBots(m, m.duration);
  m.finished = true;
  return matchResults(m);
}

export function standings(m) {
  return m.players
    .map(p => ({ ...p, score: m.scores[p.id], words: m.found[p.id].length }))
    .sort((a, b) => b.score - a.score || b.words - a.words || (a.kind === 'human' ? -1 : 1));
}

export function matchResults(m) {
  const finders = new Map();
  for (const p of m.players) for (const f of m.found[p.id]) {
    if (!finders.has(f.word)) finders.set(f.word, []);
    finders.get(f.word).push(p.id);
  }
  const all = m.solution.map(s => ({
    word: s.word, path: s.path, common: s.common, points: wordPoints(s.word), finders: finders.get(s.word) || [],
  }));
  const ranking = standings(m);
  const perPlayer = {};
  for (const p of m.players) {
    const list = m.found[p.id];
    const best = list.slice().sort((a, b) => compareWords(a, b) || b.points - a.points)[0];
    perPlayer[p.id] = { score: m.scores[p.id], words: list.length, best: best ? best.word : '', found: list.map(f => f.word) };
  }
  return { ranking, all, perPlayer, totalWords: m.solution.length, totalCommon: m.stats.common };
}

/** Longest words on the board that nobody (or a given player) found. */
export function longestMissed(m, playerId, n = 5) {
  const mine = new Set(m.found[playerId].map(f => f.word));
  return m.solution.filter(s => !mine.has(s.word) && s.common).slice(0, n);
}
