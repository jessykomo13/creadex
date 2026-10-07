// Moteur d'exécution (mode Jeu) : GameObjects, composants, scripts, physique, rendu

import * as THREE from 'three';
import {
  Vector3, Vector2, Quaternion, Color, Mathf, Random, Ray, LiveVector3,
  WaitForSeconds, WaitForSecondsRealtime, WaitUntil, WaitWhile, WaitForFixedUpdate, WaitForEndOfFrame,
  KeyCode, ForceMode, Space, TouchPhase, RuntimeRef,
} from './api.js';
import { buildVisuals, applyEnvironment, applyTransform, TextureCache, fitCamera, getGeometry, sortByHierarchy, disposeObject } from './builder.js';
import { PhysicsWorld } from './physics.js';
import { InputSystem } from './input.js';
import { AudioSystem } from './audio.js';
import { ParticleEmitter, Trail } from './particles.js';
import { UILayer } from './uilayer.js';
import { compileAll, mapError } from './compiler.js';
import { uid, clone, h } from './util.js';
import { COLLIDERS, createComponent, bestColliderFor } from './components.js';

let RT = null; // moteur courant (un seul à la fois)
let PENDING = null;
const INTERNAL = Symbol('internal');
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();

const V = (t) => new Vector3(t.x, t.y, t.z);
function needRT() {
  if (!RT) throw new Error("Cette fonction n'est disponible que pendant le jeu (mode Play)");
  return RT;
}
function toV3(a, b, c) {
  return Vector3.from(a, b, c);
}

// =====================================================================
// Transform
// =====================================================================

export class Transform {
  constructor(go) {
    this.gameObject = go;
  }
  get _o() {
    return this.gameObject.obj;
  }
  get name() { return this.gameObject.name; }
  set name(v) { this.gameObject.name = v; }
  get tag() { return this.gameObject.tag; }
  get transform() { return this; }
  CompareTag(t) { return this.gameObject.tag === t; }
  GetComponent(t) { return this.gameObject.GetComponent(t); }
  GetComponents(t) { return this.gameObject.GetComponents(t); }
  GetComponentInChildren(t) { return this.gameObject.GetComponentInChildren(t); }

  _worldPos() {
    this._o.updateWorldMatrix(true, false);
    return V(_v.setFromMatrixPosition(this._o.matrixWorld));
  }
  _setWorldPos(p) {
    const o = this._o;
    _v.set(p.x, p.y, p.z);
    if (o.parent && !o.parent.isScene) {
      o.parent.updateWorldMatrix(true, false);
      o.parent.worldToLocal(_v);
    }
    o.position.copy(_v);
    o.updateMatrixWorld();
  }
  _worldQuat() {
    this._o.updateWorldMatrix(true, false);
    this._o.matrixWorld.decompose(_v, _q, _s);
    return _q.clone();
  }
  _setWorldQuat(q) {
    const o = this._o;
    if (o.parent && !o.parent.isScene) {
      o.parent.updateWorldMatrix(true, false);
      o.parent.matrixWorld.decompose(_v, _q2, _s);
      o.quaternion.copy(_q2.invert().multiply(q));
    } else o.quaternion.copy(q);
    o.updateMatrixWorld();
  }

  get position() {
    return new LiveVector3(() => this._worldPos(), (p) => this._setWorldPos(p));
  }
  set position(p) { this._setWorldPos(toV3(p)); }
  get localPosition() {
    const o = this._o;
    return new LiveVector3(() => V(o.position), (p) => o.position.set(p.x, p.y, p.z));
  }
  set localPosition(p) { p = toV3(p); this._o.position.set(p.x, p.y, p.z); }
  get rotation() { return Quaternion.fromThree(this._worldQuat()); }
  set rotation(q) { this._setWorldQuat(new THREE.Quaternion(q.x, q.y, q.z, q.w)); }
  get localRotation() { return Quaternion.fromThree(this._o.quaternion); }
  set localRotation(q) { this._o.quaternion.set(q.x, q.y, q.z, q.w); }
  get eulerAngles() {
    const read = () => {
      _e.setFromQuaternion(this._worldQuat(), 'XYZ');
      return new Vector3(_e.x * R2D, _e.y * R2D, _e.z * R2D);
    };
    return new LiveVector3(read, (e) => this._setWorldQuat(new THREE.Quaternion().setFromEuler(new THREE.Euler(e.x * D2R, e.y * D2R, e.z * D2R, 'XYZ'))));
  }
  set eulerAngles(e) {
    e = toV3(e);
    this._setWorldQuat(new THREE.Quaternion().setFromEuler(new THREE.Euler(e.x * D2R, e.y * D2R, e.z * D2R, 'XYZ')));
  }
  get localEulerAngles() {
    const o = this._o;
    return new LiveVector3(() => new Vector3(o.rotation.x * R2D, o.rotation.y * R2D, o.rotation.z * R2D), (e) => o.rotation.set(e.x * D2R, e.y * D2R, e.z * D2R));
  }
  set localEulerAngles(e) { e = toV3(e); this._o.rotation.set(e.x * D2R, e.y * D2R, e.z * D2R); }
  get localScale() {
    const o = this._o;
    return new LiveVector3(() => V(o.scale), (s) => o.scale.set(s.x, s.y, s.z));
  }
  set localScale(s) { s = typeof s === 'number' ? new Vector3(s, s, s) : toV3(s); this._o.scale.set(s.x, s.y, s.z); }
  get lossyScale() { this._o.updateWorldMatrix(true, false); this._o.matrixWorld.decompose(_v, _q, _s); return V(_s); }

  _dir(x, y, z) { return V(_v.set(x, y, z).applyQuaternion(this._worldQuat()).normalize()); }
  get forward() { return this._dir(0, 0, -1); }
  set forward(v) { this.rotation = Quaternion.LookRotation(toV3(v)); }
  get back() { return this._dir(0, 0, 1); }
  get right() { return this._dir(1, 0, 0); }
  set right(v) { this.rotation = Quaternion.FromToRotation(Vector3.right, toV3(v)); }
  get left() { return this._dir(-1, 0, 0); }
  get up() { return this._dir(0, 1, 0); }
  set up(v) { this.rotation = Quaternion.FromToRotation(Vector3.up, toV3(v)); }
  get down() { return this._dir(0, -1, 0); }

  get parent() {
    const p = this._o.parent;
    return p && p.userData.rgo ? p.userData.rgo.transform : null;
  }
  set parent(t) { this.SetParent(t, true); }
  SetParent(t, worldPositionStays = true) {
    const target = t ? (t.transform || t)._o : needRT().scene;
    if (worldPositionStays) target.attach(this._o);
    else target.add(this._o);
  }
  get root() {
    let t = this;
    while (t.parent) t = t.parent;
    return t;
  }
  get childCount() { return this._o.children.filter((c) => c.userData.rgo).length; }
  get children() { return this._o.children.filter((c) => c.userData.rgo).map((c) => c.userData.rgo.transform); }
  GetChild(i) { return this.children[i] || null; }
  Find(path) {
    let cur = this;
    for (const part of String(path).split('/')) {
      cur = cur.children.find((c) => c.name === part);
      if (!cur) return null;
    }
    return cur;
  }
  DetachChildren() { for (const c of this.children) c.SetParent(null, true); }
  IsChildOf(t) {
    let p = this;
    while (p) {
      if (p === t || p === t.transform) return true;
      p = p.parent;
    }
    return false;
  }
  GetSiblingIndex() { const p = this._o.parent; return p ? p.children.indexOf(this._o) : 0; }

  Translate(a, b, c, d) {
    let v, space;
    if (typeof a === 'number') { v = new Vector3(a, b || 0, c || 0); space = d; }
    else { v = toV3(a); space = b; }
    if (space && space !== Space.Self && space !== 'Self') {
      if (space instanceof Transform) v = space.TransformDirection(v).mul(toV3(v).magnitude);
      this._setWorldPos(this._worldPos().add(v));
    } else {
      _v.set(v.x, v.y, v.z).applyQuaternion(this._o.quaternion);
      this._o.position.add(_v);
    }
  }
  Rotate(a, b, c, d) {
    let q, space;
    if (a instanceof Vector3 && typeof b === 'number') {
      // Rotate(axe, angle, espace)
      q = new THREE.Quaternion().setFromAxisAngle(_v.set(a.x, a.y, a.z).normalize(), b * D2R);
      space = c;
    } else if (typeof a === 'number') {
      q = new THREE.Quaternion().setFromEuler(new THREE.Euler(a * D2R, (b || 0) * D2R, (c || 0) * D2R, 'XYZ'));
      space = d;
    } else {
      const e = toV3(a);
      q = new THREE.Quaternion().setFromEuler(new THREE.Euler(e.x * D2R, e.y * D2R, e.z * D2R, 'XYZ'));
      space = b;
    }
    if (space === Space.World || space === 'World') this._setWorldQuat(q.multiply(this._worldQuat()));
    else this._o.quaternion.multiply(q);
  }
  RotateAround(point, axis, angle) {
    const q = new THREE.Quaternion().setFromAxisAngle(_v2.set(axis.x, axis.y, axis.z).normalize(), angle * D2R);
    const p = this._worldPos();
    _v.set(p.x - point.x, p.y - point.y, p.z - point.z).applyQuaternion(q);
    this._setWorldPos(new Vector3(point.x + _v.x, point.y + _v.y, point.z + _v.z));
    this._setWorldQuat(q.multiply(this._worldQuat()));
  }
  LookAt(target, up = Vector3.up) {
    let p = target;
    if (target instanceof GameObject) p = target.transform.position;
    else if (target instanceof Transform) p = target.position;
    else if (target && target.transform) p = target.transform.position;
    const me = this._worldPos();
    const dir = toV3(p).sub(me);
    if (dir.sqrMagnitude < 1e-12) return;
    this.rotation = Quaternion.LookRotation(dir, up);
  }
  TransformPoint(a, b, c) {
    const p = toV3(a, b, c);
    this._o.updateWorldMatrix(true, false);
    return V(_v.set(p.x, p.y, p.z).applyMatrix4(this._o.matrixWorld));
  }
  InverseTransformPoint(a, b, c) {
    const p = toV3(a, b, c);
    this._o.updateWorldMatrix(true, false);
    return V(this._o.worldToLocal(_v.set(p.x, p.y, p.z)));
  }
  TransformDirection(a, b, c) { const d = toV3(a, b, c); return V(_v.set(d.x, d.y, d.z).applyQuaternion(this._worldQuat())); }
  InverseTransformDirection(a, b, c) { const d = toV3(a, b, c); return V(_v.set(d.x, d.y, d.z).applyQuaternion(this._worldQuat().invert())); }
  toString() { return `${this.name} (Transform)`; }
}

// =====================================================================
// GameObject
// =====================================================================

const ALIASES = { Text: 'UIText', Button: 'UIButton', Image: 'UIImage' };

