// Renders a letter grid (DOM tiles + SVG path) and handles swipe / tap input.
import { isAdjacent } from '../core/board.js';

export class BoardView {
  /**
   * @param {HTMLElement} el container (.board / .mini-board) containing an <svg class="path-svg"><polyline/></svg>
   * @param {object} opts {interactive, onPathChange(path, change), onSubmit(path)}
   */
  constructor(el, opts = {}) {
    this.el = el;
    this.opts = opts;
    this.svg = el.querySelector('svg');
    this.line = this.svg.querySelector('polyline');
    this.tiles = [];
    this.tileEls = [];
    this.size = 4;
    this.px = 300;
    this.rotation = 0;
    this.path = [];
    this.enabled = false;
    this.gesture = null;
    if (opts.interactive) this.bindInput();
  }

  setBoard(tiles, size) {
    this.tiles = tiles;
    this.size = size;
    this.path = [];
    this.rotation = 0;
    this.cancelReveal();
    clearTimeout(this._flashT);
    this.flashPath = null;
    for (const t of this.tileEls) t.remove();
    this.tileEls = tiles.map((letter, i) => {
      const d = document.createElement('div');
      d.className = 'tile' + (letter === 'QU' ? ' qu' : '');
      d.dataset.i = i;
      d.setAttribute('aria-label', letter === 'QU' ? 'Q U' : letter);
      d.innerHTML = `<span class="tl">${letter === 'QU' ? 'Q<small>u</small>' : letter}</span>`;
      this.el.insertBefore(d, this.svg);
      return d;
    });
    this.layout(this.px);
    this.renderPath();
  }

  /** Size the board to `px` square pixels and position tiles. */
  layout(px) {
    this.px = px;
    this.el.style.width = this.el.style.height = px + 'px';
    const n = this.size;
    const pad = px * 0.045, gap = px * (n === 4 ? 0.035 : 0.028);
    const cell = (px - 2 * pad - (n - 1) * gap) / n;
    this.geom = { pad, gap, cell };
    this.tileEls.forEach((d, i) => {
      const { x, y } = this.cellPos(i);
      d.style.width = d.style.height = cell + 'px';
      d.style.left = x + 'px';
      d.style.top = y + 'px';
      d.style.fontSize = cell * (this.tiles[i] === 'QU' ? 0.46 : 0.52) + 'px';
    });
    this.svg.setAttribute('viewBox', `0 0 ${px} ${px}`);
    this.line.style.strokeWidth = cell * (this.opts.static ? 0.2 : 0.21) + 'px';
    this.renderPath();
  }

  /** Display (row, col) of a logical tile after rotation. */
  displayRC(i) {
    const n = this.size;
    let r = Math.floor(i / n), c = i % n;
    for (let k = 0; k < this.rotation; k++) [r, c] = [c, n - 1 - r];
    return { r, c };
  }

  cellPos(i) {
    const { pad, gap, cell } = this.geom;
    const { r, c } = this.displayRC(i);
    return { x: pad + c * (cell + gap), y: pad + r * (cell + gap) };
  }

  center(i) {
    const { x, y } = this.cellPos(i);
    const h = this.geom.cell / 2;
    return { x: x + h, y: y + h };
  }

  rotate() {
    this.rotation = (this.rotation + 1) % 4;
    this.layout(this.px);
  }

  setPath(path, cls = '') {
    this.path = path.slice();
    this.renderPath(cls);
  }

  renderPath(cls = '') {
    // while a submitted word is flashing (and nothing new is being built) show that instead
    const showing = this.path.length ? this.path : (this.flashPath || []);
    const set = new Set(this.path);
    const last = this.path[this.path.length - 1];
    this.tileEls.forEach((d, i) => {
      d.classList.toggle('sel', set.has(i));
      d.classList.toggle('last', i === last && this.path.length > 0 && !this.opts.static);
      if (this.opts.static) { // results board: number the tiles so the word's direction is readable
        const k = this.path.indexOf(i);
        if (k >= 0) d.dataset.ord = k + 1; else delete d.dataset.ord;
        d.classList.toggle('start', k === 0);
      }
    });
    this.line.setAttribute('points', showing.map(i => { const c = this.center(i); return `${c.x},${c.y}`; }).join(' '));
    this.svg.setAttribute('class', 'path-svg' + ((cls || (!this.path.length && this.flashCls)) ? ' ' + (cls || this.flashCls) : ''));
  }

  /** Briefly colour the given tiles (ok/bad/dup) — the live path is cleared immediately. */
  flash(path, cls, ms = 380) {
    this.clearFlash();
    this.path = [];
    this.flashPath = path.slice();
    this.flashCls = cls;
    const els = path.map(i => this.tileEls[i]);
    this.renderPath();
    for (const d of els) d.classList.add(cls);
    this._flashT = setTimeout(() => this.clearFlash(), ms);
  }

  clearFlash() {
    clearTimeout(this._flashT);
    this.flashPath = null;
    this.flashCls = '';
    for (const d of this.tileEls) d.classList.remove('ok', 'bad', 'dup');
    this.renderPath();
  }

  setFaceDown(on) {
    if (on) this.cancelReveal();
    for (const d of this.tileEls) d.classList.toggle('facedown', on);
    if (on) this.el.setAttribute('aria-hidden', 'true'); else this.el.removeAttribute('aria-hidden');
  }

  cancelReveal() { (this.revealT || []).forEach(clearTimeout); this.revealT = []; }

