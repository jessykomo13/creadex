// Modèles de projets (comme les templates du Unity Hub)

import { uid, codeHash } from './util.js';
import { createGameObject, createComponent, DEFAULT_TAGS } from './components.js';
import { DEFAULT_ENV } from './builder.js';
import { APP_VERSION } from './version.js';
import { buildCharacter } from './characters.js';
import { ensureLibScript, upgradeLibScript } from './scriptlib.js';

const C = (type, props) => createComponent(type, null, props);
function obj(name, o = {}, comps = []) {
  const g = createGameObject(name, o);
  if (o.active === false) g.active = false;
  if (o.parent) g.parent = o.parent;
  g.c = comps;
  return g;
}
const scene = (name, objects, env = {}) => ({ id: uid(), name, objects, env: { ...DEFAULT_ENV, ...env } });
export { codeHash };
const script = (name, code) => {
  code = code.trim() + '\n';
  return { id: uid(), name, code, tplHash: codeHash(code) };
};
const S = (sc, props = {}) => C('Script', { script: sc.id, props });
const box = (size, center = [0, 0, 0], extra = {}) => C('BoxCollider', { size, center, ...extra });

export function sanitizeClassName(name) {
  let n = String(name || '').normalize('NFC').replace(/[^\p{L}\p{N}_$]/gu, '');
  if (!n || /^\d/.test(n)) n = 'Script' + n;
  return n.charAt(0).toUpperCase() + n.slice(1);
}

export function scriptTemplate(name) {
  return `class ${name} extends MonoBehaviour {
  // Les champs ci-dessous apparaissent dans l'inspecteur
  vitesse = 2;

  // Appelé une fois, avant la première image
  Start() {
    Debug.Log("${name} démarre sur " + this.gameObject.name);
  }

  // Appelé à chaque image
  Update() {
    // Exemple : this.transform.Rotate(0, 90 * this.vitesse * Time.deltaTime, 0);
  }
}
`;
}

function baseSettings(extra = {}) {
  return {
    is2D: false,
    gravity: [0, -9.81, 0],
    fixedHz: 60,
    shadows: true,
    antialias: true,
    pixelRatio: 2,
    controls: { joystick: true, buttonA: true, buttonB: true, labelA: 'A', labelB: 'B' },
    tags: [...DEFAULT_TAGS],
    ...extra,
  };
}

function camera3D(p = [0, 3, 9], r = [-15, 0, 0], comps = []) {
  return obj('Main Camera', { p, r, tag: 'MainCamera' }, [C('Camera', { main: true }), ...comps]);
}
function sun() {
  return obj('Directional Light', { p: [4, 10, 6], r: [-55, 35, 0] }, [C('Light', { kind: 'Directional', intensity: 1.4 })]);
}

// ===================================================================== Modèles

function empty3D(p) {
  p.scenes.push(
    scene('SampleScene', [
      camera3D(),
      sun(),
      obj('Sol', { p: [0, 0, 0] }, [C('MeshRenderer', { mesh: 'Plane', color: '#8d99a6' }), box([10, 0.02, 10], [0, -0.01, 0])]),
      obj('Cube', { p: [0, 0.5, 0], r: [0, 30, 0] }, [C('MeshRenderer', { mesh: 'Cube', color: '#4f8cff' }), box([1, 1, 1])]),
    ])
  );
}

function empty2D(p) {
  p.settings.is2D = true;
  p.scenes.push(
    scene(
      'SampleScene',
      [
        obj('Main Camera', { p: [0, 0, 10], tag: 'MainCamera' }, [C('Camera', { main: true, ortho: true, orthoSize: 5, clear: 'color', bg: '#2d3b55' })]),
        obj('Lumière', { p: [0, 0, 10] }, [C('Light', { kind: 'Directional', intensity: 1.2, shadows: false })]),
        obj('Carré', { p: [0, 0, 0] }, [C('SpriteRenderer', { shape: 'Square', color: '#ffb84d' })]),
      ],
      { sky: 'color', bg: '#2d3b55' }
    )
  );
}

