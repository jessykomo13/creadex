// API mathématique façon Unity (indépendante du moteur)
// Convention : Y vers le haut, « avant » = -Z (comme les caméras three.js).

import * as THREE from 'three';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

function num(v, d = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

// ---------------------------------------------------------------- Vector3

export class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  static get zero() { return new Vector3(0, 0, 0); }
  static get one() { return new Vector3(1, 1, 1); }
  static get up() { return new Vector3(0, 1, 0); }
  static get down() { return new Vector3(0, -1, 0); }
  static get left() { return new Vector3(-1, 0, 0); }
  static get right() { return new Vector3(1, 0, 0); }
  static get forward() { return new Vector3(0, 0, -1); }
  static get back() { return new Vector3(0, 0, 1); }

  /** Accepte Vector3, {x,y,z}, [x,y,z] ou (x,y,z) */
  static from(a, b, c) {
    if (typeof a === 'number') return new Vector3(a, num(b), num(c));
    if (Array.isArray(a)) return new Vector3(num(a[0]), num(a[1]), num(a[2]));
    if (a && typeof a === 'object') return new Vector3(num(a.x), num(a.y), num(a.z));
    return new Vector3();
  }
  static fromThree(v) { return new Vector3(v.x, v.y, v.z); }
  toThree(t = new THREE.Vector3()) { return t.set(this.x, this.y, this.z); }
  toArray() { return [this.x, this.y, this.z]; }

  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  copy() { return this.clone(); }

  add(v, y, z) { const o = typeof v === 'number' ? new Vector3(v, num(y), num(z)) : v; return new Vector3(this.x + o.x, this.y + o.y, this.z + o.z); }
  sub(v, y, z) { const o = typeof v === 'number' ? new Vector3(v, num(y), num(z)) : v; return new Vector3(this.x - o.x, this.y - o.y, this.z - o.z); }
  mul(s) { return typeof s === 'number' ? new Vector3(this.x * s, this.y * s, this.z * s) : new Vector3(this.x * s.x, this.y * s.y, this.z * s.z); }
  div(s) { return typeof s === 'number' ? new Vector3(this.x / s, this.y / s, this.z / s) : new Vector3(this.x / s.x, this.y / s.y, this.z / s.z); }
  scale(v) { return this.mul(v); }
  neg() { return new Vector3(-this.x, -this.y, -this.z); }
  negate() { return this.neg(); }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  cross(v) { return new Vector3(this.y * v.z - this.z * v.y, this.z * v.x - this.x * v.z, this.x * v.y - this.y * v.x); }
  get magnitude() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
  get sqrMagnitude() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  get length() { return this.magnitude; }
  get normalized() { const m = this.magnitude; return m > 1e-8 ? this.div(m) : new Vector3(); }
  normalize() { return this.normalized; }
  distanceTo(v) { return this.sub(v).magnitude; }
  equals(v, eps = 1e-5) { return Math.abs(this.x - v.x) < eps && Math.abs(this.y - v.y) < eps && Math.abs(this.z - v.z) < eps; }
  lerp(v, t) { return Vector3.Lerp(this, v, t); }
  withX(x) { return new Vector3(x, this.y, this.z); }
  withY(y) { return new Vector3(this.x, y, this.z); }
  withZ(z) { return new Vector3(this.x, this.y, z); }
  toString() { return `(${this.x.toFixed(2)}, ${this.y.toFixed(2)}, ${this.z.toFixed(2)})`; }

  static Distance(a, b) { return Vector3.from(a).sub(Vector3.from(b)).magnitude; }
  static Dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  static Cross(a, b) { return Vector3.from(a).cross(b); }
  static Lerp(a, b, t) { t = Math.max(0, Math.min(1, t)); return Vector3.LerpUnclamped(a, b, t); }
  static LerpUnclamped(a, b, t) { return new Vector3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t); }
  static MoveTowards(cur, target, maxDelta) {
    const d = Vector3.from(target).sub(cur);
    const m = d.magnitude;
    if (m <= maxDelta || m < 1e-8) return Vector3.from(target);
    return Vector3.from(cur).add(d.div(m).mul(maxDelta));
  }
  static Normalize(v) { return Vector3.from(v).normalized; }
  static Scale(a, b) { return new Vector3(a.x * b.x, a.y * b.y, a.z * b.z); }
  static Angle(a, b) {
    const d = Math.sqrt(Vector3.from(a).sqrMagnitude * Vector3.from(b).sqrMagnitude);
    if (d < 1e-12) return 0;
    return Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(a, b) / d))) * R2D;
  }
  static SignedAngle(a, b, axis) {
    const ang = Vector3.Angle(a, b);
    const c = Vector3.Cross(a, b);
    return Vector3.Dot(c, axis) < 0 ? -ang : ang;
  }
  static Reflect(dir, normal) { const n = Vector3.from(normal); return Vector3.from(dir).sub(n.mul(2 * Vector3.Dot(dir, n))); }
  static Project(v, onNormal) { const n = Vector3.from(onNormal); const s = n.sqrMagnitude; if (s < 1e-12) return new Vector3(); return n.mul(Vector3.Dot(v, n) / s); }
  static ProjectOnPlane(v, planeNormal) { return Vector3.from(v).sub(Vector3.Project(v, planeNormal)); }
  static ClampMagnitude(v, max) { const m = Vector3.from(v).magnitude; return m > max ? Vector3.from(v).mul(max / m) : Vector3.from(v); }
  static Min(a, b) { return new Vector3(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z)); }
  static Max(a, b) { return new Vector3(Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z)); }
  static SmoothDamp(current, target, velocityRef, smoothTime, maxSpeed = Infinity, dt) {
    // velocityRef : objet {value: Vector3} (équivalent du paramètre « ref » de C#)
    const v = velocityRef.value || (velocityRef.value = new Vector3());
    const x = Mathf.SmoothDamp(current.x, target.x, (velocityRef._x ??= { value: v.x }), smoothTime, maxSpeed, dt);
    const y = Mathf.SmoothDamp(current.y, target.y, (velocityRef._y ??= { value: v.y }), smoothTime, maxSpeed, dt);
    const z = Mathf.SmoothDamp(current.z, target.z, (velocityRef._z ??= { value: v.z }), smoothTime, maxSpeed, dt);
    velocityRef.value = new Vector3(velocityRef._x.value, velocityRef._y.value, velocityRef._z.value);
    return new Vector3(x, y, z);
  }
}

