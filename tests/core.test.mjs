import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Dictionary } from '../docs/js/core/dict.js';
import { makeRng, hashString } from '../docs/js/core/rng.js';
import { generateBoard, solve, findPath, isValidPath, wordFromPath, adjacency, isAdjacent } from '../docs/js/core/board.js';
import { wordPoints } from '../docs/js/core/scoring.js';
import { botSchedule, pickBots, BOT_ROSTER, DIFFICULTIES, botPar, parBeaten } from '../docs/js/core/bots.js';
import { createMatch, submitWord, advanceBots, finishMatch, longestMissed, standings } from '../docs/js/core/game.js';
import { dailyInfo, shareText } from '../docs/js/core/daily.js';

const dict = new Dictionary(readFileSync(new URL('../docs/data/words.txt', import.meta.url), 'utf8'));

test('dictionary decodes and looks up', () => {
  assert.ok(dict.size > 150000);
  for (const w of ['cat', 'strange', 'queen', 'words', 'grid']) assert.ok(dict.has(w), w);
  assert.ok(!dict.has('xqzt'));
  assert.ok(!dict.has('ca'), 'two-letter words excluded');
  assert.ok(dict.isCommon('house'));
  assert.ok(dict.hasPrefix('stra'));
  // sorted
  for (let i = 1; i < 2000; i++) assert.ok(dict.words[i - 1] < dict.words[i]);
});

test('blocklist removed offensive words', () => {
  for (const w of ['fuck', 'shit', 'bitch', 'whore', 'faggot']) assert.ok(!dict.has(w), w);
  for (const w of ['cocoon', 'raccoon', 'assemble', 'class', 'scunthorpe'.slice(0, 0) || 'title']) assert.ok(dict.has(w), w);
});

test('rng is deterministic', () => {
  const a = makeRng('x'), b = makeRng('x'), c = makeRng('y');
  const sa = [a.next(), a.next()], sb = [b.next(), b.next()];
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, [c.next(), c.next()]);
  assert.equal(hashString('abc'), hashString('abc'));
});

test('adjacency', () => {
  const adj = adjacency(4);
  assert.equal(adj[0].length, 3);
  assert.equal(adj[5].length, 8);
  assert.ok(isAdjacent(4, 0, 5));
  assert.ok(!isAdjacent(4, 3, 4)); // row wrap is not adjacent
});

test('solver finds known words with valid paths', () => {
  const tiles = ['C', 'A', 'T', 'S', 'X', 'R', 'E', 'X', 'X', 'X', 'D', 'X', 'X', 'X', 'X', 'X'];
  const sol = solve(tiles, 4, dict);
  const words = sol.map(s => s.word);
  for (const w of ['cat', 'cats', 'car', 'care', 'cared', 'rat', 'rate', 'rated', 'tar']) assert.ok(words.includes(w), w);
  for (const s of sol) {
    assert.ok(isValidPath(4, s.path), s.word);
    assert.equal(wordFromPath(tiles, s.path), s.word);
  }
});

test('Qu tile spells two letters', () => {
  const tiles = ['QU', 'E', 'E', 'N', 'I', 'T', 'X', 'X', 'X', 'X', 'X', 'X', 'X', 'X', 'X', 'X'];
  const words = solve(tiles, 4, dict).map(s => s.word);
  assert.ok(words.includes('queen'));
  assert.ok(words.includes('quiet') || words.includes('quit') || words.includes('quite'));
  const p = findPath(tiles, 4, 'queen');
  assert.deepEqual(p, [0, 1, 2, 3]);
  assert.deepEqual(findPath(tiles, 4, 'q'), [0]);
});

test('findPath respects adjacency and preference', () => {
  const tiles = ['A', 'B', 'A', 'X', 'X', 'X', 'X', 'X', 'X', 'X', 'X', 'X', 'X', 'X', 'X', 'X'];
  assert.deepEqual(findPath(tiles, 4, 'ab'), [0, 1]);
  assert.deepEqual(findPath(tiles, 4, 'ab', [2]), [2, 1]);
  assert.equal(findPath(tiles, 4, 'aa'), null);
  assert.equal(findPath(tiles, 4, 'z'), null);
});

test('board generation is deterministic and strong', () => {
  for (const size of [4, 5]) {
    const a = generateBoard('seed-1', size, dict), b = generateBoard('seed-1', size, dict);
    assert.deepEqual(a.tiles, b.tiles);
    assert.equal(a.tiles.length, size * size);
    for (let i = 0; i < 20; i++) {
      const g = generateBoard('s' + i, size, dict);
      assert.ok(g.stats.common >= (size === 4 ? 75 : 170), `common ${g.stats.common}`);
      assert.ok(g.stats.longest >= (size === 4 ? 6 : 7));
    }
  }
  assert.notDeepEqual(generateBoard('a', 4, dict).tiles, generateBoard('b', 4, dict).tiles);
});

test('scoring favours long words', () => {
  assert.equal(wordPoints('ab'), 0);
  assert.equal(wordPoints('cat'), 1);
  assert.equal(wordPoints('cats'), 2);
  assert.equal(wordPoints('strange'), 10);
  assert.ok(wordPoints('strangers') > wordPoints('stranger'));
});

