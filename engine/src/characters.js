// Personnages et objets animés prêts à jouer (menu ＋ → Personnages, et modèles de projets)

import { createGameObject, createComponent } from './components.js';
import { ensureLibScript } from './scriptlib.js';

const C = (type, props) => createComponent(type, null, props);
const mesh = (m, color, extra = {}) => C('MeshRenderer', { mesh: m, color, ...extra });
const sprite = (shape, color, size, order = 0, extra = {}) => C('SpriteRenderer', { shape, color, size, order, ...extra });

export const CHARACTERS = [
  { id: 'perso3d', label: 'Perso 3D animé', icon: '🧑‍🚀', desc: 'Marche, court, saute (double saut), cligne des yeux.' },
  { id: 'perso2d', label: 'Héros 2D animé', icon: '🦸', desc: 'Plateforme : s’étire, s’écrase, ses pieds courent.' },
  { id: 'slime', label: 'Slime (ennemi 3D)', icon: '🟢', desc: 'Sautille vers le joueur et le repousse.' },
  { id: 'ennemi2d', label: 'Ennemi 2D', icon: '👿', desc: 'Fait des allers-retours, on peut l’écraser.' },
  { id: 'voiture', label: 'Voiture 3D', icon: '🏎️', desc: 'Se conduit au joystick, roues qui tournent.' },
];

/**
 * Construit un personnage. Ajoute au projet les scripts nécessaires (bibliothèque).
 * Retourne { objects, rootId, created: [noms des scripts ajoutés] }
 */
