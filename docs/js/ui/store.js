// localStorage persistence (stats, settings). Everything stays on this device.
const KEY = 'gridword:v1';

const DEFAULTS = () => ({
  muted: false, size: 4, botCount: 4, botLevel: 'normal', seenHowTo: false,
  solo: { 4: { played: 0, best: 0, bestWords: 0 }, 5: { played: 0, best: 0, bestWords: 0 } },
  bots: { played: 0, wins: 0, best: 0 },
  daily: { played: 0, streak: 0, maxStreak: 0, lastKey: '', best: 0, history: {} },
  totals: { words: 0, points: 0 },
  bestWord: '',
});

let data = null;

export function load() {
  if (data) return data;
  data = DEFAULTS();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      data = deepMerge(DEFAULTS(), saved);
    }
  } catch { /* private mode / corrupted — fall back to defaults */ }
  return data;
}

/** Re-read from localStorage (another tab may have written). */
export function reload() { data = null; return load(); }

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* ignore quota/private mode */ }
}

function deepMerge(base, over) {
  for (const k of Object.keys(over || {})) {
    const v = over[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') base[k] = deepMerge(base[k], v);
    else base[k] = v;
  }
  return base;
}

function countDaily(dd, key, prevKey) {
  dd.played++;
  dd.streak = dd.lastKey && dd.lastKey === prevKey ? dd.streak + 1 : 1;
  dd.maxStreak = Math.max(dd.maxStreak, dd.streak);
  dd.lastKey = key;
  const keys = Object.keys(dd.history).sort(); // keep history small
  while (keys.length > 60) delete dd.history[keys.shift()];
}

/**
 * Called when the Daily board is revealed: the one try is used even if the tab is closed.
 * An unfinished entry shows as a 0-point result.
 */
export function beginDaily(key, number, prevKey) {
  const d = load();
  const dd = d.daily;
  if (dd.history[key]) return;
  countDaily(dd, key, prevKey);
  dd.history[key] = { number, points: 0, words: 0, best: '', found: [], inProgress: true };
  save();
}

/** Streak that is still alive (played today or yesterday). */
export function currentStreak(todayKey, yesterdayKey) {
  const dd = load().daily;
  return dd.lastKey === todayKey || dd.lastKey === yesterdayKey ? dd.streak : 0;
}

function better(a, b) { return !a || b.length > a.length || (b.length === a.length && b < a); }

/** Record a finished round. Returns flags like {newBest}. */
export function recordRound({ mode, size, points, words, best, found, dailyKey, dailyNumber, prevDailyKey, won }) {
  const d = load();
  const flags = {};
  d.totals.words += words;
  d.totals.points += points;
  if (best && better(d.bestWord, best)) { d.bestWord = best; flags.bestWordEver = true; }
  if (mode === 'solo') {
    const s = d.solo[size];
    s.played++;
    if (points > s.best) { flags.newBest = s.played > 1 || points > 0; s.best = points; }
    s.bestWords = Math.max(s.bestWords, words);
  } else if (mode === 'bots') {
    d.bots.played++;
    if (won) d.bots.wins++;
    if (points > d.bots.best) { d.bots.best = points; flags.newBest = d.bots.played > 1; }
  } else if (mode === 'daily') {
    const dd = d.daily;
    const h = dd.history[dailyKey];
    if (!h || h.inProgress) {
      if (!h) countDaily(dd, dailyKey, prevDailyKey);
      if (points > dd.best) { dd.best = points; flags.newBest = dd.played > 1; }
      dd.history[dailyKey] = { number: dailyNumber, points, words, best, found };
    }
  }
  save();
  return flags;
}