function matchType(c, type) {
  if (typeof type === 'function') return c instanceof type;
  if (typeof type !== 'string') return false;
  const t = ALIASES[type] || type;
  const dt = c._data && c._data.type;
  if (dt === t) return true;
  if (t === 'Collider') return COLLIDERS.includes(dt);
  if (t === 'Renderer') return dt === 'MeshRenderer' || dt === 'SpriteRenderer' || dt === 'Text3D';
  if (c instanceof MonoBehaviour) return c.constructor.__scriptName === t || c.constructor.name === t || t === 'MonoBehaviour' || t === 'Script';
  return false;
}

export class GameObject {
  constructor(name = 'GameObject', internal) {
    this.name = String(name);
    this.tag = 'Untagged';
    this.layer = 0;
    this.components = [];
    this.obj = new THREE.Group();
    this.obj.userData.rgo = this;
    this.id = uid();
    this._activeSelf = true;
    this._destroyed = false;
    this.transform = new Transform(this);
    this.dataId = null;
    if (internal !== INTERNAL) {
      const rt = needRT();
      rt.scene.add(this.obj);
      rt.objects.push(this);
    }
  }
  get gameObject() { return this; }
  get activeSelf() { return this._activeSelf; }
  get activeInHierarchy() {
    for (let o = this.obj; o && o.userData.rgo; o = o.parent) if (!o.userData.rgo._activeSelf) return false;
    return !this._destroyed;
  }
  get destroyed() { return this._destroyed; }
  SetActive(v) { needRT().setActive(this, !!v); }
  CompareTag(t) { return this.tag === t; }
  GetComponent(t) { return this.components.find((c) => matchType(c, t)) || null; }
  GetComponents(t) { return this.components.filter((c) => matchType(c, t)); }
  GetComponentInChildren(t) {
    const own = this.GetComponent(t);
    if (own) return own;
    for (const ch of this.transform.children) {
      const r = ch.gameObject.GetComponentInChildren(t);
      if (r) return r;
    }
    return null;
  }
  GetComponentsInChildren(t) {
    const out = this.GetComponents(t);
    for (const ch of this.transform.children) out.push(...ch.gameObject.GetComponentsInChildren(t));
    return out;
  }
  GetComponentInParent(t) {
    for (let p = this; p; p = p.transform.parent && p.transform.parent.gameObject) {
      const r = p.GetComponent(t);
      if (r) return r;
    }
    return null;
  }
  AddComponent(type, props) { return needRT().addComponent(this, type, props); }
  SendMessage(method, ...args) { needRT().sendMessage(this, method, args); }
  BroadcastMessage(method, ...args) {
    const rt = needRT();
    const walk = (g) => {
      rt.sendMessage(g, method, args);
      g.transform.children.forEach((c) => walk(c.gameObject));
    };
    walk(this);
  }
  SendMessageUpwards(method, ...args) {
    const rt = needRT();
    for (let p = this; p; p = p.transform.parent && p.transform.parent.gameObject) rt.sendMessage(p, method, args);
  }
  toString() { return this.name; }

