// Vue Scène / vue Jeu de l'éditeur (three.js + gizmos tactiles)

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { buildVisuals, applyTransform, readTransform, applyEnvironment, TextureCache, fitCamera, sortByHierarchy, disposeObject, ICON_LAYER } from '../builder.js';
import { UILayer } from '../uilayer.js';

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
    this.camProxy = new THREE.PerspectiveCamera();
    this.camHelper = new THREE.CameraHelper(this.camProxy);
    this.camHelper.layers.set(ICON_LAYER);
    this.camHelper.visible = false;
    this.helpers.add(this.camHelper);
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
    this.camHelper.visible = false;
    this.arrow.visible = false;
    this.colBox.clear();
    if (e) {
      const box = new THREE.Box3().setFromObject(e.group);
      if (!box.isEmpty()) {
        this.selBox.setFromObject(e.group);
        this.selBox.visible = true;
      }
      const go = this.ed.getGO(id);
      const cam = go && go.c.find((c) => c.type === 'Camera');
      if (cam && e.group.userData.refs.camera) {
        const src = e.group.userData.refs.camera;
        const [w, h] = this.viewSize();
        const proxy = cam.ortho ? new THREE.OrthographicCamera() : new THREE.PerspectiveCamera();
        proxy.userData.comp = cam;
        if (!cam.ortho) {
          proxy.fov = cam.fov;
          proxy.near = Math.max(0.1, cam.near);
          proxy.far = Math.min(cam.far, 30);
        } else {
          proxy.near = 0.1;
          proxy.far = Math.min(cam.far, 30);
        }
        fitCamera(proxy, w / Math.max(1, h));
        src.updateWorldMatrix(true, false);
        proxy.matrixWorld.copy(src.matrixWorld);
        proxy.matrixWorld.decompose(proxy.position, proxy.quaternion, proxy.scale);
        this.helpers.remove(this.camHelper);
        this.camHelper.dispose();
        this.camProxy = proxy;
        this.camHelper = new THREE.CameraHelper(proxy);
        this.camHelper.layers.set(ICON_LAYER);
        this.helpers.add(this.camHelper);
        this.camHelper.update();
        this.camHelper.visible = true;
      }
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
    const hit = icon || hits.find((hh) => hh.object.isMesh && hh.object.visible);
    if (!hit) return null;
    let o = hit.object;
    while (o && !o.userData.goId) o = o.parent;
    return o ? o.userData.goId : null;
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
      if (c.main) return { cam, comp: c };
      best = best || { cam, comp: c };
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
      this.renderer.render(this.scene, this.camera);
    }
  }

  /** Appelé par le moteur à chaque image en mode Jeu */
  renderPlay() {
    const rt = this.ed.runtime;
    if (!rt) return;
    if (this.mode === 'game') rt.render();
    else {
      this.controls.update();
      if (!this.playGrid) {
        this.playGrid = makeGrid(this.is2D);
        rt.scene.add(this.playGrid);
      }
      const cam = this.camera;
      rt.scene.background = rt.scene.userData.envBackground || null;
      const [, h] = this.viewSize();
      rt.prepareRender(cam, h * this.renderer.getPixelRatio());
      this.renderer.render(rt.scene, cam);
    }
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
    this.playGrid = null;
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
