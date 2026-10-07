// Entrées : clavier, tactile, souris, joystick virtuel et boutons A/B

import { Vector2, Vector3, normKey } from './api.js';
import { h } from './util.js';

const AXIS_SENS = 3;

function keyName(k) {
  let s = String(k).toLowerCase().trim();
  if (s === 'return') s = 'enter';
  if (s.endsWith('arrow')) s = s.replace('arrow', '').trim();
  if (s.startsWith('arrow')) s = s.replace('arrow', '').trim();
  if (s === 'ctrl' || s === 'leftcontrol' || s === 'rightcontrol') s = 'control';
  if (s === 'leftshift' || s === 'rightshift') s = 'shift';
  if (s === 'esc') s = 'escape';
  if (s.startsWith('alpha') && s.length === 6) s = s[5];
  return s;
}

const BUTTONS = {
  jump: { keys: ['space'], v: 'A' },
  fire1: { keys: ['control', 'x', 'k'], v: 'B' },
  fire2: { keys: ['alt', 'c', 'l'], v: 'C' },
  fire3: { keys: ['shift', 'v'], v: null },
  submit: { keys: ['enter'], v: null },
  cancel: { keys: ['escape'], v: null },
  a: { keys: ['space'], v: 'A' },
  b: { keys: ['x'], v: 'B' },
};

export class InputSystem {
  constructor(container, opts = {}) {
    this.container = container;
    this.held = new Set();
    this.down = new Set();
    this.up = new Set();
    this.axes = { horizontal: 0, vertical: 0 };
    this.joy = { x: 0, y: 0, active: false };
    this.vbtn = { A: false, B: false, C: false };
    this.vdown = new Set();
    this.vup = new Set();
    this.touchMap = new Map();
    this.mouse = { x: 0, y: 0, dx: 0, dy: 0, buttons: [false, false, false], down: [false, false, false], up: [false, false, false] };
    this.primaryId = null;
    this.accel = new Vector3(0, -1, 0);
    this.opts = { joystick: true, buttonA: true, buttonB: true, labelA: 'A', labelB: 'B', ...opts };
    this._listeners = [];
    this.pendingDown = [];
    this.attach();
  }

  on(target, ev, fn, opt) {
    target.addEventListener(ev, fn, opt);
    this._listeners.push(() => target.removeEventListener(ev, fn, opt));
  }

  attach() {
    const isField = (e) => {
      const t = e.target;
      return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    };
    this.on(window, 'keydown', (e) => {
      if (isField(e) || e.metaKey) return;
      const k = normKey(e.key);
      if (!this.held.has(k)) this.down.add(k);
      this.held.add(k);
      if (['space', 'up', 'down', 'left', 'right'].includes(k)) e.preventDefault();
    });
    this.on(window, 'keyup', (e) => {
      const k = normKey(e.key);
      this.held.delete(k);
      this.up.add(k);
    });
    this.on(window, 'blur', () => {
      for (const k of this.held) this.up.add(k);
      this.held.clear();
    });

    const c = this.container;
    const local = (e) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
    };
    this.on(c, 'pointerdown', (e) => {
      if (e.target.closest && e.target.closest('.vctl, .ui-button')) return;
      const p = local(e);
      try {
        c.setPointerCapture(e.pointerId);
      } catch {}
      this.touchMap.set(e.pointerId, { fingerId: e.pointerId, x: p.x, y: p.y, dx: 0, dy: 0, phase: 'Began', t: performance.now() });
      if (this.primaryId === null) {
        this.primaryId = e.pointerId;
        const b = e.pointerType === 'mouse' ? e.button : 0;
        this.mouse.buttons[b] = true;
        this.mouse.down[b] = true;
        this.mouse.x = p.x;
        this.mouse.y = p.y;
        this.pendingDown.push({ x: p.x, y: p.y });
      }
    });
    this.on(c, 'pointermove', (e) => {
      const p = local(e);
      const t = this.touchMap.get(e.pointerId);
      if (t) {
        t.dx += p.x - t.x;
        t.dy += p.y - t.y;
        t.x = p.x;
        t.y = p.y;
        if (t.phase !== 'Began') t.phase = 'Moved';
      }
      if (e.pointerId === this.primaryId || (e.pointerType === 'mouse' && this.primaryId === null)) {
        this.mouse.dx += p.x - this.mouse.x;
        this.mouse.dy += p.y - this.mouse.y;
        this.mouse.x = p.x;
        this.mouse.y = p.y;
      }
    });
    const end = (e) => {
      const t = this.touchMap.get(e.pointerId);
      if (t) t.phase = e.type === 'pointercancel' ? 'Canceled' : 'Ended';
      if (e.pointerId === this.primaryId) {
        this.primaryId = null;
        for (let i = 0; i < 3; i++)
          if (this.mouse.buttons[i]) {
            this.mouse.buttons[i] = false;
            this.mouse.up[i] = true;
          }
      }
    };
    this.on(c, 'pointerup', end);
    this.on(c, 'pointercancel', end);
    this.on(c, 'contextmenu', (e) => e.preventDefault());

