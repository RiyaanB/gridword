import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previousKey } from '../docs/js/core/daily.js';

// minimal localStorage shim
const mem = new Map();
globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
const store = await import('../docs/js/ui/store.js');

test('previousKey handles month/year boundaries', () => {
  assert.equal(previousKey('2026-12-01'), '2026-11-30');
  assert.equal(previousKey('2027-01-01'), '2026-12-31');
  assert.equal(previousKey('2028-03-01'), '2028-02-29');
});

test('daily streaks, one try, unfinished rounds', () => {
  mem.clear(); store.reload();
  const play = (key, n, points) => {
    store.beginDaily(key, n, previousKey(key));
    store.recordRound({ mode: 'daily', size: 4, points, words: 3, best: 'tone', found: ['tone'], dailyKey: key, dailyNumber: n, prevDailyKey: previousKey(key) });
  };
  play('2026-11-21', 1, 10);
  play('2026-11-22', 2, 20);
  let d = store.reload().daily;
  assert.equal(d.played, 2);
  assert.equal(d.streak, 2);
  assert.equal(d.history['2026-11-22'].points, 20);
  assert.ok(!d.history['2026-11-22'].inProgress);
  // replaying the same day doesn't count again or overwrite
  play('2026-11-22', 2, 99);
  d = store.reload().daily;
  assert.equal(d.played, 2);
  assert.equal(d.history['2026-11-22'].points, 20);
  // abandoned (tab closed) round still uses the try
  store.beginDaily('2026-11-23', 3, '2026-11-22');
  d = store.reload().daily;
  assert.equal(d.played, 3);
  assert.equal(d.streak, 3);
  assert.ok(d.history['2026-11-23'].inProgress);
  // skipping a day resets
  play('2026-11-25', 5, 5);
  assert.equal(store.reload().daily.streak, 1);
  assert.equal(store.reload().daily.maxStreak, 3);
  assert.equal(store.currentStreak('2026-11-25', '2026-11-24'), 1);
  assert.equal(store.currentStreak('2026-11-30', '2026-11-29'), 0, 'stale streak shows 0');
});

test('solo + bots stats', () => {
  mem.clear(); store.reload();
  store.recordRound({ mode: 'solo', size: 4, points: 12, words: 5, best: 'stone', found: [] });
  const f = store.recordRound({ mode: 'solo', size: 4, points: 20, words: 6, best: 'stones', found: [] });
  assert.ok(f.newBest);
  store.recordRound({ mode: 'bots', size: 4, points: 9, words: 4, best: 'ton', found: [], won: true });
  const d = store.reload();
  assert.equal(d.solo[4].best, 20);
  assert.equal(d.solo[4].played, 2);
  assert.equal(d.bots.wins, 1);
  assert.equal(d.bestWord, 'stones');
  assert.equal(d.totals.words, 15);
});

test('corrupted storage falls back to defaults', () => {
  mem.set('gridword:v1', '{not json');
  const d = store.reload();
  assert.equal(d.size, 4);
});
