// QA playthrough: plays FULL real-time rounds (no clock skipping) with a simulated human
// (realistic swipe speed, think time, misses, duplicates) and screenshots key moments.
// Usage: node tests/qa-play.mjs [port] [outDir] [sessions]
//   sessions: comma list of desktop-solo,desktop-bots,phone-daily,phone-bots,desktop-5x5 (default all)
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = +(process.argv[2] || 8854);
const OUT = process.argv[3] || '/workspace/arcade-shots/qa/gridword';
const ONLY = (process.argv[4] || '').split(',').filter(Boolean);
const BASE = `http://localhost:${PORT}/`;
mkdirSync(OUT, { recursive: true });
const server = spawn('python3', ['-m', 'http.server', String(PORT), '-d', new URL('../docs', import.meta.url).pathname], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const DESK = { viewport: { width: 1280, height: 800 } };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const log = [];
const L = (...a) => { const s = a.join(' '); log.push(s); console.log(s); };
const rand = (() => { let s = 12345; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; })();

async function session(name, opts, fn, { fresh = true, query = '?test' } = {}) {
  if (ONLY.length && !ONLY.includes(name)) return;
  L(`\n=== ${name} ===`);
  const ctx = await browser.newContext(opts);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  if (!fresh) await page.addInitScript(() => { if (!localStorage.getItem('gridword:v1')) localStorage.setItem('gridword:v1', JSON.stringify({ seenHowTo: true })); });
  const cdp = opts.hasTouch ? await ctx.newCDPSession(page) : null;
  const t0 = Date.now();
  await page.goto(BASE + query);
  await page.waitForSelector('#loading.done', { state: 'attached', timeout: 15000 });
  L(`load→ready ${Date.now() - t0} ms`);
  const shot = (n, full = false) => page.screenshot({ path: `${OUT}/${name}-${n}.png`, fullPage: full });
  const api = { page, cdp, shot, ...helpers(page, cdp) };
  try { await fn(api); } catch (e) { L('SESSION ERROR', e.stack); await shot('ERROR'); }
  L(`console/page errors+warnings: ${errors.length}`); errors.forEach(e => L('  ' + e));
  await ctx.close();
}

function helpers(page, cdp) {
  const center = i => page.evaluate(i => window.__gw.tileCenter(i), i);
  async function swipe(path, speed = 1) {
    const pts = []; for (const i of path) pts.push(await center(i));
    if (cdp) {
      const tp = p => [{ x: p.x, y: p.y, id: 1, radiusX: 6, radiusY: 6, force: 1 }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(pts[0]) });
      for (let k = 1; k < pts.length; k++) {
        const a = pts[k - 1], b = pts[k];
        for (let s = 1; s <= 5; s++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp({ x: a.x + (b.x - a.x) * s / 5 + (rand() - 0.5) * 6, y: a.y + (b.y - a.y) * s / 5 + (rand() - 0.5) * 6 }) });
          await page.waitForTimeout(18 / speed);
        }
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(pts[0].x, pts[0].y); await page.mouse.down();
      for (let k = 1; k < pts.length; k++) { await page.mouse.move(pts[k].x + (rand() - 0.5) * 8, pts[k].y + (rand() - 0.5) * 8, { steps: 6 }); await page.waitForTimeout(40 / speed); }
      await page.mouse.up();
    }
  }
  const state = () => page.evaluate(() => {
    const m = window.__gw.match;
    return { t: window.__gw.now(), dur: m.duration, scores: { ...m.scores }, mine: m.found.you.map(f => f.word), size: m.size,
      players: m.players.map(p => ({ id: p.id, name: p.name, kind: p.kind, level: p.level })) };
  });
  async function waitPlaying() { await page.waitForFunction(() => window.__gw?.screen === 'game' && window.__gw.board.enabled, null, { timeout: 15000 }); }
  /** Simulated human for a whole round in real time. */
  async function playRound({ skill = 'casual', type = false, shots = {}, shotFn, tapSome = false } = {}) {
    await waitPlaying();
    const sol = await page.evaluate(() => window.__gw.match.solution.map(s => ({ w: s.word, p: s.path, c: s.common })));
    const size = await page.evaluate(() => window.__gw.match.size);
    const common = sol.filter(s => s.c);
    const gap = skill === 'good' ? [1.6, 3.0] : [2.4, 4.6];
    const lenW = skill === 'good' ? { 3: .25, 4: .35, 5: .25, 6: .1, 7: .05 } : { 3: .4, 4: .38, 5: .17, 6: .05 };
    let attempts = 0, valid = 0, bad = 0, dup = 0; const taken = new Set(); const shotsDone = new Set();
    while (true) {
      const st = await state();
      if (await page.evaluate(() => window.__gw.screen !== 'game' || !window.__gw.board.enabled)) break;
      for (const [at, label] of Object.entries(shots)) if (!shotsDone.has(at) && st.t >= +at) { shotsDone.add(at); await shotFn(label, st); }
      const think = (gap[0] + rand() * (gap[1] - gap[0])) * 1000;
      await page.waitForTimeout(think);
      if (await page.evaluate(() => window.__gw.screen !== 'game' || !window.__gw.board.enabled)) break;
      attempts++;
      const r = rand();
      let pick = null, kind = 'valid';
      if (r < 0.18) kind = 'bad';
      else if (r < 0.26 && taken.size) kind = 'dup';
      if (kind === 'valid') {
        let roll = rand(), len = 3; for (const [k, v] of Object.entries(lenW)) { if ((roll -= v) <= 0) { len = +k; break; } len = +k; }
        const pool = common.filter(s => !taken.has(s.w) && (len >= 6 ? s.w.length >= 6 : s.w.length === len));
        pick = pool[Math.floor(rand() * pool.length)] || common.find(s => !taken.has(s.w));
        if (!pick) kind = 'bad';
      }
      if (kind === 'dup') { const dw = [...taken][Math.floor(rand() * taken.size)]; pick = sol.find(s => s.w === dw); }
      if (kind === 'bad') {
        // random adjacent walk of 3-4 tiles that isn't a word
        let p; for (let tries = 0; tries < 50; tries++) {
          p = [Math.floor(rand() * size * size)];
          while (p.length < 3 + (rand() < .5 ? 1 : 0)) {
            const a = p[p.length - 1], r0 = Math.floor(a / size), c0 = a % size; const nb = [];
            for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const rr = r0 + dr, cc = c0 + dc; if ((dr || dc) && rr >= 0 && cc >= 0 && rr < size && cc < size && !p.includes(rr * size + cc)) nb.push(rr * size + cc); }
            if (!nb.length) break; p.push(nb[Math.floor(rand() * nb.length)]);
          }
          const w = await page.evaluate(p => p.map(i => window.__gw.match.tiles[i]).join('').toLowerCase(), p);
          if (!sol.some(s => s.w === w)) break;
        }
        pick = { p, w: '(nonword)' };
      }
      if (type && kind !== 'bad' && rand() < 0.5) { await page.keyboard.type(pick.w, { delay: 70 }); await page.keyboard.press('Enter'); }
      else if (tapSome && cdp && rand() < 0.2) {
        for (const i of pick.p) { const c = await center(i); await page.touchscreen.tap(c.x, c.y); await page.waitForTimeout(150); }
        const last = await center(pick.p[pick.p.length - 1]); await page.touchscreen.tap(last.x, last.y);
      } else await swipe(pick.p);
      if (kind === 'valid') { valid++; taken.add(pick.w); } else if (kind === 'bad') bad++; else dup++;
    }
    const st = await page.evaluate(() => ({ scores: window.__gw.match.scores, found: Object.fromEntries(Object.entries(window.__gw.match.found).map(([k, v]) => [k, v.length])), common: window.__gw.match.stats.common, total: window.__gw.match.solution.length }));
    L(`attempts ${attempts} (valid ${valid}, nonword ${bad}, dup ${dup}); board common ${st.common}, total ${st.total}`);
    L(`final scores ${JSON.stringify(st.scores)} words ${JSON.stringify(st.found)}`);
    return st;
  }
  async function waitResults() { await page.waitForFunction(() => window.__gw.screen === 'results', null, { timeout: 20000 }); }
  return { swipe, state, waitPlaying, playRound, waitResults, center };
}