function rollABall(p) {
  const player = script(
    'PlayerController',
    `
class PlayerController extends MonoBehaviour {
  vitesse = 12;
  sautForce = 5;
  scoreTexte = Ref.GameObject("Score");
  victoire = Ref.GameObject("Victoire");

  Start() {
    this.rb = this.GetComponent("Rigidbody");
    this.compte = 0;
    this.total = GameObject.FindGameObjectsWithTag("Collectible").length;
    this.MettreAJourScore();
  }

  FixedUpdate() {
    // Joystick / flèches : « haut » = vers l'avant (-Z)
    const h = Input.GetAxis("Horizontal");
    const v = Input.GetAxis("Vertical");
    this.rb.AddForce(new Vector3(h, 0, -v).mul(this.vitesse));
  }

  Update() {
    // Saut avec le bouton A (ou Espace)
    if (Input.GetButtonDown("Jump") && this.transform.position.y < 0.6) {
      this.rb.AddForce(new Vector3(0, this.sautForce, 0), ForceMode.Impulse);
      Audio.Play("jump");
    }
    // Tombé du plateau : on recommence
    if (this.transform.position.y < -10) SceneManager.ReloadScene();
  }

  OnTriggerEnter(other) {
    if (other.CompareTag("Collectible")) {
      other.gameObject.SetActive(false);
      this.compte++;
      Audio.Play("coin");
      this.MettreAJourScore();
    }
  }

  MettreAJourScore() {
    if (this.scoreTexte) this.scoreTexte.GetComponent("Text").text = "Score : " + this.compte + " / " + this.total;
    if (this.compte >= this.total && this.victoire) {
      this.victoire.SetActive(true);
      Audio.Play("win");
    }
  }
}`
  );
  const rotator = script(
    'Rotator',
    `
class Rotator extends MonoBehaviour {
  vitesse = new Vector3(15, 30, 45);

  Update() {
    this.transform.Rotate(this.vitesse.mul(Time.deltaTime));
  }
}`
  );
  const follow = script(
    'CameraFollow',
    `
class CameraFollow extends MonoBehaviour {
  cible = Ref.GameObject("Joueur");
  douceur = 5;

  Start() {
    this.decalage = this.transform.position.sub(this.cible.transform.position);
  }

  LateUpdate() {
    if (!this.cible) return;
    const voulu = this.cible.transform.position.add(this.decalage);
    this.transform.position = Vector3.Lerp(this.transform.position, voulu, this.douceur * Time.deltaTime);
  }
}`
  );
  p.scripts.push(player, rotator, follow);
  const objs = [
    camera3D([0, 10, 10], [-45, 0, 0], [S(follow)]),
    sun(),
    obj('Sol', { s: [2, 1, 2] }, [C('MeshRenderer', { mesh: 'Plane', color: '#3f8f5f', roughness: 0.9 }), box([10, 0.02, 10], [0, -0.01, 0])]),
  ];
  const wall = (n, pos, sc) => obj(n, { p: pos, s: sc }, [C('MeshRenderer', { mesh: 'Cube', color: '#c7ccd6' }), box([1, 1, 1])]);
  objs.push(wall('Mur Nord', [0, 0.5, -10.25], [21, 1, 0.5]), wall('Mur Sud', [0, 0.5, 10.25], [21, 1, 0.5]), wall('Mur Ouest', [-10.25, 0.5, 0], [0.5, 1, 21]), wall('Mur Est', [10.25, 0.5, 0], [0.5, 1, 21]));
  objs.push(
    obj('Joueur', { p: [0, 0.5, 0], tag: 'Player' }, [
      C('MeshRenderer', { mesh: 'Sphere', color: '#ffd34d', metalness: 0.2, roughness: 0.35 }),
      C('SphereCollider', { radius: 0.5 }),
      C('Rigidbody', { mass: 1, drag: 0.3, angularDrag: 0.4, friction: 0.6 }),
      C('TrailRenderer', { time: 0.4, width: 0.5, color: '#ffe08a', additive: true }),
      S(player),
    ])
  );
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    objs.push(
      obj(`Bonus ${i + 1}`, { p: [Math.round(Math.cos(a) * 600) / 100, 0.7, Math.round(Math.sin(a) * 600) / 100], r: [45, 45, 45], s: [0.5, 0.5, 0.5], tag: 'Collectible' }, [
        C('MeshRenderer', { mesh: 'Cube', color: '#ff4f8b', emissive: '#5a0d25' }),
        box([1, 1, 1], [0, 0, 0], { isTrigger: true }),
        S(rotator),
      ])
    );
  }
  objs.push(
    obj('Score', {}, [C('UIText', { text: 'Score : 0', fontSize: 30, anchor: 'top-left', pos: [20, 24] })]),
    obj('Victoire', { active: false }, [C('UIText', { text: 'Bravo ! 🎉', fontSize: 56, anchor: 'center', pos: [0, -40], align: 'center', color: '#ffe066' })])
  );
  // Un prefab de bonus, prêt à être placé
  const pickupId = uid();
  p.prefabs.push({
    id: uid(),
    name: 'Bonus',
    objects: [
      { id: pickupId, name: 'Bonus', parent: null, active: true, tag: 'Collectible', t: { p: [0, 0.7, 0], r: [45, 45, 45], s: [0.5, 0.5, 0.5] }, c: [C('MeshRenderer', { mesh: 'Cube', color: '#ff4f8b', emissive: '#5a0d25' }), box([1, 1, 1], [0, 0, 0], { isTrigger: true }), S(rotator)] },
    ],
  });
  p.scenes.push(scene('Niveau 1', objs, { skyTop: '#2a6fc9', skyHorizon: '#cfe6ff' }));
  p.settings.controls = { joystick: true, buttonA: true, buttonB: false, labelA: 'Saut', labelB: 'B' };
}

