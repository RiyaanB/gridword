// Gridword — UI controller. Game rules live in ./core (pure, DOM-free).
import { Dictionary } from './core/dict.js';
import { findPath, wordFromPath, compareWords } from './core/board.js';
import { wordPoints, POINTS_LEGEND } from './core/scoring.js';
import { pickBots, botPar, parBeaten, DIFFICULTIES } from './core/bots.js';
import { createMatch, submitWord, advanceBots, finishMatch, longestMissed, standings, DURATIONS } from './core/game.js';
import { dailyInfo, localDateParts, shareText, previousKey } from './core/daily.js';
import { BoardView } from './ui/boardview.js';
import { sfx, unlock, setMuted, isMuted } from './ui/audio.js';
import * as store from './ui/store.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const params = new URLSearchParams(location.search);
const TEST = params.has('test');
const YOU_COLOR = '#ff8a5c';

let dict = null;
let prefs = store.load();
let match = null;       // current match (core state)
let G = null;           // UI-side round state
let results = null;     // last results
let screen = 'title';

// ---------------------------------------------------------------- boot
async function boot() {
  setMuted(prefs.muted);
  syncMute();
  bindUI();
  try {
    const res = await fetch('data/words.txt');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    dict = new Dictionary(await res.text());
  } catch (err) {
    $('#loading p').textContent = 'Could not load the dictionary. Please reload.';
    console.warn(err);
    return;
  }
  $('#loading').classList.add('done');
  refreshTitle();
  if (!prefs.seenHowTo) openHowTo();
  if (TEST) exposeTestHook();
}

// ---------------------------------------------------------------- helpers
function show(name) {
  screen = name;
  document.activeElement?.blur?.();
  for (const s of $$('.screen')) s.classList.toggle('active', s.id === 'screen-' + name);
  if (name === 'title') refreshTitle();
}

function toast(msg, ms = 1800) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

function openModal(id) { $(id).hidden = false; const f = $(id).querySelector('.btn-primary'); f?.focus({ preventScroll: true }); }
function closeModal(id) { $(id).hidden = true; }
function anyModalOpen() { return $$('.modal').some(m => !m.hidden); }