/** Vecteur « vivant » : modifier x/y/z écrit directement dans la source (transform, vitesse…). */
export class LiveVector3 extends Vector3 {
  constructor(read, write) {
    super();
    this._r = read;
    this._w = write;
  }
  get x() { return this._r ? this._r().x : 0; }
  set x(v) { if (this._w) { const p = this._r(); p.x = v; this._w(p); } }
  get y() { return this._r ? this._r().y : 0; }
  set y(v) { if (this._w) { const p = this._r(); p.y = v; this._w(p); } }
  get z() { return this._r ? this._r().z : 0; }
  set z(v) { if (this._w) { const p = this._r(); p.z = v; this._w(p); } }
  set(x, y, z) { if (this._w) this._w({ x, y, z }); return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  toJSON() { return { x: this.x, y: this.y, z: this.z }; }
}

// ---------------------------------------------------------------- Vector2

export class Vector2 {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }
  static get zero() { return new Vector2(0, 0); }
  static get one() { return new Vector2(1, 1); }
  static get up() { return new Vector2(0, 1); }
  static get down() { return new Vector2(0, -1); }
  static get left() { return new Vector2(-1, 0); }
  static get right() { return new Vector2(1, 0); }
  static from(a, b) {
    if (typeof a === 'number') return new Vector2(a, num(b));
    if (Array.isArray(a)) return new Vector2(num(a[0]), num(a[1]));
    if (a && typeof a === 'object') return new Vector2(num(a.x), num(a.y));
    return new Vector2();
  }
  set(x, y) { this.x = x; this.y = y; return this; }
  clone() { return new Vector2(this.x, this.y); }
  add(v) { return new Vector2(this.x + v.x, this.y + v.y); }
  sub(v) { return new Vector2(this.x - v.x, this.y - v.y); }
  mul(s) { return typeof s === 'number' ? new Vector2(this.x * s, this.y * s) : new Vector2(this.x * s.x, this.y * s.y); }
  div(s) { return typeof s === 'number' ? new Vector2(this.x / s, this.y / s) : new Vector2(this.x / s.x, this.y / s.y); }
  neg() { return new Vector2(-this.x, -this.y); }
  dot(v) { return this.x * v.x + this.y * v.y; }
  get magnitude() { return Math.hypot(this.x, this.y); }
  get sqrMagnitude() { return this.x * this.x + this.y * this.y; }
  get normalized() { const m = this.magnitude; return m > 1e-8 ? this.div(m) : new Vector2(); }
  toVector3(z = 0) { return new Vector3(this.x, this.y, z); }
  toString() { return `(${this.x.toFixed(2)}, ${this.y.toFixed(2)})`; }
  static Distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  static Dot(a, b) { return a.x * b.x + a.y * b.y; }
  static Lerp(a, b, t) { t = Math.max(0, Math.min(1, t)); return new Vector2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t); }
  static MoveTowards(cur, target, maxDelta) {
    const d = new Vector2(target.x - cur.x, target.y - cur.y);
    const m = d.magnitude;
    if (m <= maxDelta || m < 1e-8) return new Vector2(target.x, target.y);
    return new Vector2(cur.x + (d.x / m) * maxDelta, cur.y + (d.y / m) * maxDelta);
  }
  static Angle(a, b) { const d = Math.sqrt((a.x * a.x + a.y * a.y) * (b.x * b.x + b.y * b.y)); return d < 1e-12 ? 0 : Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y) / d))) * R2D; }
  static SignedAngle(a, b) { return Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y) * R2D; }
  static Perpendicular(v) { return new Vector2(-v.y, v.x); }
}

