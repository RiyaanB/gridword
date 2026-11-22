// Bot opponents. Each bot gets a deterministic "find schedule" for a board:
// which words it will find and when. Bots are always labelled as bots in the UI.
import { makeRng } from './rng.js';
import { wordPoints } from './scoring.js';

// Skill tiers. Each named bot has exactly one tier, and its label always shows that tier.
export const BOT_TIERS = {
  rookie: { level: 'Rookie', vocab: 0.09, longAptitude: 0.55, obscure: 0.00, minGap: 4.6 },
  casual: { level: 'Casual', vocab: 0.15, longAptitude: 0.7,  obscure: 0.01, minGap: 3.7 },
  sharp:  { level: 'Sharp',  vocab: 0.21, longAptitude: 0.85, obscure: 0.03, minGap: 3.0 },
  ace:    { level: 'Ace',    vocab: 0.28, longAptitude: 1.0,  obscure: 0.06, minGap: 2.4 },
  pro:    { level: 'Pro',    vocab: 0.37, longAptitude: 1.15, obscure: 0.10, minGap: 1.9 },
};
const bot = (id, name, color, tier) => ({ id, name, color, tier, ...BOT_TIERS[tier] });

/** One canonical bot per tier, weakest → strongest (also used for the "bot par" benchmark). */
export const BOT_ROSTER = [
  bot('bot-pip', 'Pip', '#7cc6ff', 'rookie'),
  bot('bot-moxie', 'Moxie', '#b892ff', 'casual'),
  bot('bot-rook', 'Rook', '#ffd166', 'sharp'),
  bot('bot-quill', 'Quill', '#5fe3c0', 'ace'),
  bot('bot-vex', 'Vex', '#ff7ab6', 'pro'),
];
// Extra bots so a lineup can hold two bots of the same tier.
const BENCH = [
  bot('bot-bix', 'Bix', '#a3e635', 'rookie'),
  bot('bot-dot', 'Dot', '#fde68a', 'rookie'),
  bot('bot-juno', 'Juno', '#e879f9', 'casual'),
  bot('bot-tally', 'Tally', '#60a5fa', 'sharp'),
];

/** Difficulty = which tiers sit in the lineup. The strongest bot sets the bar to beat. */
export const DIFFICULTIES = {
  easy:   { label: 'Easy',   lineups: { 3: ['rookie', 'rookie', 'casual'], 4: ['rookie', 'rookie', 'casual', 'casual'], 5: ['rookie', 'rookie', 'rookie', 'casual', 'casual'] } },
  normal: { label: 'Normal', lineups: { 3: ['rookie', 'casual', 'sharp'], 4: ['rookie', 'casual', 'casual', 'sharp'], 5: ['rookie', 'rookie', 'casual', 'casual', 'sharp'] } },
  hard:   { label: 'Hard',   lineups: { 3: ['sharp', 'ace', 'pro'], 4: ['casual', 'sharp', 'ace', 'pro'], 5: ['casual', 'sharp', 'sharp', 'ace', 'pro'] } },
};

/** Pick `count` (3–5) bots for a difficulty ('easy' | 'normal' | 'hard'), weakest first. */
export function pickBots(count, difficulty = 'normal') {
  const n = Math.max(3, Math.min(5, count | 0));
  const tiers = (DIFFICULTIES[difficulty] || DIFFICULTIES.normal).lineups[n];
  const pool = [...BOT_ROSTER, ...BENCH];
  const used = new Set();
  return tiers.map(t => {
    const b = pool.find(p => p.tier === t && !used.has(p.id));
    used.add(b.id);
    return { ...b };
  });
}

// How likely a bot is to "see" a word of a given length (before vocab scaling).
const LEN_EASE = { 3: 1.0, 4: 0.95, 5: 0.78, 6: 0.55, 7: 0.36, 8: 0.22 };

/**
 * Deterministic schedule of finds for one bot.
 * @param bot roster entry
 * @param solution board solution [{word, common}]
 * @param duration seconds
 * @param seed any string/number (board seed)
 * @returns Array<{t:number, word:string, points:number}> sorted by t
 */
export function botSchedule(bot, solution, duration, seed, size = 4) {
  const rng = makeRng(`bot:${bot.id}:${seed}`);
  // Bigger boards have more words; scale vocab down a bit so pace stays human-like.
  // Word-rich boards: a human's pace doesn't grow with the word count, so damp the bot's
  // vocabulary on boards richer than typical (poor boards are not boosted).
  const common = solution.reduce((n, s) => n + (s.common ? 1 : 0), 0);
  const typical = size >= 5 ? 225 : 105;
  const scale = (size >= 5 ? 0.72 : 1) * Math.min(1, typical / Math.max(1, common));
  const picks = [];
  for (const s of solution) {
    const len = s.word.length;
    const ease = (LEN_EASE[len] ?? 0.14) ** (1 / bot.longAptitude);
    const p = bot.vocab * scale * ease * (s.common ? 1 : bot.obscure);
    if (rng.next() < p) {
      // short words tend to be spotted earlier, long ones later
      const bias = Math.min(1, (len - 3) / 5);
      const u = rng.next();
      const when = Math.pow(u, 1.25 - bias * 0.6);
      picks.push({ word: s.word, when });
    }
  }
  picks.sort((a, b) => a.when - b.when);
  const out = [];
  let t = 2.2 + rng.next() * 2.5; // reaction delay before the first word
  const usable = duration - 0.6;
  for (const p of picks) {
    const target = 1.5 + p.when * usable;
    t = Math.max(t + bot.minGap * (0.7 + rng.next() * 0.8), target);
    if (t > usable) break;
    out.push({ t: Math.round(t * 100) / 100, word: p.word, points: wordPoints(p.word) });
  }
  return out;
}

/**
 * "Bot par" for a board: what each canonical bot (one per tier) scores on it.
 * Deterministic, so everyone on the same Daily sees the same par.
 */
export function botPar(solution, duration, seed, size = 4) {
  return BOT_ROSTER.map(b => {
    const sched = botSchedule(b, solution, duration, seed, size);
    return { id: b.id, name: b.name, level: b.level, color: b.color, score: sched.reduce((a, e) => a + e.points, 0), words: sched.length };
  });
}

/** How many par bots a player beat (ties on points go to the player with at least as many words). */
export function parBeaten(par, score, words) {
  return par.filter(p => score > p.score || (score === p.score && words >= p.words && score > 0)).length;
}