function platformer2D(p) {
  p.settings.is2D = true;
  p.settings.gravity = [0, -22, 0];
  p.settings.controls = { joystick: true, buttonA: true, buttonB: false, labelA: 'Saut', labelB: 'B' };
  const player = script(
    'Player2D',
    `
class Player2D extends MonoBehaviour {
  vitesse = 7;
  saut = 11.5;
  piecesTexte = Ref.GameObject("Pièces");
  victoire = Ref.GameObject("Victoire");
  etincelles = Ref.Prefab("Étincelles");

  Start() {
    this.rb = this.GetComponent("Rigidbody");
    this.sprite = this.GetComponent("SpriteRenderer");
    this.pieces = 0;
    this.gagne = false;
    this.Afficher();
  }

  AuSol() {
    const p = this.transform.position;
    // trois rayons vers le bas, partant du bas du joueur
    for (const dx of [-0.38, 0, 0.38]) {
      if (Physics.Raycast(new Vector3(p.x + dx, p.y - 0.4, 0), Vector3.down, 0.2)) return true;
    }
    return false;
  }

  Update() {
    if (this.gagne) return;
    const h = Input.GetAxis("Horizontal");
    this.rb.velocity.x = h * this.vitesse;
    if (h !== 0) this.sprite.flipX = h < 0;

    if (Input.GetButtonDown("Jump") && this.AuSol()) {
      this.rb.velocity.y = this.saut;
      Audio.Play("jump");
    }
    if (this.transform.position.y < -12) SceneManager.ReloadScene();
  }

  OnTriggerEnter(other) {
    if (other.CompareTag("Collectible")) {
      this.pieces++;
      Audio.Play("coin");
      if (this.etincelles) Destroy(Instantiate(this.etincelles, other.transform.position), 1);
      Destroy(other.gameObject);
      this.Afficher();
    } else if (other.CompareTag("Enemy")) {
      // Sauter sur l'ennemi l'élimine, sinon on perd
      if (this.rb.velocity.y < -0.5 && this.transform.position.y > other.transform.position.y + 0.3) {
        Destroy(other.gameObject);
        this.rb.velocity.y = 8;
        Audio.Play("hit");
      } else {
        Audio.Play("lose");
        SceneManager.ReloadScene();
      }
    } else if (other.CompareTag("Finish") && !this.gagne) {
      this.gagne = true;
      this.rb.velocity = Vector3.zero;
      Audio.Play("win");
      if (this.victoire) this.victoire.SetActive(true);
    }
  }

  Afficher() {
    if (this.piecesTexte) this.piecesTexte.GetComponent("Text").text = "🪙 " + this.pieces;
  }
}`
  );
  const follow = script(
    'CameraFollow2D',
    `
class CameraFollow2D extends MonoBehaviour {
  cible = Ref.GameObject("Joueur");
  douceur = 4;
  decalage = new Vector3(0, 1.5, 10);

  LateUpdate() {
    if (!this.cible) return;
    const t = this.cible.transform.position;
    const voulu = new Vector3(t.x + this.decalage.x, Math.max(t.y + this.decalage.y, 0), this.decalage.z);
    this.transform.position = Vector3.Lerp(this.transform.position, voulu, this.douceur * Time.deltaTime);
  }
}`
  );
  const patrol = script(
    'Patrouille',
    `
class Patrouille extends MonoBehaviour {
  distance = 2;
  vitesse = 2;

  Start() {
    this.x0 = this.transform.position.x;
  }

  Update() {
    const s = Math.sin(Time.time * this.vitesse / this.distance);
    this.transform.position.x = this.x0 + s * this.distance;
    this.GetComponent("SpriteRenderer").flipX = Math.cos(Time.time * this.vitesse / this.distance) < 0;
  }
}`
  );
  const coin = script(
    'Piece',
    `
class Piece extends MonoBehaviour {
  Start() {
    this.y0 = this.transform.position.y;
    this.phase = Random.Float(0, 6.28);
  }

  Update() {
    this.transform.position.y = this.y0 + Math.sin(Time.time * 3 + this.phase) * 0.15;
  }
}`
  );
  p.scripts.push(player, follow, patrol, coin);
  const ground = (n, x, y, w, hgt = 1, color = '#5b8c3a') =>
    obj(n, { p: [x, y, 0], tag: 'Ground' }, [C('SpriteRenderer', { shape: 'Square', color, size: [w, hgt] }), box([w, hgt, 1])]);
  const objs = [
    obj('Main Camera', { p: [0, 1.5, 10], tag: 'MainCamera' }, [C('Camera', { main: true, ortho: true, orthoSize: 6, clear: 'color', bg: '#7ec8ff' }), S(follow)]),
    obj('Soleil', { p: [0, 0, 10] }, [C('Light', { kind: 'Directional', intensity: 1, shadows: false })]),
    obj('Fond collines', { p: [8, -2, -5] }, [C('SpriteRenderer', { shape: 'Circle', color: '#9bd88a', size: [24, 10] })]),
    obj('Nuage', { p: [-3, 5, -4] }, [C('SpriteRenderer', { shape: 'Capsule', color: '#ffffff', size: [4, 1.4] })]),
    obj('Nuage 2', { p: [14, 6, -4] }, [C('SpriteRenderer', { shape: 'Capsule', color: '#ffffff', size: [5, 1.6] })]),
    ground('Sol', 6, -3.5, 30, 1),
    ground('Terre', 6, -5, 30, 2, '#7a5230'),
    ground('Plateforme 1', 4, -0.8, 3, 0.5),
    ground('Plateforme 2', 8.5, 1.2, 3, 0.5),
    ground('Plateforme 3', 13, 3, 3, 0.5),
    ground('Sol 2', 27, -3.5, 10, 1),
    ground('Terre 2', 27, -5, 10, 2, '#7a5230'),
    ground('Mur', -9.5, 0, 1, 12, '#6b7280'),
    obj('Joueur', { p: [-6, -2.4, 0], tag: 'Player' }, [
      C('SpriteRenderer', { shape: 'Capsule', color: '#ff6b6b', size: [0.9, 0.9] }),
      box([0.9, 0.9, 1]),
      C('Rigidbody', { mass: 1, friction: 0, drag: 0, freezePos: [false, false, true], freezeRot: [true, true, true] }),
      S(player),
    ]),
    obj('Ennemi', { p: [10, -2.6, 0], tag: 'Enemy' }, [C('SpriteRenderer', { shape: 'Triangle', color: '#7c3aed', size: [0.9, 0.8] }), box([0.8, 0.7, 1], [0, 0, 0], { isTrigger: true }), S(patrol, { distance: 2.5 })]),
    obj('Ennemi 2', { p: [26, -2.6, 0], tag: 'Enemy' }, [C('SpriteRenderer', { shape: 'Triangle', color: '#7c3aed', size: [0.9, 0.8] }), box([0.8, 0.7, 1], [0, 0, 0], { isTrigger: true }), S(patrol, { distance: 3, vitesse: 3 })]),
    obj('Drapeau', { p: [30, -2, 0], tag: 'Finish' }, [C('SpriteRenderer', { shape: 'Star', color: '#ffd34d', size: [1.4, 1.4] }), box([1.2, 1.2, 1], [0, 0, 0], { isTrigger: true })]),
    obj('Pièces', {}, [C('UIText', { text: '🪙 0', fontSize: 32, anchor: 'top-left', pos: [20, 24] })]),
    obj('Victoire', { active: false }, [C('UIText', { text: 'Niveau terminé ! ⭐', fontSize: 44, anchor: 'center', pos: [0, -60], align: 'center', color: '#ffffff' })]),
  ];
  const coins = [[0, -2.2], [1, -2.2], [4, 0.3], [8.5, 2.3], [13, 4.1], [13.8, 4.1], [18, 1], [20, 0], [24, -2.2], [25, -2.2]];
  coins.forEach(([x, y], i) =>
    objs.push(obj(`Pièce ${i + 1}`, { p: [x, y, 0], tag: 'Collectible' }, [C('SpriteRenderer', { shape: 'Circle', color: '#ffd34d', size: [0.55, 0.55] }), C('SphereCollider', { radius: 0.3, isTrigger: true }), S(coin)]))
  );
  p.prefabs.push({
    id: uid(),
    name: 'Étincelles',
    objects: [{ id: uid(), name: 'Étincelles', parent: null, active: true, tag: 'Untagged', t: { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }, c: [C('ParticleSystem', { loop: false, rate: 0, burst: 24, duration: 0.2, lifetime: 0.5, speed: 4, shape: 'Sphere', size: 0.3, endSize: 0.05, startColor: '#fff3a0', endColor: '#ff9d00', gravity: 0.5 })] }],
  });
  p.scenes.push(scene('Niveau 1', objs, { sky: 'color', bg: '#7ec8ff' }));
}