// ---------------------------------------------------------------- Quaternion

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }
  static get identity() { return new Quaternion(); }
  static fromThree(q) { return new Quaternion(q.x, q.y, q.z, q.w); }
  toThree(t = new THREE.Quaternion()) { return t.set(this.x, this.y, this.z, this.w); }
  clone() { return new Quaternion(this.x, this.y, this.z, this.w); }

  static Euler(x, y, z) {
    if (typeof x === 'object') ({ x, y, z } = x);
    _e.set(num(x) * D2R, num(y) * D2R, num(z) * D2R, 'XYZ');
    return Quaternion.fromThree(_q.setFromEuler(_e));
  }
  static AngleAxis(angle, axis) {
    _v.set(axis.x, axis.y, axis.z).normalize();
    return Quaternion.fromThree(_q.setFromAxisAngle(_v, angle * D2R));
  }
  /** Rotation qui oriente l'avant (-Z) vers « forward ». */
  static LookRotation(forward, up = Vector3.up) {
    _v.set(forward.x, forward.y, forward.z);
    if (_v.lengthSq() < 1e-12) return new Quaternion();
    _m.lookAt(new THREE.Vector3(0, 0, 0), _v, _v2.set(up.x, up.y, up.z));
    return Quaternion.fromThree(_q.setFromRotationMatrix(_m));
  }
  static FromToRotation(from, to) {
    _v.set(from.x, from.y, from.z).normalize();
    _v2.set(to.x, to.y, to.z).normalize();
    return Quaternion.fromThree(_q.setFromUnitVectors(_v, _v2));
  }
  static Slerp(a, b, t) { t = Math.max(0, Math.min(1, t)); return Quaternion.fromThree(a.toThree(new THREE.Quaternion()).slerp(b.toThree(), t)); }
  static Lerp(a, b, t) { return Quaternion.Slerp(a, b, t); }
  static Inverse(q) { return Quaternion.fromThree(q.toThree(new THREE.Quaternion()).invert()); }
  static Angle(a, b) { return a.toThree(new THREE.Quaternion()).angleTo(b.toThree()) * R2D; }
  static RotateTowards(from, to, maxDegrees) {
    const ang = Quaternion.Angle(from, to);
    if (ang < 1e-5) return to.clone();
    return Quaternion.Slerp(from, to, Math.min(1, maxDegrees / ang));
  }
  /** q.mul(q2) compose ; q.mul(v) fait tourner un vecteur */
  mul(o) {
    if (o instanceof Quaternion) return Quaternion.fromThree(this.toThree(new THREE.Quaternion()).multiply(o.toThree()));
    _v.set(o.x, o.y, o.z).applyQuaternion(this.toThree(_q));
    return new Vector3(_v.x, _v.y, _v.z);
  }
  get eulerAngles() {
    _e.setFromQuaternion(this.toThree(_q), 'XYZ');
    return new Vector3(_e.x * R2D, _e.y * R2D, _e.z * R2D);
  }
  get normalized() { return Quaternion.fromThree(this.toThree(_q).normalize()); }
  get inverse() { return Quaternion.Inverse(this); }
  toString() { const e = this.eulerAngles; return `Quaternion(${e.x.toFixed(1)}°, ${e.y.toFixed(1)}°, ${e.z.toFixed(1)}°)`; }
}

