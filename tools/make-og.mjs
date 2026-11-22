// Renders docs/og-image.png (1200x630) using the game's own CSS. Dev-only (Playwright from a sibling project).
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const PORT = 8854;
const docs = new URL('../docs', import.meta.url).pathname;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '-d', docs], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(`http://localhost:${PORT}/`);
const letters = 'STRAPEGNOWILDEAC'.split('');
const path = [0, 1, 2, 3, 7, 6, 5]; // S-T-R-A-N-G-E
await page.setContent(`<!doctype html><html><head><link rel="stylesheet" href="http://localhost:${PORT}/css/style.css">
<style>
 body{display:flex;align-items:center;justify-content:center;gap:70px;height:630px;overflow:hidden}
 .l{display:flex;flex-direction:column;gap:22px;width:560px}
 .logo-tiles{width:460px}.lt{font-size:64px;animation:none}
 .logo-path polyline{animation:none;stroke-dashoffset:0}
 h2{margin:0;font-size:31px;font-weight:900;color:#f8f1e5;line-height:1.2}
 h2 em{font-style:normal;color:#ffc94d}
 .pills{display:flex;gap:10px}.pills span{padding:8px 14px;border-radius:99px;background:rgba(255,255,255,.08);box-shadow:inset 0 0 0 1px rgba(255,255,255,.14);font-weight:800;font-size:18px;color:#f8f1e5}
 .bd{position:relative;width:440px;height:440px;border-radius:30px;background:rgba(0,0,0,.28);box-shadow:inset 0 0 0 1px rgba(255,255,255,.1),0 20px 50px rgba(0,0,0,.35);display:grid;grid-template-columns:repeat(4,1fr);gap:14px;padding:20px}
 .t{display:grid;place-items:center;border-radius:20%;background:#fff4e0;color:#2a1f4a;font-weight:900;font-size:54px;box-shadow:0 6px 0 #d8c39c}
 .t.s{background:linear-gradient(160deg,#ffd56b,#ff9f43);color:#3a2205;box-shadow:0 6px 0 #c0732a}
 svg{position:absolute;inset:0;width:100%;height:100%}
 polyline{fill:none;stroke:rgba(255,107,90,.6);stroke-width:26;stroke-linecap:round;stroke-linejoin:round}
</style></head><body>
<div class="l"><span class="logo-tiles">${'GRIDWORD'.split('').map(c => `<span class="lt">${c}</span>`).join('')}<svg class="logo-path" viewBox="0 0 400 200" preserveAspectRatio="none"><polyline points="50,50 150,50 250,50 350,50 350,150 250,150 150,150 50,150"/></svg></span>
<h2>90 seconds. Swipe touching letters.<br><em>Longer words score big.</em></h2>
<div class="pills"><span>📅 Daily board</span><span>🤖 vs bots</span><span>⏱️ Solo</span></div></div>
<div class="bd">${letters.map((c, i) => `<div class="t ${path.includes(i) ? 's' : ''}">${c}</div>`).join('')}
<svg viewBox="0 0 440 440"></svg></div>
</body></html>`);
// draw path over selected tiles
await page.evaluate(path => {
  const bd = document.querySelector('.bd'), r0 = bd.getBoundingClientRect();
  const pts = path.map(i => { const r = bd.children[i].getBoundingClientRect(); return `${r.left - r0.left + r.width / 2},${r.top - r0.top + r.height / 2}`; });
  bd.querySelector('svg').innerHTML = `<polyline points="${pts.join(' ')}"/>`;
}, path);
await page.waitForTimeout(300);
await page.screenshot({ path: `${docs}/og-image.png` });
await browser.close(); server.kill();
console.log('wrote docs/og-image.png');
