// Définition des composants (schéma de l'inspecteur + valeurs par défaut)

import { uid } from './util.js';

export const MESHES = ['Cube', 'Sphere', 'Cylinder', 'Capsule', 'Cone', 'Plane', 'Quad', 'Torus', 'Icosphere', 'Pyramid', 'TorusKnot'];
export const MESH_LABELS = {
  Cube: 'Cube',
  Sphere: 'Sphère',
  Cylinder: 'Cylindre',
  Capsule: 'Capsule',
  Cone: 'Cône',
  Plane: 'Plan',
  Quad: 'Quad',
  Torus: 'Tore',
  Icosphere: 'Gemme',
  Pyramid: 'Pyramide',
  TorusKnot: 'Nœud',
};
export const SPRITE_SHAPES = ['Square', 'Circle', 'Triangle', 'Hexagon', 'Diamond', 'Star', 'Capsule'];
export const SFX = ['coin', 'jump', 'hit', 'explosion', 'laser', 'powerup', 'click', 'blip', 'lose', 'win'];
export const ANCHORS = ['top-left', 'top-center', 'top-right', 'middle-left', 'center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'];
export const DEFAULT_TAGS = ['Untagged', 'Player', 'Enemy', 'Respawn', 'Finish', 'MainCamera', 'GameController', 'Collectible', 'Ground', 'Bullet'];