export function buildCharacter(kind, project, { position = [0, 0, 0], name } = {}) {
  const objects = [];
  const created = [];
  const node = (nm, parent, t = {}, comps = []) => {
    const g = createGameObject(nm, { parent, p: t.p, r: t.r, s: t.s, tag: t.tag });
    g.c = comps;
    objects.push(g);
    return g.id;
  };
  const script = (libId, props = {}) => {
    const r = ensureLibScript(project, libId);
    if (r.created) created.push(r.script.name);
    return C('Script', { script: r.script.id, props });
  };

  let root;
  switch (kind) {
    case 'perso3d': {
      const peau = '#ffd2a8', pull = '#ff7a3d', pantalon = '#334155', casquette = '#3b82f6';
      root = node(name || 'Perso', null, { p: position, tag: 'Player' }, [
        C('Rigidbody', { mass: 1, friction: 0, drag: 0, angularDrag: 0, freezeRot: [true, true, true] }),
        C('CapsuleCollider', { radius: 0.38, height: 1.5 }),
        script('perso3d'),
        script('anim3d'),
      ]);
      const corps = node('Corps', root, { p: [0, -0.05, 0] });
      node('Torse', corps, { p: [0, 0.02, 0], s: [0.62, 0.32, 0.52] }, [mesh('Capsule', pull, { roughness: 0.55 })]);
      node('Ceinture', corps, { p: [0, -0.2, 0], s: [0.6, 0.04, 0.52] }, [mesh('Cylinder', '#1f2937')]);
      node('Poche', corps, { p: [0, -0.06, -0.25], s: [0.26, 0.12, 0.04] }, [mesh('Cube', '#ea580c')]);
      const tete = node('Tête', corps, { p: [0, 0.6, 0] });
      node('Visage', tete, { s: [0.64, 0.6, 0.62] }, [mesh('Sphere', peau, { roughness: 0.7 })]);
      node('OeilG', tete, { p: [-0.12, 0.04, -0.28], s: [0.09, 0.13, 0.06] }, [mesh('Sphere', '#111827', { roughness: 0.2 })]);
      node('OeilD', tete, { p: [0.12, 0.04, -0.28], s: [0.09, 0.13, 0.06] }, [mesh('Sphere', '#111827', { roughness: 0.2 })]);
      node('JoueG', tete, { p: [-0.2, -0.08, -0.23], s: [0.1, 0.06, 0.04] }, [mesh('Sphere', '#ff8fa3')]);
      node('JoueD', tete, { p: [0.2, -0.08, -0.23], s: [0.1, 0.06, 0.04] }, [mesh('Sphere', '#ff8fa3')]);
      node('Casquette', tete, { p: [0, 0.14, 0.02], s: [0.68, 0.4, 0.68] }, [mesh('Sphere', casquette, { roughness: 0.45 })]);
      node('Visière', tete, { p: [0, 0.12, -0.3], s: [0.36, 0.02, 0.3] }, [mesh('Cylinder', '#1d4ed8')]);
      node('Pompon', tete, { p: [0, 0.36, 0.02], s: [0.1, 0.1, 0.1] }, [mesh('Sphere', '#facc15')]);
      node('SacÀDos', corps, { p: [0, 0.05, 0.3], s: [0.42, 0.46, 0.2] }, [mesh('Cube', '#8b5a2b', { roughness: 0.8 })]);
      node('Rabat', corps, { p: [0, 0.2, 0.41], s: [0.44, 0.16, 0.04] }, [mesh('Cube', '#6b4423')]);
      for (const [nm, x] of [['BrasG', -0.4], ['BrasD', 0.4]]) {
        const b = node(nm, corps, { p: [x, 0.18, 0] });
        node('Manche', b, { p: [0, -0.2, 0], s: [0.15, 0.17, 0.15] }, [mesh('Capsule', pull, { roughness: 0.55 })]);
        node('Main', b, { p: [0, -0.42, 0], s: [0.16, 0.16, 0.16] }, [mesh('Sphere', peau)]);
      }
      for (const [nm, x] of [['JambeG', -0.16], ['JambeD', 0.16]]) {
        const j = node(nm, root, { p: [x, -0.35, 0] });
        node('Cuisse', j, { p: [0, -0.16, 0], s: [0.19, 0.14, 0.19] }, [mesh('Capsule', pantalon)]);
        node('Chaussure', j, { p: [0, -0.34, -0.05], s: [0.22, 0.12, 0.32] }, [mesh('Cube', '#f8fafc', { roughness: 0.4 })]);
      }
      break;
    }

    case 'perso2d': {
      const couleur = '#ff5d73';
      root = node(name || 'Héros', null, { p: position, tag: 'Player' }, [
        C('Rigidbody', { mass: 1, friction: 0, drag: 0, freezePos: [false, false, true], freezeRot: [true, true, true] }),
        C('BoxCollider', { size: [0.8, 0.9, 1] }),
        script('perso2d'),
        script('anim2d'),
      ]);
      const vis = node('Visuel', root);
      node('PiedG', vis, { p: [-0.18, -0.42, -0.01] }, [sprite('Capsule', '#3b2c4f', [0.32, 0.16], -1)]);
      node('PiedD', vis, { p: [0.18, -0.42, -0.01] }, [sprite('Capsule', '#3b2c4f', [0.32, 0.16], -1)]);
      const corps = node('Corps', vis, {}, [sprite('Capsule', couleur, [0.9, 0.86], 0)]);
      node('Ventre', corps, { p: [0.04, -0.2, 0.005] }, [sprite('Circle', '#ffc2cc', [0.5, 0.34], 1)]);
      for (const [nm, x] of [['OeilG', 0.05], ['OeilD', 0.29]]) {
        const o = node(nm, corps, { p: [x, 0.1, 0.01] }, [sprite('Circle', '#ffffff', [0.2, 0.27], 2)]);
        node('Pupille', o, { p: [0.03, 0, 0.005] }, [sprite('Circle', '#1e1b2e', [0.1, 0.14], 3)]);
      }
      const bandeau = node('Bandeau', corps, { p: [0, 0.3, 0.008] }, [sprite('Square', '#2f6bff', [0.92, 0.12], 2)]);
      node('Noeud', bandeau, { p: [-0.52, -0.02, -0.002], r: [0, 0, 90] }, [sprite('Triangle', '#2f6bff', [0.22, 0.24], 1)]);
      break;
    }

    case 'slime': {
      root = node(name || 'Slime', null, { p: position, tag: 'Enemy' }, [
        C('Rigidbody', { mass: 1, friction: 0.3, drag: 0.3, freezeRot: [true, true, true] }),
        C('SphereCollider', { radius: 0.45 }),
        script('slime'),
      ]);
      const corps = node('Corps', root, { p: [0, -0.45, 0] });
      node('Gelée', corps, { p: [0, 0.42, 0], s: [0.95, 0.8, 0.95] }, [mesh('Sphere', '#4ade80', { roughness: 0.15, metalness: 0.1, emissive: '#0a3d1d' })]);
      node('Reflet', corps, { p: [0.18, 0.66, -0.22], s: [0.16, 0.1, 0.08] }, [mesh('Sphere', '#ffffff', { unlit: true, castShadows: false })]);
      node('OeilG', corps, { p: [-0.15, 0.5, -0.38], s: [0.12, 0.16, 0.08] }, [mesh('Sphere', '#0f172a')]);
      node('OeilD', corps, { p: [0.15, 0.5, -0.38], s: [0.12, 0.16, 0.08] }, [mesh('Sphere', '#0f172a')]);
      break;
    }

    case 'ennemi2d': {
      root = node(name || 'Ennemi', null, { p: position, tag: 'Enemy' }, [
        sprite('Circle', '#7c3aed', [0.8, 0.7], 0),
        C('BoxCollider', { size: [0.7, 0.6, 1], isTrigger: true }),
        script('ennemi2d'),
      ]);
      for (const [nm, x] of [['OeilG', -0.12], ['OeilD', 0.12]]) {
        const o = node(nm, root, { p: [x, 0.06, 0.01] }, [sprite('Circle', '#ffffff', [0.18, 0.2], 1)]);
        node('Pupille', o, { p: [0, -0.02, 0.005] }, [sprite('Circle', '#111827', [0.08, 0.1], 2)]);
      }
      node('SourcilG', root, { p: [-0.12, 0.2, 0.02], r: [0, 0, -20] }, [sprite('Square', '#1e1b4b', [0.2, 0.05], 3)]);
      node('SourcilD', root, { p: [0.12, 0.2, 0.02], r: [0, 0, 20] }, [sprite('Square', '#1e1b4b', [0.2, 0.05], 3)]);
      break;
    }

    case 'voiture': {
      root = node(name || 'Voiture', null, { p: position, tag: 'Player' }, [
        C('Rigidbody', { mass: 2, friction: 0.2, drag: 0.05, freezeRot: [true, true, true] }),
        C('BoxCollider', { size: [1.4, 0.85, 2.4] }),
        script('voiture'),
      ]);
      node('Carrosserie', root, { p: [0, 0.08, 0], s: [1.4, 0.42, 2.4] }, [mesh('Cube', '#ef4444', { metalness: 0.45, roughness: 0.3 })]);
      node('Cabine', root, { p: [0, 0.45, 0.2], s: [1.12, 0.38, 1.2] }, [mesh('Cube', '#93c5fd', { metalness: 0.6, roughness: 0.15 })]);
      node('Aileron', root, { p: [0, 0.42, 1.12], s: [1.3, 0.06, 0.25] }, [mesh('Cube', '#111827')]);
      for (const [nm, x] of [['PhareG', -0.48], ['PhareD', 0.48]]) node(nm, root, { p: [x, 0.12, -1.2], s: [0.22, 0.14, 0.06] }, [mesh('Sphere', '#fff7cc', { emissive: '#ffe066', emissiveIntensity: 1.5 })]);
      for (const [nm, x, z] of [['RoueAVG', -0.74, -0.78], ['RoueAVD', 0.74, -0.78], ['RoueARG', -0.74, 0.8], ['RoueARD', 0.74, 0.8]]) {
        const r = node(nm, root, { p: [x, -0.15, z] });
        const pneu = node('Pneu', r, { r: [0, 0, 90], s: [0.55, 0.14, 0.55] }, [mesh('Cylinder', '#111827', { roughness: 0.9 })]);
        node('Jante', pneu, { s: [0.6, 1.05, 0.6] }, [mesh('Cylinder', '#d1d5db', { metalness: 0.8, roughness: 0.25 })]);
      }
      break;
    }

    default:
      throw new Error('Personnage inconnu : ' + kind);
  }
  return { objects, rootId: root, created };
}