// ---------------------------------------------------------------- Color

export class Color {
  constructor(r = 1, g = 1, b = 1, a = 1) {
    if (typeof r === 'string') {
      const c = Color.hex(r);
      ({ r, g, b, a } = c);
    }
    this.r = r;
    this.g = g;
    this.b = b;
    this.a = a;
  }
  static hex(s) {
    s = String(s).replace('#', '').trim();
    if (s.length === 3 || s.length === 4) s = s.split('').map((c) => c + c).join('');
    const n = parseInt(s.slice(0, 6), 16) || 0;
    const a = s.length >= 8 ? parseInt(s.slice(6, 8), 16) / 255 : 1;
    return new Color(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a);
  }
  static get red() { return new Color(1, 0, 0); }
  static get green() { return new Color(0, 1, 0); }
  static get blue() { return new Color(0, 0, 1); }
  static get white() { return new Color(1, 1, 1); }
  static get black() { return new Color(0, 0, 0); }
  static get yellow() { return new Color(1, 0.92, 0.016); }
  static get cyan() { return new Color(0, 1, 1); }
  static get magenta() { return new Color(1, 0, 1); }
  static get gray() { return new Color(0.5, 0.5, 0.5); }
  static get grey() { return new Color(0.5, 0.5, 0.5); }
  static get orange() { return new Color(1, 0.55, 0); }
  static get purple() { return new Color(0.55, 0.2, 0.9); }
  static get pink() { return new Color(1, 0.45, 0.7); }
  static get clear() { return new Color(0, 0, 0, 0); }
  static Lerp(a, b, t) {
    t = Math.max(0, Math.min(1, t));
    return new Color(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t, a.a + (b.a - a.a) * t);
  }
  static HSVToRGB(h, s, v) {
    const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    const m = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][((i % 6) + 6) % 6];
    return new Color(m[0], m[1], m[2], 1);
  }
  static from(v) {
    if (v instanceof Color) return v.clone();
    if (typeof v === 'string') return Color.hex(v);
    if (v && typeof v === 'object') return new Color(num(v.r, 1), num(v.g, 1), num(v.b, 1), num(v.a, 1));
    return new Color();
  }
  clone() { return new Color(this.r, this.g, this.b, this.a); }
  withAlpha(a) { return new Color(this.r, this.g, this.b, a); }
  mul(s) { return typeof s === 'number' ? new Color(this.r * s, this.g * s, this.b * s, this.a) : new Color(this.r * s.r, this.g * s.g, this.b * s.b, this.a * s.a); }
  toHex() {
    const h = (x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0');
    return '#' + h(this.r) + h(this.g) + h(this.b);
  }
  toCSS() { return `rgba(${Math.round(this.r * 255)},${Math.round(this.g * 255)},${Math.round(this.b * 255)},${this.a})`; }
  toString() { return `RGBA(${this.r.toFixed(2)}, ${this.g.toFixed(2)}, ${this.b.toFixed(2)}, ${this.a.toFixed(2)})`; }
}

// ---------------------------------------------------------------- Mathf