// Types de champs : num, int, bool, color, sel, vec3, vec2, str, text, image, audio, script, bool3, range, sfx
export const COMPONENTS = {
  MeshRenderer: {
    label: 'Mesh Renderer',
    icon: '🧊',
    cat: 'Rendu',
    unique: true,
    fields: [
      { k: 'mesh', t: 'sel', label: 'Maillage', options: MESHES, labels: MESH_LABELS, d: 'Cube' },
      { k: 'color', t: 'color', label: 'Couleur', d: '#ffffff' },
      { k: 'texture', t: 'image', label: 'Texture', d: '' },
      { k: 'tiling', t: 'vec2', label: 'Répétition', d: [1, 1] },
      { k: 'metalness', t: 'range', label: 'Métal', min: 0, max: 1, d: 0 },
      { k: 'roughness', t: 'range', label: 'Rugosité', min: 0, max: 1, d: 0.6 },
      { k: 'emissive', t: 'color', label: 'Émission', d: '#000000' },
      { k: 'emissiveIntensity', t: 'num', label: 'Intensité émission', d: 1, min: 0 },
      { k: 'opacity', t: 'range', label: 'Opacité', min: 0, max: 1, d: 1 },
      { k: 'unlit', t: 'bool', label: 'Sans éclairage', d: false },
      { k: 'flatShading', t: 'bool', label: 'Facettes', d: false },
      { k: 'wireframe', t: 'bool', label: 'Fil de fer', d: false },
      { k: 'castShadows', t: 'bool', label: 'Projette ombres', d: true },
      { k: 'receiveShadows', t: 'bool', label: 'Reçoit ombres', d: true },
    ],
  },
  SpriteRenderer: {
    label: 'Sprite Renderer',
    icon: '🖼️',
    cat: 'Rendu',
    unique: true,
    fields: [
      { k: 'shape', t: 'sel', label: 'Forme', options: SPRITE_SHAPES, labels: { Square: 'Carré', Circle: 'Cercle', Triangle: 'Triangle', Hexagon: 'Hexagone', Diamond: 'Losange', Star: 'Étoile', Capsule: 'Capsule' }, d: 'Square' },
      { k: 'image', t: 'image', label: 'Image', d: '' },
      { k: 'color', t: 'color', label: 'Couleur', d: '#ffffff' },
      { k: 'size', t: 'vec2', label: 'Taille', d: [1, 1] },
      { k: 'flipX', t: 'bool', label: 'Miroir X', d: false },
      { k: 'flipY', t: 'bool', label: 'Miroir Y', d: false },
      { k: 'pixelated', t: 'bool', label: 'Pixel art', d: true },
      { k: 'billboard', t: 'bool', label: 'Face caméra', d: false },
      { k: 'order', t: 'int', label: 'Ordre', d: 0 },
    ],
  },
  Text3D: {
    label: 'Texte 3D',
    icon: '🔠',
    cat: 'Rendu',
    unique: true,
    fields: [
      { k: 'text', t: 'text', label: 'Texte', d: 'Bonjour !' },
      { k: 'color', t: 'color', label: 'Couleur', d: '#ffffff' },
      { k: 'size', t: 'num', label: 'Taille', d: 1, min: 0.01 },
      { k: 'bold', t: 'bool', label: 'Gras', d: true },
      { k: 'outline', t: 'bool', label: 'Contour', d: true },
      { k: 'billboard', t: 'bool', label: 'Face caméra', d: false },
    ],
  },
  Camera: {
    label: 'Caméra',
    icon: '🎥',
    cat: 'Rendu',
    unique: true,
    fields: [
      { k: 'ortho', t: 'bool', label: 'Orthographique', d: false },
      { k: 'fov', t: 'range', label: 'Champ de vision', min: 10, max: 120, d: 60 },
      { k: 'orthoSize', t: 'num', label: 'Taille ortho', d: 5, min: 0.1 },
      { k: 'near', t: 'num', label: 'Plan proche', d: 0.1, min: 0.001 },
      { k: 'far', t: 'num', label: 'Plan éloigné', d: 1000 },
      { k: 'clear', t: 'sel', label: 'Fond', options: ['skybox', 'color'], labels: { skybox: 'Ciel de la scène', color: 'Couleur unie' }, d: 'skybox' },
      { k: 'bg', t: 'color', label: 'Couleur de fond', d: '#1d2733' },
      { k: 'main', t: 'bool', label: 'Caméra principale', d: true },
    ],
  },
  Light: {
    label: 'Lumière',
    icon: '💡',
    cat: 'Rendu',
    unique: true,
    fields: [
      { k: 'kind', t: 'sel', label: 'Type', options: ['Directional', 'Point', 'Spot', 'Hemisphere'], labels: { Directional: 'Directionnelle', Point: 'Ponctuelle', Spot: 'Projecteur', Hemisphere: 'Hémisphère' }, d: 'Directional' },
      { k: 'color', t: 'color', label: 'Couleur', d: '#fff4e0' },
      { k: 'intensity', t: 'num', label: 'Intensité', d: 1.4, min: 0 },
      { k: 'range', t: 'num', label: 'Portée', d: 12, min: 0 },
      { k: 'angle', t: 'range', label: 'Angle (spot)', min: 1, max: 89, d: 35 },
      { k: 'groundColor', t: 'color', label: 'Couleur sol (hémi)', d: '#3a3a2a' },
      { k: 'shadows', t: 'bool', label: 'Ombres', d: true },
    ],
  },
  Rigidbody: {
    label: 'Rigidbody',
    icon: '🪨',
    cat: 'Physique',
    unique: true,
    fields: [
      { k: 'mass', t: 'num', label: 'Masse', d: 1, min: 0.001 },
      { k: 'useGravity', t: 'bool', label: 'Gravité', d: true },
      { k: 'isKinematic', t: 'bool', label: 'Cinématique', d: false },
      { k: 'drag', t: 'num', label: 'Frottement air', d: 0.05, min: 0, max: 1 },
      { k: 'angularDrag', t: 'num', label: 'Frottement rotation', d: 0.05, min: 0, max: 1 },
      { k: 'friction', t: 'range', label: 'Friction', min: 0, max: 1, d: 0.4 },
      { k: 'bounciness', t: 'range', label: 'Rebond', min: 0, max: 1, d: 0 },
      { k: 'freezePos', t: 'bool3', label: 'Bloquer position', d: [false, false, false] },
      { k: 'freezeRot', t: 'bool3', label: 'Bloquer rotation', d: [false, false, false] },
    ],
  },
  BoxCollider: {
    label: 'Box Collider',
    icon: '📦',
    cat: 'Physique',
    fields: [
      { k: 'isTrigger', t: 'bool', label: 'Déclencheur', d: false },
      { k: 'center', t: 'vec3', label: 'Centre', d: [0, 0, 0] },
      { k: 'size', t: 'vec3', label: 'Taille', d: [1, 1, 1] },
    ],
  },
  SphereCollider: {
    label: 'Sphere Collider',
    icon: '⚪',
    cat: 'Physique',
    fields: [
      { k: 'isTrigger', t: 'bool', label: 'Déclencheur', d: false },
      { k: 'center', t: 'vec3', label: 'Centre', d: [0, 0, 0] },
      { k: 'radius', t: 'num', label: 'Rayon', d: 0.5, min: 0.001 },
    ],
  },
  CapsuleCollider: {
    label: 'Capsule Collider',
    icon: '💊',
    cat: 'Physique',
    fields: [
      { k: 'isTrigger', t: 'bool', label: 'Déclencheur', d: false },
      { k: 'center', t: 'vec3', label: 'Centre', d: [0, 0, 0] },
      { k: 'radius', t: 'num', label: 'Rayon', d: 0.5, min: 0.001 },
      { k: 'height', t: 'num', label: 'Hauteur', d: 2, min: 0.001 },
    ],
  },
  CylinderCollider: {
    label: 'Cylinder Collider',
    icon: '🥫',
    cat: 'Physique',
    fields: [
      { k: 'isTrigger', t: 'bool', label: 'Déclencheur', d: false },
      { k: 'center', t: 'vec3', label: 'Centre', d: [0, 0, 0] },
      { k: 'radius', t: 'num', label: 'Rayon', d: 0.5, min: 0.001 },
      { k: 'height', t: 'num', label: 'Hauteur', d: 2, min: 0.001 },
    ],
  },
  Script: {
    label: 'Script',
    icon: '📜',
    cat: 'Scripts',
    fields: [{ k: 'script', t: 'script', label: 'Script', d: '' }],
  },
  AudioSource: {
    label: 'Audio Source',
    icon: '🔊',
    cat: 'Audio',
    unique: true,
    fields: [
      { k: 'clip', t: 'sfx', label: 'Son', d: 'sfx:coin' },
      { k: 'volume', t: 'range', label: 'Volume', min: 0, max: 1, d: 0.8 },
      { k: 'pitch', t: 'range', label: 'Hauteur', min: 0.25, max: 3, d: 1 },
      { k: 'loop', t: 'bool', label: 'Boucle', d: false },
      { k: 'playOnAwake', t: 'bool', label: 'Jouer au démarrage', d: false },
    ],
  },
  ParticleSystem: {
    label: 'Particle System',
    icon: '✨',
    cat: 'Effets',
    unique: true,
    fields: [
      { k: 'playOnAwake', t: 'bool', label: 'Jouer au démarrage', d: true },
      { k: 'loop', t: 'bool', label: 'Boucle', d: true },
      { k: 'rate', t: 'num', label: 'Particules / s', d: 30, min: 0 },
      { k: 'burst', t: 'int', label: 'Rafale initiale', d: 0, min: 0 },
      { k: 'duration', t: 'num', label: 'Durée (s)', d: 2, min: 0.05 },
      { k: 'lifetime', t: 'num', label: 'Durée de vie', d: 1.2, min: 0.05 },
      { k: 'speed', t: 'num', label: 'Vitesse', d: 3 },
      { k: 'spread', t: 'range', label: 'Dispersion (°)', min: 0, max: 180, d: 25 },
      { k: 'shape', t: 'sel', label: 'Forme', options: ['Cone', 'Sphere', 'Box'], labels: { Cone: 'Cône', Sphere: 'Sphère', Box: 'Boîte' }, d: 'Cone' },
      { k: 'size', t: 'num', label: 'Taille', d: 0.25, min: 0 },
      { k: 'endSize', t: 'num', label: 'Taille finale', d: 0.05, min: 0 },
      { k: 'startColor', t: 'color', label: 'Couleur début', d: '#ffd34d' },
      { k: 'endColor', t: 'color', label: 'Couleur fin', d: '#ff3b1f' },
      { k: 'gravity', t: 'num', label: 'Gravité', d: 0 },
      { k: 'additive', t: 'bool', label: 'Lumineux (additif)', d: true },
      { k: 'worldSpace', t: 'bool', label: 'Espace monde', d: true },
      { k: 'max', t: 'int', label: 'Max particules', d: 400, min: 1 },
    ],
  },
  TrailRenderer: {
    label: 'Trail Renderer',
    icon: '〰️',
    cat: 'Effets',
    unique: true,
    fields: [
      { k: 'time', t: 'num', label: 'Durée', d: 0.5, min: 0.02 },
      { k: 'width', t: 'num', label: 'Largeur', d: 0.3, min: 0 },
      { k: 'color', t: 'color', label: 'Couleur', d: '#7dd3fc' },
      { k: 'additive', t: 'bool', label: 'Lumineux', d: true },
    ],
  },
  UIText: {
    label: 'UI Text',
    icon: '🔤',
    cat: 'Interface',
    unique: true,
    fields: [
      { k: 'text', t: 'text', label: 'Texte', d: 'Texte' },
      { k: 'fontSize', t: 'num', label: 'Taille', d: 28, min: 1 },
      { k: 'color', t: 'color', label: 'Couleur', d: '#ffffff' },
      { k: 'anchor', t: 'sel', label: 'Ancre', options: ANCHORS, d: 'top-left' },
      { k: 'pos', t: 'vec2', label: 'Décalage', d: [20, 20] },
      { k: 'align', t: 'sel', label: 'Alignement', options: ['left', 'center', 'right'], labels: { left: 'Gauche', center: 'Centre', right: 'Droite' }, d: 'left' },
      { k: 'bold', t: 'bool', label: 'Gras', d: true },
      { k: 'shadow', t: 'bool', label: 'Ombre', d: true },
    ],
  },
  UIButton: {
    label: 'UI Button',
    icon: '🔘',
    cat: 'Interface',
    unique: true,
    fields: [
      { k: 'label', t: 'str', label: 'Libellé', d: 'Bouton' },
      { k: 'onClick', t: 'str', label: 'Méthode OnClick', d: 'OnClick' },
      { k: 'anchor', t: 'sel', label: 'Ancre', options: ANCHORS, d: 'bottom-center' },
      { k: 'pos', t: 'vec2', label: 'Décalage', d: [0, 60] },
      { k: 'size', t: 'vec2', label: 'Taille', d: [180, 56] },
      { k: 'color', t: 'color', label: 'Couleur', d: '#3b82f6' },
      { k: 'textColor', t: 'color', label: 'Couleur texte', d: '#ffffff' },
      { k: 'fontSize', t: 'num', label: 'Taille texte', d: 20, min: 1 },
      { k: 'radius', t: 'num', label: 'Arrondi', d: 14, min: 0 },
    ],
  },
  UIImage: {
    label: 'UI Image',
    icon: '🟦',
    cat: 'Interface',
    unique: true,
    fields: [
      { k: 'image', t: 'image', label: 'Image', d: '' },
      { k: 'color', t: 'color', label: 'Couleur', d: '#ffffff' },
      { k: 'opacity', t: 'range', label: 'Opacité', min: 0, max: 1, d: 1 },
      { k: 'anchor', t: 'sel', label: 'Ancre', options: ANCHORS, d: 'top-center' },
      { k: 'pos', t: 'vec2', label: 'Décalage', d: [0, 20] },
      { k: 'size', t: 'vec2', label: 'Taille', d: [200, 24] },
      { k: 'fill', t: 'range', label: 'Remplissage', min: 0, max: 1, d: 1 },
      { k: 'radius', t: 'num', label: 'Arrondi', d: 8, min: 0 },
    ],
  },
};

