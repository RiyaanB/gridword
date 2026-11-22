// End-to-end: plays every mode start-to-finish in headless Chrome at desktop + phone sizes.
// Usage: node tests/e2e.mjs [port]   (serves docs/ itself with python3 -m http.server)
// Playwright is borrowed from a sibling project (dev-only; not a dependency of this game).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = +(process.argv[2] || 8852);
const BASE = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS || '/workspace/arcade-shots/gridword';
mkdirSync(SHOTS, { recursive: true });

const server = spawn('python3', ['-m', 'http.server', String(PORT), '-d', new URL('../docs', import.meta.url).pathname], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));

let pass = 0, fail = 0;
const report = [];
function check(cond, msg) {
  if (cond) { pass++; } else { fail++; console.log('  ✗ ' + msg); }
  report.push(`${cond ? 'PASS' : 'FAIL'} ${msg}`);
}

const VIEWPORTS = [
  { name: 'desktop', opts: { viewport: { width: 1280, height: 800 } } },
  { name: 'phone', opts: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
];

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const errorCounts = {};

for (const vp of VIEWPORTS) {
  console.log(`\n=== ${vp.name} ===`);
  const ctx = await browser.newContext({ ...vp.opts });
  await ctx.route(/gc\.zgo\.at|goatcounter\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' })); // analytics stubbed in tests
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  const cdp = vp.opts.hasTouch ? await ctx.newCDPSession(page) : null;
  const shot = name => page.screenshot({ path: `${SHOTS}/${vp.name}-${name}.png` });

  await page.goto(BASE + '?test');
  await page.waitForSelector('#loading.done', { state: 'attached', timeout: 15000 });
  await page.waitForTimeout(400);

  // ---- onboarding (shown automatically on first visit)
  check(await page.isVisible('#modal-howto'), `${vp.name}: how-to opens on first visit`);
  await page.waitForTimeout(500);
  await shot('01-howto-step1');
  await page.click('#howto-next');
  await page.waitForTimeout(700);
  await shot('02-howto-step2');
  await page.click('#howto-next');
  await page.waitForTimeout(500);
  await shot('03-howto-step3');
  await page.click('#howto-next');
  check(!(await page.isVisible('#modal-howto')), `${vp.name}: how-to closes`);
  await page.waitForTimeout(1800); // logo animation
  await shot('04-title');
  await checkNoOverflow(page, vp.name + ' title');

  // ---- helpers
  async function waitPlaying() {
    await page.waitForFunction(() => window.__gw?.screen === 'game' && window.__gw.board.enabled, null, { timeout: 10000 });
    await page.waitForTimeout(500);
  }
  async function swipe(path) {
    const pts = [];
    for (const i of path) pts.push(await page.evaluate(i => window.__gw.tileCenter(i), i));
    if (cdp) {
      const tp = p => [{ x: p.x, y: p.y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(pts[0]) });
      for (let k = 1; k < pts.length; k++) {
        const a = pts[k - 1], b = pts[k];
        for (let s = 1; s <= 4; s++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp({ x: a.x + (b.x - a.x) * s / 4, y: a.y + (b.y - a.y) * s / 4 }) });
        }
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(pts[0].x, pts[0].y);
      await page.mouse.down();
      for (let k = 1; k < pts.length; k++) await page.mouse.move(pts[k].x, pts[k].y, { steps: 4 });
      await page.mouse.up();
    }
    await page.waitForTimeout(160);
  }
  async function playWords(n, { typeSome = false } = {}) {
    const words = await page.evaluate(() => {
      const m = window.__gw.match;
      const mine = new Set(m.found.you.map(f => f.word));
      return m.solution.filter(s => s.common && !mine.has(s.word) && s.word.length <= 6).slice(-40).map(s => ({ w: s.word, p: s.path }));
    });
    let i = 0;
    for (const { w, p } of words.slice(0, n)) {
      if (typeSome && i % 2 === 1) {
        await page.keyboard.type(w, { delay: 25 });
        await page.keyboard.press('Enter');
        await page.waitForTimeout(160);
      } else await swipe(p);
      i++;
    }
    return words.slice(0, n).map(x => x.w);
  }
  async function finish() {
    await page.evaluate(() => window.__gw.skip(999));
    await page.waitForFunction(() => window.__gw.screen === 'results', null, { timeout: 10000 });
    await page.waitForTimeout(3400); // count-up + missed-word reveal
  }
  const score = () => page.evaluate(() => window.__gw.match.scores.you);

  // ---- SOLO
  await page.click('#btn-solo');
  await page.waitForTimeout(120);
  await shot('05a-solo-countdown');
  await waitPlaying();
  const played = await playWords(5, { typeSome: !cdp });
  if (cdp) {
    // tap-to-build: tap each tile of a word, then press Submit
    const w = await page.evaluate(() => { const m = window.__gw.match; const mine = new Set(m.found.you.map(f => f.word)); return m.solution.find(s => s.common && !mine.has(s.word) && s.word.length === 4); });
    for (const i of w.path) { const c = await page.evaluate(i => window.__gw.tileCenter(i), i); await page.touchscreen.tap(c.x, c.y); await page.waitForTimeout(80); }
    check(await page.isVisible('#btn-submit'), `${vp.name}: submit button shown in tap mode`);
    await page.click('#btn-submit');
    await page.waitForTimeout(200);
    check(await page.evaluate(w => window.__gw.match.found.you.some(f => f.word === w), w.word), `${vp.name}: tap-to-build word accepted (${w.word})`);
    // a stray tap next to the start of a word must not be glued onto the following swipe
    const w2 = await page.evaluate(() => { const m = window.__gw.match; const mine = new Set(m.found.you.map(f => f.word)); return m.solution.find(s => s.common && !mine.has(s.word) && s.word.length >= 3 && s.word.length <= 5); });
    const stray = await page.evaluate(p => { const n = window.__gw.match.size; const a = p[0]; const r = Math.floor(a / n), c = a % n; for (const [dr, dc] of [[0,1],[1,0],[0,-1],[-1,0],[1,1],[-1,-1],[1,-1],[-1,1]]) { const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < n && cc >= 0 && cc < n && !p.includes(rr * n + cc)) return rr * n + cc; } return -1; }, w2.path);
    const sc = await page.evaluate(i => window.__gw.tileCenter(i), stray);
    await page.touchscreen.tap(sc.x, sc.y);
    await page.waitForTimeout(80);
    await swipe(w2.path);
    check(await page.evaluate(w => window.__gw.match.found.you.some(f => f.word === w), w2.word), `${vp.name}: swipe after a stray tap spells the right word (${w2.word})`);
  } else {
    // rotate, then swipe still maps to the right tiles
    await page.click('#btn-rotate');
    await page.waitForTimeout(450);
    const w = await page.evaluate(() => { const m = window.__gw.match; const mine = new Set(m.found.you.map(f => f.word)); return m.solution.find(s => s.common && !mine.has(s.word) && s.word.length === 4); });
    await swipe(w.path);
    check(await page.evaluate(w => window.__gw.match.found.you.some(f => f.word === w), w.word), `${vp.name}: swipe works after rotating (${w.word})`);
    // typing a valid word (before Enter) lights it up as a word with a points preview
    const lw = await page.evaluate(() => { const m = window.__gw.match; const mine = new Set(m.found.you.map(f => f.word)); return m.solution.find(s => s.common && !mine.has(s.word) && s.word.length >= 4 && !s.word.includes('q')).word; });
    await page.keyboard.type(lw, { delay: 20 });
    check(await page.evaluate(() => document.querySelector('#current-word').classList.contains('valid') && document.querySelector('#board').classList.contains('is-valid') && !!document.querySelector('#current-word .cw-pts')), `${vp.name}: live valid-word hint while typing (${lw})`);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    check(!(await page.evaluate(() => document.querySelector('#board').classList.contains('is-valid'))), `${vp.name}: valid hint clears after submit`);
    // typing something not on the board shows the error state
    await page.keyboard.type('zzq');
    check(await page.evaluate(() => document.querySelector('#current-word').classList.contains('bad')), `${vp.name}: typed letters not on board are flagged`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    check(!(await page.isVisible('#modal-pause')), `${vp.name}: first Escape only clears the word`);
  }
  // an invalid swipe (two tiles) + a duplicate
  const dupPath = await page.evaluate(w => window.__gw.match.solutionMap.get(w).path, played[0]);
  await swipe(dupPath);
  await page.waitForTimeout(60);
  await shot('05-solo-midgame');
  const foundSolo = await page.evaluate(() => window.__gw.match.found.you.length);
  check(foundSolo === 7, `${vp.name}: solo found all words via ${cdp ? 'touch swipe' : 'mouse swipe + typing'} (got ${foundSolo})`);
  check(await score() > 0, `${vp.name}: solo score > 0`);
  await checkNoOverflow(page, vp.name + ' solo game');
  await page.evaluate(() => window.__gw.skip(window.__gw.match.duration - window.__gw.now() - 7.5));
  await page.waitForTimeout(700);
  check(await page.evaluate(() => document.querySelector('#timer').classList.contains('low')), `${vp.name}: last-10s warning state`);
  await shot('06-solo-last10s');
  await finish();
  check(await page.isVisible('#screen-results'), `${vp.name}: solo results shown`);
  check((await page.textContent('#res-score')).trim() === String(await score()), `${vp.name}: results score matches`);
  check(await page.locator('#all-words .word-chip').count() > 20, `${vp.name}: all-words list rendered`);
  check(await page.locator('#res-par .par').count() === 5 && (await page.textContent('#res-badges')).includes('bots'), `${vp.name}: solo results show bot par ladder`);
  await shot('07-solo-results');
  await page.click('#all-words .word-chip >> nth=0');
  await page.waitForTimeout(200);
  check((await page.textContent('#mini-caption')).includes('pts'), `${vp.name}: tapping a word shows its path`);
  await page.evaluate(() => document.querySelector('.res-words-card').scrollIntoView());
  await page.waitForTimeout(300);
  await shot('08-solo-results-words');
  await checkNoOverflow(page, vp.name + ' results');
  await page.click('#btn-menu');
  await page.waitForTimeout(400);
  check((await page.textContent('#solo-sub')).includes('best ' + (await score())), `${vp.name}: solo best persisted`);

  // ---- VS BOTS
  await page.click('#btn-bots');
  await page.waitForTimeout(400);
  await shot('09-bots-sheet');
  check((await page.locator('#bot-list li').count()) === 4, `${vp.name}: bot sheet lists 4 labelled bots`);
  check((await page.textContent('#bot-list')).includes('BOT'), `${vp.name}: bots carry BOT label`);
  await page.click('[data-diff="hard"]');
  check((await page.textContent('#bot-list')).includes('Pro') && (await page.textContent('#bots-sub')).includes('Hard'), `${vp.name}: Hard lineup includes the Pro bot`);
  await page.click('[data-diff="easy"]');
  check(!(await page.textContent('#bot-list')).match(/Sharp|Ace|Pro/), `${vp.name}: Easy lineup tops out at Casual`);
  await page.click('[data-diff="normal"]');
  await page.click('#bots-start');
  await waitPlaying();
  await playWords(4, { typeSome: !cdp });
  await page.evaluate(() => window.__gw.skip(40));
  await page.waitForTimeout(900);
  await shot('10-bots-midgame');
  const botScores = await page.evaluate(() => Object.entries(window.__gw.match.scores).filter(([k]) => k !== 'you').map(([, v]) => v));
  check(botScores.some(s => s > 0), `${vp.name}: bots scored during the round (${botScores.join(',')})`);
  check((await page.locator('.sb-chip').count()) === 5, `${vp.name}: live scoreboard has 5 entries`);
  await checkNoOverflow(page, vp.name + ' bots game');
  await finish();
  check((await page.locator('.st-row').count()) === 5, `${vp.name}: bots standings shown`);
  check((await page.locator('#all-words .word-chip .dots i').count()) > 5, `${vp.name}: who-found-what dots shown`);
  await shot('11-bots-results');
  await page.click('#btn-menu');
  await page.waitForTimeout(300);

  // ---- DAILY
  const dailyTitle = await page.textContent('#daily-title');
  if (!cdp) {
    // reloading mid-round must not grant a second try
    const ctx2 = await browser.newContext({ ...vp.opts });
    await ctx2.route(/gc\.zgo\.at|goatcounter\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' })); // analytics stubbed in tests
    const p2 = await ctx2.newPage();
    await p2.addInitScript(() => { if (!localStorage.getItem('gridword:v1')) localStorage.setItem('gridword:v1', JSON.stringify({ seenHowTo: true })); });
    await p2.goto(BASE + '?test');
    await p2.waitForSelector('#loading.done', { state: 'attached' });
    await p2.click('#btn-daily');
    await p2.waitForFunction(() => window.__gw?.board.enabled);
    await p2.reload();
    await p2.waitForSelector('#loading.done', { state: 'attached' });
    check((await p2.textContent('#daily-sub')).includes('Played'), `${vp.name}: reloading mid-Daily still uses the one try`);
    await ctx2.close();
  }
  await page.click('#btn-daily');
  await waitPlaying();
  await playWords(4, { typeSome: !cdp });
  await shot('12-daily-midgame');
  await finish();
  await shot('13-daily-results');
  check(await page.isVisible('#btn-share'), `${vp.name}: daily share button visible`);
  await page.click('#btn-share');
  await page.waitForTimeout(300);
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  check(/^Gridword #\d+ 🔤 4 words · \d+ pts · best: [A-Z]+/.test(clip), `${vp.name}: share text copied (${clip.split('\n')[0]})`);
  check(/\n🤖 Beat \d\/5 bots\n/.test(clip), `${vp.name}: share text includes bot par line`);
  check(clip.split('\n')[0].startsWith(dailyTitle.replace('Daily ', 'Gridword ')), `${vp.name}: share uses daily number`);
  await page.click('#btn-menu');
  await page.waitForTimeout(300);
  check((await page.textContent('#daily-sub')).includes('Played'), `${vp.name}: daily marked as played`);
  await page.click('#btn-daily');
  await page.waitForTimeout(500);
  check(await page.evaluate(() => window.__gw.screen === 'results' && window.__gw.match.found.you.length === 4), `${vp.name}: replaying daily shows saved result`);
  await page.click('#btn-menu');

  // ---- extra: 5x5 solo on desktop, pause/resume, stats modal
  if (!cdp) {
    // pausing during the countdown must hold the clock at 0 until Resume
    await page.evaluate(() => { document.querySelector('#btn-solo').click(); document.querySelector('#btn-quit').click(); });
    await page.waitForTimeout(900);
    check(await page.evaluate(() => window.__gw.now() === 0 && !window.__gw.board.enabled), `${vp.name}: pause during countdown holds the clock`);
    await shot('13b-pause');
    await page.click('#pause-resume');
    await page.waitForTimeout(300);
    check(await page.evaluate(() => window.__gw.now() > 0 && window.__gw.board.enabled), `${vp.name}: resume after countdown pause starts the clock`);
    await page.click('#btn-quit');
    await page.click('#pause-quit');
    await page.waitForTimeout(300);
    check(await page.evaluate(() => window.__gw.screen === 'title'), `${vp.name}: quit from pause returns to menu`);

    await page.click('[data-size="5"]');
    await page.click('#btn-solo');
    await waitPlaying();
    check(await page.evaluate(() => window.__gw.match.tiles.length === 25), `${vp.name}: 5x5 board`);
    await playWords(3, { typeSome: true });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    check(await page.isVisible('#modal-pause'), `${vp.name}: Escape pauses`);
    const t1 = await page.evaluate(() => window.__gw.now());
    await page.waitForTimeout(500);
    const t2 = await page.evaluate(() => window.__gw.now());
    check(Math.abs(t2 - t1) < 0.01, `${vp.name}: clock frozen while paused`);
    await page.keyboard.press('Escape');
    await shot('14-solo5x5-midgame');
    await finish();
    await shot('15-solo5x5-results');
    await page.click('#btn-menu');
    await page.click('[data-size="4"]');
  }
  await page.click('#btn-stats');
  await page.waitForTimeout(300);
  await shot('16-stats');
  check((await page.textContent('#stats-grid')).includes('Words found'), `${vp.name}: stats modal`);
  await page.click('#modal-stats [data-close]');

  // ---- landscape sanity
  if (!cdp) {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.click('#btn-solo');
    await waitPlaying();
    await playWords(2);
    await shot('17-landscape-16x9-game');
    await checkNoOverflow(page, 'landscape 16:9 game');
    await finish();
  }

  errorCounts[vp.name] = errors.length;
  for (const e of errors) console.log('  ' + e);
  check(errors.length === 0, `${vp.name}: 0 console/page errors (got ${errors.length})`);
  await ctx.close();
}

async function checkNoOverflow(page, label) {
  const o = await page.evaluate(() => {
    const W = innerWidth, H = innerHeight;
    const bad = [];
    for (const el of document.querySelectorAll('.screen.active *')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed' || el.closest('.pop,.feedback,.plus')) continue;
      if (r.right > W + 1 || r.left < -1) bad.push(el.className || el.tagName);
    }
    return { bad: bad.slice(0, 5), sx: document.documentElement.scrollWidth > W };
  });
  check(!o.bad.length && !o.sx, `${label}: no horizontal overflow ${o.bad.join(' | ')}`);
}

await browser.close();
server.kill();
console.log(`\n${pass} passed, ${fail} failed. Console errors: ${JSON.stringify(errorCounts)}`);
console.log(`Screenshots: ${SHOTS}`);
process.exit(fail ? 1 : 0);