test('bots: deterministic, ordered, skill-ranked', () => {
  const board = generateBoard('bots', 4, dict);
  const runs = BOT_ROSTER.map(b => botSchedule(b, board.solution, 90, board.seed));
  assert.deepEqual(runs[0], botSchedule(BOT_ROSTER[0], board.solution, 90, board.seed));
  for (const r of runs) {
    for (let i = 1; i < r.length; i++) assert.ok(r[i].t >= r[i - 1].t);
    for (const e of r) assert.ok(e.t > 0 && e.t < 90);
  }
  // average over boards: higher tiers find more
  const totals = BOT_ROSTER.map(() => 0);
  for (let i = 0; i < 15; i++) {
    const b = generateBoard('avg' + i, 4, dict);
    BOT_ROSTER.forEach((bot, k) => { totals[k] += botSchedule(bot, b.solution, 90, b.seed).length; });
  }
  for (let k = 1; k < totals.length; k++) assert.ok(totals[k] > totals[k - 1], totals.join(','));
  assert.equal(pickBots(3).length, 3);
  assert.equal(pickBots(5).length, 5);
});

test('bots: difficulty lineups are honest, unique and ordered', () => {
  const rank = ['Rookie', 'Casual', 'Sharp', 'Ace', 'Pro'];
  const top = {};
  for (const d of Object.keys(DIFFICULTIES)) for (const n of [3, 4, 5]) {
    const L = pickBots(n, d);
    assert.equal(L.length, n);
    assert.equal(new Set(L.map(b => b.id)).size, n, 'unique ids');
    assert.equal(new Set(L.map(b => b.color)).size, n, 'distinct colours');
    for (const b of L) assert.ok(rank.includes(b.level) && b.name && b.id.startsWith('bot-'));
    const best = Math.max(...L.map(b => rank.indexOf(b.level)));
    if (top[d] === undefined) top[d] = best; else assert.equal(top[d], best, 'same strongest tier for every count');
  }
  assert.ok(top.easy < top.normal && top.normal < top.hard);
  assert.ok(!pickBots(5, 'easy').some(b => b.level === 'Pro'));
  assert.deepEqual(pickBots(4, 'bogus').map(b => b.id), pickBots(4, 'normal').map(b => b.id));
});

test('bots: par is deterministic and parBeaten counts correctly', () => {
  const b = generateBoard('par', 4, dict);
  const par = botPar(b.solution, 90, b.seed, 4);
  assert.deepEqual(par, botPar(b.solution, 90, b.seed, 4));
  assert.equal(par.length, 5);
  assert.equal(parBeaten(par, 0, 0), 0);
  assert.equal(parBeaten(par, 10000, 1), 5);
  const mid = par[2];
  assert.equal(parBeaten([mid], mid.score + 1, 0), 1);
  assert.equal(parBeaten([mid], mid.score, mid.words), mid.score > 0 ? 1 : 0);
  assert.equal(parBeaten([mid], mid.score, mid.words - 1), 0);
});

test('match flow: submit, duplicates, bots, results', () => {
  const players = [{ id: 'you', name: 'You', kind: 'human' }, ...pickBots(4).map(b => ({ ...b, kind: 'bot' }))];
  const m = createMatch({ seed: 'match', size: 4, players, dict });
  const w = m.solution[m.solution.length - 1].word;
  assert.equal(submitWord(m, 'you', w, 5).status, 'ok');
  assert.equal(submitWord(m, 'you', w, 6).status, 'dup');
  assert.equal(submitWord(m, 'you', 'ab', 6).status, 'short');
  assert.equal(submitWord(m, 'you', 'zzzq', 6).status, 'invalid');
  const absent = ['zebra', 'xylophone', 'jukebox', 'quizzed'].find(x => !m.solutionMap.has(x));
  assert.equal(submitWord(m, 'you', absent, 6).status, 'notonboard');
  assert.equal(m.scores.you, wordPoints(w));
  const ev = advanceBots(m, 45);
  assert.ok(ev.every(e => e.t <= 45));
  assert.equal(submitWord(m, 'you', m.solution[0].word, 91).status, 'over');
  const res = finishMatch(m);
  assert.equal(res.ranking.length, 5);
  assert.ok(res.all.find(a => a.word === w).finders.includes('you'));
  assert.equal(submitWord(m, 'you', m.solution[1].word, 50).status, 'over');
  assert.ok(longestMissed(m, 'you').every(s => s.word !== w));
  assert.equal(standings(m)[0].score, Math.max(...Object.values(m.scores)));
});

test('daily info + share text', () => {
  assert.equal(dailyInfo({ y: 2026, m: 11, d: 21 }).number, 1);
  assert.equal(dailyInfo({ y: 2026, m: 12, d: 2 }).number, 12);
  assert.equal(dailyInfo({ y: 2027, m: 1, d: 1 }).key, '2027-01-01');
  const txt = shareText({ number: 12, words: 31, points: 148, best: 'strange' });
  assert.equal(txt, 'Gridword #12 🔤 31 words · 148 pts · best: STRANGE');
  const full = shareText({ number: 3, words: 2, points: 5, best: 'tones', found: ['tones', 'ton'], totalCommon: 10 });
  assert.match(full, /3️⃣×1 5️⃣×1/);
  assert.match(full, /🟩🟩⬜/);
  assert.ok(!full.includes('🤖'));
  assert.match(shareText({ number: 3, words: 2, points: 5, best: 'tones', botsBeaten: 3, botsTotal: 5 }), /\n🤖 Beat 3\/5 bots$/);
});