export const CATEGORIES = ['Rendu', 'Physique', 'Scripts', 'Audio', 'Effets', 'Interface'];
export const COLLIDERS = ['BoxCollider', 'SphereCollider', 'CapsuleCollider', 'CylinderCollider'];

export function createComponent(type, go, extra = {}) {
  const def = COMPONENTS[type];
  if (!def) throw new Error('Composant inconnu : ' + type);
  const c = { type, enabled: true };
  for (const f of def.fields) c[f.k] = Array.isArray(f.d) ? [...f.d] : f.d;
  if (type === 'Script') c.props = {};
  // Valeurs adaptées au maillage existant
  const mr = go && go.c.find((x) => x.type === 'MeshRenderer');
  const sr = go && go.c.find((x) => x.type === 'SpriteRenderer');
  if (mr) {
    const m = mr.mesh;
    if (type === 'BoxCollider') {
      if (m === 'Plane') c.size = [10, 0.02, 10];
      else if (m === 'Quad') c.size = [1, 1, 0.02];
      else if (m === 'Cylinder' || m === 'Capsule') c.size = [1, 2, 1];
      else if (m === 'Torus') c.size = [1.3, 1.3, 0.4];
    }
    if (type === 'SphereCollider' && m === 'Torus') c.radius = 0.65;
  }
  if (sr && type === 'BoxCollider') c.size = [sr.size[0], sr.size[1], 1];
  if (sr && type === 'SphereCollider') c.radius = Math.max(sr.size[0], sr.size[1]) / 2;
  return Object.assign(c, extra);
}