// ---------------------------------------------------------------- sessions
await session('desk-solo', DESK, async ({ page, shot, playRound, waitResults }) => {
  // brand-new player, real countdown timing (no ?test for the first look)
  await page.goto(BASE); await page.waitForSelector('#loading.done', { state: 'attached' });
  await page.waitForTimeout(300); await shot('00-first-visit');
  for (let i = 1; i <= 3; i++) { await page.waitForTimeout(900); await shot(`01-howto-${i}`); await page.click('#howto-next'); }
  await page.waitForTimeout(1500); await shot('02-title');
  await page.click('#btn-solo');
  for (let i = 0; i < 4; i++) { await shot(`03-countdown-${i}`); await page.waitForTimeout(650); }
  await page.waitForTimeout(400); await shot('04-board-revealed');
  // first-timer: tap a single tile, then click elsewhere – what happens?
  const tileBox = await page.locator('.tile').first().boundingBox();
  await page.mouse.click(tileBox.x + tileBox.width / 2, tileBox.y + tileBox.height / 2);
  await page.waitForTimeout(200); await shot('05-single-click');
  await page.keyboard.press('Escape');
  // now play a full round with the test hook
  await page.goto(BASE + '?test'); await page.waitForSelector('#loading.done', { state: 'attached' });
  await page.click('#btn-solo');
  const shots = { 1: 'early', 20: 't20', 45: 't45', 82: 'last10' };
  await playRound({ skill: 'casual', type: true, shots, shotFn: async l => shot('10-' + l) });
  await page.waitForTimeout(250); await shot('11-times-up');
  await waitResults(); await page.waitForTimeout(500); await shot('12-results-early');
  await page.waitForTimeout(3200); await shot('13-results'); await shot('14-results-full', true);
  L('results kicker:', await page.textContent('#res-kicker'), '| badges:', await page.textContent('#res-badges'));
  await page.click('#btn-again'); await page.waitForTimeout(200); await shot('15-again-countdown');
}, { fresh: true });

