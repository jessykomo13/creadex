// Audio : effets sonores synthétisés + sons importés (Web Audio)

let ctx = null;
let master = null;
let noiseBuf = null;

export function audioContext() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
  }
  return ctx;
}

/** À appeler lors d'un geste utilisateur (iOS) */
export function unlockAudio() {
  const c = audioContext();
  if (!c) return;
  if (c.state === 'suspended') c.resume();
  try {
    const b = c.createBuffer(1, 1, 22050);
    const s = c.createBufferSource();
    s.buffer = b;
    s.connect(master);
    s.start(0);
  } catch {}
}

function noise() {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

function tone(out, t, { type = 'square', f0, f1 = f0, dur, vol = 0.3, attack = 0.005, curve = 'exp' }) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) {
    if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    else o.frequency.linearRampToValueAtTime(f1, t + dur);
  }
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
  return o;
}

function noiseHit(out, t, { dur, vol = 0.4, f0 = 3000, f1 = 200 }) {
  const s = ctx.createBufferSource();
  s.buffer = noise();
  const flt = ctx.createBiquadFilter();
  flt.type = 'lowpass';
  flt.frequency.setValueAtTime(f0, t);
  flt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(flt).connect(g).connect(out);
  s.start(t);
  s.stop(t + dur + 0.02);
  return s;
}

const SFX = {
  coin: (o, t, p) => { tone(o, t, { f0: 988 * p, dur: 0.07, vol: 0.18 }); tone(o, t + 0.07, { f0: 1319 * p, dur: 0.28, vol: 0.18 }); return 0.36; },
  jump: (o, t, p) => { tone(o, t, { f0: 260 * p, f1: 720 * p, dur: 0.2, vol: 0.18 }); return 0.22; },
  hit: (o, t, p) => { noiseHit(o, t, { dur: 0.16, vol: 0.5, f0: 2500 * p, f1: 300 }); tone(o, t, { type: 'square', f0: 180 * p, f1: 60 * p, dur: 0.15, vol: 0.2 }); return 0.18; },
  explosion: (o, t, p) => { noiseHit(o, t, { dur: 0.9, vol: 0.7, f0: 1800 * p, f1: 60 }); tone(o, t, { type: 'sine', f0: 120 * p, f1: 30, dur: 0.6, vol: 0.4 }); return 0.9; },
  laser: (o, t, p) => { tone(o, t, { type: 'sawtooth', f0: 1400 * p, f1: 180 * p, dur: 0.18, vol: 0.14 }); return 0.2; },
  powerup: (o, t, p) => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(o, t + i * 0.07, { f0: f * p, dur: 0.12, vol: 0.15 })); return 0.45; },
  click: (o, t, p) => { tone(o, t, { type: 'sine', f0: 1100 * p, dur: 0.04, vol: 0.25 }); return 0.05; },
  blip: (o, t, p) => { tone(o, t, { f0: 660 * p, dur: 0.07, vol: 0.15 }); return 0.08; },
  lose: (o, t, p) => { [392, 330, 262, 196].forEach((f, i) => tone(o, t + i * 0.16, { type: 'triangle', f0: f * p, f1: f * p * 0.97, dur: 0.22, vol: 0.25 })); return 0.75; },
  win: (o, t, p) => { [523, 659, 784, 1047].forEach((f, i) => tone(o, t + i * 0.1, { type: 'triangle', f0: f * p, dur: i === 3 ? 0.5 : 0.14, vol: 0.25 })); return 0.85; },
};
export const SFX_NAMES = Object.keys(SFX);

export class AudioSystem {
  constructor(project) {
    this.project = project;
    this.buffers = new Map();
    this.active = new Set();
    this.muted = false;
  }

  findAsset(ref) {
    if (!ref) return null;
    return (this.project.assets || []).find((a) => a.kind === 'audio' && (a.id === ref || a.name === ref)) || null;
  }

  async buffer(asset) {
    let p = this.buffers.get(asset.id);
    if (!p) {
      p = fetch(asset.data)
        .then((r) => r.arrayBuffer())
        .then((ab) => new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej)));
      this.buffers.set(asset.id, p);
    }
    return p;
  }

  /** Joue un son. clip : 'coin', 'sfx:coin' ou nom/id d'un son importé. Retourne une poignée {stop()} */
  play(clip, { volume = 1, pitch = 1, loop = false } = {}) {
    const c = audioContext();
    if (!c || this.muted || !clip) return { stop() {}, playing: false };
    if (c.state === 'suspended') c.resume();
    const out = c.createGain();
    out.gain.value = Math.max(0, volume);
    out.connect(master);
    const handle = { playing: true, out, timer: 0, src: null };
    handle.stop = () => {
      handle.playing = false;
      clearTimeout(handle.timer);
      try {
        handle.src && handle.src.stop();
      } catch {}
      try {
        out.disconnect();
      } catch {}
      this.active.delete(handle);
    };
    this.active.add(handle);
    const name = String(clip).replace(/^sfx:/, '');
    if (SFX[name]) {
      const run = () => {
        if (!handle.playing) return;
        const dur = SFX[name](out, c.currentTime + 0.005, pitch);
        if (loop) handle.timer = setTimeout(run, dur * 1000);
        else handle.timer = setTimeout(() => handle.stop(), dur * 1000 + 200);
      };
      run();
      return handle;
    }
    const asset = this.findAsset(clip);
    if (!asset) {
      handle.stop();
      return handle;
    }
    this.buffer(asset)
      .then((buf) => {
        if (!handle.playing) return;
        const s = c.createBufferSource();
        s.buffer = buf;
        s.loop = loop;
        s.playbackRate.value = pitch;
        s.connect(out);
        s.onended = () => !loop && handle.stop();
        s.start();
        handle.src = s;
      })
      .catch(() => handle.stop());
    return handle;
  }

  stopAll() {
    for (const hdl of [...this.active]) hdl.stop();
  }
}
