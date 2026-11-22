// Build docs/data/words.txt from public-domain sources.
// Usage: node tools/build-dict.mjs <enable1.txt> <2of12id.txt>
//   enable1.txt : ENABLE word list (public domain)
//   2of12id.txt : 12dicts "2of12id" list by Alan Beale (public domain) — used only
//                 to flag "common" words (bots + end-screen reveal prefer these).
// Output format (front-coded, sorted): one line per word,
//   first char = code: 'A'+p for common words, 'a'+p for others, where p = length of
//   prefix shared with the previous word (0..15); rest of line = remaining suffix.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const [enablePath, commonPath] = process.argv.slice(2);
if (!enablePath || !commonPath) {
  console.error('usage: node tools/build-dict.mjs <enable1.txt> <2of12id.txt>');
  process.exit(1);
}
const MIN = 3, MAX = 16;

const block = readFileSync(join(here, 'blocklist.txt'), 'utf8')
  .split('\n').map(s => s.trim().toLowerCase()).filter(s => s && !s.startsWith('#'));
const exact = new Set(block.filter(s => !s.endsWith('*')));
const stems = block.filter(s => s.endsWith('*')).map(s => s.slice(0, -1));
const blocked = w => exact.has(w) || stems.some(s => w.startsWith(s));

const common = new Set();
for (const line of readFileSync(commonPath, 'utf8').split('\n')) {
  const m = line.match(/^([a-z]+)\s+[A-Z]:?\s*(.*)$/);
  if (!m) continue;
  common.add(m[1]);
  // plain inflections only; '~' = uncommon, '(...)' = variant, skip those
  for (const tok of m[2].replace(/\([^)]*\)/g, ' ').split(/\s+/)) {
    if (/^[a-z]+$/.test(tok)) common.add(tok);
  }
}

let removed = 0;
const words = [...new Set(readFileSync(enablePath, 'utf8').split(/\r?\n/).map(w => w.trim().toLowerCase()))]
  .filter(w => /^[a-z]+$/.test(w) && w.length >= MIN && w.length <= MAX)
  // a lone 'q' not followed by 'u' can never be spelled on our board (Qu tile)
  .filter(w => !/q(?!u)/.test(w))
  .filter(w => { if (blocked(w)) { removed++; return false; } return true; })
  .sort();

let prev = '', out = [], nCommon = 0;
for (const w of words) {
  let p = 0;
  while (p < prev.length && p < w.length && p < 15 && prev[p] === w[p]) p++;
  const isCommon = common.has(w);
  if (isCommon) nCommon++;
  out.push(String.fromCharCode((isCommon ? 65 : 97) + p) + w.slice(p));
  prev = w;
}
const text = out.join('\n') + '\n';
writeFileSync(join(here, '..', 'docs', 'data', 'words.txt'), text);
console.log(`words: ${words.length}, common: ${nCommon}, blocked: ${removed}, bytes: ${text.length}`);