function spaceShooter(p) {
  p.settings.controls = { joystick: true, buttonA: false, buttonB: true, labelA: 'A', labelB: 'Tir' };
  const ship = script(
    'ShipController',
    `
class ShipController extends MonoBehaviour {
  vitesse = 9;
  cadence = 0.15;
  laser = Ref.Prefab("Laser");
  limites = new Vector2(7, 5);

  Start() {
    this.prochainTir = 0;
  }

  Update() {
    const h = Input.GetAxis("Horizontal");
    const v = Input.GetAxis("Vertical");
    const p = this.transform.position.clone();
    p.x = Mathf.Clamp(p.x + h * this.vitesse * Time.deltaTime, -this.limites.x, this.limites.x);
    p.z = Mathf.Clamp(p.z - v * this.vitesse * Time.deltaTime, -this.limites.y, this.limites.y);
    this.transform.position = p;
    // inclinaison dans les virages
    this.transform.localEulerAngles = new Vector3(0, 0, -h * 25);

    // Tir : bouton B (ou X / Ctrl au clavier)
    if (Input.GetButton("Fire1") && Time.time >= this.prochainTir) {
      this.prochainTir = Time.time + this.cadence;
      Instantiate(this.laser, this.transform.position.add(new Vector3(0, 0, -1)));
      Audio.Play("laser", 0.35);
    }
  }

  OnCollisionEnter(collision) {
    if (collision.gameObject.CompareTag("Enemy")) {
      Instantiate(Prefabs.Explosion, this.transform.position);
      Audio.Play("explosion");
      GameObject.Find("GameManager").SendMessage("GameOver");
      this.gameObject.SetActive(false);
    }
  }
}`
  );
  const bullet = script(
    'Bullet',
    `
class Bullet extends MonoBehaviour {
  vitesse = 25;

  Start() {
    this.GetComponent("Rigidbody").velocity = new Vector3(0, 0, -this.vitesse);
    Destroy(this.gameObject, 1.5);
  }

  OnTriggerEnter(other) {
    if (other.CompareTag("Enemy")) {
      Instantiate(Prefabs.Explosion, other.transform.position);
      Destroy(other.gameObject);
      Destroy(this.gameObject);
      Audio.Play("explosion", 0.5);
      GameObject.Find("GameManager").SendMessage("AjouterScore", 10);
    }
  }
}`
  );
  const asteroid = script(
    'Asteroid',
    `
class Asteroid extends MonoBehaviour {
  Start() {
    const rb = this.GetComponent("Rigidbody");
    rb.velocity = new Vector3(Random.Float(-1, 1), 0, Random.Float(4, 8));
    rb.angularVelocity = Random.insideUnitSphere.mul(3);
  }

  Update() {
    if (this.transform.position.z > 14) Destroy(this.gameObject);
  }
}`
  );
  const spawner = script(
    'Spawner',
    `
class Spawner extends MonoBehaviour {
  asteroide = Ref.Prefab("Astéroïde");
  intervalle = 0.7;
  largeur = 7;

  Start() {
    this.InvokeRepeating("Creer", 1, this.intervalle);
  }

  Creer() {
    const pos = new Vector3(Random.Float(-this.largeur, this.largeur), 0, -26);
    const a = Instantiate(this.asteroide, pos, Random.rotation);
    const s = Random.Float(0.7, 1.8);
    a.transform.localScale = new Vector3(s, s, s);
  }
}`
  );
  const gm = script(
    'GameManager',
    `
class GameManager extends MonoBehaviour {
  score = 0;
  finDePartie = Ref.GameObject("Fin de partie");

  Start() {
    this.texte = GameObject.Find("Score").GetComponent("Text");
    this.record = PlayerPrefs.GetInt("record", 0);
    this.Afficher();
  }

  AjouterScore(n) {
    this.score += n;
    this.Afficher();
  }

  Afficher() {
    this.texte.text = "Score " + this.score + "   •   Record " + this.record;
  }

  GameOver() {
    if (this.score > this.record) {
      this.record = this.score;
      PlayerPrefs.SetInt("record", this.record);
    }
    this.Afficher();
    this.finDePartie.SetActive(true);
    Audio.Play("lose");
  }

  Rejouer() {
    SceneManager.ReloadScene();
  }
}`
  );
  p.scripts.push(ship, bullet, asteroid, spawner, gm);
  const shipId = uid();
  const goId = uid();
  const objs = [
    obj('Main Camera', { p: [0, 17, 7], r: [-68, 0, 0], tag: 'MainCamera' }, [C('Camera', { main: true, fov: 55, clear: 'color', bg: '#05060f' })]),
    obj('Lumière', { p: [3, 10, 4], r: [-60, 20, 0] }, [C('Light', { kind: 'Directional', intensity: 1.5, color: '#dfe8ff', shadows: false })]),
    obj('Lumière bleue', { p: [-6, 4, -6] }, [C('Light', { kind: 'Point', intensity: 2, color: '#4f7cff', range: 18, shadows: false })]),
    obj('Étoiles', { p: [0, -4, -24], r: [0, 180, 0], s: [36, 1, 1] }, [C('ParticleSystem', { rate: 60, lifetime: 5, speed: 9, spread: 0, shape: 'Box', size: 0.18, endSize: 0.12, startColor: '#ffffff', endColor: '#9fb4ff', additive: true, burst: 0, max: 600 })]),
    { ...obj('Vaisseau', { p: [0, 0, 3], tag: 'Player' }, [C('SphereCollider', { radius: 0.7 }), C('Rigidbody', { isKinematic: true, useGravity: false }), S(ship)]), id: shipId },
    obj('Coque', { parent: shipId, r: [-90, 0, 0], s: [1, 1.6, 0.6] }, [C('MeshRenderer', { mesh: 'Cone', color: '#e8eefc', metalness: 0.6, roughness: 0.3, castShadows: false })]),
    obj('Ailes', { parent: shipId, p: [0, 0, 0.3], s: [2.2, 0.12, 0.7] }, [C('MeshRenderer', { mesh: 'Cube', color: '#3b82f6', metalness: 0.5, roughness: 0.4 })]),
    obj('Réacteur', { parent: shipId, p: [0, 0, 0.85], r: [0, 180, 0] }, [C('ParticleSystem', { rate: 50, lifetime: 0.35, speed: 4, spread: 12, size: 0.35, endSize: 0.02, startColor: '#7dd3fc', endColor: '#1d4ed8', worldSpace: true, max: 200 })]),
    obj('Générateur', { p: [0, 0, -26] }, [S(spawner)]),
    obj('GameManager', {}, [S(gm)]),
    obj('Score', {}, [C('UIText', { text: 'Score 0', fontSize: 26, anchor: 'top-center', pos: [0, 22], align: 'center' })]),
    { ...obj('Fin de partie', { active: false }, [C('UIText', { text: 'GAME OVER', fontSize: 54, anchor: 'center', pos: [0, -70], align: 'center', color: '#ff5a5a' })]), id: goId },
    obj('Rejouer', { parent: goId }, [C('UIButton', { label: 'Rejouer', onClick: 'Rejouer', anchor: 'center', pos: [0, 30], size: [200, 60], color: '#22c55e', fontSize: 24 })]),
  ];
  const sid = () => uid();
  const ast = sid(), las = sid(), exp = sid();
  p.prefabs.push(
    { id: uid(), name: 'Astéroïde', objects: [{ id: ast, name: 'Astéroïde', parent: null, active: true, tag: 'Enemy', t: { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }, c: [C('MeshRenderer', { mesh: 'Icosphere', color: '#9b8673', flatShading: true, roughness: 1 }), C('SphereCollider', { radius: 0.5 }), C('Rigidbody', { useGravity: false, angularDrag: 0, drag: 0, mass: 3, freezePos: [false, true, false] }), S(asteroid)] }] },
    { id: uid(), name: 'Laser', objects: [{ id: las, name: 'Laser', parent: null, active: true, tag: 'Bullet', t: { p: [0, 0, 0], r: [90, 0, 0], s: [0.15, 0.35, 0.15] }, c: [C('MeshRenderer', { mesh: 'Capsule', color: '#7df9ff', unlit: true, castShadows: false }), C('SphereCollider', { radius: 1.2, isTrigger: true }), C('Rigidbody', { useGravity: false, drag: 0, mass: 0.1 }), S(bullet)] }] },
    { id: uid(), name: 'Explosion', objects: [{ id: exp, name: 'Explosion', parent: null, active: true, tag: 'Untagged', t: { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }, c: [C('ParticleSystem', { loop: false, rate: 0, burst: 60, duration: 0.2, lifetime: 0.7, speed: 7, shape: 'Sphere', size: 0.6, endSize: 0.05, startColor: '#ffd36b', endColor: '#ff3b1f', additive: true })] }] }
  );
  p.scenes.push(scene('Espace', objs, { sky: 'color', bg: '#05060f', ambient: '#8899ff', ambientIntensity: 0.35 }));
}