export function bestColliderFor(go) {
  const mr = go.c.find((x) => x.type === 'MeshRenderer');
  const sr = go.c.find((x) => x.type === 'SpriteRenderer');
  if (sr) return sr.shape === 'Circle' ? 'SphereCollider' : 'BoxCollider';
  if (!mr) return 'BoxCollider';
  if (mr.mesh === 'Sphere' || mr.mesh === 'Icosphere') return 'SphereCollider';
  if (mr.mesh === 'Capsule') return 'CapsuleCollider';
  if (mr.mesh === 'Cylinder' || mr.mesh === 'Cone') return 'CylinderCollider';
  return 'BoxCollider';
}

export function createGameObject(name = 'GameObject', opts = {}) {
  return {
    id: uid(),
    name,
    parent: opts.parent || null,
    active: true,
    tag: opts.tag || 'Untagged',
    t: { p: opts.p || [0, 0, 0], r: opts.r || [0, 0, 0], s: opts.s || [1, 1, 1] },
    c: [],
  };
}

export function goIcon(go) {
  const types = go.c.map((c) => c.type);
  if (types.includes('Camera')) return '🎥';
  if (types.includes('Light')) return '💡';
  if (types.includes('UIButton')) return '🔘';
  if (types.includes('UIText')) return '🔤';
  if (types.includes('UIImage')) return '🟦';
  if (types.includes('ParticleSystem')) return '✨';
  if (types.includes('SpriteRenderer')) return '🖼️';
  if (types.includes('Text3D')) return '🔠';
  if (types.includes('MeshRenderer')) return go.c.find((c) => c.type === 'Rigidbody') ? '🪨' : '🧊';
  if (types.includes('Script')) return '📜';
  if (types.includes('AudioSource')) return '🔊';
  return '⬜';
}

