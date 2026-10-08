// Vue Scène / vue Jeu de l'éditeur (three.js + gizmos tactiles)

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { buildVisuals, applyTransform, readTransform, applyEnvironment, TextureCache, fitCamera, sortByHierarchy, disposeObject, ICON_LAYER } from '../builder.js';
import { UILayer } from '../uilayer.js';
import { h, toast } from '../util.js';
import { Prefs } from '../storage.js';
import { Camera } from '../runtime.js';

const D2R = Math.PI / 180;

function makeGrid(is2D) {
  const g = new THREE.Group();
  const minor = new THREE.GridHelper(200, 200, 0x3a3f4a, 0x3a3f4a);
  minor.material.transparent = true;
  minor.material.opacity = 0.35;
  minor.material.depthWrite = false;
  const major = new THREE.GridHelper(200, 20, 0x5c6470, 0x5c6470);
  major.material.transparent = true;
  major.material.opacity = 0.55;
  major.material.depthWrite = false;
  g.add(minor, major);
  const axes = new THREE.Group();
  const line = (a, b, c) => {
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.8 }));
    axes.add(l);
  };
  line(new THREE.Vector3(-100, 0.001, 0), new THREE.Vector3(100, 0.001, 0), 0xd94a4a);
  if (is2D) line(new THREE.Vector3(0, -100, 0.001), new THREE.Vector3(0, 100, 0.001), 0x5fbf4a);
  else line(new THREE.Vector3(0, 0.001, -100), new THREE.Vector3(0, 0.001, 100), 0x4a7bd9);
  g.add(axes);
  if (is2D) {
    minor.rotation.x = Math.PI / 2;
    major.rotation.x = Math.PI / 2;
    g.position.z = -90;
  }
  g.traverse((o) => o.layers.set(ICON_LAYER));
  return g;
}

// ---------------------------------------------------------------- champ de vision des caméras
const FRUSTUM_COLOR = 0xffffff;
const FRUSTUM_SELECTED = 0xffc23d;
const _fp = new THREE.Vector3();
const _fq = new THREE.Quaternion();
const _fs = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);

// traits épais (les lignes WebGL font 1 pixel, invisibles sur iPhone) :
// contour sombre + trait clair devant les objets, trait léger à travers les objets
function makeFrustumLines() {
  const mat = (color, linewidth, opacity, depthTest) => new LineMaterial({ color, linewidth, opacity, transparent: true, depthTest, depthWrite: false });
  const outline = new LineSegments2(new LineSegmentsGeometry(), mat(0x000000, 4.5, 0.35, true));
  const solid = new LineSegments2(outline.geometry, mat(FRUSTUM_COLOR, 2.2, 0.95, true));
  const faint = new LineSegments2(outline.geometry, mat(FRUSTUM_COLOR, 1.6, 0.3, false));
  const lines = [faint, outline, solid];
  lines.forEach((l, i) => {
    l.layers.set(ICON_LAYER);
    l.frustumCulled = false;
    l.matrixAutoUpdate = false;
    l.renderOrder = 994 + i;
  });
  return { lines, solid, local: new Float32Array(0), count: 0, key: '' };
}

/** Lignes du champ de vision (repère local de la caméra, échelle ignorée) */
function setFrustum(f, cam, comp, aspect, selected, w, h) {
  const c = cam.userData.comp || comp || {};
  const near = Math.max(0.01, c.near ?? 0.1);
  const far = Math.max(near + 0.1, Math.min(c.far ?? 1000, 30));
  const ortho = !!cam.isOrthographicCamera;
  const fov = cam.fov || c.fov || 60;
  const key = [ortho, fov, c.orthoSize, near, far, aspect.toFixed(4)].join('|');
  if (key !== f.key) {
    f.key = key;
    const pts = [];
    const seg = (a, b) => pts.push(...a, ...b);
    const rect = (hw, hh, z) => {
      const q = [[-hw, -hh, z], [hw, -hh, z], [hw, hh, z], [-hw, hh, z]];
      for (let i = 0; i < 4; i++) seg(q[i], q[(i + 1) % 4]);
      return q;
    };
    if (ortho) {
      const hh = c.orthoSize || 5;
      const a = rect(hh * aspect, hh, -near);
      const b = rect(hh * aspect, hh, -far);
      for (let i = 0; i < 4; i++) seg(a[i], b[i]);
    } else {
      const hh = Math.tan((fov * Math.PI) / 360) * far;
      const b = rect(hh * aspect, hh, -far);
      for (let i = 0; i < 4; i++) seg([0, 0, 0], b[i]);
    }
    f.local = new Float32Array(pts);
    f.count = pts.length / 3;
    const old = f.solid.geometry;
    const geo = new LineSegmentsGeometry().setPositions(f.local);
    for (const l of f.lines) l.geometry = geo;
    old.dispose();
  }
  cam.updateWorldMatrix(true, false);
  cam.matrixWorld.decompose(_fp, _fq, _fs);
  for (const l of f.lines) {
    l.matrix.compose(_fp, _fq, ONE);
    l.matrixWorldNeedsUpdate = true;
    l.material.resolution.set(w, h);
  }
  f.lines[0].material.color.setHex(selected ? FRUSTUM_SELECTED : FRUSTUM_COLOR);
  f.solid.material.color.setHex(selected ? FRUSTUM_SELECTED : FRUSTUM_COLOR);
}