const perm = new Uint8Array(512);
(() => {
  const p = [];
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = 1337;
  for (let i = 255; i > 0; i--) {
    s = (s * 16807) % 2147483647;
    const j = s % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
})();
function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
function grad(hh, x, y) { const g = hh & 7; const u = g < 4 ? x : y, v = g < 4 ? y : x; return ((g & 1) ? -u : u) + ((g & 2) ? -2 * v : 2 * v); }

export const Mathf = {
  PI: Math.PI,
  Infinity: Infinity,
  NegativeInfinity: -Infinity,
  Epsilon: 1.401298e-45,
  Deg2Rad: D2R,
  Rad2Deg: R2D,
  Abs: Math.abs, Sin: Math.sin, Cos: Math.cos, Tan: Math.tan, Asin: Math.asin, Acos: Math.acos, Atan: Math.atan, Atan2: Math.atan2,
  Sqrt: Math.sqrt, Pow: Math.pow, Exp: Math.exp, Log: (x, b) => (b ? Math.log(x) / Math.log(b) : Math.log(x)), Log10: Math.log10,
  Min: Math.min, Max: Math.max, Floor: Math.floor, Ceil: Math.ceil, Round: Math.round, Sign: (x) => (x >= 0 ? 1 : -1),
  FloorToInt: Math.floor, CeilToInt: Math.ceil, RoundToInt: Math.round,
  Clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
  Clamp01: (v) => Math.max(0, Math.min(1, v)),
  Lerp: (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t)),
  LerpUnclamped: (a, b, t) => a + (b - a) * t,
  InverseLerp: (a, b, v) => (a === b ? 0 : Math.max(0, Math.min(1, (v - a) / (b - a)))),
  MoveTowards: (cur, target, maxDelta) => (Math.abs(target - cur) <= maxDelta ? target : cur + Math.sign(target - cur) * maxDelta),
  Repeat: (t, len) => t - Math.floor(t / len) * len,
  PingPong: (t, len) => { const r = t - Math.floor(t / (len * 2)) * len * 2; return len - Math.abs(r - len); },
  DeltaAngle: (a, b) => { let d = Mathf.Repeat(b - a, 360); if (d > 180) d -= 360; return d; },
  LerpAngle: (a, b, t) => a + Mathf.DeltaAngle(a, b) * Math.max(0, Math.min(1, t)),
  MoveTowardsAngle: (cur, target, maxDelta) => { const d = Mathf.DeltaAngle(cur, target); if (-maxDelta < d && d < maxDelta) return target; return Mathf.MoveTowards(cur, cur + d, maxDelta); },
  SmoothStep: (a, b, t) => { t = Math.max(0, Math.min(1, t)); t = t * t * (3 - 2 * t); return a + (b - a) * t; },
  Approximately: (a, b) => Math.abs(a - b) < Math.max(1e-6 * Math.max(Math.abs(a), Math.abs(b)), 1e-6),
  SmoothDamp(current, target, velRef, smoothTime, maxSpeed = Infinity, dt = 1 / 60) {
    smoothTime = Math.max(0.0001, smoothTime);
    const omega = 2 / smoothTime, x = omega * dt, exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    let change = current - target;
    const orig = target, maxChange = maxSpeed * smoothTime;
    change = Math.max(-maxChange, Math.min(maxChange, change));
    target = current - change;
    const temp = ((velRef.value || 0) + omega * change) * dt;
    velRef.value = ((velRef.value || 0) - omega * temp) * exp;
    let out = target + (change + temp) * exp;
    if (orig - current > 0 === out > orig) { out = orig; velRef.value = (out - orig) / dt; }
    return out;
  },
  /** Bruit de Perlin 2D dans [0,1] */
  PerlinNoise(x, y = 0) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    x -= Math.floor(x); y -= Math.floor(y);
    const u = fade(x), v = fade(y);
    const a = perm[X] + Y, b = perm[X + 1] + Y;
    const r = (1 - v) * ((1 - u) * grad(perm[a], x, y) + u * grad(perm[b], x - 1, y)) + v * ((1 - u) * grad(perm[a + 1], x, y - 1) + u * grad(perm[b + 1], x - 1, y - 1));
    return Math.max(0, Math.min(1, r * 0.35 + 0.5));
  },
};

// ---------------------------------------------------------------- Random

