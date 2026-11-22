// Ad-hoc visual QA at extra viewports (phone landscape, small phone, tablet).
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const PORT = 8853, BASE = `http://localhost:${PORT}/`, OUT = '/workspace/arcade-shots/gridword';
const server = spawn('python3', ['-m', 'http.server', String(PORT), '-d', new URL('../docs', import.meta.url).pathname], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const VPS = [
  ['phone-landscape', { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
  ['small-phone', { viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
  ['tablet', { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }],
];
let errs = 0;
for (const [name, opts] of VPS) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', e => { errs++; console.log(name, e.message); });
  page.on('console', m => { if (m.type() === 'error') { errs++; console.log(name, m.text()); } });
  await page.addInitScript(() => localStorage.setItem('gridword:v1', JSON.stringify({ seenHowTo: true, botCount: 5 })));
  await page.goto(BASE + '?test');
  await page.waitForSelector('#loading.done', { state: 'attached' });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${OUT}/extra-${name}-title.png` });
  await page.click('#btn-bots'); await page.click('#bots-start');
  await page.waitForFunction(() => window.__gw?.board.enabled);
  await page.evaluate(() => { const m = window.__gw.match; window.__gw.board.setPath(m.solution[3].path); window.__gw.skip(30); });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/extra-${name}-game.png` });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || [...document.querySelectorAll('.screen.active *')].some(e => { const r = e.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.bottom > innerHeight + 1) && !e.closest('.found-list'); }));
  console.log(name, 'overflow:', overflow);
  await page.evaluate(() => window.__gw.skip(999));
  await page.waitForFunction(() => window.__gw.screen === 'results');
  await page.waitForTimeout(3200);
  await page.screenshot({ path: `${OUT}/extra-${name}-results.png` });
  await ctx.close();
}
await browser.close(); server.kill();
console.log('errors', errs);