  static Find(name) {
    const rt = needRT();
    if (String(name).includes('/')) {
      const [first, ...rest] = String(name).replace(/^\//, '').split('/');
      const root = rt.objects.find((g) => g.name === first && !g.transform.parent && g.activeInHierarchy);
      const t = root && (rest.length ? root.transform.Find(rest.join('/')) : root.transform);
      return t ? t.gameObject : null;
    }
    return rt.objects.find((g) => g.name === name && g.activeInHierarchy) || null;
  }
  static FindWithTag(tag) { return needRT().objects.find((g) => g.tag === tag && g.activeInHierarchy) || null; }
  static FindGameObjectWithTag(tag) { return GameObject.FindWithTag(tag); }
  static FindGameObjectsWithTag(tag) { return needRT().objects.filter((g) => g.tag === tag && g.activeInHierarchy); }
  static FindObjectOfType(type) {
    for (const g of needRT().objects) {
      if (!g.activeInHierarchy) continue;
      const c = g.GetComponent(type);
      if (c) return c;
    }
    return null;
  }
  static FindObjectsOfType(type) {
    const out = [];
    for (const g of needRT().objects) if (g.activeInHierarchy) out.push(...g.GetComponents(type));
    return out;
  }
  static CreatePrimitive(mesh = 'Cube') {
    const rt = needRT();
    const go = new GameObject(mesh);
    const fake = { c: [] };
    const mr = createComponent('MeshRenderer', null, { mesh });
    fake.c.push(mr);
    rt.addComponent(go, 'MeshRenderer', mr);
    rt.addComponent(go, bestColliderFor(fake));
    return go;
  }
}

// =====================================================================
// Composants
// =====================================================================

export class Component {
  _init(go, data) {
    this.gameObject = go;
    this._data = data;
    this._cid = uid();
  }
  get transform() { return this.gameObject.transform; }
  get name() { return this.gameObject.name; }
  get tag() { return this.gameObject.tag; }
  CompareTag(t) { return this.gameObject.tag === t; }
  GetComponent(t) { return this.gameObject.GetComponent(t); }
  GetComponents(t) { return this.gameObject.GetComponents(t); }
  GetComponentInChildren(t) { return this.gameObject.GetComponentInChildren(t); }
  GetComponentInParent(t) { return this.gameObject.GetComponentInParent(t); }
  get enabled() { return this._data.enabled !== false; }
  set enabled(v) {
    v = !!v;
    if (v === this.enabled) return;
    this._data.enabled = v;
    this._enabledChanged(v);
  }
  _enabledChanged() {}
  _attach() {}
  _onActive() {}
  _destroy() {}
  toString() { return `${this.gameObject ? this.gameObject.name : '?'} (${this.constructor.name})`; }
}
export class Behaviour extends Component {}

export class MonoBehaviour extends Behaviour {
  constructor() {
    super();
    if (PENDING) {
      this.gameObject = PENDING.go;
      this._data = PENDING.data;
      this._cid = uid();
    }
    this._awoken = false;
    this._started = false;
  }
  get enabled() { return this._data ? this._data.enabled !== false : true; }
  set enabled(v) { needRT().setBehaviourEnabled(this, !!v); }
  get isActiveAndEnabled() { return this.enabled && this.gameObject.activeInHierarchy; }
  StartCoroutine(routine, ...args) {
    if (typeof routine === 'string') routine = this[routine] && this[routine](...args);
    return needRT().startCoroutine(this, routine);
  }
  StopCoroutine(c) { needRT().stopCoroutine(this, c); }
  StopAllCoroutines() { needRT().stopCoroutine(this, null); }
  Invoke(name, delay = 0) { needRT().invoke(this, name, delay, 0); }
  InvokeRepeating(name, delay = 0, rate = 1) { needRT().invoke(this, name, delay, Math.max(0.001, rate)); }
  CancelInvoke(name) { needRT().cancelInvoke(this, name); }
  IsInvoking(name) { return needRT().invokes.some((i) => i.b === this && (!name || i.name === name)); }
  print(...a) { needRT().userLog('log', a); }
  Instantiate(...a) { return needRT().instantiate(...a); }
  Destroy(o, t) { needRT().destroy(o, t); }
  SendMessage(m, ...a) { this.gameObject.SendMessage(m, ...a); }
}

// ---------------------------------------------------------------- Rendu

function colorOf(m) {
  return m ? Color.hex('#' + m.color.getHexString()).withAlpha(m.opacity) : Color.white;
}

export class MeshRenderer extends Component {
  get _mesh() { return this.gameObject.obj.userData.refs && this.gameObject.obj.userData.refs.mesh; }
  get material() {
    if (this._mat) return this._mat;
    const comp = this;
    const m = () => comp._mesh && comp._mesh.material;
    this._mat = {
      get color() { return colorOf(m()); },
      set color(c) {
        c = Color.from(c);
        comp._data.color = c.toHex();
        const mm = m();
        if (mm) {
          mm.color.set(c.toHex());
          if (c.a < 1 || mm.opacity < 1) {
            mm.opacity = c.a;
            mm.transparent = c.a < 1;
            comp._data.opacity = c.a;
          }
        }
      },
      get emissiveColor() { const mm = m(); return mm && mm.emissive ? Color.hex('#' + mm.emissive.getHexString()) : Color.black; },
      set emissiveColor(c) { c = Color.from(c); comp._data.emissive = c.toHex(); const mm = m(); if (mm && mm.emissive) mm.emissive.set(c.toHex()); },
      get emissiveIntensity() { return comp._data.emissiveIntensity; },
      set emissiveIntensity(v) { comp._data.emissiveIntensity = v; const mm = m(); if (mm && 'emissiveIntensity' in mm) mm.emissiveIntensity = v; },
      get opacity() { return comp._data.opacity ?? 1; },
      set opacity(v) { comp._data.opacity = v; const mm = m(); if (mm) { mm.opacity = v; mm.transparent = v < 1; } },
      get metalness() { return comp._data.metalness; },
      set metalness(v) { comp._data.metalness = v; const mm = m(); if (mm && 'metalness' in mm) mm.metalness = v; },
      get roughness() { return comp._data.roughness; },
      set roughness(v) { comp._data.roughness = v; const mm = m(); if (mm && 'roughness' in mm) mm.roughness = v; },
      get mainTexture() { return comp._data.texture; },
      set mainTexture(v) { comp._data.texture = v || ''; needRT().rebuildVisuals(comp.gameObject); },
      SetColor(_n, c) { this.color = c; },
    };
    return this._mat;
  }
  get sharedMaterial() { return this.material; }
  get mesh() { return this._data.mesh; }
  set mesh(v) {
    this._data.mesh = v;
    if (this._mesh) this._mesh.geometry = getGeometry(v);
  }
  get bounds() {
    const b = new THREE.Box3();
    if (this._mesh) b.setFromObject(this._mesh);
    return { center: V(b.getCenter(_v)), size: V(b.getSize(_v2)), min: V(b.min), max: V(b.max) };
  }
  _enabledChanged(v) { if (this._mesh) this._mesh.visible = v; }
}

export class SpriteRenderer extends Component {
  get _mesh() { return this.gameObject.obj.userData.refs && this.gameObject.obj.userData.refs.sprite; }
  _scale() {
    const m = this._mesh, d = this._data;
    if (m) m.scale.set(d.size[0] * (d.flipX ? -1 : 1), d.size[1] * (d.flipY ? -1 : 1), 1);
  }
  get color() { const m = this._mesh; return m ? colorOf(m.material) : Color.from(this._data.color); }
  set color(c) {
    c = Color.from(c);
    this._data.color = c.toHex();
    const m = this._mesh;
    if (m) { m.material.color.set(c.toHex()); m.material.opacity = c.a; }
  }
  get flipX() { return !!this._data.flipX; }
  set flipX(v) { this._data.flipX = !!v; this._scale(); }
  get flipY() { return !!this._data.flipY; }
  set flipY(v) { this._data.flipY = !!v; this._scale(); }
  get size() { return new Vector2(this._data.size[0], this._data.size[1]); }
  set size(v) { this._data.size = [v.x, v.y]; this._scale(); }
  get sprite() { return this._data.image; }
  set sprite(v) { this._data.image = v || ''; needRT().rebuildVisuals(this.gameObject); }
  get shape() { return this._data.shape; }
  set shape(v) { this._data.shape = v; needRT().rebuildVisuals(this.gameObject); }
  get sortingOrder() { return this._data.order || 0; }
  set sortingOrder(v) { this._data.order = v; if (this._mesh) this._mesh.renderOrder = v; }
  _enabledChanged(v) { if (this._mesh) this._mesh.visible = v; }
}

export class Text3D extends Component {
  get text() { return this._data.text; }
  set text(v) {
    v = String(v);
    if (v === this._data.text) return;
    this._data.text = v;
    needRT().rebuildVisuals(this.gameObject);
  }
  get color() { return Color.from(this._data.color); }
  set color(c) {
    c = Color.from(c);
    this._data.color = c.toHex();
    const m = this.gameObject.obj.userData.refs.text3d;
    if (m) m.material.color.set(c.toHex());
  }
  _enabledChanged(v) { const m = this.gameObject.obj.userData.refs.text3d; if (m) m.visible = v; }
}

function lightMul(d) {
  if (d.kind === 'Directional') return 1.6;
  if (d.kind === 'Hemisphere') return 1.5;
  return Math.max(1, ((d.range || 0) * (d.range || 0)) / 4);
}
export class Light extends Component {
  get _light() { return this.gameObject.obj.userData.refs && this.gameObject.obj.userData.refs.light; }
  get intensity() { return this._data.intensity; }
  set intensity(v) { this._data.intensity = v; if (this._light) this._light.intensity = v * lightMul(this._data); }
  get color() { return Color.from(this._data.color); }
  set color(c) { c = Color.from(c); this._data.color = c.toHex(); if (this._light) this._light.color.set(c.toHex()); }
  get range() { return this._data.range; }
  set range(v) {
    this._data.range = v;
    const l = this._light;
    if (l && 'distance' in l) { l.distance = v; l.intensity = this._data.intensity * lightMul(this._data); }
  }
  get spotAngle() { return this._data.angle; }
  set spotAngle(v) { this._data.angle = v; if (this._light && 'angle' in this._light) this._light.angle = v * D2R; }
  get type() { return this._data.kind; }
  _enabledChanged(v) { if (this._light) this._light.visible = v; }
}

const _ray = new THREE.Raycaster();
export class Camera extends Component {
  static get main() { return RT ? RT.mainCamera() : null; }
  static get allCameras() { return RT ? RT.objects.flatMap((g) => g.GetComponents('Camera')) : []; }
  get _cam() { return this.gameObject.obj.userData.refs && this.gameObject.obj.userData.refs.camera; }
  get fieldOfView() { return this._data.fov; }
  set fieldOfView(v) { this._data.fov = v; const c = this._cam; if (c && c.isPerspectiveCamera) { c.fov = v; c.updateProjectionMatrix(); } }
  get orthographic() { return !!this._data.ortho; }
  set orthographic(v) { this._data.ortho = !!v; needRT().rebuildVisuals(this.gameObject); }
  get orthographicSize() { return this._data.orthoSize; }
  set orthographicSize(v) { this._data.orthoSize = v; }
  get backgroundColor() { return Color.from(this._data.bg); }
  set backgroundColor(c) { this._data.bg = Color.from(c).toHex(); this._data.clear = 'color'; }
  get aspect() { const rt = needRT(); return rt.width / Math.max(1, rt.height); }
  get pixelWidth() { return needRT().width; }
  get pixelHeight() { return needRT().height; }
  _prep() {
    const rt = needRT();
    const c = this._cam;
    fitCamera(c, rt.width / Math.max(1, rt.height));
    c.updateMatrixWorld();
    return { c, W: rt.width, H: rt.height };
  }
  ScreenPointToRay(p) {
    const { c, W, H } = this._prep();
    _ray.setFromCamera(new THREE.Vector2((p.x / W) * 2 - 1, (p.y / H) * 2 - 1), c);
    return new Ray(V(_ray.ray.origin), V(_ray.ray.direction));
  }
  ViewportPointToRay(p) { const rt = needRT(); return this.ScreenPointToRay(new Vector2(p.x * rt.width, p.y * rt.height)); }
  ScreenToWorldPoint(p) {
    const { c, W, H } = this._prep();
    const z = p.z || 0;
    const ndc = new THREE.Vector3((p.x / W) * 2 - 1, (p.y / H) * 2 - 1, 0.5).unproject(c);
    const origin = new THREE.Vector3().setFromMatrixPosition(c.matrixWorld);
    if (c.isOrthographicCamera) {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(c.getWorldQuaternion(new THREE.Quaternion()));
      const base = new THREE.Vector3((p.x / W) * 2 - 1, (p.y / H) * 2 - 1, -1).unproject(c);
      const camDist = base.clone().sub(origin).dot(fwd);
      return V(base.add(fwd.multiplyScalar(z - camDist)));
    }
    const dir = ndc.sub(origin).normalize();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(c.getWorldQuaternion(new THREE.Quaternion()));
    const t = z / Math.max(1e-6, dir.dot(fwd));
    return V(origin.add(dir.multiplyScalar(t)));
  }
  ViewportToWorldPoint(p) { const rt = needRT(); return this.ScreenToWorldPoint(new Vector3(p.x * rt.width, p.y * rt.height, p.z || 0)); }
  WorldToScreenPoint(p) {
    const { c, W, H } = this._prep();
    const v = new THREE.Vector3(p.x, p.y, p.z);
    const camPos = new THREE.Vector3().setFromMatrixPosition(c.matrixWorld);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(c.getWorldQuaternion(new THREE.Quaternion()));
    const depth = v.clone().sub(camPos).dot(fwd);
    v.project(c);
    return new Vector3(((v.x + 1) / 2) * W, ((v.y + 1) / 2) * H, depth);
  }
  WorldToViewportPoint(p) { const s = this.WorldToScreenPoint(p); const rt = needRT(); return new Vector3(s.x / rt.width, s.y / rt.height, s.z); }
}

// ---------------------------------------------------------------- Physique

export class Rigidbody extends Component {
  get _body() { return RT ? RT.physics.bodyOf(this.gameObject) : null; }
  _lv(get, set) { return new LiveVector3(get, set); }
  _fac(v) {
    const fp = this._data.freezePos || [];
    return { x: fp[0] ? 0 : v.x, y: fp[1] ? 0 : v.y, z: fp[2] ? 0 : v.z };
  }
  get velocity() {
    const b = this._body;
    return this._lv(() => (b ? V(b.velocity) : new Vector3()), (v) => { if (b) { const f = this._fac(v); b.velocity.set(f.x, f.y, f.z); b.wakeUp(); } });
  }
  set velocity(v) { const b = this._body; if (b) { const f = this._fac(toV3(v)); b.velocity.set(f.x, f.y, f.z); b.wakeUp(); } }
  get linearVelocity() { return this.velocity; }
  set linearVelocity(v) { this.velocity = v; }
  get angularVelocity() {
    const b = this._body;
    return this._lv(() => (b ? V(b.angularVelocity) : new Vector3()), (v) => { if (b) { b.angularVelocity.set(v.x, v.y, v.z); b.wakeUp(); } });
  }
  set angularVelocity(v) { const b = this._body; if (b) { v = toV3(v); b.angularVelocity.set(v.x, v.y, v.z); b.wakeUp(); } }
  get mass() { return this._data.mass; }
  set mass(v) { this._data.mass = v; const b = this._body; if (b && b.type === 1) { b.mass = v; b.updateMassProperties(); } }
  get useGravity() { return this._data.useGravity !== false; }
  set useGravity(v) { this._data.useGravity = !!v; const b = this._body; if (b) { b.userData_useGravity = !!v; b.wakeUp(); } }
  get isKinematic() { return !!this._data.isKinematic; }
  set isKinematic(v) {
    if (!!v === !!this._data.isKinematic) return;
    this._data.isKinematic = !!v;
    needRT().physics.sync(this.gameObject);
  }
  get drag() { return this._data.drag; }
  set drag(v) { this._data.drag = v; const b = this._body; if (b) b.linearDamping = Math.min(0.99, v); }
  get angularDrag() { return this._data.angularDrag; }
  set angularDrag(v) { this._data.angularDrag = v; const b = this._body; if (b) b.angularDamping = Math.min(0.99, v); }
  get freezeRotation() { return (this._data.freezeRot || []).every(Boolean); }
  set freezeRotation(v) {
    this._data.freezeRot = [!!v, !!v, !!v];
    const b = this._body;
    if (b) { b.angularFactor.set(v ? 0 : 1, v ? 0 : 1, v ? 0 : 1); if (v) b.angularVelocity.set(0, 0, 0); }
  }
  get position() { const b = this._body; return b ? V(b.position) : this.transform.position.clone(); }
  set position(p) { this.MovePosition(p); }
  get rotation() { const b = this._body; return b ? new Quaternion(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w) : this.transform.rotation; }
  set rotation(q) { this.MoveRotation(q); }
  MovePosition(p) { this.transform.position = toV3(p); }
  MoveRotation(q) { this.transform.rotation = q; }
  AddForce(a, b, c, d) {
    let f, mode;
    if (typeof a === 'number') { f = new Vector3(a, b || 0, c || 0); mode = d; }
    else { f = toV3(a); mode = b; }
    const body = this._body;
    if (!body || body.type !== 1) return;
    f = this._fac(f);
    mode = mode || ForceMode.Force;
    body.wakeUp();
    if (mode === ForceMode.Force) { body.force.x += f.x; body.force.y += f.y; body.force.z += f.z; }
    else if (mode === ForceMode.Acceleration) { body.force.x += f.x * body.mass; body.force.y += f.y * body.mass; body.force.z += f.z * body.mass; }
    else if (mode === ForceMode.Impulse) { body.velocity.x += f.x / body.mass; body.velocity.y += f.y / body.mass; body.velocity.z += f.z / body.mass; }
    else { body.velocity.x += f.x; body.velocity.y += f.y; body.velocity.z += f.z; }
  }
  AddRelativeForce(a, b, c, d) {
    let f = typeof a === 'number' ? new Vector3(a, b || 0, c || 0) : toV3(a);
    const mode = typeof a === 'number' ? d : b;
    f = this.transform.TransformDirection(f);
    this.AddForce(f, mode);
  }
  AddTorque(a, b, c, d) {
    let t, mode;
    if (typeof a === 'number') { t = new Vector3(a, b || 0, c || 0); mode = d; }
    else { t = toV3(a); mode = b; }
    const body = this._body;
    if (!body || body.type !== 1) return;
    body.wakeUp();
    if (mode === ForceMode.Impulse || mode === ForceMode.VelocityChange) {
      const k = mode === ForceMode.Impulse ? 1 / body.mass : 1;
      body.angularVelocity.x += t.x * k; body.angularVelocity.y += t.y * k; body.angularVelocity.z += t.z * k;
    } else { body.torque.x += t.x; body.torque.y += t.y; body.torque.z += t.z; }
  }
  AddRelativeTorque(t, mode) { this.AddTorque(this.transform.TransformDirection(toV3(t)), mode); }
  AddForceAtPosition(f, pos, mode) {
    const body = this._body;
    if (!body || body.type !== 1) return;
    f = toV3(f);
    this.AddForce(f, mode);
    const r = toV3(pos).sub(V(body.position));
    const tq = r.cross(f);
    this.AddTorque(tq, mode === ForceMode.Impulse ? ForceMode.Impulse : ForceMode.Force);
  }
  AddExplosionForce(force, center, radius, upwards = 0, mode = ForceMode.Impulse) {
    const body = this._body;
    if (!body) return;
    const d = V(body.position).sub(toV3(center));
    const dist = d.magnitude;
    if (dist > radius) return;
    const dir = d.add(new Vector3(0, upwards, 0)).normalized;
    this.AddForce(dir.mul(force * (1 - dist / radius)), mode);
  }
  Sleep() { const b = this._body; if (b) b.sleep(); }
  WakeUp() { const b = this._body; if (b) b.wakeUp(); }
  IsSleeping() { const b = this._body; return b ? b.sleepState === 2 : false; }
  _enabledChanged() {}
}

export class Collider extends Component {
  get isTrigger() { return !!this._data.isTrigger; }
  set isTrigger(v) { this._data.isTrigger = !!v; needRT().physics.sync(this.gameObject); }
  get attachedRigidbody() { return this.gameObject.GetComponent('Rigidbody'); }
  get center() { return Vector3.from(this._data.center); }
  set center(v) { this._data.center = [v.x, v.y, v.z]; needRT().physics.sync(this.gameObject); }
  get bounds() {
    const b = RT && RT.physics.bodyOf(this.gameObject);
    if (!b) return null;
    b.updateAABB();
    const lo = V(b.aabb.lowerBound), hi = V(b.aabb.upperBound);
    return { min: lo, max: hi, center: lo.add(hi).mul(0.5), size: hi.sub(lo) };
  }
  _enabledChanged() { needRT().physics.sync(this.gameObject); }
}
export class BoxCollider extends Collider {
  get size() { return Vector3.from(this._data.size); }
  set size(v) { this._data.size = [v.x, v.y, v.z]; needRT().physics.sync(this.gameObject); }
}
export class SphereCollider extends Collider {
  get radius() { return this._data.radius; }
  set radius(v) { this._data.radius = v; needRT().physics.sync(this.gameObject); }
}
export class CapsuleCollider extends SphereCollider {
  get height() { return this._data.height; }
  set height(v) { this._data.height = v; needRT().physics.sync(this.gameObject); }
}
export class CylinderCollider extends CapsuleCollider {}

// ---------------------------------------------------------------- Audio / effets

export class AudioSource extends Component {
  _attach() { if (this._data.playOnAwake && this.enabled && this.gameObject.activeInHierarchy) this.Play(); }
  Play() {
    this.Stop();
    this._h = needRT().audio.play(this._data.clip, { volume: this._data.volume, pitch: this._data.pitch, loop: this._data.loop });
  }
  Stop() { if (this._h) this._h.stop(); this._h = null; }
  Pause() { this.Stop(); }
  PlayOneShot(clip, vol = 1) { needRT().audio.play(clip || this._data.clip, { volume: this._data.volume * vol, pitch: this._data.pitch }); }
  get isPlaying() { return !!(this._h && this._h.playing); }
  get clip() { return this._data.clip; }
  set clip(v) { this._data.clip = v; }
  get volume() { return this._data.volume; }
  set volume(v) { this._data.volume = v; if (this._h && this._h.out) this._h.out.gain.value = v; }
  get pitch() { return this._data.pitch; }
  set pitch(v) { this._data.pitch = v; }
  get loop() { return !!this._data.loop; }
  set loop(v) { this._data.loop = !!v; }
  get mute() { return !!this._mute; }
  set mute(v) { this._mute = !!v; if (this._h && this._h.out) this._h.out.gain.value = v ? 0 : this._data.volume; }
  _enabledChanged(v) { if (!v) this.Stop(); }
  _onActive(a) { if (!a) this.Stop(); }
  _destroy() { this.Stop(); }
}

export class ParticleSystem extends Component {
  _attach() {
    const rt = needRT();
    this._em = new ParticleEmitter(this._data, this.gameObject.obj, rt.scene);
    rt.emitters.push(this);
    if (!this.gameObject.activeInHierarchy || !this.enabled) this._em.Stop();
  }
  Play() { this._em && this._em.Play(); }
  Stop() { this._em && this._em.Stop(); }
  Pause() { this._em && this._em.Pause(); }
  Clear() { this._em && this._em.Clear(); }
  Emit(n = 1) { this._em && this._em.Emit(n); }
  get isPlaying() { return !!(this._em && this._em.isPlaying); }
  get particleCount() { return this._em ? this._em.particleCount : 0; }
  _set(k, v) { this._data[k] = v; if (this._em) this._em.refreshColors(); }
  get rate() { return this._data.rate; } set rate(v) { this._data.rate = v; }
  get speed() { return this._data.speed; } set speed(v) { this._data.speed = v; }
  get lifetime() { return this._data.lifetime; } set lifetime(v) { this._data.lifetime = v; }
  get size() { return this._data.size; } set size(v) { this._data.size = v; }
  get gravity() { return this._data.gravity; } set gravity(v) { this._data.gravity = v; }
  get loop() { return this._data.loop; } set loop(v) { this._data.loop = !!v; }
  get startColor() { return Color.from(this._data.startColor); } set startColor(c) { this._set('startColor', Color.from(c).toHex()); }
  get endColor() { return Color.from(this._data.endColor); } set endColor(c) { this._set('endColor', Color.from(c).toHex()); }
  _onActive(a) { if (!a && this._em) this._em.Stop(); }
  _destroy() {
    const rt = RT;
    if (this._em) this._em.dispose();
    if (rt) rt.emitters = rt.emitters.filter((e) => e !== this);
  }
}

export class TrailRenderer extends Component {
  _attach() {
    const rt = needRT();
    this._tr = new Trail(this._data, this.gameObject.obj, rt.scene);
    rt.trails.push(this);
  }
  Clear() { this._tr && this._tr.Clear(); }
  get emitting() { return this._tr ? this._tr.emitting : false; }
  set emitting(v) { if (this._tr) this._tr.emitting = !!v; }
  _destroy() {
    const rt = RT;
    if (this._tr) this._tr.dispose();
    if (rt) rt.trails = rt.trails.filter((e) => e !== this);
  }
}

// ---------------------------------------------------------------- Interface

class UIComp extends Component {
  _attach() {
    const rt = needRT();
    this._it = rt.ui.add(this._cid, this._data.type, this._data, () => this._click && this._click());
    rt.ui.setVisible(this._cid, this.gameObject.activeInHierarchy);
  }
  _refresh() { if (RT) RT.ui.update(this._cid); }
  _enabledChanged() { this._refresh(); }
  _onActive(a) { if (RT) RT.ui.setVisible(this._cid, a); }
  _destroy() { if (RT) RT.ui.remove(this._cid); }
  get color() { return Color.from(this._data.color); }
  set color(c) { this._data.color = Color.from(c).toHex(); this._refresh(); }
  get anchoredPosition() { return Vector2.from(this._data.pos); }
  set anchoredPosition(v) { this._data.pos = [v.x, v.y]; this._refresh(); }
}
export class Text extends UIComp {
  get text() { return this._data.text; }
  set text(v) { v = String(v); if (v !== this._data.text) { this._data.text = v; this._refresh(); } }
  get fontSize() { return this._data.fontSize; }
  set fontSize(v) { this._data.fontSize = v; this._refresh(); }
}
export class Button extends UIComp {
  constructor() {
    super();
    this._listeners = [];
    this.onClick = {
      AddListener: (fn) => this._listeners.push(fn),
      RemoveListener: (fn) => (this._listeners = this._listeners.filter((f) => f !== fn)),
      RemoveAllListeners: () => (this._listeners = []),
      Invoke: () => this._click(),
    };
  }
  _click() {
    const rt = RT;
    if (!rt || rt.paused) return;
    for (const fn of this._listeners) {
      try { fn(); } catch (e) { rt.reportError(e, null, 'onClick'); }
    }
    const m = this._data.onClick;
    if (m) {
      const own = this.gameObject.components.filter((c) => c instanceof MonoBehaviour && typeof c[m] === 'function');
      const targets = own.length ? own : rt.behaviours.filter((b) => typeof b[m] === 'function' && b.gameObject.activeInHierarchy);
      for (const b of targets) rt.safeCall(b, m, [this]);
    }
  }
  get text() { return this._data.label; }
  set text(v) { this._data.label = String(v); this._refresh(); }
  get label() { return this.text; }
  set label(v) { this.text = v; }
  get interactable() { return this._it ? this._it.interactable !== false : true; }
  set interactable(v) { if (this._it) { this._it.interactable = !!v; this._refresh(); } }
}
export class Image extends UIComp {
  get fillAmount() { return this._data.fill ?? 1; }
  set fillAmount(v) { this._data.fill = Math.max(0, Math.min(1, v)); this._refresh(); }
  get sprite() { return this._data.image; }
  set sprite(v) { this._data.image = v || ''; this._refresh(); }
  get opacity() { return this._data.opacity; }
  set opacity(v) { this._data.opacity = v; this._refresh(); }
  get size() { return Vector2.from(this._data.size); }
  set size(v) { this._data.size = [v.x, v.y]; this._refresh(); }
}

const BUILTIN = {
  MeshRenderer, SpriteRenderer, Text3D, Light, Camera, Rigidbody,
  BoxCollider, SphereCollider, CapsuleCollider, CylinderCollider,
  AudioSource, ParticleSystem, TrailRenderer, UIText: Text, UIButton: Button, UIImage: Image,
};
const VISUAL_TYPES = new Set(['MeshRenderer', 'SpriteRenderer', 'Text3D', 'Light', 'Camera']);
const PHYS_TYPES = new Set(['Rigidbody', ...COLLIDERS]);

export class PrefabRef {
  constructor(id, name) {
    this.id = id;
    this.name = name;
  }
  toString() { return `Prefab(${this.name})`; }
}

// =====================================================================
// Runtime
// =====================================================================

export class Runtime {
  /**
   * opts: { project, container, sceneId, renderer?, log(entry), onQuit(), onPause(bool), onStats(s), isEditor, errorPause, autoRender }
   */
  constructor(opts) {
    this.opts = opts;
    this.project = opts.project;
    this.settings = { gravity: [0, -9.81, 0], fixedHz: 60, shadows: true, antialias: true, pixelRatio: 2, controls: {}, ...(this.project.settings || {}) };
    this.container = opts.container;
    this.ownRenderer = !opts.renderer;
    if (this.ownRenderer) {
      this.renderer = new THREE.WebGLRenderer({ antialias: this.settings.antialias !== false, powerPreference: 'high-performance' });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.settings.pixelRatio || 2));
      this.renderer.shadowMap.enabled = this.settings.shadows !== false;
      this.renderer.shadowMap.type = THREE.PCFShadowMap;
      this.renderer.domElement.className = 'rt-canvas';
      this.container.appendChild(this.renderer.domElement);
    } else this.renderer = opts.renderer;
    this.overlay = h('div.rt-overlay');
    this.container.appendChild(this.overlay);
    this.width = 1;
    this.height = 1;
    this.textures = new TextureCache(this.project);
    this.ctx = { mode: 'runtime', textures: this.textures, shadows: this.settings.shadows !== false };
    this.scene = new THREE.Scene();
    this.physics = new PhysicsWorld(this.settings);
    const ctl = this.settings.controls || {};
    this.input = new InputSystem(this.overlay, { joystick: ctl.joystick !== false, buttonA: ctl.buttonA !== false, buttonB: ctl.buttonB !== false, labelA: ctl.labelA || 'A', labelB: ctl.labelB || 'B' });
    this.audio = new AudioSystem(this.project);
    this.ui = new UILayer(this.overlay, {
      interactive: true,
      findImage: (ref) => {
        const a = (this.project.assets || []).find((x) => x.id === ref || x.name === ref);
        return a ? a.data : null;
      },
    });
    this.objects = [];
    this.behaviours = [];
    this.toStart = [];
    this.emitters = [];
    this.trails = [];
    this.coroutines = [];
    this.invokes = [];
    this.timers = [];
    this.destroyQueue = [];
    this.debugLines = [];
    this.sceneMap = new Map();
    this.t = { time: 0, deltaTime: 0, unscaled: 0, unscaledTime: 0, fixed: 1 / (this.settings.fixedHz || 60), scale: 1, frame: 0, start: performance.now(), levelStart: 0 };
    this.fixedAcc = 0;
    this.paused = false;
    this.running = false;
    this.pendingScene = null;
    this.fallbackCam = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    this.fallbackCam.position.set(0, 1, 10);
    this.scriptsMap = {};
    this.api = this.buildApi();
    this.scriptNames = (this.project.scripts || []).map((s) => s.name);
    this.lineObj = null;
    this.raycaster = new THREE.Raycaster();
    this.statsT = 0;
    this.statsFrames = 0;
  }

  // ------------------------------------------------------------ journal
  userLog(type, args) {
    const msg = args.map(fmt).join(' ');
    this.opts.log && this.opts.log({ type, msg, ...this.callerLoc() });
  }
  callerLoc() {
    const loc = mapError(new Error(), this.scriptNames);
    return loc ? { script: loc.script, line: loc.line } : {};
  }
  reportError(e, b, method) {
    const loc = mapError(e, this.scriptNames);
    const script = loc ? loc.script : b && b.constructor.__scriptName;
    const name = (e && e.name) || 'Erreur';
    const msg = `${name}: ${(e && e.message) || e}${method ? ` — ${b ? b.constructor.__scriptName + '.' : ''}${method}()` : ''}`;
    this.opts.log && this.opts.log({ type: 'error', msg, script, line: loc && loc.line, stack: e && e.stack });
    if (this.opts.errorPause) this.setPaused(true);
  }
  warn(msg) {
    this.opts.log && this.opts.log({ type: 'warn', msg });
  }

  // ------------------------------------------------------------ API des scripts
  buildApi() {
    const rt = this;
    const T = this.t;
    const Time = {
      get time() { return T.time; },
      get deltaTime() { return T.deltaTime; },
      get unscaledDeltaTime() { return T.unscaled; },
      get unscaledTime() { return T.unscaledTime; },
      get fixedDeltaTime() { return T.fixed; },
      set fixedDeltaTime(v) { T.fixed = Math.max(0.002, v); },
      get fixedTime() { return T.time; },
      get timeScale() { return T.scale; },
      set timeScale(v) { T.scale = Math.max(0, v); },
      get frameCount() { return T.frame; },
      get realtimeSinceStartup() { return (performance.now() - T.start) / 1000; },
      get timeSinceLevelLoad() { return T.time - T.levelStart; },
    };
    const Debug = {
      Log: (...a) => rt.userLog('log', a),
      LogWarning: (...a) => rt.userLog('warn', a),
      LogError: (...a) => rt.userLog('error', a),
      Assert: (cond, ...a) => { if (!cond) rt.userLog('error', ['Assertion échouée', ...a]); },
      DrawLine: (a, b, color = Color.white, duration = 0) => rt.debugLines.push({ a: toV3(a), b: toV3(b), color: Color.from(color), until: T.time + duration }),
      DrawRay: (o, d, color = Color.white, duration = 0) => rt.debugLines.push({ a: toV3(o), b: toV3(o).add(toV3(d)), color: Color.from(color), until: T.time + duration }),
      Break: () => rt.setPaused(true),
      ClearDeveloperConsole: () => rt.opts.onClear && rt.opts.onClear(),
    };
    const hit = (r) =>
      r && {
        point: Vector3.from(r.point),
        normal: Vector3.from(r.normal),
        distance: r.distance,
        gameObject: r.rgo,
        transform: r.rgo.transform,
        collider: r.rgo.GetComponent('Collider'),
        rigidbody: r.rgo.GetComponent('Rigidbody'),
      };
    const rayArgs = (a, b, c) => (a instanceof Ray ? [a.origin, a.direction, b ?? 1000] : [toV3(a), toV3(b), c ?? 1000]);
    const Physics = {
      get gravity() { const g = rt.physics.world.gravity; return new LiveVector3(() => V(g), (v) => g.set(v.x, v.y, v.z)); },
      set gravity(v) { rt.physics.world.gravity.set(v.x, v.y, v.z); },
      Raycast: (a, b, c) => { const [o, d, m] = rayArgs(a, b, c); return hit(rt.physics.raycast(o, d, m)); },
      RaycastAll: (a, b, c) => { const [o, d, m] = rayArgs(a, b, c); return rt.physics.raycast(o, d, m, true).map(hit); },
      Linecast: (a, b) => { const d = toV3(b).sub(toV3(a)); return hit(rt.physics.raycast(toV3(a), d, d.magnitude)); },
      OverlapSphere: (c, r) => rt.physics.overlapSphere(toV3(c), r).map((g) => g.GetComponent('Collider') || g.GetComponent('Rigidbody')).filter(Boolean),
      CheckSphere: (c, r) => rt.physics.overlapSphere(toV3(c), r).length > 0,
    };
    const Screen = {
      get width() { return rt.width; },
      get height() { return rt.height; },
      get dpi() { return 160 * (window.devicePixelRatio || 1); },
      get orientation() { return rt.width > rt.height ? 'Landscape' : 'Portrait'; },
    };
    const Application = {
      Quit: () => rt.opts.onQuit && rt.opts.onQuit(),
      get isEditor() { return !!rt.opts.isEditor; },
      get isPlaying() { return true; },
      get isMobilePlatform() { return /iP(hone|ad|od)|Android/.test(navigator.userAgent); },
      get platform() { return /iPhone/.test(navigator.userAgent) ? 'IPhonePlayer' : 'WebGLPlayer'; },
      get productName() { return rt.project.name; },
      version: '1.0',
      targetFrameRate: 60,
      OpenURL: (u) => window.open(u, '_blank'),
    };
    const SceneManager = {
      LoadScene: (n) => { rt.pendingScene = n; },
      ReloadScene: () => { rt.pendingScene = rt.currentScene ? rt.currentScene.id : 0; },
      GetActiveScene: () => ({ name: rt.currentScene ? rt.currentScene.name : '', buildIndex: rt.project.scenes.indexOf(rt.currentScene) }),
      get sceneCount() { return rt.project.scenes.length; },
      get sceneCountInBuildSettings() { return rt.project.scenes.length; },
    };
    const ppKey = 'crea.pp.' + (rt.project.id || 'x');
    let pp = {};
    try { pp = JSON.parse(localStorage.getItem(ppKey) || '{}'); } catch {}
    const ppSave = () => { try { localStorage.setItem(ppKey, JSON.stringify(pp)); } catch {} };
    const PlayerPrefs = {
      SetInt: (k, v) => { pp[k] = Math.trunc(v); ppSave(); },
      GetInt: (k, d = 0) => (k in pp ? Math.trunc(Number(pp[k])) : d),
      SetFloat: (k, v) => { pp[k] = Number(v); ppSave(); },
      GetFloat: (k, d = 0) => (k in pp ? Number(pp[k]) : d),
      SetString: (k, v) => { pp[k] = String(v); ppSave(); },
      GetString: (k, d = '') => (k in pp ? String(pp[k]) : d),
      HasKey: (k) => k in pp,
      DeleteKey: (k) => { delete pp[k]; ppSave(); },
      DeleteAll: () => { pp = {}; ppSave(); },
      Save: () => ppSave(),
    };
    const Audio = {
      Play: (clip, volume = 1, pitch = 1) => rt.audio.play(clip, { volume, pitch }),
      StopAll: () => rt.audio.stopAll(),
      get mute() { return rt.audio.muted; },
      set mute(v) { rt.audio.muted = !!v; if (v) rt.audio.stopAll(); },
    };
    const Resources = { Load: (name) => rt.prefabRef(name) };
    const Prefabs = new Proxy({}, { get: (_, k) => (typeof k === 'string' ? rt.prefabRef(k) : undefined) });
    const Handheld = { Vibrate: () => { try { navigator.vibrate && navigator.vibrate(60); } catch {} } };
    return {
      Vector3, Vector2, Quaternion, Color, Mathf, Random, Ray,
      Time, Input: this.input.api(), Debug, print: Debug.Log, Physics, Screen, Application, SceneManager, PlayerPrefs, Handheld, Audio,
      GameObject, Transform, Component, Behaviour, MonoBehaviour,
      Instantiate: (...a) => rt.instantiate(...a),
      Destroy: (o, t) => rt.destroy(o, t),
      DontDestroyOnLoad: (o) => { if (o) (o.gameObject || o)._dontDestroy = true; },
      Camera, Rigidbody, Collider, BoxCollider, SphereCollider, CapsuleCollider, CylinderCollider,
      MeshRenderer, SpriteRenderer, Text3D, Light, AudioSource, ParticleSystem, TrailRenderer, Text, Button, Image,
      WaitForSeconds, WaitForSecondsRealtime, WaitUntil, WaitWhile, WaitForFixedUpdate, WaitForEndOfFrame,
      KeyCode, ForceMode, Space, TouchPhase, Ref: RuntimeRef, Resources, Prefabs, Scripts: this.scriptsMap,
    };
  }

  prefabRef(nameOrId) {
    const p = (this.project.prefabs || []).find((x) => x.id === nameOrId || x.name === nameOrId);
    return p ? new PrefabRef(p.id, p.name) : null;
  }

  // ------------------------------------------------------------ démarrage
  /** Compile et lance. Retourne false si erreurs de compilation. */
  start(sceneRef) {
    const res = compileAll(this.project.scripts || [], this.api);
    if (res.errors.length) {
      for (const e of res.errors) this.opts.log && this.opts.log({ type: 'error', msg: `Erreur de compilation : ${e.message}`, script: e.script, line: e.line, compile: true });
      return false;
    }
    this.classes = res.classes;
    Object.assign(this.scriptsMap, res.byClassName);
    this.hasMouse = [...res.classes.values()].some((c) => ['OnMouseDown', 'OnMouseUp', 'OnMouseDrag', 'OnMouseUpAsButton'].some((m) => typeof c.prototype[m] === 'function'));
    this.hasStay = [...res.classes.values()].some((c) => typeof c.prototype.OnCollisionStay === 'function' || typeof c.prototype.OnTriggerStay === 'function');
    RT = this;
    const scene = this.findScene(sceneRef ?? this.settings.startScene) || this.project.scenes[0];
    try {
      this.loadScene(scene);
    } catch (e) {
      this.reportError(e, null, 'chargement de la scène');
    }
    this.running = true;
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
    return true;
  }

  findScene(ref) {
    if (ref == null) return null;
    const sc = this.project.scenes;
    if (typeof ref === 'number') return sc[ref] || null;
    return sc.find((s) => s.id === ref || s.name === ref) || null;
  }

  loadScene(scene) {
    this.currentScene = scene;
    applyEnvironment(this.scene, scene.env);
    this.t.levelStart = this.t.time;
    const { list, map } = this.createFromData(scene.objects, null);
    this.sceneMap = map;
    this.setupBatch(list);
    this.awakeBatch(list, map);
  }

  /** Crée les GameObjects d'une liste plate (sans physique ni Awake) */
  createFromData(objs, parentObj) {
    const sorted = sortByHierarchy(objs);
    const map = new Map();
    const list = [];
    for (const d of sorted) {
      const go = new GameObject(d.name, INTERNAL);
      go.tag = d.tag || 'Untagged';
      go._activeSelf = d.active !== false;
      go.obj.visible = go._activeSelf;
      go.dataId = d.id;
      go.prefabId = d.prefabId || null;
      applyTransform(go.obj, d.t);
      const p = d.parent && map.get(d.parent);
      (p ? p.obj : parentObj || this.scene).add(go.obj);
      map.set(d.id, go);
      list.push({ go, d });
      this.objects.push(go);
    }
    for (const { go, d } of list) {
      for (const cd of d.c || []) this.createComponent(go, clone(cd), map);
    }
    return { list, map };
  }

  createComponent(go, data, batchMap) {
    if (data.type === 'Script') {
      const cls = this.scriptClass(data.script);
      if (!cls) {
        const sc = (this.project.scripts || []).find((s) => s.id === data.script);
        if (data.script) this.warn(`« ${go.name} » : le script ${sc ? sc.name : '(supprimé)'} est introuvable.`);
        return null;
      }
      let inst;
      PENDING = { go, data };
      try {
        inst = new cls();
      } catch (e) {
        this.reportError(e, null, `constructeur de ${cls.__scriptName}`);
        return null;
      } finally {
        PENDING = null;
      }
      if (!(inst instanceof MonoBehaviour)) {
        this.warn(`${cls.__scriptName} doit hériter de MonoBehaviour (class ${cls.name} extends MonoBehaviour)`);
        return null;
      }
      inst._init(go, data);
      this.applyFields(inst, data.props || {}, batchMap);
      go.components.push(inst);
      this.behaviours.push(inst);
      return inst;
    }
    const C = BUILTIN[data.type];
    if (!C) return null;
    const comp = new C();
    comp._init(go, data);
    go.components.push(comp);
    return comp;
  }

  scriptClass(ref) {
    if (!ref || !this.classes) return null;
    const sc = (this.project.scripts || []).find((s) => s.id === ref || s.name === ref);
    return sc ? this.classes.get(sc.name) || null : null;
  }

  applyFields(inst, props, batchMap) {
    for (const k of Object.keys(props)) {
      if (!(k in inst)) continue;
      const v = props[k];
      const cur = inst[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (v.ref === 'go') inst[k] = v.id ? (batchMap && batchMap.get(v.id)) || this.sceneMap.get(v.id) || null : null;
        else if (v.ref === 'prefab') inst[k] = v.id ? this.prefabRef(v.id) : null;
        continue;
      }
      if (cur instanceof Color && typeof v === 'string') inst[k] = Color.hex(v);
      else if (cur instanceof Vector3 && Array.isArray(v)) inst[k] = new Vector3(v[0], v[1], v[2]);
      else if (cur instanceof Vector2 && Array.isArray(v)) inst[k] = new Vector2(v[0], v[1]);
      else if (typeof cur === 'number' && typeof v === 'number') inst[k] = v;
      else if (typeof cur === 'boolean' && typeof v === 'boolean') inst[k] = v;
      else if (typeof cur === 'string' && typeof v === 'string') inst[k] = v;
      else if ((cur === null || cur === undefined || (cur && (cur.__lazyGo || cur.__lazyPrefab))) && typeof v === 'string') inst[k] = v;
    }
  }

  /** Visuels, physique et composants actifs pour une liste de GameObjects */
  setupBatch(list) {
    for (const { go } of list) {
      this.rebuildVisuals(go);
    }
    for (const { go } of list) {
      if (go.activeInHierarchy) this.physics.sync(go);
      for (const c of go.components) if (!(c instanceof MonoBehaviour)) c._attach();
    }
  }

  awakeBatch(list, batchMap) {
    const bs = [];
    for (const { go } of list) for (const c of go.components) if (c instanceof MonoBehaviour) bs.push(c);
    // références paresseuses : Ref.GameObject("Nom"), Ref.Prefab("Nom")
    for (const b of bs) {
      for (const k of Object.keys(b)) {
        const v = b[k];
        if (v && typeof v === 'object') {
          if (v.__lazyGo) {
            let found = null;
            if (batchMap) for (const g of batchMap.values()) if (g.name === v.__lazyGo) { found = g; break; }
            b[k] = found || this.objects.find((g) => g.name === v.__lazyGo && !g._destroyed) || null;
          } else if (v.__lazyPrefab) b[k] = this.prefabRef(v.__lazyPrefab);
        }
      }
    }
    for (const b of bs) if (b.gameObject.activeInHierarchy && !b._removed) this.awake(b);
    for (const b of bs) if (b._awoken && b.enabled && b.gameObject.activeInHierarchy && !b._removed) this.enable(b);
  }

  awake(b) {
    if (b._awoken) return;
    b._awoken = true;
    this.safeCall(b, 'Awake');
  }
  enable(b) {
    this.safeCall(b, 'OnEnable');
    if (!b._started && !this.toStart.includes(b)) this.toStart.push(b);
  }

  safeCall(b, m, args) {
    const f = b[m];
    if (typeof f !== 'function') return undefined;
    try {
      return args ? f.apply(b, args) : f.call(b);
    } catch (e) {
      this.reportError(e, b, m);
      return undefined;
    }
  }

  rebuildVisuals(go) {
    const comps = go.components.map((c) => c._data).filter((d) => d && d.type !== 'Script');
    buildVisuals(go.obj, { id: go.id, c: comps }, this.ctx);
  }

  // ------------------------------------------------------------ opérations
  addComponent(go, type, props) {
    let tname = type;
    if (typeof type === 'function') {
      if (type.__scriptName) tname = type.__scriptName;
      else tname = Object.keys(BUILTIN).find((k) => BUILTIN[k] === type) || type.name;
    }
    tname = ALIASES[tname] || tname;
    let data;
    if (BUILTIN[tname]) {
      data = createComponent(tname, null);
      if (props) Object.assign(data, props);
    } else {
      const sc = (this.project.scripts || []).find((s) => s.name === tname || (this.classes.get(s.name) && this.classes.get(s.name).name === tname));
      if (!sc) throw new Error(`AddComponent : type inconnu « ${tname} »`);
      data = { type: 'Script', enabled: true, script: sc.id, props: {} };
    }
    const comp = this.createComponent(go, data, null);
    if (!comp) return null;
    if (comp instanceof MonoBehaviour) {
      if (props && typeof props === 'object') Object.assign(comp, props);
      if (go.activeInHierarchy) {
        this.awake(comp);
        if (comp.enabled) this.enable(comp);
      }
    } else {
      if (VISUAL_TYPES.has(tname)) this.rebuildVisuals(go);
      if (PHYS_TYPES.has(tname) && go.activeInHierarchy) this.physics.sync(go);
      comp._attach();
    }
    return comp;
  }

  removeComponent(c) {
    const go = c.gameObject;
    if (!go || go._destroyed) return;
    const i = go.components.indexOf(c);
    if (i < 0) return;
    go.components.splice(i, 1);
    if (c instanceof MonoBehaviour) {
      if (c._awoken && c.enabled && go.activeInHierarchy) this.safeCall(c, 'OnDisable');
      if (c._awoken) this.safeCall(c, 'OnDestroy');
      c._removed = true;
      this.stopCoroutine(c, null);
      this.cancelInvoke(c);
      this.behaviours = this.behaviours.filter((b) => b !== c);
    } else {
      c._destroy();
      const t = c._data.type;
      if (VISUAL_TYPES.has(t)) this.rebuildVisuals(go);
      if (PHYS_TYPES.has(t)) this.physics.sync(go);
    }
  }

  setBehaviourEnabled(b, v) {
    if (b._data.enabled !== false === v) return;
    b._data.enabled = v;
    if (!b.gameObject.activeInHierarchy || b._removed) return;
    if (v) {
      if (!b._awoken) this.awake(b);
      this.enable(b);
    } else if (b._awoken) this.safeCall(b, 'OnDisable');
  }

  subtree(go) {
    const out = [];
    const walk = (g) => {
      out.push(g);
      for (const c of g.obj.children) if (c.userData.rgo) walk(c.userData.rgo);
    };
    walk(go);
    return out;
  }

  setActive(go, v) {
    if (go._activeSelf === v || go._destroyed) return;
    const sub = this.subtree(go);
    const was = sub.map((g) => g.activeInHierarchy);
    go._activeSelf = v;
    go.obj.visible = v;
    sub.forEach((g, i) => {
      const now = g.activeInHierarchy;
      if (now === was[i]) return;
      for (const c of g.components) {
        if (c instanceof MonoBehaviour) {
          if (now) {
            if (!c._awoken) this.awake(c);
            if (c.enabled) this.enable(c);
          } else if (c._awoken && c.enabled) {
            this.safeCall(c, 'OnDisable');
            this.stopCoroutine(c, null);
          }
        } else c._onActive(now);
      }
      if (now) this.physics.sync(g);
      else this.physics.remove(g);
    });
  }

  sendMessage(go, method, args) {
    for (const c of go.components) {
      if (c instanceof MonoBehaviour && c.enabled && typeof c[method] === 'function') this.safeCall(c, method, args);
    }
  }

  destroy(o, t = 0) {
    if (!o) return;
    if (t > 0) {
      this.timers.push({ at: this.t.time + t, fn: () => this.destroy(o, 0) });
      return;
    }
    if (o instanceof Transform) o = o.gameObject;
    if (o instanceof GameObject) {
      if (o._destroyed || o._pendingDestroy) return;
      o._pendingDestroy = true;
    }
    this.destroyQueue.push(o);
  }

  processDestroy() {
    if (!this.destroyQueue.length) return;
    const q = this.destroyQueue;
    this.destroyQueue = [];
    for (const o of q) {
      if (o instanceof GameObject) this.destroyGO(o);
      else if (o instanceof Component) this.removeComponent(o);
    }
    this.behaviours = this.behaviours.filter((b) => !b._removed);
    this.toStart = this.toStart.filter((b) => !b._removed);
    this.objects = this.objects.filter((g) => !g._destroyed);
  }

  destroyGO(go) {
    if (go._destroyed) return;
    for (const ch of go.transform.children) this.destroyGO(ch.gameObject);
    const active = go.activeInHierarchy;
    for (const c of go.components) {
      if (c instanceof MonoBehaviour) {
        if (active && c._awoken && c.enabled) this.safeCall(c, 'OnDisable');
        if (c._awoken) this.safeCall(c, 'OnDestroy');
        c._removed = true;
        this.stopCoroutine(c, null);
        this.cancelInvoke(c);
      } else c._destroy();
    }
    go._destroyed = true;
    this.physics.remove(go);
    go.obj.removeFromParent();
    for (const v of go.obj.userData.visuals || []) disposeObject(v);
    if (this.mouseTarget === go) this.mouseTarget = null;
  }

  serializeRuntime(go) {
    const objs = [];
    const copies = [];
    const walk = (g, parentId, isRoot) => {
      const id = uid();
      let t;
      if (isRoot) {
        g.obj.updateWorldMatrix(true, false);
        g.obj.matrixWorld.decompose(_v, _q, _s);
        _e.setFromQuaternion(_q, 'XYZ');
        t = { p: [_v.x, _v.y, _v.z], r: [_e.x * R2D, _e.y * R2D, _e.z * R2D], s: [_s.x, _s.y, _s.z] };
      } else {
        const o = g.obj;
        t = { p: [o.position.x, o.position.y, o.position.z], r: [o.rotation.x * R2D, o.rotation.y * R2D, o.rotation.z * R2D], s: [o.scale.x, o.scale.y, o.scale.z] };
      }
      const c = [];
      g.components.forEach((comp) => {
        if (comp instanceof MonoBehaviour) {
          c.push({ type: 'Script', enabled: comp.enabled, script: comp.constructor.__scriptId, props: {} });
          copies.push({ id, index: c.length - 1, src: comp });
        } else c.push(clone(comp._data));
      });
      objs.push({ id, name: g.name, parent: parentId, active: g._activeSelf, tag: g.tag, t, c });
      for (const ch of g.transform.children) walk(ch.gameObject, id, false);
    };
    walk(go, null, true);
    return { objs, copies };
  }

  instantiate(original, a, b, c) {
    let pos = null, rot = null, parent = null;
    if (a instanceof Transform || a instanceof GameObject) parent = a;
    else {
      pos = a || null;
      rot = b || null;
      parent = c || null;
    }
    let objs, copies = [];
    if (typeof original === 'string') original = this.prefabRef(original);
    if (original instanceof PrefabRef) {
      const pf = this.project.prefabs.find((p) => p.id === original.id);
      if (!pf) throw new Error('Instantiate : prefab introuvable');
      objs = clone(pf.objects);
    } else if (original instanceof GameObject || original instanceof Component) {
      ({ objs, copies } = this.serializeRuntime(original.gameObject || original));
    } else throw new Error('Instantiate : il faut un GameObject ou un prefab (Ref.Prefab / Prefabs.Nom)');
    const parentObj = parent ? (parent.transform || parent)._o : null;
    const { list, map } = this.createFromData(objs, parentObj);
    const rootEntry = list.find((x) => !x.d.parent || !map.has(x.d.parent));
    const root = rootEntry.go;
    if (pos) root.transform.position = toV3(pos);
    if (rot) root.transform.rotation = rot instanceof Quaternion ? rot : Quaternion.Euler(rot.x, rot.y, rot.z);
    // copie des champs des scripts (comme la sérialisation Unity)
    for (const cp of copies) {
      const g = map.get(cp.id);
      const target = g && g.components.filter((x) => x._data)[cp.index];
      if (!target || !(target instanceof MonoBehaviour)) continue;
      for (const k of Object.keys(cp.src)) {
        if (k.startsWith('_') || k === 'gameObject' || k === 'onClick') continue;
        const v = cp.src[k];
        target[k] = v instanceof Vector3 || v instanceof Vector2 || v instanceof Color ? v.clone() : v;
      }
    }
    this.setupBatch(list);
    this.awakeBatch(list, map);
    return root;
  }

  // ------------------------------------------------------------ coroutines & invocations
  startCoroutine(b, it) {
    if (!it || typeof it.next !== 'function') {
      this.warn('StartCoroutine attend un générateur : déclare la méthode avec une étoile, ex. *Clignote() { yield new WaitForSeconds(1); }');
      return null;
    }
    const co = { b, stack: [it], done: false, _isCoroutine: true, waitT: 0, waitReal: false, waitFn: null, waitCo: null, frame: -1 };
    co.stop = () => (co.done = true);
    this.coroutines.push(co);
    this.stepCoroutine(co);
    return co;
  }
  stepCoroutine(co) {
    let guard = 0;
    while (!co.done && guard++ < 10000) {
      const top = co.stack[co.stack.length - 1];
      let r;
      try {
        r = top.next();
      } catch (e) {
        this.reportError(e, co.b, 'coroutine');
        co.done = true;
        return;
      }
      if (r.done) {
        co.stack.pop();
        if (!co.stack.length) co.done = true;
        continue;
      }
      const v = r.value;
      if (v && typeof v.next === 'function' && typeof v[Symbol.iterator] === 'function') {
        co.stack.push(v);
        continue;
      }
      co.waitT = 0;
      co.waitFn = null;
      co.waitCo = null;
      if (v instanceof WaitForSecondsRealtime) { co.waitT = performance.now() / 1000 + v.seconds; co.waitReal = true; }
      else if (v instanceof WaitForSeconds) { co.waitT = this.t.time + v.seconds; co.waitReal = false; }
      else if (typeof v === 'number') { co.waitT = this.t.time + v; co.waitReal = false; }
      else if (v instanceof WaitUntil) co.waitFn = () => !!v.fn();
      else if (v instanceof WaitWhile) co.waitFn = () => !v.fn();
      else if (v && v._isCoroutine) co.waitCo = v;
      co.frame = this.t.frame;
      return;
    }
  }
  runCoroutines() {
    if (!this.coroutines.length) return;
    const now = performance.now() / 1000;
    for (const co of this.coroutines.slice()) {
      if (co.done) continue;
      const b = co.b;
      if (b._removed || !b.gameObject.activeInHierarchy) {
        co.done = true;
        continue;
      }
      if (co.frame === this.t.frame) continue;
      if (co.waitT && (co.waitReal ? now : this.t.time) < co.waitT) continue;
      if (co.waitFn) {
        let ok = false;
        try {
          ok = co.waitFn();
        } catch (e) {
          this.reportError(e, b, 'WaitUntil');
          co.done = true;
          continue;
        }
        if (!ok) continue;
      }
      if (co.waitCo && !co.waitCo.done) continue;
      this.stepCoroutine(co);
    }
    this.coroutines = this.coroutines.filter((c) => !c.done);
  }
  stopCoroutine(b, c) {
    for (const co of this.coroutines) {
      if (co.b !== b) continue;
      if (!c || co === c || (typeof c === 'string' && co.name === c)) co.done = true;
    }
  }
  invoke(b, name, delay, rate) {
    if (typeof b[name] !== 'function') {
      this.warn(`Invoke : la méthode « ${name} » n'existe pas`);
      return;
    }
    this.invokes.push({ b, name, at: this.t.time + delay, rate });
  }
  cancelInvoke(b, name) {
    this.invokes = this.invokes.filter((i) => !(i.b === b && (!name || i.name === name)));
  }
  runInvokes() {
    if (this.invokes.length) {
      for (const inv of this.invokes.slice()) {
        if (this.t.time < inv.at) continue;
        if (inv.b._removed) {
          inv.dead = true;
          continue;
        }
        if (inv.b.gameObject.activeInHierarchy) this.safeCall(inv.b, inv.name);
        if (inv.rate > 0) inv.at += inv.rate;
        else inv.dead = true;
      }
      this.invokes = this.invokes.filter((i) => !i.dead);
    }
    if (this.timers.length) {
      const due = this.timers.filter((t) => this.t.time >= t.at);
      if (due.length) {
        this.timers = this.timers.filter((t) => this.t.time < t.at);
        due.forEach((t) => t.fn());
      }
    }
  }

  // ------------------------------------------------------------ boucle
  setPaused(p) {
    if (this.paused === p) return;
    this.paused = p;
    this.opts.onPause && this.opts.onPause(p);
  }
  stepOnce() {
    this.stepRequested = true;
  }

  loop(now) {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    let raw = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (this.paused && !this.stepRequested) {
      this.renderFrame();
      return;
    }
    if (this.stepRequested) {
      raw = this.t.fixed;
      this.stepRequested = false;
    }
    try {
      this.tick(raw);
    } catch (e) {
      this.reportError(e, null, 'boucle');
    }
    this.renderFrame();
    this.stats(raw);
  }

  tick(raw) {
    const T = this.t;
    const dt = raw * T.scale;
    T.unscaled = raw;
    T.unscaledTime += raw;
    T.time += dt;
    T.frame++;
    this.input.beginFrame(raw);

    // Start
    if (this.toStart.length) {
      const list = this.toStart;
      this.toStart = [];
      for (const b of list) {
        if (b._removed || b._started) continue;
        if (!b.enabled || !b.gameObject.activeInHierarchy) {
          this.toStart.push(b);
          continue;
        }
        b._started = true;
        const r = this.safeCall(b, 'Start');
        if (r && typeof r.next === 'function') this.startCoroutine(b, r);
      }
    }

    if (this.hasMouse) this.handleMouse();

    // Physique à pas fixe
    this.fixedAcc += dt;
    let n = 0;
    T.deltaTime = T.fixed;
    while (this.fixedAcc >= T.fixed && n < 6) {
      for (const b of this.behaviours) {
        if (b._started && b.enabled && typeof b.FixedUpdate === 'function' && b.gameObject.activeInHierarchy) this.safeCall(b, 'FixedUpdate');
      }
      this.physics.syncIn(T.fixed);
      this.physics.step(T.fixed);
      this.physics.syncOut();
      this.dispatchPhysics();
      this.fixedAcc -= T.fixed;
      n++;
    }
    if (n === 6) this.fixedAcc = 0;
    T.deltaTime = dt;

    // Update
    for (const b of this.behaviours) {
      if (b._started && b.enabled && typeof b.Update === 'function' && b.gameObject.activeInHierarchy) this.safeCall(b, 'Update');
    }
    this.runInvokes();
    this.runCoroutines();
    for (const b of this.behaviours) {
      if (b._started && b.enabled && typeof b.LateUpdate === 'function' && b.gameObject.activeInHierarchy) this.safeCall(b, 'LateUpdate');
    }

    this.processDestroy();
    if (this.pendingScene !== null) {
      const ref = this.pendingScene;
      this.pendingScene = null;
      this.switchScene(ref);
    }
    this.input.endFrame();
  }

  dispatchPhysics() {
    const evs = this.physics.takeEvents();
    for (const ev of evs) {
      const { a, b, A, B, trigger, type } = ev;
      if (a._destroyed || b._destroyed) continue;
      if (trigger) {
        const m = type === 'enter' ? 'OnTriggerEnter' : 'OnTriggerExit';
        this.sendPhys(a, m, this.colliderOf(b));
        this.sendPhys(b, m, this.colliderOf(a));
      } else {
        const m = type === 'enter' ? 'OnCollisionEnter' : 'OnCollisionExit';
        this.sendPhys(a, m, this.collision(A, B, b));
        this.sendPhys(b, m, this.collision(B, A, a));
      }
    }
    if (this.hasStay) {
      for (const p of this.physics.pairs.values()) {
        if (p.a._destroyed || p.b._destroyed) continue;
        if (p.trigger) {
          this.sendPhys(p.a, 'OnTriggerStay', this.colliderOf(p.b));
          this.sendPhys(p.b, 'OnTriggerStay', this.colliderOf(p.a));
        } else {
          this.sendPhys(p.a, 'OnCollisionStay', this.collision(p.A, p.B, p.b));
          this.sendPhys(p.b, 'OnCollisionStay', this.collision(p.B, p.A, p.a));
        }
      }
    }
  }
  colliderOf(go) {
    return go.GetComponent('Collider') || go.GetComponent('Rigidbody') || go;
  }
  collision(Me, Other, otherGo) {
    const rt = this;
    let info;
    return {
      gameObject: otherGo,
      transform: otherGo.transform,
      collider: this.colliderOf(otherGo),
      rigidbody: otherGo.GetComponent('Rigidbody'),
      relativeVelocity: new Vector3(Me.velocity.x - Other.velocity.x, Me.velocity.y - Other.velocity.y, Me.velocity.z - Other.velocity.z),
      get contacts() {
        info = info || rt.physics.contactInfo(Me, Other);
        return info ? [{ point: Vector3.from(info.point), normal: Vector3.from(info.normal) }] : [];
      },
      get contactCount() { return this.contacts.length; },
      GetContact(i) { return this.contacts[i]; },
      get tag() { return otherGo.tag; },
      CompareTag: (t) => otherGo.tag === t,
    };
  }
  sendPhys(go, method, arg) {
    // le message va au GameObject et aux parents portant le Rigidbody
    for (let g = go; g; g = g.transform.parent && g.transform.parent.gameObject) {
      for (const c of g.components) {
        if (c instanceof MonoBehaviour && c.enabled && !c._removed && typeof c[method] === 'function') this.safeCall(c, method, [arg]);
      }
      if (g.GetComponent('Rigidbody')) break;
    }
  }

  pick(x, y) {
    const cam = this.activeCamera();
    if (!cam) return null;
    this.raycaster.setFromCamera(new THREE.Vector2((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1), cam);
    const hits = this.raycaster.intersectObjects(this.scene.children, true);
    for (const hh of hits) {
      if (hh.object.isPoints || !hh.object.visible) continue;
      let o = hh.object;
      while (o && !o.userData.rgo) o = o.parent;
      if (o && o.userData.rgo.activeInHierarchy) return o.userData.rgo;
    }
    return null;
  }
  handleMouse() {
    const inp = this.input;
    for (const p of inp.pendingDown) {
      const go = this.pick(p.x, p.y);
      if (go) {
        this.mouseTarget = go;
        this.sendMessage(go, 'OnMouseDown', []);
      }
    }
    if (this.mouseTarget) {
      if (inp.mouse.up[0]) {
        const go = this.mouseTarget;
        this.mouseTarget = null;
        this.sendMessage(go, 'OnMouseUp', []);
        if (this.pick(inp.mouse.x, inp.mouse.y) === go) this.sendMessage(go, 'OnMouseUpAsButton', []);
      } else if (inp.mouse.buttons[0]) this.sendMessage(this.mouseTarget, 'OnMouseDrag', []);
    }
  }

  switchScene(ref) {
    const scene = this.findScene(ref);
    if (!scene) {
      this.warn(`LoadScene : scène « ${ref} » introuvable`);
      return;
    }
    for (const go of this.objects.slice()) {
      if (go._destroyed) continue;
      const isRoot = !(go.obj.parent && go.obj.parent.userData.rgo);
      if (isRoot && !go._dontDestroy) this.destroyGO(go);
    }
    this.behaviours = this.behaviours.filter((b) => !b._removed);
    this.toStart = this.toStart.filter((b) => !b._removed);
    this.objects = this.objects.filter((g) => !g._destroyed);
    this.coroutines = this.coroutines.filter((c) => !c.b._removed);
    this.debugLines = [];
    this.mouseTarget = null;
    this.loadScene(scene);
  }

  // ------------------------------------------------------------ rendu
  mainCamera() {
    let best = null;
    for (const go of this.objects) {
      if (go._destroyed || !go.activeInHierarchy) continue;
      for (const c of go.components) {
        if (c instanceof Camera && c.enabled && c._cam) {
          if (c._data.main) return c;
          best = best || c;
        }
      }
    }
    return best;
  }
  activeCamera() {
    const c = this.mainCamera();
    const cam = c ? c._cam : this.fallbackCam;
    fitCamera(cam, this.width / Math.max(1, this.height));
    return cam;
  }

  resize(w, hh) {
    this.width = Math.max(1, Math.round(w));
    this.height = Math.max(1, Math.round(hh));
    if (this.ownRenderer) this.renderer.setSize(this.width, this.height, false);
    this.ui.resize(this.width, this.height);
  }

  /** Prépare la scène pour un rendu avec la caméra donnée (particules, traînées, lignes) */
  prepareRender(cam, viewH) {
    const dt = this.paused ? 0 : this.t.unscaled * this.t.scale;
    for (const e of this.emitters) {
      if (!e._em) continue;
      const active = e.gameObject.activeInHierarchy && e.enabled;
      e._em.points.visible = active;
      e._em.update(active ? dt : 0, cam, viewH);
    }
    for (const t of this.trails) t._tr && t._tr.update(dt, cam);
    this.updateDebugLines();
  }

  renderFrame() {
    if (this.opts.renderHook) {
      this.opts.renderHook();
      return;
    }
    this.render();
  }

  render(cam) {
    const camComp = cam ? null : this.mainCamera();
    cam = cam || (camComp ? camComp._cam : this.fallbackCam);
    fitCamera(cam, this.width / Math.max(1, this.height));
    if (camComp && camComp._data.clear === 'color') {
      this._bg = this._bg || new THREE.Color();
      this.scene.background = this._bg.set(camComp._data.bg);
    } else this.scene.background = this.scene.userData.envBackground || null;
    const pr = this.renderer.getPixelRatio();
    this.prepareRender(cam, this.height * pr);
    this.renderer.render(this.scene, cam);
  }

  updateDebugLines() {
    const lines = this.debugLines;
    if (!lines.length && !this.lineObj) return;
    if (!this.lineObj) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4000 * 6), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(4000 * 6), 3).setUsage(THREE.DynamicDrawUsage));
      this.lineObj = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }));
      this.lineObj.renderOrder = 999;
      this.lineObj.frustumCulled = false;
      this.scene.add(this.lineObj);
    }
    const P = this.lineObj.geometry.attributes.position.array;
    const C = this.lineObj.geometry.attributes.color.array;
    const n = Math.min(4000, lines.length);
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const l = lines[i];
      P.set([l.a.x, l.a.y, l.a.z, l.b.x, l.b.y, l.b.z], i * 6);
      col.setRGB(l.color.r, l.color.g, l.color.b, THREE.SRGBColorSpace);
      C.set([col.r, col.g, col.b, col.r, col.g, col.b], i * 6);
    }
    this.lineObj.geometry.setDrawRange(0, n * 2);
    this.lineObj.geometry.attributes.position.needsUpdate = true;
    this.lineObj.geometry.attributes.color.needsUpdate = true;
    if (!this.paused) this.debugLines = lines.filter((l) => l.until > this.t.time);
  }

  stats(raw) {
    this.statsFrames++;
    this.statsT += raw;
    if (this.statsT >= 0.5) {
      const info = this.renderer.info.render;
      this.opts.onStats && this.opts.onStats({ fps: Math.round(this.statsFrames / this.statsT), calls: info.calls, tris: info.triangles, objects: this.objects.length, bodies: this.physics.bodies.size });
      this.statsT = 0;
      this.statsFrames = 0;
    }
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    if (RT === this) RT = null;
    this.audio.stopAll();
    this.input.dispose();
    this.ui.dispose();
    this.physics.clear();
    for (const e of this.emitters) e._em && e._em.dispose();
    for (const t of this.trails) t._tr && t._tr.dispose();
    this.scene.traverse((o) => {
      if (o.userData.visuals) for (const v of o.userData.visuals) disposeObject(v);
    });
    if (this.lineObj) disposeObject(this.lineObj);
    this.textures.dispose();
    this.overlay.remove();
    if (this.ownRenderer) {
      this.renderer.dispose();
      this.renderer.domElement.remove();
    }
  }
}

function fmt(v) {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 10000) / 10000);
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (v instanceof Vector3 || v instanceof Vector2 || v instanceof Color || v instanceof Quaternion) return v.toString();
  if (v instanceof GameObject || v instanceof Component || v instanceof Transform || v instanceof PrefabRef) return v.toString();
  if (Array.isArray(v)) return '[' + v.map(fmt).join(', ') + ']';
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v, (k, x) => (x instanceof GameObject ? x.name : x), 0).slice(0, 500);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

export function currentRuntime() {
  return RT;
}