let seed = 0;
let rnd = Math.random;
function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const Random = {
  InitState(s) { seed = s | 0; rnd = mulberry(seed); },
  get value() { return rnd(); },
  /** Entiers : max exclu (comme Unity). Décimaux : max inclus. */
  Range(min, max) {
    if (Number.isInteger(min) && Number.isInteger(max)) return min + Math.floor(rnd() * (max - min));
    return min + rnd() * (max - min);
  },
  get insideUnitSphere() { const v = Random.onUnitSphere; return v.mul(Math.cbrt(rnd())); },
  get onUnitSphere() { const u = rnd() * 2 - 1, t = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u); return new Vector3(r * Math.cos(t), r * Math.sin(t), u); },
  get insideUnitCircle() { const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()); return new Vector2(Math.cos(a) * r, Math.sin(a) * r); },
  get rotation() { return Quaternion.Euler(rnd() * 360, rnd() * 360, rnd() * 360); },
  ColorHSV(hMin = 0, hMax = 1, sMin = 0.6, sMax = 1, vMin = 0.7, vMax = 1) {
    const f = (a, b) => a + rnd() * (b - a);
    return Color.HSVToRGB(f(hMin, hMax), f(sMin, sMax), f(vMin, vMax));
  },
  /** Décimal entre min et max (toujours décimal, même avec des bornes entières) */
  Float(min, max) { return min + rnd() * (max - min); },
  /** Entier entre min (inclus) et max (exclu) */
  Int(min, max) { return min + Math.floor(rnd() * (max - min)); },
  Pick(arr) { return arr[Math.floor(rnd() * arr.length)]; },
  Chance(p) { return rnd() < p; },
};

// ---------------------------------------------------------------- Divers

export class Ray {
  constructor(origin = new Vector3(), direction = Vector3.forward) {
    this.origin = Vector3.from(origin);
    this.direction = Vector3.from(direction).normalized;
  }
  GetPoint(d) { return this.origin.add(this.direction.mul(d)); }
}

export class WaitForSeconds {
  constructor(s) { this.seconds = s; }
}
export class WaitForSecondsRealtime extends WaitForSeconds {}
export class WaitUntil {
  constructor(fn) { this.fn = fn; }
}
export class WaitWhile {
  constructor(fn) { this.fn = fn; }
}
export const WaitForFixedUpdate = class {};
export const WaitForEndOfFrame = class {};

export const Space = { Self: 'Self', World: 'World' };
export const ForceMode = { Force: 'Force', Acceleration: 'Acceleration', Impulse: 'Impulse', VelocityChange: 'VelocityChange' };
export const TouchPhase = { Began: 'Began', Moved: 'Moved', Stationary: 'Stationary', Ended: 'Ended', Canceled: 'Canceled' };

export const KeyCode = {};
for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') KeyCode[c] = c.toLowerCase();
for (let i = 0; i <= 9; i++) KeyCode['Alpha' + i] = String(i);
Object.assign(KeyCode, {
  Space: 'space', Return: 'enter', Enter: 'enter', Escape: 'escape', Backspace: 'backspace', Tab: 'tab',
  LeftArrow: 'left', RightArrow: 'right', UpArrow: 'up', DownArrow: 'down',
  LeftShift: 'shift', RightShift: 'shift', LeftControl: 'control', RightControl: 'control', LeftAlt: 'alt', RightAlt: 'alt',
  Mouse0: 'mouse0', Mouse1: 'mouse1', Mouse2: 'mouse2',
});

/** Normalise le nom d'une touche du clavier (event.key) */
export function normKey(k) {
  if (!k) return '';
  const map = { ' ': 'space', ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Enter: 'enter', Escape: 'escape', Shift: 'shift', Control: 'control', Alt: 'alt', Meta: 'meta', Backspace: 'backspace', Tab: 'tab' };
  if (map[k]) return map[k];
  return k.length === 1 ? k.toLowerCase() : k.toLowerCase();
}

/** Marqueurs pour exposer des références dans l'inspecteur (remplacés à l'exécution). */
export const RuntimeRef = {
  GameObject: (defName) => (defName ? { __lazyGo: defName } : null),
  Prefab: (defName) => (defName ? { __lazyPrefab: defName } : null),
  Range: (min, max, val) => (val === undefined ? min : val),
  Color: (hex = '#ffffff') => Color.hex(hex),
  Sound: (name = 'coin') => name,
  Image: () => null,
};
export const EditorRef = {
  GameObject: (defName) => ({ __ref: 'go', def: defName || '' }),
  Prefab: (defName) => ({ __ref: 'prefab', def: defName || '' }),
  Range: (min, max, val) => ({ __ref: 'range', min, max, def: val === undefined ? min : val }),
  Color: (hex = '#ffffff') => Color.hex(hex),
  Sound: (name = 'coin') => ({ __ref: 'sound', def: name }),
  Image: () => ({ __ref: 'image', def: '' }),
};