function todayInfo() { return dailyInfo(localDateParts(new Date())); }
function yesterdayKey() { const d = new Date(); d.setDate(d.getDate() - 1); return dailyInfo(localDateParts(d)).key; }
function fmtTime(s) { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
const upper = w => w.toUpperCase();
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function syncMute() {
  for (const b of $$('[data-mute]')) { b.textContent = isMuted() ? '🔇' : '🔊'; b.setAttribute('aria-pressed', String(isMuted())); }
}

// ---------------------------------------------------------------- title
function refreshTitle() {
  prefs = store.reload();
  const info = todayInfo();
  const played = prefs.daily.history[info.key];
  $('#daily-title').textContent = `Daily #${info.number}`;
  $('#btn-daily').classList.toggle('played', !!played);
  $('#daily-sub').textContent = played
    ? (played.inProgress ? 'Played ✓ · unfinished (0 pts) · see the board' : `Played ✓ ${played.points} pts · ${played.words} words · view & share`)
    : `Same board for everyone · 90s · one try`;
  const sz = prefs.size;
  $('#solo-sub').textContent = `Fresh ${sz}×${sz} board · ${DURATIONS[sz]}s · best ${prefs.solo[sz].best}`;
  $('#bots-sub').textContent = `Race ${prefs.botCount} computer bots · ${diffLabel()} · ${sz}×${sz}`;
  for (const b of $$('[data-size]')) b.setAttribute('aria-checked', String(+b.dataset.size === sz));
}

function setSize(sz) { prefs.size = sz; store.save(); refreshTitle(); }
function diffLabel() { return (DIFFICULTIES[prefs.botLevel] || DIFFICULTIES.normal).label; }
function setBotLevel(lv) { if (!DIFFICULTIES[lv]) return; prefs.botLevel = lv; store.save(); renderBotSheet(); refreshTitle(); }
const BOT_HINT = {
  easy: 'Relaxed pace. Good for learning the board.',
  normal: 'A fair race. The Sharp bot is the one to beat.',
  hard: 'Includes Vex (Pro), who finds 30+ words a round.',
};

// ---------------------------------------------------------------- how to
let howStep = 0;
function openHowTo() {
  howStep = 0;
  renderHowTo();
  const pts = $('#howto-points');
  pts.innerHTML = POINTS_LEGEND.map((r, i) =>
    `<div class="bar" style="height:${34 + r.pts * 8}px;animation-delay:${i * 0.07}s"><b>+${r.pts}</b><span>${r.len}<br>ltrs</span></div>`).join('');
  openModal('#modal-howto');
}
function renderHowTo() {
  $$('#howto-steps .step').forEach((s, i) => s.classList.toggle('active', i === howStep));
  $$('#howto-dots i').forEach((d, i) => d.classList.toggle('on', i === howStep));
  $('#howto-next').textContent = howStep === 2 ? "Let's play!" : 'Next';
  if (howStep === 1) { const p = $('#howto-points'); p.innerHTML = p.innerHTML; } // restart bar animation
}
function howNext() {
  sfx.click();
  if (howStep < 2) { howStep++; renderHowTo(); return; }
  finishHowTo();
}
function finishHowTo() { prefs.seenHowTo = true; store.save(); closeModal('#modal-howto'); }

// ---------------------------------------------------------------- stats
function openStats() {
  const d = prefs;
  const winRate = d.bots.played ? Math.round(100 * d.bots.wins / d.bots.played) + '%' : '—';
  const cells = [
    ['h', 'Daily'],
    [d.daily.played, 'Played'], [store.currentStreak(todayInfo().key, yesterdayKey()), 'Streak'], [d.daily.maxStreak, 'Max streak'],
    ['h', 'Solo & bots'],
    [d.solo[4].best, 'Best 4×4'], [d.solo[5].best, 'Best 5×5'], [d.bots.best, 'Best vs bots'],
    [d.solo[4].played + d.solo[5].played, 'Solo rounds'], [d.bots.played, 'Bot races'], [winRate, 'Win rate'],
    ['h', 'All time'],
    [d.totals.words, 'Words found'], [d.totals.points, 'Total points'], [d.daily.best, 'Best daily'],
  ];
  $('#stats-grid').innerHTML = cells.map(([v, l]) => v === 'h' ? `<h3 class="stats-h">${l}</h3>` : `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('') +
    `<div class="stat wide"><b>${d.bestWord ? esc(upper(d.bestWord)) : '—'}</b><span>Longest word ever</span></div>`;
  openModal('#modal-stats');
}

// ---------------------------------------------------------------- bots sheet
function openBots() {
  renderBotSheet();
  openModal('#modal-bots');
}
function renderBotSheet() {
  for (const b of $$('[data-bots]')) b.setAttribute('aria-checked', String(+b.dataset.bots === prefs.botCount));
  for (const b of $$('[data-diff]')) b.setAttribute('aria-checked', String(b.dataset.diff === (DIFFICULTIES[prefs.botLevel] ? prefs.botLevel : 'normal')));
  $('#bot-hint').textContent = BOT_HINT[prefs.botLevel] || BOT_HINT.normal;
  $('#bot-list').innerHTML = pickBots(prefs.botCount, prefs.botLevel).map((b, i) =>
    `<li style="animation-delay:${i * 0.04}s"><span class="dot" style="background:${b.color}"></span>🤖 ${esc(b.name)} <span class="bot-tag">BOT</span><span class="lvl">${b.level}</span></li>`).join('');
}

// ---------------------------------------------------------------- game
const board = new BoardView($('#board'), {
  interactive: true,
  onPathChange: (path, change) => {
    if (!G) return;
    G.typed = '';
    if (change.type === 'add') { sfx.select(path.length - 1); if (navigator.vibrate && G.haptics) navigator.vibrate(6); }
    else sfx.unselect();
    renderCurrentWord();
  },
  onSubmit: path => submitPath(path),
  onGestureEnd: () => { if (G && !G.ended && board.path.length) renderCurrentWord(); },
});
const mini = new BoardView($('#mini-board'), { static: true });

let timers = { win: 0, cdHide: 0 };
function clearRoundTimers() {
  revealTimers.forEach(clearTimeout); revealTimers = [];
  clearTimeout(timers.win); clearTimeout(timers.cdHide);
  if (G) { clearTimeout(G.cdTimer); cancelAnimationFrame(G.raf); }
}

function startGame(mode, opts = {}) {
  if (!dict) return;
  unlock();
  clearRoundTimers();
  if (G && !G.ended) G.ended = true;
  if (mode === 'daily') {
    prefs = store.reload();
    if (prefs.daily.history[todayInfo().key]) { viewDailyResult(); return; } // played in another tab
  }
  const size = mode === 'daily' ? 4 : prefs.size;
  let seed, dailyMeta = null;
  if (mode === 'daily') {
    const info = todayInfo();
    seed = info.seed; dailyMeta = info;
  } else {
    seed = opts.seed || `${mode}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  }
  const players = [{ id: 'you', name: 'You', kind: 'human', color: YOU_COLOR }];
  if (mode === 'bots') for (const b of pickBots(prefs.botCount, prefs.botLevel)) players.push({ ...b, kind: 'bot' });
  match = createMatch({ seed, size, players, dict, mode });
  G = {
    mode, size, dailyMeta, botLevel: mode === 'bots' ? diffLabel() : '', typed: '', combo: 0, lastOkT: -99, lastTickSec: null, liveValid: false,
    clock: { base: 0, startedAt: 0, running: false }, ended: false, haptics: matchMedia('(pointer: coarse)').matches,
  };
  $('#hud-mode').textContent = mode === 'daily' ? `Daily #${dailyMeta.number}` : mode === 'bots' ? `vs ${players.length - 1} bots · ${G.botLevel}` : `Solo ${size}×${size}`;
  $('#score').textContent = '0';
  $('#timer').textContent = fmtTime(match.duration);
  $('#timer').classList.remove('low');
  $('#timebar').classList.remove('low');
  $('#timebar').style.transform = 'scaleX(1)';
  $('#found-list').innerHTML = `<div class="empty" id="found-empty"><p>Swipe across touching letters to make a word.</p>
    <div class="pts-legend">${POINTS_LEGEND.map(r => `<span><b>${r.len}</b> letters <i>${r.pts}</i></span>`).join('')}</div></div>`;
  $('#found-count').textContent = '0';
  $('#found-total').textContent = `of ${match.stats.common} common`;
  $('#found-bar').style.width = '0';
  $('#current-word').innerHTML = '';
  $('#btn-submit').hidden = true;
  renderScoreboard();
  show('game');
  board.setBoard(match.tiles, size);
  board.enabled = false;
  board.setFaceDown(true);
  layoutGame();
  countdown();
}

function countdown() {
  const cd = $('#countdown'), num = $('#countdown-num');
  cd.hidden = false;
  let n = TEST ? 1 : 3;
  const step = () => {
    if (!G || screen !== 'game') { cd.hidden = true; return; }
    if (n === 0) {
      num.textContent = 'GO!';
      num.style.animation = 'none'; void num.offsetWidth; num.style.animation = '';
      sfx.go();
      if ($('#modal-pause').hidden && !document.hidden) board.revealTiles();
      beginClock();
      timers.cdHide = setTimeout(() => { cd.hidden = true; }, 600);
      return;
    }
    num.textContent = n;
    num.style.animation = 'none'; void num.offsetWidth; num.style.animation = '';
    sfx.count();
    n--;
    G.cdTimer = setTimeout(step, TEST ? 200 : 700);
  };
  step();
}

function beginClock() {
  G.started = true;
  if (G.mode === 'daily') store.beginDaily(G.dailyMeta.key, G.dailyMeta.number, previousKey(G.dailyMeta.key));
  if (!$('#modal-pause').hidden || document.hidden) {
    // paused during the countdown: wait for Resume
    G.clock = { base: 0, startedAt: 0, running: false };
    return;
  }
  G.clock = { base: 0, startedAt: performance.now(), running: true };
  board.enabled = true;
  G.raf = requestAnimationFrame(loop);
}

function now() {
  if (!G) return 0;
  const c = G.clock;
  return c.base + (c.running ? (performance.now() - c.startedAt) / 1000 : 0);
}

function pauseClock() {
  if (!G || !G.clock.running) return;
  G.clock.base = now();
  G.clock.running = false;
  board.enabled = false;
  board.cancelGesture();
  board.setPath([]);
  board.setFaceDown(true); // no studying the board while paused
  G.typed = '';
  renderCurrentWord();
}
function resumeClock() {
  if (!G || G.clock.running || G.ended || !G.started) return;
  G.clock.startedAt = performance.now();
  G.clock.running = true;
  board.enabled = true;
  board.revealTiles();
  cancelAnimationFrame(G.raf);
  G.raf = requestAnimationFrame(loop);
}

function loop() {
  if (!G || G.ended || screen !== 'game') return;
  const t = now();
  const left = match.duration - t;
  $('#timer').textContent = fmtTime(left);
  $('#timebar').style.transform = `scaleX(${Math.max(0, left / match.duration)})`;
  const low = left <= 10;
  $('#timer').classList.toggle('low', low);
  $('#timebar').classList.toggle('low', low);
  const sec = Math.ceil(left);
  if (low && sec !== G.lastTickSec && sec > 0 && G.clock.running) { G.lastTickSec = sec; sfx.tick(sec <= 5); }
  // bots
  const ev = advanceBots(match, t);
  if (ev.length) onBotEvents(ev);
  if (left <= 0) { endRound(); return; }
  if (G.clock.running) G.raf = requestAnimationFrame(loop);
}

function onBotEvents(events) {
  renderScoreboard();
  for (const e of events) {
    const chip = $(`.sb-chip[data-id="${e.playerId}"]`);
    if (!chip) continue;
    chip.classList.remove('hit'); void chip.offsetWidth; chip.classList.add('hit');
    const plus = document.createElement('span');
    plus.className = 'plus'; plus.textContent = '+' + e.points;
    chip.appendChild(plus);
    setTimeout(() => plus.remove(), 900);
  }
  sfx.bot();
}

function renderScoreboard() {
  const sb = $('#scoreboard');
  const on = match && match.players.length > 1;
  sb.classList.toggle('on', !!on);
  sb.classList.toggle('n6', !!on && match.players.length >= 6);
  if (!on) { sb.innerHTML = ''; return; }
  const st = standings(match);
  const leader = st[0].score > 0 ? st[0].id : null;
  const rankOf = Object.fromEntries(st.map((p, i) => [p.id, i]));
  sb.innerHTML = match.players.map(p => {
    const bot = p.kind === 'bot';
    return `<div class="sb-chip ${bot ? '' : 'you'} ${p.id === leader ? 'lead' : ''}" data-id="${p.id}" style="--rank:${rankOf[p.id]}" title="${bot ? esc(p.name) + ' — computer bot (' + p.level + ')' : 'You'}">
      <span class="rk">${rankOf[p.id] + 1}</span>
      <span class="nm"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}</span>
      <span class="sc">${match.scores[p.id]}</span><span class="tag">${bot ? '🤖 BOT' : 'YOU'}</span></div>`;
  }).join('');
}

function renderCurrentWord(cls = '') {
  const el = $('#current-word');
  let text = '';
  if (G.typed) text = G.typed;
  else if (board.path.length) text = wordFromPath(match.tiles, board.path);
  // live hint while building: is this a word on the board (and new for you)?
  let live = '';
  if (!cls && G && !G.ended && text.length >= 3 && match.solutionMap.has(text)) {
    live = match.found.you.some(f => f.word === text) ? 'live-dup' : 'valid';
  }
  if (live === 'valid' && !G.liveValid) sfx.lock();
  if (G) G.liveValid = live === 'valid';
  board.el.classList.toggle('is-valid', live === 'valid');
  el.className = 'current-word' + (cls ? ' ' + cls : '') + (live ? ' ' + live : '');
  const prev = el.dataset.text || '';
  el.dataset.text = text;
  // animate only newly-added letters
  el.innerHTML = [...text.toUpperCase()].map((ch, i) => `<span class="cl" style="${i < prev.length && prev[i] === text[i] ? 'animation:none' : ''}">${ch}</span>`).join('') +
    (live === 'valid' ? `<span class="cw-pts">+${wordPoints(text)}</span>` : live === 'live-dup' ? '<span class="cw-pts dup">found</span>' : '');
  $('#btn-submit').hidden = !(text.length >= 3 && !board.gesture && G && !G.ended);
}

function feedback(text, color) {
  const f = $('#feedback');
  f.textContent = text;
  f.style.color = color;
  f.classList.remove('show'); void f.offsetWidth; f.classList.add('show');
  $('#current-word').classList.add('fly');
}

const PRAISE = { 3: 'Nice', 4: 'Good!', 5: 'Great!', 6: 'Superb!', 7: 'Amazing!' };

function submitPath(path) {
  if (!G || G.ended) return;
  const word = wordFromPath(match.tiles, path);
  handleSubmit(word, path);
}

function submitTyped() {
  if (!G || G.ended) return;
  const word = G.typed;
  if (!word) { if (board.path.length) submitPath(board.path); return; }
  const path = findPath(match.tiles, match.size, word, board.path) || [];
  handleSubmit(word, path, true);
}

function handleSubmit(word, path, typed) {
  const t = now();
  const r = submitWord(match, 'you', word, t);
  G.typed = '';
  const cw = $('#current-word');
  if (r.status === 'ok') {
    G.combo = t - G.lastOkT < 4 ? G.combo + 1 : 1;
    G.lastOkT = t;
    const p = path.length ? path : r.path;
    board.flash(p, 'ok');
    board.popPoints(p[p.length - 1], '+' + r.points);
    sfx.good(G.combo, word.length);
    if (navigator.vibrate && G.haptics) navigator.vibrate(word.length >= 6 ? [20, 40, 30] : 18);
    renderCurrentWord('ok');
    const praise = word.length >= 8 ? 'LEGENDARY!' : PRAISE[word.length];
    feedback(praise + (G.combo >= 3 ? ` · 🔥 ${G.combo} in a row` : ''), word.length >= 6 ? 'var(--gold)' : 'var(--mint)');
    if (word.length >= 6) { const b = $('#board'); b.classList.remove('flash-long'); void b.offsetWidth; b.classList.add('flash-long'); }
    addFoundChip(word, r.points);
    const sc = $('#score');
    sc.textContent = match.scores.you;
    sc.classList.remove('bump'); void sc.offsetWidth; sc.classList.add('bump');
    renderScoreboard();
  } else {
    G.combo = 0;
    const msg = { dup: 'Already found', short: '3+ letters', invalid: 'Not a word', notonboard: 'Not on the board', over: '' }[r.status];
    if (r.status === 'dup') {
      board.flash(path, 'dup');
      sfx.dup();
      const chip = $(`.fw[data-w="${word}"]`);
      if (chip) { chip.classList.remove('pulse'); void chip.offsetWidth; chip.classList.add('pulse'); chip.scrollIntoView({ block: 'nearest' }); }
      renderCurrentWord('dup');
    } else if (r.status !== 'over') {
      if (path.length) board.flash(path, 'bad');
      else board.setPath([]);
      sfx.bad();
      renderCurrentWord('bad shake');
    }
    if (msg) feedback(msg, r.status === 'dup' ? 'var(--gold)' : 'var(--red)');
  }
  setTimeout(() => { if (G && !G.typed && !board.path.length) { $('#current-word').innerHTML = ''; $('#current-word').dataset.text = ''; $('#current-word').className = 'current-word'; } }, 420);
  $('#btn-submit').hidden = true;
}

function addFoundChip(word, points) {
  const list = $('#found-list');
  $('#found-empty')?.remove();
  const c = document.createElement('span');
  c.className = 'fw new' + (word.length >= 6 ? ' long' : '');
  c.dataset.w = word;
  c.innerHTML = `${esc(word)}<i>${points}</i>`;
  list.prepend(c);
  list.scrollTop = 0;
  $('#found-count').textContent = match.found.you.length;
  $('#found-bar').style.width = Math.min(100, 100 * match.found.you.length / Math.max(1, match.stats.common)) + '%';
}

function endRound(early = false) {
  if (!G || G.ended) return;
  G.ended = true;
  board.enabled = false;
  board.cancelGesture();
  board.setPath([]);
  cancelAnimationFrame(G.raf);
  clearTimeout(G.cdTimer);
  $('#timer').textContent = early ? $('#timer').textContent : '0:00';
  $('#timebar').style.transform = early ? $('#timebar').style.transform : 'scaleX(0)';
  sfx.end();
  const tu = $('#times-up');
  tu.querySelector('span').textContent = early ? 'Done!' : 'Time!';
  tu.hidden = false;
  results = finishMatch(match);
  const me = results.perPlayer.you;
  let flags = {};
  const won = G.mode === 'bots' && results.ranking[0].id === 'you';
  flags = store.recordRound({
    mode: G.mode, size: G.size, points: me.score, words: me.words, best: me.best, found: me.found,
    dailyKey: G.dailyMeta?.key, dailyNumber: G.dailyMeta?.number, prevDailyKey: G.dailyMeta ? previousKey(G.dailyMeta.key) : '', won,
  });
  prefs = store.load();
  setTimeout(() => { tu.hidden = true; showResults({ flags, won }); }, TEST ? 300 : 1400);
}

// ---------------------------------------------------------------- results
let resFilter = 'all';
let showObscure = false;
let revealTimers = [];

function showResults({ flags = {}, won = false, replay = false } = {}) {
  const mode = G.mode;
  const me = results.perPlayer.you;
  show('results');
  $('#screen-results').scrollTop = 0;
  const rank = results.ranking.findIndex(p => p.id === 'you') + 1;
  const medals = ['🥇', '🥈', '🥉'];
  $('#res-kicker').textContent = mode === 'daily' ? `Daily #${G.dailyMeta.number}${replay ? ' · already played' : ''}`
    : mode === 'bots' ? `${won ? 'You beat the bots!' : `${ordinal(rank)} place`} · ${G.botLevel || 'Normal'}` : `Solo ${G.size}×${G.size} · time's up`;
  countUp($('#res-score'), me.score, replay ? 0 : 900);
  $('#res-line').innerHTML = `${me.words} word${me.words === 1 ? '' : 's'}${me.best ? ` · best: <b>${esc(me.best)}</b>` : ''}`;
  const pct = Math.round(100 * Math.min(1, foundCommon() / Math.max(1, results.totalCommon)));
  const badges = [];
  if (flags.newBest) badges.push(['🏆 New best!', 'gold']);
  if (won) badges.push(['🥇 1st of ' + results.ranking.length, 'gold']);
  if (flags.bestWordEver && me.best.length >= 6) badges.push(['✨ Longest word ever', 'gold']);
  if (mode === 'daily') badges.push([`🔥 Streak ${prefs.daily.streak}`, '']);
  // solo / daily: benchmark against what each bot tier scores on this same board
  const parBox = $('#res-par');
  if (mode !== 'bots') {
    const par = botPar(match.solution, match.duration, match.seed, match.size);
    const beat = parBeaten(par, me.score, me.words);
    results.parBeaten = beat; results.parTotal = par.length;
    badges.push([beat === par.length ? '🤖 Beat every bot!' : `🤖 Beat ${beat}/${par.length} bots`, beat === par.length ? 'gold' : '']);
    const next = par.find(p => parBeaten([p], me.score, me.words) === 0);
    parBox.innerHTML = `<div class="par-title">Bot par on this board <small>(computer bots, same board)</small></div>
      <div class="par-row">${par.map((p, i) => {
        const won = parBeaten([p], me.score, me.words) === 1;
        return `<span class="par ${won ? 'beat' : ''}" style="animation-delay:${0.45 + i * 0.08}s"><i>${won ? '✓' : '🤖'}</i><b>${p.score}</b><small>${p.level}</small></span>`;
      }).join('')}</div>
      <div class="par-next">${next ? `${next.score - me.score + 1} more pts to beat the ${next.level} bot` : 'You out-scored every bot. 👑'}</div>`;
    parBox.hidden = false;
  } else { parBox.hidden = true; parBox.innerHTML = ''; }
  badges.push([`Found ${pct}% of common words`, '']);
  $('#res-badges').innerHTML = badges.map(([t, c], i) => `<span class="badge ${c}" style="animation-delay:${0.3 + i * 0.1}s">${t}</span>`).join('');

  // standings (bots)
  const st = $('#res-standings');
  if (mode === 'bots') {
    st.innerHTML = results.ranking.map((p, i) => `<div class="st-row ${p.kind === 'human' ? 'you' : ''}" style="animation-delay:${i * 0.08}s">
      <span class="st-rank">${medals[i] || i + 1}</span>
      <span class="st-name"><span class="dot" style="background:${p.color}"></span>${p.kind === 'bot' ? '🤖 ' : ''}${esc(p.name)} ${p.kind === 'bot' ? `<span class="bot-tag">BOT</span><small>${p.level}</small>` : ''}</span>
      <span class="st-words">${p.words}w</span><span class="st-score">${p.score}</span></div>`).join('');
  } else st.innerHTML = '';

  $('#btn-share').hidden = mode !== 'daily';
  $('#btn-again').innerHTML = mode === 'daily' ? '⏱️ Play solo' : '↻ Play again';
  if (won && !replay) timers.win = setTimeout(() => sfx.win(), 500);

  // mini board + words
  mini.setBoard(match.tiles, match.size);
  layoutMini();
  $('#mini-caption').textContent = 'Tap a word to see where it hides.';
  resFilter = 'all'; showObscure = false;
  $$('.tab').forEach(t => { t.classList.toggle('active', t.dataset.filter === 'all'); t.setAttribute('aria-selected', String(t.dataset.filter === 'all')); });
  renderLegend();
  renderAllWords();
  revealMissed(replay);
}

function foundCommon() { return results.all.filter(w => w.common && w.finders.includes('you')).length; }

function ordinal(n) { return n + (['th', 'st', 'nd', 'rd'][(n % 100 >> 3) ^ 1 && n % 10] || 'th'); }

function countUp(el, target, ms) {
  if (!ms) { el.textContent = target; return; }
  const t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    el.textContent = Math.round(target * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  step();
}

function revealMissed(instant) {
  revealTimers.forEach(clearTimeout); revealTimers = [];
  const box = $('#missed-reveal');
  const missed = pickVaried(longestMissed(match, 'you', 40), 5);
  if (!missed.length) { box.innerHTML = '<p class="none">You found every common word. Incredible! 🎉</p>'; return; }
  box.innerHTML = missed.map(s => `<button class="mr" data-w="${s.word}"><span class="mr-word">${esc(s.word)}</span><span class="mr-len">${s.word.length} letters</span><span class="mr-pts">+${wordPoints(s.word)}</span></button>`).join('');
  const rows = [...box.children];
  rows.forEach((row, i) => {
    revealTimers.push(setTimeout(() => {
      row.classList.add('in');
      if (!instant) sfx.reveal(rows.length - i);
      if (i === 0) showWordOnMini(missed[0].word);
    }, instant ? 0 : 1100 + i * 380));
  });
}

/** Prefer variety: skip words that merely extend/contain an already-chosen word (TOPSIDE vs TOPSIDES). */
function pickVaried(list, n) {
  const out = [];
  for (const s of list) {
    if (out.length >= n) break;
    if (out.some(o => o.word.includes(s.word.slice(0, -1)) || s.word.includes(o.word.slice(0, -1)))) continue;
    out.push(s);
  }
  for (const s of list) { if (out.length >= n) break; if (!out.includes(s)) out.push(s); }
  return out.sort((a, b) => b.word.length - a.word.length || (a.word < b.word ? -1 : 1));
}

function renderLegend() {
  const lg = $('#legend');
  if (match.players.length < 2) { lg.innerHTML = '<span><span class="dot" style="background:var(--cream)"></span>Light chips = words you found · tap any word to trace it</span>'; return; }
  lg.innerHTML = match.players.map(p => `<span><span class="dot" style="background:${p.color}"></span>${p.kind === 'bot' ? '🤖 ' + esc(p.name) + ' (bot)' : 'You'}</span>`).join('');
}

function renderAllWords() {
  const box = $('#all-words');
  const colors = Object.fromEntries(match.players.map(p => [p.id, p.color]));
  let list = results.all;
  const rare = list.filter(w => !w.common && !w.finders.length);
  if (!showObscure) list = list.filter(w => w.common || w.finders.length);
  if (resFilter === 'found') list = list.filter(w => w.finders.includes('you'));
  if (resFilter === 'missed') list = list.filter(w => !w.finders.includes('you'));
  const mineCount = results.all.filter(w => w.finders.includes('you')).length;
  $('#all-count').textContent = `· you ${mineCount} / ${results.all.filter(w => w.common || w.finders.length).length}`;
  let html = '', lastLen = 0;
  for (const w of list) {
    const L = Math.min(w.word.length, 8);
    if (L !== lastLen) { html += `<div class="len-sep">${L >= 8 ? '8+ letters' : L + ' letters'} · ${wordPoints(L)} pt${wordPoints(L) > 1 ? 's' : ''}</div>`; lastLen = L; }
    const mine = w.finders.includes('you');
    const dots = match.players.length > 1 ? `<span class="dots">${w.finders.map(id => `<i style="background:${colors[id]}"></i>`).join('')}</span>` : '';
    html += `<button class="word-chip ${mine ? 'mine' : ''} ${w.common ? '' : 'obscure'}" data-w="${w.word}">${esc(w.word)}${dots}</button>`;
  }
  box.innerHTML = html || '<p class="empty" style="color:var(--muted)">Nothing here.</p>';
  const ob = $('#btn-obscure');
  ob.hidden = !rare.length || resFilter === 'found';
  ob.textContent = showObscure ? 'Hide rare words' : `Show ${rare.length} rare dictionary words nobody found`;
}

function showWordOnMini(word) {
  const s = match.solutionMap.get(word);
  if (!s) return;
  mini.setPath(s.path);
  const who = results.all.find(a => a.word === word)?.finders || [];
  const names = who.map(id => id === 'you' ? 'you' : '🤖 ' + match.players.find(p => p.id === id).name);
  $('#mini-caption').innerHTML = `<b>${esc(word)}</b> · ${wordPoints(word)} pts · ${names.length ? 'found by ' + names.join(', ') : match.players.length > 1 ? 'nobody found it' : 'you missed it'}`;
  $$('.word-chip.sel, .mr.sel').forEach(c => c.classList.remove('sel'));
  $$(`.word-chip[data-w="${word}"]`).forEach(c => c.classList.add('sel'));
}

async function shareResult() {
  const me = results.perPlayer.you;
  const text = shareText({
    number: G.dailyMeta.number, words: me.words, points: me.score, best: me.best, found: me.found,
    totalCommon: results.totalCommon, foundCommon: foundCommon(), botsBeaten: results.parBeaten ?? null, botsTotal: results.parTotal || 5,
    url: location.origin + location.pathname,
  });
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch { /* fall back */ }
  if (!ok) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
  }
  if (ok) toast('Copied! Paste it anywhere 📋');
  else if (navigator.share) navigator.share({ text }).catch(() => {});
  else toast('Could not copy — your browser blocked the clipboard.');
}

function viewDailyResult() {
  const info = todayInfo();
  const h = prefs.daily.history[info.key];
  if (!h) return false;
  match = createMatch({ seed: info.seed, size: 4, players: [{ id: 'you', name: 'You', kind: 'human', color: YOU_COLOR }], dict, mode: 'daily' });
  h.found.forEach((w, i) => submitWord(match, 'you', w, Math.min(i * 0.01, 1)));
  G = { mode: 'daily', size: 4, dailyMeta: info, ended: true, clock: { running: false, base: 0 } };
  results = finishMatch(match);
  showResults({ replay: true });
  return true;
}

// ---------------------------------------------------------------- pause / quit
function openPause() {
  if (!G || G.ended || screen !== 'game') return;
  if (!G.started) { clearTimeout(G.cdTimer); $('#countdown').hidden = true; } // restart the countdown on resume
  pauseClock();
  $('#pause-sub').textContent = G.mode === 'daily'
    ? 'The clock is stopped. Ending the Daily now still uses your one try.'
    : 'The clock is stopped.';
  $('#pause-quit').textContent = G.mode === 'daily' ? 'End round now' : 'Quit to menu';
  openModal('#modal-pause');
}
function resumeFromPause() {
  closeModal('#modal-pause');
  unlock();
  if (G && !G.ended && !G.started) { countdown(); return; }
  resumeClock();
}
function quitFromPause() {
  closeModal('#modal-pause');
  if (G.mode === 'daily') { endRound(true); return; }
  G.ended = true;
  cancelAnimationFrame(G.raf);
  clearTimeout(G.cdTimer);
  $('#countdown').hidden = true;
  show('title');
}

// ---------------------------------------------------------------- layout
function layoutGame() {
  if (screen !== 'game') return;
  const area = $('#board-area');
  const wide = matchMedia('(min-aspect-ratio: 5/4)').matches;
  let px;
  if (wide) {
    area.style.height = '';
    px = Math.min(area.clientWidth, area.clientHeight);
  } else {
    // portrait: board as wide as possible but leave room for the found-words panel
    const body = $('.game-body');
    const colBoard = $('.col-board');
    const other = colBoard.offsetHeight - area.offsetHeight; // word line + tools
    const side = $('#scoreboard').classList.contains('on') ? $('#scoreboard').offsetHeight + 8 : 0;
    const minFound = 104;
    const avail = body.clientHeight - other - side - minFound - 8;
    px = Math.max(180, Math.min(body.clientWidth, avail, 600));
    area.style.height = Math.floor(px) + 'px';
  }
  px = Math.max(180, Math.min(px, 600));
  board.layout(Math.floor(px));
}

function layoutMini() {
  if (screen !== 'results') return;
  const el = $('#mini-board');
  el.style.width = el.style.height = '';
  mini.layout(el.getBoundingClientRect().width || 280);
}

// ---------------------------------------------------------------- input wiring
function bindUI() {
  $('#btn-daily').addEventListener('click', () => { unlock(); sfx.click(); if (!viewDailyResult()) startGame('daily'); });
  $('#btn-solo').addEventListener('click', () => { unlock(); sfx.click(); startGame('solo'); });
  $('#btn-bots').addEventListener('click', () => { unlock(); sfx.click(); openBots(); });
  $('#bots-start').addEventListener('click', () => { closeModal('#modal-bots'); startGame('bots'); });
  for (const b of $$('[data-size]')) b.addEventListener('click', () => { sfx.click(); setSize(+b.dataset.size); });
  for (const b of $$('[data-bots]')) b.addEventListener('click', () => { sfx.click(); prefs.botCount = +b.dataset.bots; store.save(); renderBotSheet(); refreshTitle(); });
  for (const b of $$('[data-diff]')) b.addEventListener('click', () => { sfx.click(); setBotLevel(b.dataset.diff); });
  $('#btn-howto').addEventListener('click', () => { unlock(); openHowTo(); });
  $('#howto-next').addEventListener('click', howNext);
  $('#howto-skip').addEventListener('click', finishHowTo);
  $('#btn-stats').addEventListener('click', openStats);
  for (const b of $$('[data-close]')) b.addEventListener('click', () => closeModal('#' + b.closest('.modal').id));
  for (const m of $$('.modal')) m.addEventListener('click', e => {
    if (e.target !== m) return;
    if (m.id === 'modal-pause') resumeFromPause();
    else if (m.id === 'modal-howto') finishHowTo();
    else closeModal('#' + m.id);
  });
  for (const b of $$('[data-mute]')) b.addEventListener('click', () => {
    unlock(); setMuted(!isMuted()); prefs.muted = isMuted(); store.save(); syncMute(); sfx.click();
  });
  $('#btn-quit').addEventListener('click', openPause);
  $('#pause-resume').addEventListener('click', resumeFromPause);
  $('#pause-quit').addEventListener('click', quitFromPause);
  $('#btn-rotate').addEventListener('click', e => { e.currentTarget.blur(); if (!G || G.ended) return; board.rotate(); sfx.click(); });
  $('#btn-submit').addEventListener('click', e => { e.currentTarget.blur(); if (G?.typed) submitTyped(); else if (board.path.length) submitPath(board.path); });
  $('#btn-again').addEventListener('click', () => { sfx.click(); startGame(G.mode === 'daily' ? 'solo' : G.mode); });
  $('#btn-menu').addEventListener('click', () => { sfx.click(); clearRoundTimers(); show('title'); });
  $('#btn-share').addEventListener('click', shareResult);
  for (const t of $$('.tab')) t.addEventListener('click', () => {
    resFilter = t.dataset.filter;
    $$('.tab').forEach(x => { x.classList.toggle('active', x === t); x.setAttribute('aria-selected', String(x === t)); });
    renderAllWords();
  });
  $('#btn-obscure').addEventListener('click', () => { showObscure = !showObscure; renderAllWords(); });
  $('#all-words').addEventListener('click', e => { const c = e.target.closest('.word-chip'); if (c) showWordOnMini(c.dataset.w); });
  $('#missed-reveal').addEventListener('click', e => { const c = e.target.closest('.mr'); if (c) showWordOnMini(c.dataset.w); });

  window.addEventListener('resize', () => { layoutGame(); layoutMini(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && screen === 'title') refreshTitle(); });
  window.addEventListener('storage', e => { if (e.key && e.key.startsWith('gridword') && screen === 'title') refreshTitle(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && G && !G.ended && screen === 'game' && $('#modal-pause').hidden) openPause(); });
  document.addEventListener('keydown', onKey);
}

function onKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey || !dict) return;
  const k = e.key;
  // modals first
  if (!$('#modal-howto').hidden) { if (k === 'Enter' || k === 'ArrowRight') { e.preventDefault(); howNext(); } else if (k === 'Escape') finishHowTo(); return; }
  if (!$('#modal-pause').hidden) { if (k === 'Escape' || k === 'Enter') { e.preventDefault(); k === 'Escape' ? resumeFromPause() : document.activeElement?.click?.(); } return; }
  if (!$('#modal-bots').hidden) {
    const lk = k.toLowerCase();
    if (k === 'Escape') closeModal('#modal-bots');
    else if (['3', '4', '5'].includes(k)) { prefs.botCount = +k; store.save(); renderBotSheet(); refreshTitle(); }
    else if (lk === 'e' || lk === 'n' || lk === 'h') setBotLevel({ e: 'easy', n: 'normal', h: 'hard' }[lk]);
    return;
  }
  if (!$('#modal-stats').hidden) { if (k === 'Escape') closeModal('#modal-stats'); return; }

  if (screen === 'title') {
    const key = k.toLowerCase();
    if (key === 'd') $('#btn-daily').click();
    else if (key === 's') $('#btn-solo').click();
    else if (key === 'b') $('#btn-bots').click();
    else if (key === 'h') openHowTo();
    else if (key === 'm') $('[data-mute]').click();
    else if (k === '4' || k === '5') setSize(+k);
    return;
  }
  if (screen === 'results') {
    if (k === 'Escape') $('#btn-menu').click();
    else if (k === 'Enter' && !(document.activeElement && document.activeElement.tagName === 'BUTTON')) $('#btn-again').click();
    return;
  }
  if (screen !== 'game' || !G || G.ended) return;
  if (k === 'Escape') {
    e.preventDefault();
    if (G.typed || board.path.length) { G.typed = ''; board.setPath([]); renderCurrentWord(); }
    else openPause();
    return;
  }
  if (!G.clock.running) { if (k === 'Enter' || k === ' ') e.preventDefault(); return; }
  if (k === 'Enter') { e.preventDefault(); submitTyped(); return; }
  if (k === ' ') { e.preventDefault(); board.rotate(); return; }
  if (k === 'Backspace') {
    e.preventDefault();
    if (!G.typed && board.path.length) { board.setPath(board.path.slice(0, -1)); renderCurrentWord(); sfx.unselect(); return; }
    G.typed = G.typed.slice(0, -1);
    updateTypedPath();
    sfx.unselect();
    return;
  }
  if (/^[a-zA-Z]$/.test(k)) {
    e.preventDefault();
    board.clearFlash();
    if (!G.typed) board.path = []; // typing always starts a fresh word
    G.typed += k.toLowerCase(); // 'qu' matches the single Qu tile
    updateTypedPath();
    sfx.select(Math.max(0, G.typed.length - 1));
  }
}

function updateTypedPath() {
  const p = G.typed ? findPath(match.tiles, match.size, G.typed, board.path) : [];
  board.path = p || [];
  board.renderPath(p ? '' : 'bad');
  renderCurrentWord(p ? '' : 'bad');
}

// ---------------------------------------------------------------- test hook (only with ?test)
function exposeTestHook() {
  window.__gw = {
    get screen() { return screen; },
    get match() { return match; },
    get results() { return results; },
    board,
    now,
    /** jump the round clock forward */
    skip(sec) { if (G) G.clock.base += sec; },
    tileCenter(i) {
      const r = $('#board').getBoundingClientRect();
      const c = board.center(i);
      return { x: r.left + c.x * r.width / board.px, y: r.top + c.y * r.height / board.px };
    },
  };
}

boot();