function disposeFrustum(f) {
  f.solid.geometry.dispose();
  for (const l of f.lines) l.material.dispose();
}

function shownInScene(o) {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
}

export class SceneView {
  constructor(editor, host) {
    this.ed = editor;
    this.host = host;
    const set = editor.project.settings;
    this.renderer = new THREE.WebGLRenderer({ antialias: set.antialias !== false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, set.pixelRatio || 2));
    this.renderer.shadowMap.enabled = set.shadows !== false;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'sv-canvas';
    host.appendChild(this.canvas);

    this.scene = new THREE.Scene();
    this.helpers = new THREE.Group();
    this.scene.add(this.helpers);
    this.is2D = !!set.is2D;
    this.grid = makeGrid(this.is2D);
    this.helpers.add(this.grid);

    this.persp = new THREE.PerspectiveCamera(50, 1, 0.05, 5000);
    this.persp.position.set(8, 7, 11);
    this.persp.layers.enable(ICON_LAYER);
    this.ortho = new THREE.OrthographicCamera(-8, 8, 6, -6, -2000, 2000);
    this.ortho.position.set(0, 0, 100);
    this.ortho.layers.enable(ICON_LAYER);

    this.orbit = new OrbitControls(this.persp, this.canvas);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.14;
    this.orbit.screenSpacePanning = true;
    this.orbit.zoomToCursor = true;
    this.orbit2 = new OrbitControls(this.ortho, this.canvas);
    this.orbit2.enableRotate = false;
    this.orbit2.screenSpacePanning = true;
    this.orbit2.zoomToCursor = true;
    this.orbit2.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.orbit2.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
    this.orbit.addEventListener('change', () => this.requestRender());
    this.orbit2.addEventListener('change', () => this.requestRender());

    this.gizmo = new TransformControls(this.persp, this.canvas);
    this.gizmo.setSize(1.25);
    this.gizmoHelper = this.gizmo.getHelper();
    this.scene.add(this.gizmoHelper);
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.dragging = e.value;
      this.updateControls();
    });
    this.gizmo.addEventListener('mouseDown', () => {
      this.gizmoTouched = true;
    });
    this.gizmo.addEventListener('objectChange', () => this.onGizmoChange());
    this.gizmo.addEventListener('mouseUp', () => {
      setTimeout(() => (this.gizmoTouched = false), 50);
      if (this.gizmoChanged) {
        this.gizmoChanged = false;
        this.ed.commit('Transformer');
      }
    });

    this.selBox = new THREE.BoxHelper(undefined, 0xffa22b);
    this.selBox.material.depthTest = false;
    this.selBox.material.transparent = true;
    this.selBox.renderOrder = 998;
    this.selBox.layers.set(ICON_LAYER);
    this.selBox.visible = false;
    this.helpers.add(this.selBox);
    this.frusta = new THREE.Group();
    this.helpers.add(this.frusta);
    this.arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(), 2, 0xffe066, 0.4, 0.25);
    this.arrow.traverse((o) => o.layers.set(ICON_LAYER));
    this.arrow.visible = false;
    this.helpers.add(this.arrow);
    this.colBox = new THREE.Group();
    this.helpers.add(this.colBox);

    this.goMap = new Map();
    this.textures = new TextureCache(editor.project, () => this.requestRender());
    this.ctx = { mode: 'editor', textures: this.textures, shadows: true };
    this.mode = 'scene';
    this.tool = 'move';
    this.space = 'world';
    this.snap = false;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.layers.enableAll();
    this.needsRender = true;
    this.uiPreview = null;
    this.pip = { on: Prefs.get('camPreview') !== false, big: !!Prefs.get('camPreviewBig'), fx: Prefs.get('camPreviewX') ?? 1, fy: Prefs.get('camPreviewY') ?? 1, key: '' };
    this.buildPip();

    this.setMode2D(this.is2D, true);
    this.bindPointer();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  get camera() {
    return this.is2D ? this.ortho : this.persp;
  }
  get controls() {
    return this.is2D ? this.orbit2 : this.orbit;
  }

  updateControls() {
    const sceneTab = this.mode === 'scene';
    this.orbit.enabled = sceneTab && !this.is2D && !this.dragging;
    this.orbit2.enabled = sceneTab && this.is2D && !this.dragging;
  }

  setMode2D(b, initial = false) {
    this.is2D = !!b;
    this.helpers.remove(this.grid);
    this.grid = makeGrid(this.is2D);
    this.helpers.add(this.grid);
    this.gizmo.camera = this.camera;
    this.updateControls();
    this.applyGizmoAxes();
    if (initial && this.is2D) {
      this.ortho.position.set(0, 0, 100);
      this.orbit2.target.set(0, 0, 0);
      this.ortho.zoom = 1;
      this.ortho.updateProjectionMatrix();
    }
    this.resize();
    this.requestRender();
  }

  applyGizmoAxes() {
    const g = this.gizmo;
    if (this.is2D) {
      if (this.tool === 'rotate') {
        g.showX = false;
        g.showY = false;
        g.showZ = true;
      } else {
        g.showX = true;
        g.showY = true;
        g.showZ = false;
      }
    } else g.showX = g.showY = g.showZ = true;
  }

  setTool(t) {
    this.tool = t;
    if (t !== 'view') this.gizmo.setMode(t === 'move' ? 'translate' : t);
    this.applyGizmoAxes();
    this.attachGizmo();
    this.requestRender();
  }
  setSpace(s) {
    this.space = s;
    this.gizmo.setSpace(s === 'local' ? 'local' : 'world');
    this.requestRender();
  }
  setSnap(b) {
    this.snap = b;
    this.gizmo.setTranslationSnap(b ? (this.is2D ? 0.5 : 0.5) : null);
    this.gizmo.setRotationSnap(b ? 15 * D2R : null);
    this.gizmo.setScaleSnap(b ? 0.1 : null);
  }

  setMode(m) {
    this.mode = m;
    this.updateControls();
    this.attachGizmo();
    this.refreshUIPreview();
    this.requestRender();
  }

  // ------------------------------------------------------------ données → three
  rebuild() {
    for (const e of this.goMap.values()) {
      e.group.removeFromParent();
      for (const v of e.group.userData.visuals || []) disposeObject(v);
    }
    this.goMap.clear();
    this.textures.project = this.ed.project;
    this.textures.invalidate();
    applyEnvironment(this.scene, this.ed.scene.env);
    for (const go of sortByHierarchy(this.ed.scene.objects)) this.syncObject(go, true);
    this.updateSelection();
    this.refreshUIPreview();
    this.requestRender();
  }

  syncAll() {
    const ids = new Set(this.ed.scene.objects.map((o) => o.id));
    for (const [id, e] of this.goMap) {
      if (!ids.has(id)) {
        e.group.removeFromParent();
        for (const v of e.group.userData.visuals || []) disposeObject(v);
        this.goMap.delete(id);
      }
    }
    applyEnvironment(this.scene, this.ed.scene.env);
    for (const go of sortByHierarchy(this.ed.scene.objects)) this.syncObject(go, true);
    this.updateSelection();
    this.refreshUIPreview();
    this.requestRender();
  }

  syncObject(go, quiet = false) {
    let e = this.goMap.get(go.id);
    if (!e) {
      const group = new THREE.Group();
      group.userData.goId = go.id;
      e = { group, sig: '' };
      this.goMap.set(go.id, e);
    }
    applyTransform(e.group, go.t);
    e.group.visible = go.active !== false;
    const pe = go.parent ? this.goMap.get(go.parent) : null;
    const parentObj = pe ? pe.group : this.scene;
    if (e.group.parent !== parentObj) parentObj.add(e.group);
    const sig = JSON.stringify(go.c);
    if (sig !== e.sig) {
      buildVisuals(e.group, go, this.ctx);
      e.sig = sig;
    }
    if (!quiet) {
      if (go.id === this.ed.selection) this.updateSelection();
      this.refreshUIPreview();
    }
    this.requestRender();
  }

  invalidateTextures() {
    this.textures.invalidate();
    for (const e of this.goMap.values()) e.sig = '';
    this.syncAll();
  }

  // ------------------------------------------------------------ sélection & gizmo
  updateSelection() {
    const id = this.ed.selection;
    const e = id && this.goMap.get(id);
    this.selBox.visible = false;
    this.arrow.visible = false;
    this.colBox.clear();
    if (e) {
      const box = new THREE.Box3().setFromObject(e.group);
      if (!box.isEmpty()) {
        this.selBox.setFromObject(e.group);
        this.selBox.visible = true;
      }
      const go = this.ed.getGO(id);
      const light = go && go.c.find((c) => c.type === 'Light' && (c.kind === 'Directional' || c.kind === 'Spot'));
      if (light) {
        e.group.updateWorldMatrix(true, false);
        const pos = new THREE.Vector3().setFromMatrixPosition(e.group.matrixWorld);
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(e.group.getWorldQuaternion(new THREE.Quaternion()));
        this.arrow.position.copy(pos);
        this.arrow.setDirection(dir);
        this.arrow.visible = true;
      }
      // contours des colliders
      if (go) {
        e.group.updateWorldMatrix(true, false);
        for (const c of go.c) {
          if (c.enabled === false) continue;
          let geo = null;
          if (c.type === 'BoxCollider') geo = new THREE.BoxGeometry(c.size[0], c.size[1], c.size[2]);
          else if (c.type === 'SphereCollider') geo = new THREE.SphereGeometry(c.radius, 16, 10);
          else if (c.type === 'CapsuleCollider') geo = new THREE.CapsuleGeometry(c.radius, Math.max(0, c.height - 2 * c.radius), 4, 12);
          else if (c.type === 'CylinderCollider') geo = new THREE.CylinderGeometry(c.radius, c.radius, c.height, 16);
          if (!geo) continue;
          const wire = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: c.isTrigger ? 0x66ccff : 0x7dff7a, transparent: true, opacity: 0.8, depthTest: false }));
          geo.dispose();
          wire.layers.set(ICON_LAYER);
          wire.renderOrder = 997;
          wire.position.set(...(c.center || [0, 0, 0]));
          const holder = new THREE.Group();
          holder.matrixAutoUpdate = false;
          holder.matrix.copy(e.group.matrixWorld);
          holder.add(wire);
          this.colBox.add(holder);
        }
      }
    }
    this.attachGizmo();
    this.requestRender();
  }

  attachGizmo() {
    const id = this.ed.selection;
    const e = id && this.goMap.get(id);
    const go = id && this.ed.getGO(id);
    const isUI = go && go.c.some((c) => c.type.startsWith('UI'));
    if (e && this.tool !== 'view' && this.mode === 'scene' && !this.ed.playing && !isUI) {
      this.gizmo.attach(e.group);
      this.gizmoHelper.visible = true;
    } else {
      this.gizmo.detach();
      this.gizmoHelper.visible = false;
    }
  }

  onGizmoChange() {
    const id = this.ed.selection;
    const e = id && this.goMap.get(id);
    const go = id && this.ed.getGO(id);
    if (!e || !go) return;
    go.t = readTransform(e.group);
    this.gizmoChanged = true;
    this.selBox.setFromObject(e.group);
    this.ed.onTransformLive(go);
    this.requestRender();
  }

  // ------------------------------------------------------------ pointeur
  bindPointer() {
    let down = null;
    let count = 0;
    let lastTap = 0;
    this.canvas.addEventListener('pointerdown', (e) => {
      count++;
      if (count === 1) down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
      else down = null;
    });
    const up = (e) => {
      count = Math.max(0, count - 1);
      if (!down || e.pointerId !== down.id) return;
      const d = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const dt = performance.now() - down.t;
      down = null;
      if (d > 8 || dt > 600 || this.gizmoTouched || this.dragging || this.mode !== 'scene') return;
      const id = this.pick(e.clientX, e.clientY);
      const now = performance.now();
      if (id && id === this.ed.selection && now - lastTap < 350) this.focus(id);
      lastTap = now;
      this.ed.select(id || null, 'view');
    };
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', () => {
      count = Math.max(0, count - 1);
      down = null;
    });
  }

  pick(cx, cy) {
    if (this.ed.playing) return null;
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const targets = [...this.goMap.values()].filter((e) => e.group.visible).map((e) => e.group);
    const hits = this.raycaster.intersectObjects(targets, true);
    // les icônes ont la priorité
    const icon = hits.find((hh) => hh.object.userData.isIcon);
    const mesh = hits.find((hh) => hh.object.isMesh && hh.object.visible);
    if (!icon) {
      const cam = this.pickFrustum(cx - r.left, cy - r.top, r.width, r.height, mesh ? mesh.distance : Infinity);
      if (cam) return cam;
    }
    const hit = icon || mesh;
    if (!hit) return null;
    let o = hit.object;
    while (o && !o.userData.goId) o = o.parent;
    return o ? o.userData.goId : null;
  }

  /** Caméra dont une ligne du champ de vision passe sous le doigt (px CSS) */
  pickFrustum(px, py, W, H, maxDist) {
    const map = this.frusta.userData.map;
    if (!map || !this.frusta.visible) return null;
    const cam = this.camera;
    cam.updateMatrixWorld();
    const a = new THREE.Vector3(), b = new THREE.Vector3(), va = new THREE.Vector3(), vb = new THREE.Vector3();
    const toScreen = (v) => {
      const p = v.clone().project(cam);
      return [((p.x + 1) / 2) * W, ((1 - p.y) / 2) * H];
    };
    let best = null;
    let bestD = 10;
    for (const [id, f] of map) {
      const arr = f.local;
      const m = f.solid.matrixWorld;
      for (let i = 0; i < f.count; i += 2) {
        a.fromArray(arr, i * 3).applyMatrix4(m);
        b.fromArray(arr, i * 3 + 3).applyMatrix4(m);
        va.copy(a).applyMatrix4(cam.matrixWorldInverse);
        vb.copy(b).applyMatrix4(cam.matrixWorldInverse);
        if (!cam.isOrthographicCamera && (va.z > -cam.near || vb.z > -cam.near)) continue;
        const [ax, ay] = toScreen(a);
        const [bx, by] = toScreen(b);
        const dx = bx - ax, dy = by - ay;
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
        const d = Math.hypot(ax + t * dx - px, ay + t * dy - py);
        if (d >= bestD) continue;
        const dist = a.clone().lerp(b, t).distanceTo(cam.position);
        if (!cam.isOrthographicCamera && dist > maxDist) continue;
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  /** Met à jour les lignes : items = [{ id, cam, comp, selected }] */
  updateFrusta(group, items, w, h) {
    const map = group.userData.map || (group.userData.map = new Map());
    const seen = new Set();
    for (const it of items) {
      seen.add(it.id);
      let f = map.get(it.id);
      if (!f) {
        f = makeFrustumLines();
        map.set(it.id, f);
        group.add(...f.lines);
      }
      setFrustum(f, it.cam, it.comp, w / h, it.selected, w, h);
    }
    for (const [id, f] of map) {
      if (seen.has(id)) continue;
      group.remove(...f.lines);
      disposeFrustum(f);
      map.delete(id);
    }
  }

  editorFrustumItems() {
    const items = [];
    if (Prefs.get('camFrustum') === false) return items;
    for (const go of this.ed.scene.objects) {
      const comp = go.c.find((c) => c.type === 'Camera');
      if (!comp) continue;
      const e = this.goMap.get(go.id);
      const cam = e && e.group.userData.refs && e.group.userData.refs.camera;
      const selected = go.id === this.ed.selection;
      if (!cam || (!selected && (comp.enabled === false || !shownInScene(e.group)))) continue;
      items.push({ id: go.id, cam, comp, selected });
    }
    return items;
  }

  playFrustumItems(rt) {
    const items = [];
    if (Prefs.get('camFrustum') === false) return items;
    for (const go of rt.objects) {
      if (go._destroyed || !go.activeInHierarchy) continue;
      for (const c of go.components) if (c instanceof Camera && c.enabled && c._cam) items.push({ id: c, cam: c._cam, comp: c._data, selected: false });
    }
    return items;
  }

  focus(id) {
    const e = this.goMap.get(id);
    if (!e) return;
    const box = new THREE.Box3().setFromObject(e.group);
    const center = new THREE.Vector3();
    let size = 2;
    if (box.isEmpty()) e.group.getWorldPosition(center);
    else {
      box.getCenter(center);
      size = Math.max(0.5, box.getSize(new THREE.Vector3()).length());
    }
    if (this.is2D) {
      this.orbit2.target.set(center.x, center.y, 0);
      this.ortho.position.set(center.x, center.y, 100);
      const [, h] = this.viewSize();
      this.ortho.zoom = Math.max(0.05, Math.min(20, 12 / (size * 2)));
      void h;
      this.ortho.updateProjectionMatrix();
      this.orbit2.update();
    } else {
      const dir = this.persp.position.clone().sub(this.orbit.target).normalize();
      this.orbit.target.copy(center);
      this.persp.position.copy(center).add(dir.multiplyScalar(size * 1.6 + 1));
      this.orbit.update();
    }
    this.requestRender();
  }

  /** Point devant la caméra où placer un nouvel objet */
  spawnPoint() {
    if (this.is2D) return [Math.round(this.orbit2.target.x * 2) / 2, Math.round(this.orbit2.target.y * 2) / 2, 0];
    const t = this.orbit.target;
    return [Math.round(t.x * 2) / 2, Math.max(0, Math.round(t.y * 2) / 2), Math.round(t.z * 2) / 2];
  }

  // ------------------------------------------------------------ rendu
  viewSize() {
    return [Math.max(1, this.host.clientWidth), Math.max(1, this.host.clientHeight)];
  }

  resize() {
    const [w, h] = this.viewSize();
    this.renderer.setSize(w, h, false);
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    const hh = 6;
    this.ortho.left = -hh * (w / h);
    this.ortho.right = hh * (w / h);
    this.ortho.top = hh;
    this.ortho.bottom = -hh;
    this.ortho.updateProjectionMatrix();
    if (this.uiPreview) this.uiPreview.resize(w, h);
    if (this.ed.runtime) this.ed.runtime.resize(w, h);
    this.requestRender();
  }

  requestRender() {
    this.needsRender = true;
  }

  gameCamera() {
    let best = null;
    for (const go of this.ed.scene.objects) {
      if (go.active === false) continue;
      const c = go.c.find((x) => x.type === 'Camera' && x.enabled !== false);
      if (!c) continue;
      const e = this.goMap.get(go.id);
      const cam = e && e.group.userData.refs && e.group.userData.refs.camera;
      if (!cam) continue;
      if (c.main) return { cam, comp: c, go };
      best = best || { cam, comp: c, go };
    }
    return best;
  }

  renderEditor() {
    const [w, h] = this.viewSize();
    if (this.mode === 'game') {
      const gc = this.gameCamera();
      this.helpers.visible = false;
      this.gizmoHelper.visible = false;
      const bg = this.scene.background;
      if (gc) {
        fitCamera(gc.cam, w / h);
        if (gc.comp.clear === 'color') this.scene.background = new THREE.Color(gc.comp.bg);
        this.renderer.render(this.scene, gc.cam);
      } else {
        this.renderer.setClearColor(0x000000);
        this.renderer.clear();
      }
      this.scene.background = bg;
      this.helpers.visible = true;
    } else {
      this.updateFrusta(this.frusta, this.editorFrustumItems(), w, h);
      this.renderer.render(this.scene, this.camera);
    }
    this.renderPip(this.scene, w, h);
  }

  /** Appelé par le moteur à chaque image en mode Jeu */
  renderPlay() {
    const rt = this.ed.runtime;
    if (!rt) return;
    const [w, h] = this.viewSize();
    if (this.mode === 'game') rt.render();
    else {
      this.controls.update();
      if (!this.playGrid) {
        this.playGrid = makeGrid(this.is2D);
        rt.scene.add(this.playGrid);
        this.playFrusta = new THREE.Group();
        rt.scene.add(this.playFrusta);
      }
      this.updateFrusta(this.playFrusta, this.playFrustumItems(rt), w, h);
      const cam = this.camera;
      rt.scene.background = rt.scene.userData.envBackground || null;
      rt.prepareRender(cam, h * this.renderer.getPixelRatio());
      this.renderer.render(rt.scene, cam);
    }
    this.renderPip(rt.scene, w, h);
  }

  loop() {
    this.raf = requestAnimationFrame(this.loop);
    if (this.ed.playing || this.disposed) return;
    const changed = this.mode === 'scene' && this.controls.update();
    if (this.needsRender || changed) {
      this.needsRender = false;
      this.renderEditor();
    }
  }

  // ------------------------------------------------------------ aperçu caméra (vue Scène)
  buildPip() {
    const btn = (label, title, fn, cls = '') =>
      h('button.pip-btn' + cls, {
        type: 'button',
        title,
        onclick: (e) => {
          e.stopPropagation();
          fn();
        },
      }, label);
    this.pipLabel = h('span.pip-label');
    this.pipBigBtn = btn(this.pip.big ? '⤡' : '⤢', 'Agrandir / réduire', () => this.setPipBig(!this.pip.big));
    this.pipEl = h(
      'div.cam-pip.hidden',
      h('div.pip-bar', this.pipLabel, btn('📍', 'Placer la caméra comme la vue', () => this.alignCameraToView(), '.pip-align'), this.pipBigBtn, btn('✕', 'Masquer l’aperçu', () => this.setPip(false))),
      h('div.pip-hit', { title: 'Glisser pour déplacer, toucher pour ouvrir la vue Jeu' }),
      h('button.pip-open', { type: 'button', title: 'Afficher l’aperçu de la caméra', onclick: () => this.setPip(true) }, '🎥')
    );
    this.host.appendChild(this.pipEl);
    this.bindPipDrag();
  }

  /** Glisser l'aperçu (barre ou image) pour le déplacer ; un simple toucher sur l'image ouvre la vue Jeu */
  bindPipDrag() {
    const el = this.pipEl;
    let drag = null;
    el.addEventListener('pointerdown', (e) => {
      if (drag || el.classList.contains('mini') || e.target.closest('button')) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, fx: this.pip.fx, fy: this.pip.fy, onImage: !!e.target.closest('.pip-hit'), moved: false };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {}
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 6) return;
      drag.moved = true;
      el.classList.add('dragging');
      const [w, h] = this.viewSize();
      const r = this.pipRect(w, h);
      const clamp = (v) => Math.max(0, Math.min(1, v));
      this.pip.fx = clamp(drag.fx + dx / Math.max(1, r.rangeX));
      this.pip.fy = clamp(drag.fy + dy / Math.max(1, r.rangeY));
      this.requestRender();
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      el.classList.remove('dragging');
      if (e.type === 'pointercancel') return;
      if (d.moved) {
        Prefs.set('camPreviewX', this.pip.fx);
        Prefs.set('camPreviewY', this.pip.fy);
      } else if (d.onImage) this.ed.setViewMode('game');
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  setPip(on) {
    this.pip.on = on;
    Prefs.set('camPreview', on);
    this.requestRender();
  }

  setPipBig(big) {
    this.pip.big = big;
    Prefs.set('camPreviewBig', big);
    this.pipBigBtn.textContent = big ? '⤡' : '⤢';
    this.requestRender();
  }

  /** Caméra montrée dans l'aperçu : celle sélectionnée, sinon la caméra principale */
  pipTarget() {
    if (this.ed.playing) {
      const c = this.ed.runtime && this.ed.runtime.mainCamera();
      return c && c._cam ? { cam: c._cam, comp: c._data, name: c.gameObject.name } : null;
    }
    const go = this.ed.selection && this.ed.getGO(this.ed.selection);
    const comp = go && go.c.find((c) => c.type === 'Camera');
    const e = comp && this.goMap.get(go.id);
    const cam = e && e.group.userData.refs && e.group.userData.refs.camera;
    if (cam) return { cam, comp, name: go.name, goId: go.id };
    const gc = this.gameCamera();
    return gc ? { cam: gc.cam, comp: gc.comp, name: gc.go.name, goId: gc.go.id } : null;
  }

  /** Rectangle de l'aperçu en px CSS (y compté depuis le bas, comme WebGL) */
  pipRect(w, h) {
    const aspect = w / h;
    let pw = this.pip.big ? w * 0.62 : Math.min(300, Math.max(150, w * 0.42));
    let ph = pw / aspect;
    const maxH = (h - 40) * (this.pip.big ? 0.75 : 0.5);
    if (ph > maxH) {
      ph = maxH;
      pw = ph * aspect;
    }
    pw = Math.round(pw);
    ph = Math.round(ph);
    // position choisie en glissant (fractions de l'espace libre ; 1,1 = en bas à droite)
    const m = 8;
    const bar = 26;
    const rangeX = Math.max(0, w - pw - 2 * m);
    const rangeY = Math.max(0, h - ph - bar - 2 * m);
    const left = Math.round(m + this.pip.fx * rangeX);
    const top = Math.round(m + bar + this.pip.fy * rangeY);
    return { x: left, y: h - top - ph, w: pw, h: ph, left, top, rangeX, rangeY };
  }

  renderPip(scene, w, h) {
    // ✕ réduit l'aperçu en une pastille 🎥 ; sans caméra dans la scène, rien n'est affiché
    const t = this.mode === 'scene' ? this.pipTarget() : null;
    const show = !!t && this.pip.on;
    const r = this.pipRect(w, h);
    const key = t ? [this.pip.on, t.name, r.w, r.h, r.left, r.top].join('|') : '';
    if (key !== this.pip.key) {
      this.pip.key = key;
      this.pipEl.classList.toggle('hidden', !t);
      this.pipEl.classList.toggle('mini', !!t && !this.pip.on);
      this.pipLabel.textContent = t ? '🎥 ' + t.name : '';
      const st = this.pipEl.style;
      st.width = show ? r.w + 'px' : '';
      st.height = show ? r.h + 'px' : '';
      st.left = show ? r.left + 'px' : '';
      st.top = show ? r.top + 'px' : '';
      st.right = st.bottom = show ? 'auto' : '';
    }
    if (!show || r.h < 20) return;
    const R = this.renderer;
    const { cam, comp } = t;
    fitCamera(cam, w / h);
    const bg = scene.background;
    if (comp.clear === 'color') scene.background = (this._pipBg = this._pipBg || new THREE.Color()).set(comp.bg);
    else scene.background = scene.userData.envBackground || null;
    const hv = this.helpers.visible;
    const gv = this.gizmoHelper.visible;
    const pg = this.playGrid && this.playGrid.visible;
    this.helpers.visible = false;
    this.gizmoHelper.visible = false;
    if (this.playGrid) this.playGrid.visible = false;
    const pf = this.playFrusta && this.playFrusta.visible;
    if (this.playFrusta) this.playFrusta.visible = false;
    // l'ombre du soleil ne dépend pas de la caméra : on réutilise celle de la vue Scène
    const au = R.shadowMap.autoUpdate;
    R.shadowMap.autoUpdate = false;
    R.setScissorTest(true);
    R.setScissor(r.x, r.y, r.w, r.h);
    R.setViewport(r.x, r.y, r.w, r.h);
    R.render(scene, cam);
    R.setScissorTest(false);
    R.setViewport(0, 0, w, h);
    R.shadowMap.autoUpdate = au;
    this.helpers.visible = hv;
    this.gizmoHelper.visible = gv;
    if (this.playGrid) this.playGrid.visible = pg;
    if (this.playFrusta) this.playFrusta.visible = pf;
    scene.background = bg;
  }

  /** Place la caméra (sélectionnée ou principale) pour qu'elle voie comme la vue Scène */
  alignCameraToView(goId) {
    if (this.ed.playing) return toast('Arrête le jeu pour modifier la scène', 'warn');
    const t = goId ? { goId } : this.pipTarget();
    const go = t && t.goId && this.ed.getGO(t.goId);
    const e = go && this.goMap.get(go.id);
    const comp = go && go.c.find((c) => c.type === 'Camera');
    if (!e || !comp) return toast('Aucune caméra dans la scène', 'warn');
    const g = e.group;
    const parent = g.parent || this.scene;
    parent.updateWorldMatrix(true, false);
    if (this.is2D) {
      const wp = g.getWorldPosition(new THREE.Vector3());
      wp.x = this.orbit2.target.x;
      wp.y = this.orbit2.target.y;
      g.position.copy(parent.worldToLocal(wp));
      if (comp.ortho) comp.orthoSize = Math.round((6 / this.ortho.zoom) * 100) / 100;
    } else {
      // termine l'inertie de la vue pour viser sa position finale
      this.orbit.enableDamping = false;
      this.orbit.update();
      this.orbit.enableDamping = true;
      this.persp.updateMatrixWorld();
      const m = new THREE.Matrix4().copy(parent.matrixWorld).invert().multiply(this.persp.matrixWorld);
      const s = g.scale.clone();
      m.decompose(g.position, g.quaternion, new THREE.Vector3());
      g.scale.copy(s);
    }
    go.t = readTransform(g);
    this.ed.updateGO(go);
    this.ed.onTransformLive(go);
    this.ed.commit('Aligner la caméra');
    const moved = go.c.some((c) => c.type === 'Script');
    toast(moved ? '📍 Caméra placée (son script peut la déplacer en jeu)' : '📍 La caméra voit maintenant comme la vue', 'ok', 2400);
  }

  // ------------------------------------------------------------ aperçu UI (vue Jeu)
  refreshUIPreview() {
    const show = this.mode === 'game' && !this.ed.playing;
    if (!show) {
      if (this.uiPreview) {
        this.uiPreview.dispose();
        this.uiPreview = null;
      }
      return;
    }
    if (!this.uiPreview)
      this.uiPreview = new UILayer(this.host, {
        interactive: false,
        findImage: (ref) => {
          const a = this.ed.project.assets.find((x) => x.id === ref || x.name === ref);
          return a ? a.data : null;
        },
      });
    this.uiPreview.clear();
    const objs = this.ed.scene.objects;
    const byId = new Map(objs.map((o) => [o.id, o]));
    const activeIn = (o) => {
      for (let x = o; x; x = x.parent ? byId.get(x.parent) : null) if (x.active === false) return false;
      return true;
    };
    for (const o of objs) {
      for (const c of o.c) {
        if (!c.type.startsWith('UI')) continue;
        this.uiPreview.add(o.id + c.type, c.type, c);
        this.uiPreview.setVisible(o.id + c.type, activeIn(o));
      }
    }
    const [w, h] = this.viewSize();
    this.uiPreview.resize(w, h);
  }

  // ------------------------------------------------------------ mode Jeu
  onPlayStart() {
    this.gizmo.detach();
    this.gizmoHelper.visible = false;
    this.refreshUIPreview();
  }
  onPlayStop() {
    if (this.playFrusta) this.updateFrusta(this.playFrusta, [], 1, 1);
    this.playGrid = null;
    this.playFrusta = null;
    this.updateControls();
    this.attachGizmo();
    this.refreshUIPreview();
    this.requestRender();
  }

  /** Miniature JPEG de la vue Jeu (pour le Hub) */
  captureThumb() {
    try {
      const gc = this.gameCamera();
      const cam = gc ? gc.cam : this.camera;
      const [w, h] = this.viewSize();
      this.helpers.visible = false;
      this.gizmoHelper.visible = false;
      const bg = this.scene.background;
      if (gc) {
        fitCamera(gc.cam, w / h);
        if (gc.comp.clear === 'color') this.scene.background = new THREE.Color(gc.comp.bg);
      }
      this.renderer.render(this.scene, cam);
      const cv = document.createElement('canvas');
      cv.width = 320;
      cv.height = 200;
      const g = cv.getContext('2d');
      const src = this.canvas;
      const sa = src.width / src.height, da = 320 / 200;
      let sw = src.width, sh = src.height, sx = 0, sy = 0;
      if (sa > da) {
        sw = sh * da;
        sx = (src.width - sw) / 2;
      } else {
        sh = sw / da;
        sy = (src.height - sh) / 2;
      }
      g.drawImage(src, sx, sy, sw, sh, 0, 0, 320, 200);
      this.scene.background = bg;
      this.helpers.visible = true;
      this.requestRender();
      return cv.toDataURL('image/jpeg', 0.72);
    } catch {
      return '';
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.gizmo.dispose();
    this.orbit.dispose();
    this.orbit2.dispose();
    for (const e of this.goMap.values()) for (const v of e.group.userData.visuals || []) disposeObject(v);
    this.textures.dispose();
    if (this.uiPreview) this.uiPreview.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
