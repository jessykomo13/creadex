// Construction des objets three.js à partir des données de scène (partagé éditeur / jeu)

import * as THREE from 'three';

export const ICON_LAYER = 1; // icônes & aides visibles seulement dans la vue Scène

export const DEFAULT_ENV = {
  sky: 'gradient',
  skyTop: '#3b7bd4',
  skyHorizon: '#bcd8f1',
  skyBottom: '#4d535c',
  bg: '#1f2633',
  ambient: '#ffffff',
  ambientIntensity: 0.55,
  fog: false,
  fogColor: '#bcd8f1',
  fogNear: 25,
  fogFar: 140,
};

// ---------------------------------------------------------------- Géométries

const geoCache = new Map();
export function getGeometry(mesh) {
  let g = geoCache.get(mesh);
  if (g) return g;
  switch (mesh) {
    case 'Sphere': g = new THREE.SphereGeometry(0.5, 32, 20); break;
    case 'Cylinder': g = new THREE.CylinderGeometry(0.5, 0.5, 2, 32); break;
    case 'Capsule': g = new THREE.CapsuleGeometry(0.5, 1, 8, 24); break;
    case 'Cone': g = new THREE.ConeGeometry(0.5, 1, 32); break;
    case 'Plane': g = new THREE.PlaneGeometry(10, 10); g.rotateX(-Math.PI / 2); break;
    case 'Quad': g = new THREE.PlaneGeometry(1, 1); break;
    case 'Torus': g = new THREE.TorusGeometry(0.5, 0.15, 16, 48); break;
    case 'Icosphere': g = new THREE.IcosahedronGeometry(0.5, 0); break;
    case 'Pyramid': g = new THREE.ConeGeometry(0.7071, 1, 4); g.rotateY(Math.PI / 4); break;
    case 'TorusKnot': g = new THREE.TorusKnotGeometry(0.35, 0.12, 120, 16); break;
    default: g = new THREE.BoxGeometry(1, 1, 1);
  }
  g.userData.shared = true;
  geoCache.set(mesh, g);
  return g;
}
const unitPlane = new THREE.PlaneGeometry(1, 1);
unitPlane.userData.shared = true;

// ---------------------------------------------------------------- Textures

export class TextureCache {
  constructor(project, onLoad) {
    this.project = project;
    this.onLoad = onLoad || (() => {});
    this.textures = new Map();
    this.images = new Map();
  }
  findAsset(ref) {
    if (!ref) return null;
    return (this.project.assets || []).find((a) => a.id === ref || a.name === ref) || null;
  }
  loadImage(asset) {
    let rec = this.images.get(asset.id);
    if (!rec) {
      const img = new Image();
      rec = { img, ready: false, waiters: [] };
      img.onload = () => {
        rec.ready = true;
        rec.waiters.forEach((f) => f(img));
        rec.waiters = [];
        this.onLoad();
      };
      img.src = asset.data;
      this.images.set(asset.id, rec);
    }
    return rec;
  }
  get(ref, { repeat = [1, 1], nearest = false } = {}) {
    const asset = this.findAsset(ref);
    if (!asset) return null;
    const key = `${asset.id}|${repeat[0]}|${repeat[1]}|${nearest ? 1 : 0}`;
    let tex = this.textures.get(key);
    if (tex) return tex;
    tex = new THREE.Texture();
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0] || 1, repeat[1] || 1);
    if (nearest) {
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
    }
    const rec = this.loadImage(asset);
    const apply = (img) => {
      tex.image = img;
      tex.needsUpdate = true;
    };
    if (rec.ready) apply(rec.img);
    else rec.waiters.push(apply);
    tex.userData.aspect = () => (tex.image ? tex.image.width / tex.image.height : 1);
    this.textures.set(key, tex);
    return tex;
  }
  invalidate() {
    for (const t of this.textures.values()) t.dispose();
    this.textures.clear();
    this.images.clear();
  }
  dispose() {
    this.invalidate();
  }
}