/** Menu de création d'objets (« GameObject > … ») */
export const CREATE_MENU = [
  { header: 'Général' },
  { id: 'empty', label: 'Objet vide', icon: '⬜' },
  { header: 'Objets 3D' },
  ...['Cube', 'Sphere', 'Cylinder', 'Capsule', 'Plane', 'Quad', 'Cone', 'Torus', 'Icosphere', 'Pyramid'].map((m) => ({ id: 'mesh:' + m, label: MESH_LABELS[m], icon: '🧊' })),
  { id: 'text3d', label: 'Texte 3D', icon: '🔠' },
  { header: '2D' },
  { id: 'sprite:Square', label: 'Sprite carré', icon: '🟥' },
  { id: 'sprite:Circle', label: 'Sprite cercle', icon: '🔴' },
  { id: 'sprite:Triangle', label: 'Sprite triangle', icon: '🔺' },
  { id: 'sprite:Hexagon', label: 'Sprite hexagone', icon: '⬢' },
  { id: 'sprite:Star', label: 'Sprite étoile', icon: '⭐' },
  { header: 'Lumières' },
  { id: 'light:Directional', label: 'Lumière directionnelle', icon: '☀️' },
  { id: 'light:Point', label: 'Lumière ponctuelle', icon: '💡' },
  { id: 'light:Spot', label: 'Projecteur', icon: '🔦' },
  { id: 'light:Hemisphere', label: 'Lumière hémisphère', icon: '🌗' },
  { header: 'Caméra & effets' },
  { id: 'camera', label: 'Caméra', icon: '🎥' },
  { id: 'particles', label: 'Système de particules', icon: '✨' },
  { id: 'audio', label: 'Source audio', icon: '🔊' },
  { header: 'Interface (UI)' },
  { id: 'ui:text', label: 'Texte', icon: '🔤' },
  { id: 'ui:button', label: 'Bouton', icon: '🔘' },
  { id: 'ui:image', label: 'Image / barre', icon: '🟦' },
];