    this.on(window, 'devicemotion', (e) => {
      const a = e.accelerationIncludingGravity;
      if (a && a.x !== null) {
        // repère écran portrait, unités en g (comme Unity)
        const s = /iP(hone|ad|od)/.test(navigator.userAgent) ? 1 : -1;
        this.accel = new Vector3((s * a.x) / 9.81, (s * a.y) / 9.81, (s * a.z) / 9.81);
      }
    });

    this.buildVirtual();
  }

  buildVirtual() {
    const knob = h('div.vjoy-knob');
    const base = h('div.vjoy-base', knob);
    const zone = h('div.vctl.vjoy-zone', base);
    let pid = null;
    let cx = 0, cy = 0;
    let R = 46;
    const move = (e) => {
      const dx = e.clientX - cx, dy = e.clientY - cy;
      const d = Math.hypot(dx, dy);
      const k = d > R ? R / d : 1;
      knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      this.joy.x = (dx * k) / R;
      this.joy.y = -(dy * k) / R;
    };
    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      pid = e.pointerId;
      zone.setPointerCapture(pid);
      const r = base.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      R = Math.max(24, r.width * 0.38);
      this.joy.active = true;
      base.classList.add('active');
      move(e);
    });
    zone.addEventListener('pointermove', (e) => e.pointerId === pid && move(e));
    const release = (e) => {
      if (e.pointerId !== pid) return;
      pid = null;
      this.joy.x = this.joy.y = 0;
      this.joy.active = false;
      knob.style.transform = '';
      base.classList.remove('active');
    };
    zone.addEventListener('pointerup', release);
    zone.addEventListener('pointercancel', release);

    const mkBtn = (id, label, cls) => {
      const b = h('div.vctl.vbtn.' + cls, label);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        b.setPointerCapture(e.pointerId);
        if (!this.vbtn[id]) this.vdown.add(id);
        this.vbtn[id] = true;
        b.classList.add('pressed');
      });
      const up = () => {
        if (this.vbtn[id]) this.vup.add(id);
        this.vbtn[id] = false;
        b.classList.remove('pressed');
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      return b;
    };
    this.btnA = mkBtn('A', this.opts.labelA || 'A', 'vbtn-a');
    this.btnB = mkBtn('B', this.opts.labelB || 'B', 'vbtn-b');
    this.joyZone = zone;
    this.vroot = h('div.vcontrols', zone, this.btnA, this.btnB);
    this.container.appendChild(this.vroot);
    this.applyVirtual();
  }

  applyVirtual() {
    const o = this.opts;
    this.joyZone.style.display = o.joystick ? '' : 'none';
    this.btnA.style.display = o.buttonA ? '' : 'none';
    this.btnB.style.display = o.buttonB ? '' : 'none';
    this.btnA.textContent = o.labelA || 'A';
    this.btnB.textContent = o.labelB || 'B';
  }

  setVirtual(cfg) {
    Object.assign(this.opts, cfg);
    this.applyVirtual();
  }

  beginFrame(dt) {
    const raw = (n) => this.axisRaw(n);
    for (const n of ['horizontal', 'vertical']) {
      const target = raw(n);
      const j = n === 'horizontal' ? this.joy.x : this.joy.y;
      if (this.joy.active && Math.abs(j) > 0.01) {
        this.axes[n] = j;
        continue;
      }
      let v = this.axes[n];
      if (target === 0) v = Math.abs(v) <= AXIS_SENS * dt ? 0 : v - Math.sign(v) * AXIS_SENS * dt;
      else {
        if (Math.sign(v) !== Math.sign(target) && v !== 0) v = 0;
        v += Math.sign(target) * AXIS_SENS * dt;
        v = Math.max(-1, Math.min(1, v));
      }
      this.axes[n] = v;
    }
  }

  endFrame() {
    this.down.clear();
    this.up.clear();
    this.vdown.clear();
    this.vup.clear();
    this.mouse.down = [false, false, false];
    this.mouse.up = [false, false, false];
    this.mouse.dx = this.mouse.dy = 0;
    this.pendingDown.length = 0;
    for (const [id, t] of this.touchMap) {
      if (t.phase === 'Ended' || t.phase === 'Canceled') this.touchMap.delete(id);
      else {
        t.phase = 'Stationary';
        t.dx = t.dy = 0;
      }
    }
  }

  axisRaw(name) {
    const n = String(name).toLowerCase();
    const k = (a) => (this.held.has(a) ? 1 : 0);
    if (n === 'horizontal') {
      const v = k('right') + k('d') - k('left') - k('a');
      if (v === 0 && this.joy.active) return Math.abs(this.joy.x) > 0.2 ? Math.sign(this.joy.x) : 0;
      return Math.max(-1, Math.min(1, v));
    }
    if (n === 'vertical') {
      const v = k('up') + k('w') - k('down') - k('s');
      if (v === 0 && this.joy.active) return Math.abs(this.joy.y) > 0.2 ? Math.sign(this.joy.y) : 0;
      return Math.max(-1, Math.min(1, v));
    }
    if (n === 'mouse x') return this.mouse.dx * 0.1;
    if (n === 'mouse y') return -this.mouse.dy * 0.1;
    return 0;
  }

  button(name, kind) {
    const b = BUTTONS[String(name).toLowerCase()];
    if (!b) return false;
    const set = kind === 'down' ? this.down : kind === 'up' ? this.up : this.held;
    if (b.keys.some((k) => set.has(k))) return true;
    if (b.v) {
      if (kind === 'down') return this.vdown.has(b.v);
      if (kind === 'up') return this.vup.has(b.v);
      return !!this.vbtn[b.v];
    }
    return false;
  }

  /** Objet « Input » exposé aux scripts */
  api() {
    const self = this;
    const height = () => self.container.clientHeight;
    return {
      GetKey: (k) => self.held.has(keyName(k)),
      GetKeyDown: (k) => self.down.has(keyName(k)),
      GetKeyUp: (k) => self.up.has(keyName(k)),
      GetAxis: (n) => {
        const l = String(n).toLowerCase();
        if (l === 'horizontal' || l === 'vertical') return self.axes[l];
        return self.axisRaw(n);
      },
      GetAxisRaw: (n) => self.axisRaw(n),
      GetButton: (n) => self.button(n, 'held'),
      GetButtonDown: (n) => self.button(n, 'down'),
      GetButtonUp: (n) => self.button(n, 'up'),
      GetMouseButton: (i = 0) => !!self.mouse.buttons[i],
      GetMouseButtonDown: (i = 0) => !!self.mouse.down[i],
      GetMouseButtonUp: (i = 0) => !!self.mouse.up[i],
      get mousePosition() {
        return new Vector3(self.mouse.x, height() - self.mouse.y, 0);
      },
      get mouseDelta() {
        return new Vector2(self.mouse.dx, -self.mouse.dy);
      },
      get touchCount() {
        return self.touchMap.size;
      },
      get touches() {
        return [...self.touchMap.values()].map((t) => self.touchObj(t));
      },
      GetTouch: (i) => {
        const t = [...self.touchMap.values()][i];
        return t ? self.touchObj(t) : null;
      },
      get anyKey() {
        return self.held.size > 0 || self.mouse.buttons.some(Boolean) || Object.values(self.vbtn).some(Boolean);
      },
      get anyKeyDown() {
        return self.down.size > 0 || self.mouse.down.some(Boolean) || self.vdown.size > 0;
      },
      get acceleration() {
        return self.accel.clone();
      },
      get joystick() {
        return new Vector2(self.joy.x, self.joy.y);
      },
      SetVirtualControls: (cfg) => self.setVirtual(cfg || {}),
    };
  }

  touchObj(t) {
    const H = this.container.clientHeight;
    return { fingerId: t.fingerId, position: new Vector2(t.x, H - t.y), deltaPosition: new Vector2(t.dx, -t.dy), phase: t.phase };
  }

  dispose() {
    this._listeners.forEach((f) => f());
    this._listeners = [];
    this.vroot && this.vroot.remove();
  }
}

/** Demande l'accès aux capteurs de mouvement (iOS : doit suivre un geste de l'utilisateur) */
export async function requestMotionPermission() {
  try {
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      await DeviceMotionEvent.requestPermission();
    }
  } catch {}
}