const shapeTexCache = new Map();
/** Textures générées pour les sprites sans image (cercle, triangle…) */
export function getShapeTexture(shape) {
  if (shape === 'Square' || !shape) return null;
  let t = shapeTexCache.get(shape);
  if (t) return t;
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#fff';
  g.beginPath();
  const c = S / 2;
  const poly = (n, r, rot = -Math.PI / 2, inner = 0) => {
    const pts = inner ? n * 2 : n;
    for (let i = 0; i < pts; i++) {
      const a = rot + (i / pts) * Math.PI * 2;
      const rr = inner && i % 2 ? inner : r;
      const x = c + Math.cos(a) * rr, y = c + Math.sin(a) * rr;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath();
  };
  switch (shape) {
    case 'Circle': g.arc(c, c, c - 2, 0, Math.PI * 2); break;
    case 'Triangle': g.moveTo(c, 2); g.lineTo(S - 2, S - 2); g.lineTo(2, S - 2); g.closePath(); break;
    case 'Hexagon': poly(6, c - 1, 0); break;
    case 'Diamond': poly(4, c - 1); break;
    case 'Star': poly(5, c - 1, -Math.PI / 2, (c - 1) * 0.45); break;
    case 'Capsule': g.roundRect ? g.roundRect(1, 1, S - 2, S - 2, c / 1.5) : g.rect(1, 1, S - 2, S - 2); break;
    default: g.rect(0, 0, S, S);
  }
  g.fill();
  t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  shapeTexCache.set(shape, t);
  return t;
}

const iconCache = new Map();
export function getIconTexture(emoji) {
  let t = iconCache.get(emoji);
  if (t) return t;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 96;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgba(30,30,34,0.75)';
  g.beginPath();
  g.arc(48, 48, 44, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.8)';
  g.lineWidth = 4;
  g.stroke();
  g.font = '52px "Apple Color Emoji","Segoe UI Emoji",sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(emoji, 48, 52);
  t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  iconCache.set(emoji, t);
  return t;
}

export function makeTextCanvas(c) {
  const lines = String(c.text ?? '').split('\n');
  const fs = 72;
  const font = `${c.bold ? 'bold ' : ''}${fs}px -apple-system, "Segoe UI", Roboto, sans-serif`;
  const cv = document.createElement('canvas');
  let g = cv.getContext('2d');
  g.font = font;
  const w = Math.max(8, ...lines.map((l) => g.measureText(l).width));
  const pad = 16;
  cv.width = Math.ceil(w + pad * 2);
  cv.height = Math.ceil(lines.length * fs * 1.2 + pad * 2);
  g = cv.getContext('2d');
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((l, i) => {
    const y = pad + fs * 0.6 + i * fs * 1.2;
    if (c.outline) {
      g.lineWidth = 10;
      g.strokeStyle = 'rgba(0,0,0,0.85)';
      g.lineJoin = 'round';
      g.strokeText(l, cv.width / 2, y);
    }
    g.fillStyle = '#fff';
    g.fillText(l, cv.width / 2, y);
  });
  return { canvas: cv, lines: lines.length };
}

// ---------------------------------------------------------------- Ciel / environnement

const skyCache = new Map();
function getSkyTexture(top, hor, bot) {
  const key = top + hor + bot;
  let t = skyCache.get(key);
  if (t) return t;
  const cv = document.createElement('canvas');
  cv.width = 4;
  cv.height = 256;
  const g = cv.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, top);
  grd.addColorStop(0.47, hor);
  grd.addColorStop(0.53, hor);
  grd.addColorStop(1, bot);
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 256);
  t = new THREE.CanvasTexture(cv);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  if (skyCache.size > 12) skyCache.clear();
  skyCache.set(key, t);
  return t;
}

export function applyEnvironment(scene, env0) {
  const env = { ...DEFAULT_ENV, ...(env0 || {}) };
  scene.userData.envBackground = env.sky === 'gradient' ? getSkyTexture(env.skyTop, env.skyHorizon, env.skyBottom) : new THREE.Color(env.bg);
  scene.background = scene.userData.envBackground;
  scene.fog = env.fog ? new THREE.Fog(env.fogColor, env.fogNear, env.fogFar) : null;
  let amb = scene.userData.ambient;
  if (!amb) {
    amb = new THREE.AmbientLight();
    scene.userData.ambient = amb;
    scene.add(amb);
  }
  amb.color.set(env.ambient);
  amb.intensity = env.ambientIntensity * 1.6;
}

// ---------------------------------------------------------------- Transforms

const D2R = Math.PI / 180;
export function applyTransform(obj, t) {
  obj.position.set(t.p[0], t.p[1], t.p[2]);
  obj.rotation.set(t.r[0] * D2R, t.r[1] * D2R, t.r[2] * D2R, 'XYZ');
  obj.scale.set(t.s[0], t.s[1], t.s[2]);
}
export function readTransform(obj) {
  const r = (v) => Math.round(v * 10000) / 10000;
  return {
    p: [r(obj.position.x), r(obj.position.y), r(obj.position.z)],
    r: [r(obj.rotation.x / D2R), r(obj.rotation.y / D2R), r(obj.rotation.z / D2R)],
    s: [r(obj.scale.x), r(obj.scale.y), r(obj.scale.z)],
  };
}

// ---------------------------------------------------------------- Composants visuels

