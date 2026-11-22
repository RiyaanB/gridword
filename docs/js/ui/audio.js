// Tiny WebAudio synth — every sound is generated, no audio files.
let ctx = null;
let master = null;
let muted = false;

const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31, 33, 36];
const hz = semis => 440 * Math.pow(2, (semis - 9) / 12) / 2; // semis from C4-ish

export function setMuted(m) { muted = !!m; if (master) master.gain.value = muted ? 0 : 0.5; }
export function isMuted() { return muted; }

/** Must be called from a user gesture at least once. */
export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp); comp.connect(ctx.destination);
  }
  if (ctx.state !== 'running') ctx.resume().catch(() => {}); // 'suspended' or iOS 'interrupted'
}

function tone({ f, f2, type = 'sine', dur = 0.12, vol = 0.3, at = 0, attack = 0.005 }) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

function noise({ dur = 0.08, vol = 0.15, at = 0, freq = 2000 }) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + at;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filt = ctx.createBiquadFilter();
  filt.type = 'bandpass'; filt.frequency.value = freq; filt.Q.value = 1.2;
  const g = ctx.createGain(); g.gain.value = vol;
  src.connect(filt); filt.connect(g); g.connect(master);
  src.start(t);
}

export const sfx = {
  select(n) { const s = PENTA[Math.min(n, PENTA.length - 1)] + 12; tone({ f: hz(s), type: 'triangle', dur: 0.09, vol: 0.18 }); },
  unselect() { tone({ f: 330, f2: 260, type: 'triangle', dur: 0.06, vol: 0.1 }); },
  good(combo, len) {
    const base = 12 + Math.min(combo, 8) * 2;
    const notes = [0, 4, 7, 12];
    if (len >= 6) notes.push(16, 19);
    if (len >= 8) notes.push(24);
    notes.forEach((n, i) => tone({ f: hz(base + n), type: 'triangle', dur: 0.22, vol: 0.2, at: i * 0.045 }));
    if (len >= 6) noise({ dur: 0.4, vol: 0.06, at: 0.1, freq: 6000 });
  },
  dup() { tone({ f: 520, type: 'sine', dur: 0.07, vol: 0.15 }); tone({ f: 520, type: 'sine', dur: 0.07, vol: 0.12, at: 0.09 }); },
  bad() { tone({ f: 180, f2: 90, type: 'square', dur: 0.22, vol: 0.12 }); },
  tick(urgent) { noise({ dur: 0.04, vol: urgent ? 0.3 : 0.15, freq: urgent ? 2600 : 1800 }); },
  count() { tone({ f: 440, type: 'sine', dur: 0.15, vol: 0.2 }); },
  go() { [0, 4, 7, 12].forEach((n, i) => tone({ f: hz(19 + n), type: 'triangle', dur: 0.3, vol: 0.18, at: i * 0.03 })); },
  end() { [12, 7, 4, 0].forEach((n, i) => tone({ f: hz(12 + n), type: 'triangle', dur: 0.4, vol: 0.2, at: i * 0.12 })); noise({ dur: 0.6, vol: 0.05, freq: 900, at: 0.36 }); },
  bot() { tone({ f: 900, f2: 1200, type: 'sine', dur: 0.05, vol: 0.035 }); },
  reveal(i) { tone({ f: hz(7 + i * 3), f2: hz(12 + i * 3), type: 'sine', dur: 0.18, vol: 0.12 }); },
  win() { [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => tone({ f: hz(12 + n), type: 'triangle', dur: 0.3, vol: 0.16, at: i * 0.07 })); },
  lock() { tone({ f: 1320, type: 'sine', dur: 0.06, vol: 0.07 }); tone({ f: 1760, type: 'sine', dur: 0.07, vol: 0.05, at: 0.04 }); },
  click() { tone({ f: 700, type: 'sine', dur: 0.04, vol: 0.08 }); },
};