export function createFromMenu(id, { is2D = false } = {}) {
  const [kind, arg] = id.split(':');
  let go;
  switch (kind) {
    case 'empty':
      go = createGameObject('GameObject');
      break;
    case 'mesh': {
      go = createGameObject(MESH_LABELS[arg] || arg);
      const mr = createComponent('MeshRenderer', go, { mesh: arg });
      go.c.push(mr);
      if (arg === 'Plane') mr.color = '#9aa5b1';
      go.c.push(createComponent(bestColliderFor(go), go));
      break;
    }
    case 'text3d':
      go = createGameObject('Texte 3D');
      go.c.push(createComponent('Text3D', go));
      break;
    case 'sprite': {
      go = createGameObject('Sprite');
      go.c.push(createComponent('SpriteRenderer', go, { shape: arg }));
      break;
    }
    case 'light': {
      const names = { Directional: 'Lumière directionnelle', Point: 'Lumière ponctuelle', Spot: 'Projecteur', Hemisphere: 'Lumière hémisphère' };
      go = createGameObject(names[arg]);
      go.c.push(createComponent('Light', go, { kind: arg, shadows: arg === 'Directional', intensity: arg === 'Hemisphere' ? 0.6 : arg === 'Directional' ? 1.4 : 2 }));
      if (arg === 'Directional') {
        go.t.p = [3, 8, 4];
        go.t.r = [-50, 30, 0];
      } else if (arg === 'Spot') {
        go.t.p = [0, 5, 0];
        go.t.r = [-90, 0, 0];
      } else go.t.p = [0, 3, 0];
      break;
    }
    case 'camera':
      go = createGameObject('Caméra');
      go.c.push(createComponent('Camera', go, { main: false, ortho: is2D }));
      go.t.p = [0, is2D ? 0 : 2, 8];
      break;
    case 'particles':
      go = createGameObject('Particules');
      go.c.push(createComponent('ParticleSystem', go));
      go.t.r = [90, 0, 0];
      break;
    case 'audio':
      go = createGameObject('Source audio');
      go.c.push(createComponent('AudioSource', go));
      break;
    case 'ui': {
      if (arg === 'text') {
        go = createGameObject('Texte UI');
        go.c.push(createComponent('UIText', go));
      } else if (arg === 'button') {
        go = createGameObject('Bouton');
        go.c.push(createComponent('UIButton', go));
      } else {
        go = createGameObject('Image UI');
        go.c.push(createComponent('UIImage', go));
      }
      break;
    }
    default:
      go = createGameObject('GameObject');
  }
  return go;
}