function physicsSandbox(p) {
  p.settings.controls = { joystick: false, buttonA: true, buttonB: true, labelA: 'Cube', labelB: 'Boum' };
  const launcher = script(
    'Lanceur',
    `
class Lanceur extends MonoBehaviour {
  force = 22;

  Update() {
    // Toucher l'écran : lance une balle vers le point touché
    if (Input.GetMouseButtonDown(0)) {
      const rayon = Camera.main.ScreenPointToRay(Input.mousePosition);
      const balle = GameObject.CreatePrimitive("Sphere");
      balle.transform.position = rayon.origin.add(rayon.direction.mul(1.5));
      balle.transform.localScale = Vector3.one.mul(0.6);
      balle.GetComponent("MeshRenderer").material.color = Random.ColorHSV();
      const rb = balle.AddComponent("Rigidbody");
      rb.AddForce(rayon.direction.mul(this.force), ForceMode.VelocityChange);
      Destroy(balle, 10);
      Audio.Play("blip");
    }

    // A : fait tomber un cube
    if (Input.GetButtonDown("Jump")) {
      const c = GameObject.CreatePrimitive("Cube");
      c.transform.position = new Vector3(Random.Float(-3, 3), 9, Random.Float(-3, 3));
      c.transform.rotation = Random.rotation;
      c.GetComponent("MeshRenderer").material.color = Random.ColorHSV();
      c.AddComponent("Rigidbody");
    }

    // B : explosion au centre
    if (Input.GetButtonDown("Fire1")) {
      for (const rb of GameObject.FindObjectsOfType("Rigidbody")) {
        rb.AddExplosionForce(14, new Vector3(0, 0, 0), 12, 1.5);
      }
      Audio.Play("explosion");
    }
  }
}`
  );
  p.scripts.push(launcher);
  const objs = [
    camera3D([0, 6, 15], [-18, 0, 0], [S(launcher)]),
    sun(),
    obj('Sol', { s: [3, 1, 3] }, [C('MeshRenderer', { mesh: 'Plane', color: '#d9dee7', roughness: 0.95 }), box([10, 0.02, 10], [0, -0.01, 0])]),
    obj('Rampe', { p: [-6, 1, 0], r: [0, 0, -20], s: [6, 0.3, 3] }, [C('MeshRenderer', { mesh: 'Cube', color: '#f59e0b' }), box([1, 1, 1])]),
    obj('Balle rebondissante', { p: [6, 6, 0], s: [1.2, 1.2, 1.2] }, [C('MeshRenderer', { mesh: 'Sphere', color: '#ef4444', roughness: 0.3 }), C('SphereCollider', { radius: 0.5 }), C('Rigidbody', { bounciness: 0.9, mass: 0.5 })]),
    obj('Aide', {}, [C('UIText', { text: 'Touche l\'écran pour lancer une balle\nA : cube   •   B : boum !', fontSize: 18, anchor: 'top-center', pos: [0, 18], align: 'center' })]),
  ];
  const colors = ['#6366f1', '#22c55e', '#06b6d4', '#ec4899', '#eab308'];
  let k = 0;
  for (let layer = 0; layer < 5; layer++) {
    const count = 5 - layer;
    for (let i = 0; i < count; i++) {
      objs.push(obj(`Brique ${++k}`, { p: [(i - (count - 1) / 2) * 1.02, 0.5 + layer * 1.0, 0] }, [C('MeshRenderer', { mesh: 'Cube', color: colors[layer] }), box([1, 1, 1]), C('Rigidbody', { mass: 1, friction: 0.6 })]));
    }
  }
  for (let i = 0; i < 3; i++)
    objs.push(obj(`Cylindre ${i + 1}`, { p: [3 + i * 1.3, 1, -3], s: [0.6, 0.5, 0.6] }, [C('MeshRenderer', { mesh: 'Cylinder', color: '#94a3b8', metalness: 0.7, roughness: 0.3 }), C('CylinderCollider', { radius: 0.5, height: 2 }), C('Rigidbody', { mass: 2 })]));
  p.scenes.push(scene('Bac à sable', objs));
}

// ===================================================================== Mondes avec personnages animés