await session('desk-bots', DESK, async ({ page, shot, playRound, waitResults }) => {
  await page.click('#btn-bots'); await page.waitForTimeout(400);
  await page.click('[data-bots="5"]'); await page.click('[data-diff="hard"]'); await page.waitForTimeout(200); await shot('01-sheet-5');
  await page.click('#bots-start');
  await playRound({ skill: 'good', type: true, shots: { 5: 't05', 30: 't30', 60: 't60', 85: 't85' }, shotFn: async l => shot('02-' + l) });
  await waitResults(); await page.waitForTimeout(3600); await shot('03-results'); await shot('04-results-full', true);
  L('standings:', (await page.textContent('#res-standings')).replace(/\s+/g, ' '));
}, { fresh: false });

await session('phone-daily', PHONE, async ({ page, shot, playRound, waitResults }) => {
  await page.waitForTimeout(400); await shot('00-first-visit');
  await page.click('#howto-skip'); await page.waitForTimeout(1500); await shot('01-title');
  await page.click('#btn-daily');
  await playRound({ skill: 'casual', tapSome: true, shots: { 2: 't02', 40: 't40', 84: 't84' }, shotFn: async l => shot('02-' + l) });
  await waitResults(); await page.waitForTimeout(3600); await shot('03-results'); await shot('04-results-full', true);
  await page.click('#btn-share'); await page.waitForTimeout(400); await shot('05-shared');
  L('share text:\n' + await page.evaluate(() => navigator.clipboard.readText().catch(() => '')));
  await page.click('#btn-menu'); await page.waitForTimeout(600); await shot('06-title-after');
  await page.click('#btn-stats'); await page.waitForTimeout(300); await shot('07-stats');
}, { fresh: true });

await session('phone-bots', PHONE, async ({ page, shot, playRound, waitResults }) => {
  await page.click('#btn-bots'); await page.waitForTimeout(400); await shot('01-sheet');
  await page.click('#bots-start');
  await playRound({ skill: 'casual', tapSome: true, shots: { 3: 't03', 30: 't30', 70: 't70' }, shotFn: async l => shot('02-' + l) });
  await waitResults(); await page.waitForTimeout(3600); await shot('03-results'); await shot('04-results-full', true);
  L('standings:', (await page.textContent('#res-standings')).replace(/\s+/g, ' '));
}, { fresh: false });

await session('desk-5x5', DESK, async ({ page, shot, playRound, waitResults }) => {
  await page.click('[data-size="5"]'); await page.click('#btn-solo');
  await playRound({ skill: 'good', type: true, shots: { 10: 't10', 100: 't100' }, shotFn: async l => shot('01-' + l) });
  await waitResults(); await page.waitForTimeout(3600); await shot('02-results');
}, { fresh: false });

// mid-swipe look: is a valid word signalled before letting go?
await session('phone-hint', PHONE, async ({ page, cdp, shot, waitPlaying, center }) => {
  await page.click('#btn-solo'); await waitPlaying(); await page.waitForTimeout(600);
  const w = await page.evaluate(() => window.__gw.match.solution.find(s => s.common && s.word.length >= 5));
  const pts = []; for (const i of w.path) pts.push(await center(i));
  const tp = p => [{ x: p.x, y: p.y, id: 1, radiusX: 6, radiusY: 6, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(pts[0]) });
  for (let k = 1; k < pts.length; k++) for (let st = 1; st <= 5; st++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp({ x: pts[k - 1].x + (pts[k].x - pts[k - 1].x) * st / 5, y: pts[k - 1].y + (pts[k].y - pts[k - 1].y) * st / 5 }) });
  await page.waitForTimeout(250); await shot('01-mid-swipe-valid');
  L('mid-swipe word', w.word, 'valid class:', await page.evaluate(() => document.querySelector('#current-word').className));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(120); await shot('02-after-release');
}, { fresh: false });

writeFileSync(`${OUT}/qa-log.txt`, log.join('\n'));
await browser.close(); server.kill();