  revealTiles() {
    this.cancelReveal();
    this.el.removeAttribute('aria-hidden');
    this.tileEls.forEach((d, i) => {
      const { r, c } = this.displayRC(i);
      this.revealT.push(setTimeout(() => {
        d.classList.remove('facedown'); d.classList.add('flip');
        this.revealT.push(setTimeout(() => d.classList.remove('flip'), 500));
      }, (r + c) * 45));
    });
  }

  /** Floating "+N" from a tile. */
  popPoints(i, text, color) {
    const c = this.center(i);
    const p = document.createElement('div');
    p.className = 'pop';
    p.textContent = text;
    if (color) p.style.color = color;
    p.style.left = c.x + 'px';
    p.style.top = (c.y - this.geom.cell * 0.45) + 'px';
    this.el.appendChild(p);
    setTimeout(() => p.remove(), 950);
  }

  // ---------------- input ----------------
  hit(clientX, clientY, generous) {
    const rect = this.el.getBoundingClientRect();
    const x = (clientX - rect.left) * (this.px / rect.width);
    const y = (clientY - rect.top) * (this.px / rect.height);
    const R = this.geom.cell * (generous ? 0.66 : 0.43);
    let best = -1, bestD = Infinity;
    for (let i = 0; i < this.tiles.length; i++) {
      const c = this.center(i);
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < bestD) { bestD = d; best = i; }
    }
    return bestD <= R ? best : -1;
  }

  bindInput() {
    const el = this.el;
    el.addEventListener('pointerdown', e => this.onDown(e));
    el.addEventListener('pointermove', e => this.onMove(e));
    el.addEventListener('pointerup', e => this.onUp(e));
    el.addEventListener('pointercancel', e => this.onUp(e, true));
    el.addEventListener('lostpointercapture', e => { if (this.gesture && this.gesture.id === e.pointerId) this.onUp(e); });
    el.addEventListener('contextmenu', e => e.preventDefault());
  }

  emit(change) { this.renderPath(); this.opts.onPathChange?.(this.path, change); }

  onDown(e) {
    if (!this.enabled || this.gesture) return;
    e.preventDefault();
    const i = this.hit(e.clientX, e.clientY, true);
    try { el_capture(this.el, e.pointerId); } catch { /* ignore */ }
    const prevPath = this.path.slice();
    const last = prevPath[prevPath.length - 1];
    let downOnLast = false;
    this.clearFlash();
    if (i === -1) {
      this.gesture = { id: e.pointerId, moved: false, downOnLast: false, x: e.clientX, y: e.clientY };
      return;
    }
    if (prevPath.length && i === last) {
      downOnLast = true;
    } else if (prevPath.length && prevPath.includes(i)) {
      this.path = prevPath.slice(0, prevPath.indexOf(i) + 1);
      this.emit({ type: 'remove' });
    } else if (prevPath.length && isAdjacent(this.size, last, i)) {
      this.path.push(i);
      this.emit({ type: 'add', index: i });
    } else {
      this.path = [i];
      this.emit({ type: 'add', index: i, fresh: true });
    }
    this.gesture = { id: e.pointerId, moved: false, downOnLast, start: i, x: e.clientX, y: e.clientY };
  }

  onMove(e) {
    const g = this.gesture;
    if (!g || g.id !== e.pointerId || !this.enabled) return;
    e.preventDefault();
    // sample along the segment so fast swipes don't skip tiles
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    const rect = this.el.getBoundingClientRect();
    const stepPx = (this.geom.cell * rect.width / this.px) * 0.18;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / stepPx));
    for (let s = 1; s <= steps; s++) this.visit(g.x + dx * s / steps, g.y + dy * s / steps);
    g.x = e.clientX; g.y = e.clientY;
  }

  visit(x, y) {
    const g = this.gesture;
    if (!this.path.length) {
      const i = this.hit(x, y, true);
      if (i !== -1) { this.path = [i]; g.moved = true; this.emit({ type: 'add', index: i, fresh: true }); }
      return;
    }
    const i = this.hit(x, y, false);
    if (i === -1) return;
    if (i === this.path[this.path.length - 1]) return;
    // A real drag that didn't begin on the end of a tap-built path starts a fresh word
    // (so a stray earlier tap isn't glued onto this swipe).
    if (g.start !== undefined && !g.downOnLast && !g.restarted) {
      g.restarted = true;
      if (this.path.length !== 1 || this.path[0] !== g.start) { this.path = [g.start]; g.moved = true; this.emit({ type: 'remove' }); }
    }
    const n = this.path.length;
    const last = this.path[n - 1];
    if (i === last) return;
    if (n >= 2 && i === this.path[n - 2]) {
      this.path.pop(); g.moved = true;
      this.emit({ type: 'remove' });
      return;
    }
    if (!this.path.includes(i) && isAdjacent(this.size, last, i)) {
      this.path.push(i); g.moved = true;
      this.emit({ type: 'add', index: i });
    }
  }

  onUp(e, cancelled) {
    const g = this.gesture;
    if (!g || g.id !== e.pointerId) return;
    this.gesture = null;
    if (!this.enabled || cancelled) { this.opts.onGestureEnd?.(); return; }
    if (g.moved) { if (this.path.length) this.opts.onSubmit?.(this.path.slice()); }
    else if (g.downOnLast && this.path.length > 1) this.opts.onSubmit?.(this.path.slice());
    else if (g.downOnLast && this.path.length === 1) { this.path = []; this.emit({ type: 'remove' }); } // tap again = deselect
    // otherwise: a tap — keep the path (tap-to-build mode)
    this.opts.onGestureEnd?.();
  }

  cancelGesture() { this.gesture = null; }
}

function el_capture(el, id) { if (el.setPointerCapture) el.setPointerCapture(id); }