function rng(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r2 = (v) => Math.round(v * 100) / 100;
const libC = (p, id, props = {}) => C('Script', { script: ensureLibScript(p, id).script.id, props });
const goRef = (id) => ({ ref: 'go', id });
function sparkles(p, a, b) {
  p.prefabs.push({
    id: uid(),
    name: 'Étincelles',
    objects: [{ id: uid(), name: 'Étincelles', parent: null, active: true, tag: 'Untagged', t: { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }, c: [C('ParticleSystem', { loop: false, rate: 0, burst: 28, duration: 0.2, lifetime: 0.6, speed: 4, shape: 'Sphere', size: 0.3, endSize: 0.04, startColor: a, endColor: b, gravity: 0.4 })] }],
  });
}
function endScreens(objs, winText) {
  const fin = uid();
  objs.push(
    obj('Victoire', { active: false }, [C('UIText', { text: winText, fontSize: 34, anchor: 'center', pos: [0, -60], align: 'center', color: '#fde68a' })]),
    { ...obj('Fin de partie', { active: false }, [C('UIText', { text: 'Oups… 💫', fontSize: 46, anchor: 'center', pos: [0, -70], align: 'center', color: '#fca5a5' })]), id: fin },
    obj('Rejouer', { parent: fin }, [C('UIButton', { label: 'Rejouer', onClick: 'Rejouer', anchor: 'center', pos: [0, 30], size: [200, 58], color: '#22c55e', fontSize: 24 })])
  );
}

function world3D(p) {
  p.settings.controls = { joystick: true, buttonA: true, buttonB: false, labelA: 'Saut', labelB: 'B' };
  const R = rng(2024);
  const objs = [];
  const hero = buildCharacter('perso3d', p, { position: [0, 1.2, 6] });
  const heroId = hero.rootId;
  hero.objects[0].c.push(libC(p, 'vie'));
  objs.push(
    obj('Main Camera', { p: [0, 4.5, 13], r: [-15, 0, 0], tag: 'MainCamera' }, [C('Camera', { main: true, fov: 60, far: 400 }), libC(p, 'cam3p', { cible: goRef(heroId) }), libC(p, 'shake')]),
    obj('Soleil', { p: [6, 14, 14], r: [-50, 35, 0] }, [C('Light', { kind: 'Directional', intensity: 1.5, color: '#fff1d6' }), libC(p, 'suivre', { cible: goRef(heroId) })]),
    obj('Sol', { s: [10, 1, 10] }, [C('MeshRenderer', { mesh: 'Plane', color: '#5fae55', roughness: 1 }), box([10, 0.02, 10], [0, -0.01, 0])])
  );
  objs.push(...hero.objects);
  for (const [x, y, z, d] of [[-24, -3.2, -20, 9], [27, -3.6, -9, 10], [6, -4.2, -32, 11], [-31, -3.4, 15, 9]])
    objs.push(obj('Colline', { p: [x, y, z], s: [d, d, d] }, [C('MeshRenderer', { mesh: 'Sphere', color: '#58a14f', roughness: 1 }), C('SphereCollider', { radius: 0.5 })]));
  objs.push(obj('Lac', { p: [-13, 0.03, 4], s: [1.4, 1, 1] }, [C('MeshRenderer', { mesh: 'Plane', color: '#3b82f6', metalness: 0.3, roughness: 0.12, opacity: 0.88, castShadows: false })]));
  // forêt
  const foret = uid();
  objs.push({ ...obj('Forêt', {}), id: foret });
  const places = [];
  const libre = (x, z, min) => Math.hypot(x, z - 4) > 9 && Math.hypot(x + 13, z - 4) > 8 && places.every(([a, b]) => Math.hypot(a - x, b - z) > min);
  const verts = ['#3f9b4b', '#4caf50', '#2f855a', '#68b04d'];
  let n = 0;
  for (let tries = 0; n < 30 && tries < 600; tries++) {
    const x = r2(R() * 90 - 45), z = r2(R() * 90 - 45);
    if (!libre(x, z, 4.5)) continue;
    places.push([x, z]);
    n++;
    const t = uid();
    objs.push({ ...obj('Arbre ' + n, { parent: foret, p: [x, 0, z], r: [0, Math.round(R() * 360), 0] }), id: t });
    if (R() < 0.4) {
      objs.push(obj('Tronc', { parent: t, p: [0, 0.6, 0], s: [0.3, 0.6, 0.3] }, [C('MeshRenderer', { mesh: 'Cylinder', color: '#7c4a24' }), C('CylinderCollider', { radius: 0.5, height: 2 })]));
      for (const [y, k] of [[2, 2.4], [3.1, 1.8], [4, 1.1]]) objs.push(obj('Branches', { parent: t, p: [0, y, 0], s: [k, k * 0.85, k] }, [C('MeshRenderer', { mesh: 'Cone', color: '#2f6b3f', flatShading: true, roughness: 0.9 })]));
    } else {
      const k = r2(2.2 + R() * 1.2);
      objs.push(obj('Tronc', { parent: t, p: [0, 0.9, 0], s: [0.35, 0.9, 0.35] }, [C('MeshRenderer', { mesh: 'Cylinder', color: '#8b5a2b' }), C('CylinderCollider', { radius: 0.5, height: 2 })]));
      objs.push(obj('Feuillage', { parent: t, p: [0, 2.5, 0], s: [k, r2(k * 0.9), k] }, [C('MeshRenderer', { mesh: 'Icosphere', color: verts[Math.floor(R() * 4)], flatShading: true, roughness: 0.9 })]));
      objs.push(obj('Feuillage 2', { parent: t, p: [0.4, 3.2, 0.2], s: [1.5, 1.4, 1.5] }, [C('MeshRenderer', { mesh: 'Icosphere', color: '#7cc46a', flatShading: true, roughness: 0.9 })]));
    }
  }
  // rochers et fleurs
  const deco = uid();
  objs.push({ ...obj('Décor', {}), id: deco });
  for (let i = 0; i < 14; i++) {
    const x = r2(R() * 80 - 40), z = r2(R() * 80 - 40);
    if (!libre(x, z, 2.5)) continue;
    const k = r2(0.6 + R() * 1.1);
    objs.push(obj('Rocher', { parent: deco, p: [x, r2(k * 0.25), z], r: [Math.round(R() * 360), Math.round(R() * 360), 0], s: [k, r2(k * 0.7), k] }, [C('MeshRenderer', { mesh: 'Icosphere', color: '#9ca3af', flatShading: true, roughness: 1 }), C('SphereCollider', { radius: 0.45 })]));
  }
  const fleurs = ['#f472b6', '#facc15', '#f87171', '#a78bfa', '#ffffff'];
  for (let i = 0; i < 36; i++) {
    const x = r2(R() * 70 - 35), z = r2(R() * 70 - 35);
    if (Math.hypot(x + 13, z - 4) < 7) continue;
    objs.push(obj('Fleur', { parent: deco, p: [x, 0.12, z], s: [0.18, 0.18, 0.18] }, [C('MeshRenderer', { mesh: 'Sphere', color: fleurs[i % 5], castShadows: false })]));
  }
  // gemmes à ramasser
  const gemmes = uid();
  objs.push({ ...obj('Gemmes', {}), id: gemmes });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + R() * 0.4;
    const d = 8 + R() * 30;
    objs.push(
      obj('Gemme', { parent: gemmes, p: [r2(Math.cos(a) * d), 1, r2(Math.sin(a) * d)], s: [0.55, 0.7, 0.55], tag: 'Collectible' }, [
        C('MeshRenderer', { mesh: 'Icosphere', color: '#c084fc', emissive: '#7e22ce', emissiveIntensity: 0.8, flatShading: true, metalness: 0.3, roughness: 0.2 }),
        C('SphereCollider', { radius: 0.8, isTrigger: true }),
        libC(p, 'ramassable'),
        libC(p, 'flotter'),
      ])
    );
  }
  // slimes
  for (const pos of [[12, 1, -6], [-8, 1, -16], [18, 1, 14], [-22, 1, -3]]) {
    const s = buildCharacter('slime', p, { position: pos });
    s.objects[0].c.find((c) => c.type === 'Script').props = { cible: goRef(heroId) };
    objs.push(...s.objects);
  }
  // panneau d'accueil
  const pan = uid();
  objs.push(
    { ...obj('Panneau', { p: [2.6, 0, 3.4], r: [0, -20, 0] }, [box([3, 2, 3], [0, 1, 0], { isTrigger: true }), libC(p, 'panneau', { message: 'Bienvenue ! Ramasse les 12 gemmes 💎\nAttention aux slimes 🟢\nGlisse le doigt à droite pour tourner la caméra.' })]), id: pan },
    obj('Poteau', { parent: pan, p: [0, 0.6, 0], s: [0.12, 0.6, 0.12] }, [C('MeshRenderer', { mesh: 'Cylinder', color: '#7c4a24' })]),
    obj('Planche', { parent: pan, p: [0, 1.35, 0], s: [1.3, 0.62, 0.08] }, [C('MeshRenderer', { mesh: 'Cube', color: '#c08a3e' })])
  );
  objs.push(
    obj('GameManager', {}, [libC(p, 'gestion', { icone: '💎' })]),
    obj('Score', {}, [C('UIText', { text: '💎 0 / 12', fontSize: 28, anchor: 'top-left', pos: [18, 22] })]),
    obj('BarreDeVie', {}, [C('UIImage', { color: '#ef4444', anchor: 'top-right', pos: [18, 30], size: [130, 16], radius: 8 })]),
    obj('Coeur', {}, [C('UIText', { text: '❤️', fontSize: 20, anchor: 'top-right', pos: [152, 24], shadow: false })]),
    obj('Message', { active: false }, [C('UIText', { text: '', fontSize: 17, anchor: 'bottom-center', pos: [0, 170], align: 'center' })])
  );
  endScreens(objs, 'Bravo ! Toutes les gemmes 🎉');
  sparkles(p, '#f5d0fe', '#a855f7');
  p.scenes.push(scene('Monde', objs, { skyTop: '#3d8fe0', skyHorizon: '#d6ecff', skyBottom: '#5fae55', ambientIntensity: 0.6, fog: true, fogColor: '#d6ecff', fogNear: 35, fogFar: 120 }));
}

