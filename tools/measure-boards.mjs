import { readFileSync } from 'node:fs';
import { Dictionary } from '../docs/js/core/dict.js';
import { generateBoard } from '../docs/js/core/board.js';
let t0 = performance.now();
const dict = new Dictionary(readFileSync(new URL('../docs/data/words.txt', import.meta.url), 'utf8'));
console.log('decode ms', (performance.now() - t0).toFixed(1), dict.size);
for (const size of [4, 5]) {
  const att = [], com = [], tot = [];
  t0 = performance.now();
  for (let i = 0; i < 40; i++) {
    const b = generateBoard('m' + i, size, dict);
    att.push(b.attempts); com.push(b.stats.common); tot.push(b.stats.total);
  }
  const ms = (performance.now() - t0) / 40;
  const avg = a => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
  console.log(size, 'avg ms/board', ms.toFixed(1), 'attempts', avg(att), Math.max(...att), 'common', avg(com), 'total', avg(tot));
}
