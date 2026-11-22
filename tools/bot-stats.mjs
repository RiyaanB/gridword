import { readFileSync } from 'node:fs';
import { Dictionary } from '../docs/js/core/dict.js';
import { generateBoard } from '../docs/js/core/board.js';
import { botSchedule, BOT_ROSTER } from '../docs/js/core/bots.js';
const dict = new Dictionary(readFileSync(new URL('../docs/data/words.txt', import.meta.url), 'utf8'));
for (const [size, dur] of [[4, 90], [5, 120]]) {
  const words = BOT_ROSTER.map(() => 0), pts = BOT_ROSTER.map(() => 0);
  const N = 30;
  for (let i = 0; i < N; i++) {
    const b = generateBoard('x' + i, size, dict);
    BOT_ROSTER.forEach((bot, k) => { const s = botSchedule(bot, b.solution, dur, b.seed, size); words[k] += s.length; pts[k] += s.reduce((a, e) => a + e.points, 0); });
  }
  console.log(size, BOT_ROSTER.map((b, k) => `${b.name}: ${(words[k] / N).toFixed(1)}w ${(pts[k] / N).toFixed(0)}p`).join(' | '));
}