function adventure2D(p) {
  p.settings.is2D = true;
  p.settings.gravity = [0, -25, 0];
  p.settings.controls = { joystick: true, buttonA: true, buttonB: false, labelA: 'Saut', labelB: 'B' };
  const objs = [];
  const hero = buildCharacter('perso2d', p, { position: [-4, -1.4, 0] });
  const heroId = hero.rootId;
  hero.objects[0].c.push(libC(p, 'vie'));
  const sq = (shape, color, size, order = 0) => C('SpriteRenderer', { shape, color, size, order });
  objs.push(obj('Main Camera', { p: [-2, 0, 10], tag: 'MainCamera' }, [C('Camera', { main: true, ortho: true, orthoSize: 5.5, clear: 'color', bg: '#8fd3ff' }), libC(p, 'cam2d', { cible: goRef(heroId) }), libC(p, 'shake')]));
  // décor en parallaxe
  const layer = (name, z, facteur) => {
    const id = uid();
    objs.push({ ...obj(name, { p: [0, 0, z] }, [libC(p, 'parallaxe', { facteur })]), id });
    return id;
  };
  const mont = layer('Montagnes', -9, 0.85);
  for (let i = 0; i < 7; i++) {
    const x = i * 9 - 12;
    objs.push(obj('Montagne', { parent: mont, p: [x, 0.5, 0] }, [sq('Triangle', i % 2 ? '#a9c9ee' : '#bcd6f3', [12, 8], -30)]));
    objs.push(obj('Neige', { parent: mont, p: [x, 3.4, 0.01] }, [sq('Triangle', '#f8fafc', [3, 2.2], -29)]));
  }
  const nua = layer('Nuages', -8, 0.92);
  for (let i = 0; i < 8; i++) objs.push(obj('Nuage', { parent: nua, p: [i * 8 - 10 + (i % 3), 3.8 + (i % 2) * 1.2, 0] }, [sq('Capsule', '#ffffff', [3.6 + (i % 3), 1.2], -25)]));
  const col = layer('Collines', -6, 0.6);
  for (let i = 0; i < 7; i++) objs.push(obj('Colline', { parent: col, p: [i * 11 - 10, -3.6, 0] }, [sq('Circle', i % 2 ? '#8fd47e' : '#a3e08f', [15, 7], -20)]));
  // niveau
  const bloc = (name, cx, cy, w, hh) => {
    const id = uid();
    objs.push({ ...obj(name, { p: [cx, cy, 0], tag: 'Ground' }, [sq('Square', '#7a4a2a', [w, hh]), box([w, hh, 1])]), id });
    objs.push(obj('Herbe', { parent: id, p: [0, hh / 2 - 0.1, 0.01] }, [sq('Square', '#5bbf4a', [w, 0.26], 1)]));
  };
  bloc('Sol A', 3, -3, 20, 2);
  bloc('Mur', -8, 1, 1, 10);
  bloc('Sol B', 27, -3, 16, 2);
  bloc('Sol C', 44, -2, 14, 4);
  bloc('Plateforme 1', 5, 0.5, 3, 0.5);
  bloc('Plateforme 2', 9.5, 2.3, 3, 0.5);
  bloc('Plateforme 3', 24, 0.3, 2.5, 0.5);
  bloc('Plateforme 4', 28.5, 2.2, 2.5, 0.5);
  bloc('Plateforme 5', 33, 3.8, 2, 0.5);
  objs.push(
    obj('Plateforme mobile', { p: [16, -3.5, 0] }, [sq('Square', '#f59e0b', [2.4, 0.5]), box([2.4, 0.5, 1]), C('Rigidbody', { isKinematic: true, useGravity: false }), libC(p, 'plateforme', { deplacement: [0, 3, 0], duree: 2, pause: 0.5 })]),
    obj('Vide', { p: [22, -9, 0] }, [box([90, 2, 4], [0, 0, 0], { isTrigger: true }), libC(p, 'mort')])
  );
  const drap = uid();
  objs.push(
    { ...obj('Point de contrôle', { p: [20.5, -1.3, 0] }, [sq('Square', '#94a3b8', [0.12, 1.4]), box([1, 1.6, 1], [0, 0, 0], { isTrigger: true }), libC(p, 'checkpoint')]), id: drap },
    obj('Fanion', { parent: drap, p: [0.3, 0.45, 0.01], r: [0, 0, -90] }, [sq('Triangle', '#e5e7eb', [0.5, 0.55], 1)])
  );
  const pieces = [[-1, -1.4], [0, -1.4], [1, -1.4], [5, 1.4], [9.5, 3.2], [10.5, 3.2], [16, 1], [24, 1.2], [28.5, 3.1], [33, 4.7], [33.8, 4.7], [40, 1], [41, 1.6], [42, 1], [46, 1], [47, 1]];
  for (const [x, y] of pieces) {
    const id = uid();
    objs.push(
      { ...obj('Pièce', { p: [x, y, 0], tag: 'Collectible' }, [sq('Circle', '#fcd34d', [0.5, 0.5], 1), C('SphereCollider', { radius: 0.3, isTrigger: true }), libC(p, 'ramassable', { son: 'sfx:coin' }), libC(p, 'flotter', { hauteur: 0.12, vitesse: 3 })]), id },
      obj('Brillance', { parent: id, p: [-0.08, 0.08, 0.01] }, [sq('Circle', '#fff7c2', [0.2, 0.2], 2)])
    );
  }
  for (const pos of [[8, -1.65, 0], [26, -1.65, 0], [43, 0.35, 0]]) objs.push(...buildCharacter('ennemi2d', p, { position: pos }).objects);
  objs.push(
    obj('Arrivée', { p: [49, 1.2, 0] }, [
      sq('Star', '#fde047', [1.4, 1.4], 1),
      box([1.2, 1.2, 1], [0, 0, 0], { isTrigger: true }),
      libC(p, 'arrivee'),
      libC(p, 'rotation', { vitesse: [0, 0, 60] }),
      C('ParticleSystem', { playOnAwake: false, loop: false, rate: 0, burst: 60, lifetime: 1, speed: 5, shape: 'Sphere', size: 0.3, startColor: '#fff59d', endColor: '#f472b6' }),
    ])
  );
  objs.push(...hero.objects);
  objs.push(
    obj('GameManager', {}, [libC(p, 'gestion', { icone: '🪙', objectif: -1 })]),
    obj('Score', {}, [C('UIText', { text: '🪙 0', fontSize: 30, anchor: 'top-left', pos: [18, 22] })]),
    obj('BarreDeVie', {}, [C('UIImage', { color: '#ef4444', anchor: 'top-right', pos: [18, 30], size: [130, 16], radius: 8 })]),
    obj('Coeur', {}, [C('UIText', { text: '❤️', fontSize: 20, anchor: 'top-right', pos: [152, 24], shadow: false })])
  );
  endScreens(objs, 'Niveau terminé ! ⭐');
  sparkles(p, '#fff3a0', '#ff9d00');
  p.scenes.push(scene('Niveau 1', objs, { sky: 'color', bg: '#8fd3ff' }));
}