export function makeMeshMaterial(c, ctx) {
  const params = {
    color: new THREE.Color(c.color || '#ffffff'),
    transparent: (c.opacity ?? 1) < 1,
    opacity: c.opacity ?? 1,
    wireframe: !!c.wireframe,
    side: c.mesh === 'Plane' || c.mesh === 'Quad' ? THREE.DoubleSide : THREE.FrontSide,
  };
  let m;
  if (c.unlit) m = new THREE.MeshBasicMaterial(params);
  else
    m = new THREE.MeshStandardMaterial({
      ...params,
      metalness: c.metalness ?? 0,
      roughness: c.roughness ?? 0.6,
      emissive: new THREE.Color(c.emissive || '#000000'),
      emissiveIntensity: c.emissiveIntensity ?? 1,
      flatShading: !!c.flatShading,
    });
  if (c.texture && ctx.textures) {
    const tex = ctx.textures.get(c.texture, { repeat: c.tiling || [1, 1] });
    if (tex) m.map = tex;
  }
  return m;
}

function makeSpriteMesh(c, ctx) {
  let map = null;
  if (c.image && ctx.textures) map = ctx.textures.get(c.image, { nearest: c.pixelated });
  if (!map) map = getShapeTexture(c.shape);
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(c.color || '#ffffff'),
    map,
    transparent: true,
    alphaTest: 0.02,
    side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(unitPlane, mat);
  const sz = c.size || [1, 1];
  m.scale.set(sz[0] * (c.flipX ? -1 : 1), sz[1] * (c.flipY ? -1 : 1), 1);
  m.renderOrder = c.order || 0;
  if (c.billboard) setBillboard(m);
  return m;
}

const _bq = new THREE.Quaternion();
export function setBillboard(mesh) {
  mesh.onBeforeRender = (r, s, cam) => {
    const parent = mesh.parent;
    if (parent) {
      parent.getWorldQuaternion(_bq).invert();
      mesh.quaternion.copy(_bq.multiply(cam.quaternion));
    } else mesh.quaternion.copy(cam.quaternion);
    mesh.updateMatrixWorld(true);
  };
}

export function makeText3D(c) {
  const { canvas, lines } = makeTextCanvas(c);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.userData.owned = true;
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(c.color || '#fff'), transparent: true, side: THREE.DoubleSide, depthWrite: false });
  const m = new THREE.Mesh(unitPlane, mat);
  const hgt = (c.size || 1) * lines * 1.2 + (c.size || 1) * 0.45;
  m.scale.set((hgt * canvas.width) / canvas.height, hgt, 1);
  if (c.billboard) setBillboard(m);
  return m;
}

export function makeLight(c, ctx) {
  const color = new THREE.Color(c.color || '#ffffff');
  let light, holder;
  switch (c.kind) {
    case 'Point':
      light = new THREE.PointLight(color, (c.intensity ?? 1) * Math.max(1, (c.range * c.range) / 4), c.range || 0, 2);
      if (c.shadows && ctx.shadows) {
        light.castShadow = true;
        light.shadow.mapSize.set(512, 512);
        light.shadow.bias = -0.002;
      }
      holder = light;
      break;
    case 'Spot': {
      light = new THREE.SpotLight(color, (c.intensity ?? 1) * Math.max(1, (c.range * c.range) / 4), c.range || 0, (c.angle || 30) * D2R, 0.35, 2);
      light.target.position.set(0, 0, -1);
      holder = new THREE.Group();
      holder.add(light, light.target);
      if (c.shadows && ctx.shadows) {
        light.castShadow = true;
        light.shadow.mapSize.set(1024, 1024);
        light.shadow.bias = -0.0015;
      }
      break;
    }
    case 'Hemisphere':
      light = new THREE.HemisphereLight(color, new THREE.Color(c.groundColor || '#333'), (c.intensity ?? 1) * 1.5);
      holder = light;
      break;
    default: {
      light = new THREE.DirectionalLight(color, (c.intensity ?? 1) * 1.6);
      // la lumière est reculée le long de +Z pour que l'ombre couvre la scène
      light.position.set(0, 0, 40);
      light.target.position.set(0, 0, 0);
      holder = new THREE.Group();
      holder.add(light, light.target);
      if (c.shadows && ctx.shadows) {
        light.castShadow = true;
        const s = light.shadow;
        s.mapSize.set(2048, 2048);
        s.camera.left = s.camera.bottom = -28;
        s.camera.right = s.camera.top = 28;
        s.camera.near = 1;
        s.camera.far = 120;
        s.bias = -0.0008;
        s.normalBias = 0.02;
      }
    }
  }
  holder.userData.light = light;
  return holder;
}