export const TEMPLATES = [
  { id: 'monde3d', name: 'Monde 3D', icon: '🌳', desc: 'Promène un perso animé dans un monde ouvert : forêt, gemmes, slimes, caméra au doigt.', build: world3D },
  { id: 'aventure2d', name: 'Aventure 2D', icon: '🦸', desc: 'Un héros 2D animé, pièces, ennemis à écraser, plateforme mobile et drapeau.', build: adventure2D },
  { id: '3d', name: '3D vide', icon: '🧊', desc: 'Caméra, lumière, sol et un cube. Le point de départ classique.', build: empty3D },
  { id: '2d', name: '2D vide', icon: '🟧', desc: 'Caméra orthographique et un sprite, pour les jeux 2D.', build: empty2D },
  { id: 'rollaball', name: 'Balle roulante 3D', icon: '⚽', desc: 'Le tuto culte : fais rouler la balle et ramasse tous les bonus.', build: rollABall },
  { id: 'platformer', name: 'Plateforme 2D', icon: '🍄', desc: 'Saute de plateforme en plateforme, ramasse les pièces, écrase les ennemis.', build: platformer2D },
  { id: 'shooter', name: 'Shooter spatial', icon: '🚀', desc: 'Pilote un vaisseau, détruis les astéroïdes, bats ton record.', build: spaceShooter },
  { id: 'sandbox', name: 'Bac à sable physique', icon: '🧱', desc: 'Lance des balles sur une tour de briques. Pure physique !', build: physicsSandbox },
];

export function createProject(name, templateId = '3d') {
  const now = Date.now();
  const p = {
    id: uid(),
    name: name || 'Mon jeu',
    version: 1,
    created: now,
    modified: now,
    template: templateId,
    settings: baseSettings(),
    scenes: [],
    scripts: [],
    prefabs: [],
    assets: [],
    activeScene: null,
    thumb: '',
  };
  const t = TEMPLATES.find((x) => x.id === templateId) || TEMPLATES[0];
  t.build(p);
  p.activeScene = p.scenes[0].id;
  p.settings.startScene = p.scenes[0].id;
  return p;
}

/** Met à niveau un projet importé / ancien */
export function normalizeProject(p) {
  p.settings = { ...baseSettings(), ...(p.settings || {}) };
  p.settings.controls = { ...baseSettings().controls, ...(p.settings.controls || {}) };
  p.scenes = p.scenes && p.scenes.length ? p.scenes : [scene('SampleScene', [camera3D(), sun()])];
  p.scripts = p.scripts || [];
  p.prefabs = p.prefabs || [];
  p.assets = p.assets || [];
  for (const s of p.scenes) s.env = { ...DEFAULT_ENV, ...(s.env || {}) };
  if (!p.scenes.find((s) => s.id === p.activeScene)) p.activeScene = p.scenes[0].id;
  if (!p.scenes.find((s) => s.id === p.settings.startScene)) p.settings.startScene = p.scenes[0].id;
  p.engineVersion = APP_VERSION;
  return p;
}

/**
 * Met à jour les scripts venant d'un modèle avec leur dernière version,
 * uniquement s'ils n'ont jamais été modifiés. Retourne le nombre de scripts mis à jour.
 */
export function upgradeTemplateScripts(p) {
  let n = 0;
  // scripts de la bibliothèque
  for (const s of p.scripts || []) if (s.lib && upgradeLibScript(s)) n++;
  // scripts propres au modèle
  const t = TEMPLATES.find((x) => x.id === p.template);
  if (!t) return n;
  let fresh;
  try {
    fresh = createProject('x', t.id).scripts;
  } catch {
    return n;
  }
  for (const s of p.scripts || []) {
    if (s.lib) continue;
    const f = fresh.find((x) => x.name === s.name);
    if (!f) continue;
    if (!s.tplHash) {
      // ancien projet : on suit le script s'il est identique au modèle actuel
      if (s.code === f.code) s.tplHash = f.tplHash;
      continue;
    }
    if (codeHash(s.code) !== s.tplHash) continue; // modifié par l'utilisateur : on n'y touche pas
    if (s.code !== f.code) {
      s.code = f.code;
      s.tplHash = f.tplHash;
      n++;
    }
  }
  return n;
}

export function newScene(name, is2D) {
  if (is2D)
    return scene(name, [obj('Main Camera', { p: [0, 0, 10], tag: 'MainCamera' }, [C('Camera', { main: true, ortho: true, orthoSize: 5, clear: 'color', bg: '#2d3b55' })])], { sky: 'color', bg: '#2d3b55' });
  return scene(name, [camera3D(), sun()]);
}