export function makeCamera(c) {
  let cam;
  if (c.ortho) {
    const s = c.orthoSize || 5;
    cam = new THREE.OrthographicCamera(-s, s, s, -s, c.near ?? 0.1, c.far ?? 1000);
  } else cam = new THREE.PerspectiveCamera(c.fov || 60, 1, c.near ?? 0.1, c.far ?? 1000);
  cam.userData.comp = c;
  return cam;
}

export function fitCamera(cam, aspect) {
  const c = cam.userData.comp || {};
  if (cam.isOrthographicCamera) {
    const s = c.orthoSize || 5;
    cam.left = -s * aspect;
    cam.right = s * aspect;
    cam.top = s;
    cam.bottom = -s;
  } else cam.aspect = aspect;
  cam.updateProjectionMatrix();
}

const _ws = new THREE.Vector3();
function makeIcon(emoji) {
  const mat = new THREE.SpriteMaterial({ map: getIconTexture(emoji), depthTest: false, depthWrite: false, sizeAttenuation: false, transparent: true });
  const s = new THREE.Sprite(mat);
  s.scale.set(0.07, 0.07, 1);
  s.renderOrder = 1000;
  s.layers.set(ICON_LAYER);
  s.userData.isIcon = true;
  s.onBeforeRender = () => {
    if (!s.parent) return;
    s.parent.getWorldScale(_ws);
    s.scale.set(0.07 / (Math.abs(_ws.x) || 1), 0.07 / (Math.abs(_ws.y) || 1), 1);
    s.updateMatrixWorld();
  };
  return s;
}

/**
 * (Re)construit les éléments visuels d'un GameObject dans son groupe three.js.
 * ctx = { mode: 'editor'|'runtime', textures: TextureCache, shadows: bool }
 */
export function buildVisuals(group, go, ctx) {
  const old = group.userData.visuals || [];
  for (const v of old) {
    group.remove(v);
    disposeObject(v);
  }
  const visuals = [];
  const refs = {};
  let hasVisible = false;
  const add = (o, c) => {
    if (c && c.enabled === false) o.visible = false;
    o.userData.goId = go.id;
    o.traverse((x) => (x.userData.goId = go.id));
    group.add(o);
    visuals.push(o);
    return o;
  };
  for (const c of go.c) {
    switch (c.type) {
      case 'MeshRenderer': {
        const mesh = new THREE.Mesh(getGeometry(c.mesh), makeMeshMaterial(c, ctx));
        mesh.castShadow = !!c.castShadows;
        mesh.receiveShadow = !!c.receiveShadows;
        refs.mesh = add(mesh, c);
        hasVisible = true;
        break;
      }
      case 'SpriteRenderer':
        refs.sprite = add(makeSpriteMesh(c, ctx), c);
        hasVisible = true;
        break;
      case 'Text3D':
        refs.text3d = add(makeText3D(c), c);
        hasVisible = true;
        break;
      case 'Light': {
        const l = makeLight(c, ctx);
        refs.light = l.userData.light;
        add(l, c);
        if (ctx.mode === 'editor') add(makeIcon(c.kind === 'Directional' ? '☀️' : c.kind === 'Spot' ? '🔦' : c.kind === 'Hemisphere' ? '🌗' : '💡'));
        break;
      }
      case 'Camera': {
        const cam = makeCamera(c);
        refs.camera = add(cam, c);
        if (ctx.mode === 'editor') add(makeIcon('🎥'));
        break;
      }
      case 'ParticleSystem':
        if (ctx.mode === 'editor') add(makeIcon('✨'));
        break;
      case 'AudioSource':
        if (ctx.mode === 'editor' && !hasVisible) add(makeIcon('🔊'));
        break;
    }
  }
  group.userData.visuals = visuals;
  group.userData.refs = refs;
  return refs;
}

export function disposeObject(o) {
  o.traverse((x) => {
    if (x.geometry && !x.geometry.userData.shared) x.geometry.dispose();
    if (x.material) {
      const mats = Array.isArray(x.material) ? x.material : [x.material];
      for (const m of mats) {
        if (m.map && m.map.userData.owned) m.map.dispose();
        m.dispose();
      }
    }
    if (x.isLight && x.shadow && x.shadow.map) x.shadow.map.dispose();
  });
}

/** Ordonne une liste plate d'objets pour que chaque parent précède ses enfants. */
export function sortByHierarchy(objects) {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const out = [];
  const seen = new Set();
  const visit = (o) => {
    if (seen.has(o.id)) return;
    seen.add(o.id);
    if (o.parent && byId.has(o.parent)) visit(byId.get(o.parent));
    out.push(o);
  };
  objects.forEach(visit);
  return out;
}
