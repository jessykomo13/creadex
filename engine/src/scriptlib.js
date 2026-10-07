// Bibliothèque de scripts prêts à l'emploi (Ajouter un composant → Bibliothèque, ou Projet → ＋ Script)
// Chaque script garde sa classe d'origine (cls) ; elle est renommée si l'utilisateur choisit un autre nom.

import { uid, codeHash, uniqueName } from './util.js';

const S = (id, cls, name, icon, cat, desc, code) => ({ id, cls, name, icon, cat, desc, code: code.trim() + '\n' });

export const SCRIPT_CATEGORIES = ['Déplacement', 'Caméra', 'Animation', 'Ennemis', 'Gameplay', 'Interface'];

export const SCRIPT_LIBRARY = [
  // ================================================================ Déplacement
  S('perso3d', 'PersoController3D', 'Perso 3D : marcher et sauter', '🏃', 'Déplacement',
    'Joystick pour marcher (par rapport à la caméra), A pour sauter, double saut. À mettre sur un objet avec Rigidbody + Capsule Collider.', `
class PersoController3D extends MonoBehaviour {
  vitesse = 5;
  vitesseRotation = 12;
  saut = 7;
  doubleSaut = true;
  hauteurPieds = 0.75;

  Start() {
    this.rb = this.GetComponent("Rigidbody");
    this.depart = this.transform.position.clone();
    this.sautsBonus = 0;
    this.recul = 0;
    this.auSol = false;
  }

  VerifierSol() {
    const p = this.transform.position;
    const y = p.y - this.hauteurPieds + 0.2;
    for (const d of [[0, 0], [0.2, 0], [-0.2, 0], [0, 0.2], [0, -0.2]]) {
      if (Physics.Raycast(new Vector3(p.x + d[0], y, p.z + d[1]), Vector3.down, 0.32)) return true;
    }
    return false;
  }

  Update() {
    if (!this.rb) return;
    const h = Input.GetAxis("Horizontal");
    const v = Input.GetAxis("Vertical");
    // directions de la caméra, à plat
    let avant = Vector3.forward, droite = Vector3.right;
    const cam = Camera.main;
    if (cam) {
      avant = cam.transform.forward.withY(0);
      if (avant.sqrMagnitude < 0.01) avant = cam.transform.up.withY(0);
      avant = avant.normalized;
      droite = cam.transform.right.withY(0).normalized;
    }
    let dir = droite.mul(h).add(avant.mul(v));
    if (dir.magnitude > 1) dir = dir.normalized;
    const vy = this.rb.velocity.y;
    if (this.recul > 0) this.recul -= Time.deltaTime;
    else this.rb.velocity = new Vector3(dir.x * this.vitesse, vy, dir.z * this.vitesse);
    // se tourner vers la direction de marche
    if (dir.sqrMagnitude > 0.01) {
      const cible = Quaternion.LookRotation(dir);
      this.transform.rotation = Quaternion.Slerp(this.transform.rotation, cible, Mathf.Clamp01(this.vitesseRotation * Time.deltaTime));
    }
    this.auSol = this.VerifierSol();
    if (this.auSol && vy <= 0.1) this.sautsBonus = this.doubleSaut ? 1 : 0;
    if (Input.GetButtonDown("Jump")) {
      if (this.auSol) this.Sauter();
      else if (this.sautsBonus > 0) { this.sautsBonus--; this.Sauter(); }
    }
    if (this.transform.position.y < -20) this.Reapparaitre();
  }

  Sauter() {
    this.rb.velocity.y = this.saut;
    Audio.Play("jump", 0.4);
    this.SendMessage("AuSaut");
  }

  // appelé par les ennemis : on perd le contrôle un court instant
  Repousser(duree) { this.recul = typeof duree === "number" ? duree : 0.3; }
  NouveauDepart(p) { this.depart = Vector3.from(p); }
  Reapparaitre() {
    this.transform.position = this.depart;
    this.rb.velocity = Vector3.zero;
  }
}`),

  S('perso2d', 'PersoPlateforme2D', 'Perso 2D : plateforme', '🦘', 'Déplacement',
    'Course fluide, saut précis (saut tardif, saut anticipé, saut plus court si on relâche), double saut. Rigidbody avec position Z et rotations bloquées.', `
class PersoPlateforme2D extends MonoBehaviour {
  vitesse = 7;
  acceleration = 60;
  saut = 12;
  doubleSaut = true;
  demiHauteur = 0.45;

  Start() {
    this.rb = this.GetComponent("Rigidbody");
    this.sprite = this.GetComponent("SpriteRenderer");
    this.depart = this.transform.position.clone();
    this.coyote = 0;
    this.tampon = 0;
    this.sautsBonus = 0;
    this.recul = 0;
  }

  AuSol() {
    const p = this.transform.position;
    for (const dx of [-0.3, 0, 0.3]) {
      if (Physics.Raycast(new Vector3(p.x + dx, p.y - this.demiHauteur + 0.05, p.z), Vector3.down, 0.15)) return true;
    }
    return false;
  }

  Update() {
    if (!this.rb) return;
    const dt = Time.deltaTime;
    const h = Input.GetAxis("Horizontal");
    if (this.recul > 0) this.recul -= dt;
    else this.rb.velocity.x = Mathf.MoveTowards(this.rb.velocity.x, h * this.vitesse, this.acceleration * dt);
    if (this.sprite && Math.abs(h) > 0.1) this.sprite.flipX = h < 0;

    const sol = this.AuSol();
    if (sol) {
      this.coyote = 0.12;
      this.sautsBonus = this.doubleSaut ? 1 : 0;
    } else this.coyote -= dt;
    // saut anticipé : on retient l'appui un court instant
    if (Input.GetButtonDown("Jump")) this.tampon = 0.15;
    else this.tampon -= dt;
    if (this.tampon > 0) {
      if (this.coyote > 0) { this.coyote = 0; this.Sauter(); }
      else if (this.sautsBonus > 0 && Input.GetButtonDown("Jump")) { this.sautsBonus--; this.Sauter(); }
    }
    // relâcher tôt = saut plus court
    if (Input.GetButtonUp("Jump") && this.rb.velocity.y > 0) this.rb.velocity.y = this.rb.velocity.y * 0.5;
    if (this.transform.position.y < -15) this.Reapparaitre();
  }

  Sauter() {
    this.tampon = 0;
    this.rb.velocity.y = this.saut;
    Audio.Play("jump", 0.4);
    this.SendMessage("AuSaut");
  }

  Rebondir(force) { this.rb.velocity.y = typeof force === "number" ? force : 9; }
  Repousser(duree) { this.recul = typeof duree === "number" ? duree : 0.3; }
  NouveauDepart(p) { this.depart = Vector3.from(p); }
  Reapparaitre() {
    this.transform.position = this.depart;
    this.rb.velocity = Vector3.zero;
  }
}`),

  S('topdown', 'VueDeDessus', 'Vue de dessus', '🧭', 'Déplacement',
    'Déplacement libre au joystick (jeux vus du dessus). En 3D sur X/Z, en 2D sur X/Y (coche mode2D et désactive la gravité du Rigidbody).', `
class VueDeDessus extends MonoBehaviour {
  vitesse = 6;
  mode2D = false;
  tourner = true;

  Start() {
    this.rb = this.GetComponent("Rigidbody");
  }

  Update() {
    const h = Input.GetAxis("Horizontal");
    const v = Input.GetAxis("Vertical");
    let d = this.mode2D ? new Vector3(h, v, 0) : new Vector3(h, 0, -v);
    if (d.magnitude > 1) d = d.normalized;
    if (this.rb && !this.rb.isKinematic) {
      const vy = this.rb.velocity.y;
      this.rb.velocity = this.mode2D ? d.mul(this.vitesse) : new Vector3(d.x * this.vitesse, vy, d.z * this.vitesse);
    } else {
      this.transform.Translate(d.mul(this.vitesse * Time.deltaTime), Space.World);
    }
    if (this.tourner && d.sqrMagnitude > 0.01) {
      if (this.mode2D) this.transform.localEulerAngles = new Vector3(0, 0, Math.atan2(d.y, d.x) * Mathf.Rad2Deg - 90);
      else this.transform.rotation = Quaternion.Slerp(this.transform.rotation, Quaternion.LookRotation(d), Mathf.Clamp01(12 * Time.deltaTime));
    }
  }
}`),

  S('voiture', 'Voiture', 'Voiture arcade', '🏎️', 'Déplacement',
    'Haut/bas pour accélérer et freiner, gauche/droite pour tourner. Fait tourner les roues nommées RoueAVG, RoueAVD, RoueARG, RoueARD (avec un enfant « Pneu »).', `
class Voiture extends MonoBehaviour {
  vitesseMax = 14;
  acceleration = 10;
  braquage = 110;

  Start() {
    this.rb = this.GetComponent("Rigidbody");
    this.vitesse = 0;
    this.depart = this.transform.position.clone();
    this.roues = ["RoueAVG", "RoueAVD", "RoueARG", "RoueARD"].map((n) => this.transform.Find(n));
  }

  Update() {
    const dt = Time.deltaTime;
    const h = Input.GetAxis("Horizontal");
    const v = Input.GetAxis("Vertical");
    const freinage = v === 0 ? 0.6 : Math.sign(v) !== Math.sign(this.vitesse) ? 2 : 1;
    this.vitesse = Mathf.MoveTowards(this.vitesse, v * this.vitesseMax, this.acceleration * freinage * dt);
    const k = Mathf.Clamp01(Math.abs(this.vitesse) / 4);
    if (k > 0) this.transform.Rotate(0, -h * this.braquage * k * Math.sign(this.vitesse) * dt, 0);
    const avant = this.transform.forward;
    if (this.rb) {
      const vy = this.rb.velocity.y;
      this.rb.velocity = new Vector3(avant.x * this.vitesse, vy, avant.z * this.vitesse);
    } else this.transform.position = this.transform.position.add(avant.mul(this.vitesse * dt));
    // roues : braquage à l'avant, rotation de toutes les roues
    this.roues.forEach((r, i) => {
      if (!r) return;
      if (i < 2) r.localEulerAngles = new Vector3(0, -h * 28, 0);
      const pneu = r.Find("Pneu");
      if (pneu) pneu.Rotate(0, this.vitesse * dt * 140, 0);
    });
    if (this.transform.position.y < -20) {
      this.transform.position = this.depart;
      this.vitesse = 0;
    }
  }
}`),

  S('glisser', 'GlisserAuDoigt', 'Glisser au doigt', '👆', 'Déplacement',
    "Touche l'objet et fais-le glisser avec le doigt. Il lui faut un collider (ou un maillage).", `
class GlisserAuDoigt extends MonoBehaviour {
  OnMouseDown() {
    const cam = Camera.main;
    if (!cam) return;
    this.distance = cam.WorldToScreenPoint(this.transform.position).z;
    this.rb = this.GetComponent("Rigidbody");
    if (this.rb) this.rb.isKinematic = true;
    Audio.Play("click", 0.5);
  }

  OnMouseDrag() {
    const cam = Camera.main;
    if (!cam) return;
    const m = Input.mousePosition;
    this.transform.position = cam.ScreenToWorldPoint(new Vector3(m.x, m.y, this.distance));
  }

  OnMouseUp() {
    if (this.rb) this.rb.isKinematic = false;
  }
}`),

  // ================================================================ Caméra
  S('cam3p', 'CameraTroisiemePersonne', 'Caméra 3e personne', '🎥', 'Caméra',
    'Suit le perso de derrière. Glisse le doigt sur la droite de l’écran pour tourner autour. Évite de traverser les murs.', `
class CameraTroisiemePersonne extends MonoBehaviour {
  cible = Ref.GameObject("Perso");
  distance = 6;
  hauteur = 1.2;
  sensibilite = 0.25;
  douceur = 10;

  Start() {
    if (!this.cible) this.cible = GameObject.FindWithTag("Player");
    this.yaw = 0;
    this.pitch = 20;
    if (this.cible) {
      const d = this.transform.position.sub(this.cible.transform.position);
      if (d.magnitude > 0.1) {
        this.yaw = Math.atan2(d.x, d.z) * Mathf.Rad2Deg;
        this.pitch = Mathf.Clamp(Math.asin(Mathf.Clamp(d.y / d.magnitude, -1, 1)) * Mathf.Rad2Deg, -5, 60);
      }
    }
  }

  LateUpdate() {
    if (!this.cible) return;
    // glisser sur la droite de l'écran pour tourner autour du perso
    for (const t of Input.touches) {
      if (t.phase === "Moved" && t.position.x > Screen.width * 0.35) {
        this.yaw -= t.deltaPosition.x * this.sensibilite;
        this.pitch = Mathf.Clamp(this.pitch - t.deltaPosition.y * this.sensibilite, -5, 65);
      }
    }
    const r = Mathf.Deg2Rad;
    const off = new Vector3(Math.sin(this.yaw * r) * Math.cos(this.pitch * r), Math.sin(this.pitch * r), Math.cos(this.yaw * r) * Math.cos(this.pitch * r));
    const centre = this.cible.transform.position.add(new Vector3(0, this.hauteur, 0));
    let dist = this.distance;
    const mur = Physics.Raycast(centre, off, this.distance);
    if (mur) dist = Math.max(0.6, mur.distance - 0.3);
    const voulu = centre.add(off.mul(dist));
    this.transform.position = Vector3.Lerp(this.transform.position, voulu, Mathf.Clamp01(this.douceur * Time.deltaTime));
    this.transform.LookAt(centre);
  }
}`),

  S('camfps', 'CameraPremierePersonne', 'Caméra 1re personne', '👀', 'Caméra',
    'Vue à travers les yeux du perso. Glisse le doigt sur la droite de l’écran pour regarder autour.', `
class CameraPremierePersonne extends MonoBehaviour {
  cible = Ref.GameObject("Perso");
  hauteurYeux = 0.6;
  sensibilite = 0.25;

  Start() {
    if (!this.cible) this.cible = GameObject.FindWithTag("Player");
    this.yaw = this.transform.eulerAngles.y;
    this.pitch = 0;
  }

  LateUpdate() {
    for (const t of Input.touches) {
      if (t.phase === "Moved" && t.position.x > Screen.width * 0.35) {
        this.yaw -= t.deltaPosition.x * this.sensibilite;
        this.pitch = Mathf.Clamp(this.pitch + t.deltaPosition.y * this.sensibilite, -80, 80);
      }
    }
    this.transform.rotation = Quaternion.Euler(0, this.yaw, 0).mul(Quaternion.Euler(this.pitch, 0, 0));
    if (this.cible) this.transform.position = this.cible.transform.position.add(new Vector3(0, this.hauteurYeux, 0));
  }
}`),

  S('cam2d', 'CameraSuivi2D', 'Caméra qui suit (2D)', '📹', 'Caméra',
    'Suit le héros en douceur et regarde un peu devant lui quand il court.', `
class CameraSuivi2D extends MonoBehaviour {
  cible = Ref.GameObject("Héros");
  douceur = 5;
  anticipation = 1.5;
  decalageY = 1;
  limiteBas = -2;

  Start() {
    if (!this.cible) this.cible = GameObject.FindWithTag("Player");
    this.z = this.transform.position.z;
    this.avance = 0;
  }

  LateUpdate() {
    if (!this.cible) return;
    const p = this.cible.transform.position;
    const rb = this.cible.GetComponent("Rigidbody");
    const vx = rb ? rb.velocity.x : 0;
    this.avance = Mathf.Lerp(this.avance, Mathf.Clamp(vx * 0.3, -1, 1) * this.anticipation, 2 * Time.deltaTime);
    const voulu = new Vector3(p.x + this.avance, Math.max(p.y + this.decalageY, this.limiteBas), this.z);
    this.transform.position = Vector3.Lerp(this.transform.position, voulu, Mathf.Clamp01(this.douceur * Time.deltaTime));
  }
}`),

  S('suivre', 'Suivre', 'Suivre un objet', '🧲', 'Caméra',
    'Garde la même distance avec un objet (pratique pour une lumière ou une caméra fixe).', `
class Suivre extends MonoBehaviour {
  cible = Ref.GameObject("Perso");
  garderEcart = true;
  decalage = new Vector3(0, 5, 8);

  Start() {
    if (!this.cible) this.cible = GameObject.FindWithTag("Player");
    if (this.cible && this.garderEcart) this.decalage = this.transform.position.sub(this.cible.transform.position);
  }

  LateUpdate() {
    if (this.cible) this.transform.position = this.cible.transform.position.add(this.decalage);
  }
}`),

  S('shake', 'TremblementCamera', 'Tremblement de caméra', '💥', 'Caméra',
    'Fait trembler l’objet (la caméra). Depuis un autre script : GameObject.Find("Main Camera").SendMessage("Trembler", 0.4)', `
class TremblementCamera extends MonoBehaviour {
  force = 0.3;
  duree = 0.3;

  Start() {
    this.reste = 0;
    this.f = this.force;
  }

  Trembler(force) {
    this.reste = this.duree;
    this.f = typeof force === "number" ? force : this.force;
  }

  LateUpdate() {
    if (this.reste <= 0) return;
    this.reste -= Time.deltaTime;
    const k = this.f * Math.max(0, this.reste / this.duree);
    this.transform.position = this.transform.position.add(new Vector3(Random.Float(-1, 1) * k, Random.Float(-1, 1) * k, 0));
  }
}`),

  // ================================================================ Animation
  S('anim3d', 'AnimationPerso3D', 'Animation de perso 3D', '🕺', 'Animation',
    'Marche, course, saut, respiration et clignement des yeux, sans fichier d’animation. Anime les enfants Corps, Corps/Tête, Corps/BrasG, Corps/BrasD, JambeG, JambeD.', `
class AnimationPerso3D extends MonoBehaviour {
  amplitude = 45;
  frequence = 10;
  inclinaison = 10;

  Start() {
    this.rb = this.GetComponent("Rigidbody");
    const t = this.transform;
    this.corps = t.Find("Corps");
    this.tete = t.Find("Corps/Tête");
    this.brasG = t.Find("Corps/BrasG");
    this.brasD = t.Find("Corps/BrasD");
    this.jambeG = t.Find("JambeG");
    this.jambeD = t.Find("JambeD");
    this.yeux = [t.Find("Corps/Tête/OeilG"), t.Find("Corps/Tête/OeilD")].filter((o) => o);
    this.hYeux = this.yeux.length ? this.yeux[0].localScale.y : 1;
    this.yCorps = this.corps ? this.corps.localPosition.y : 0;
    this.phase = 0;
    this.k = 0;
    this.air = 0;
    this.ecrase = 0;
    this.etaitEnAir = false;
    this.clin = 0;
    this.prochainClin = Time.time + Random.Float(1.5, 4);
    this.avant = this.transform.position.clone();
  }

  // appelé par le contrôleur au moment du saut
  AuSaut() { this.ecrase = -1; }

  Update() {
    const dt = Math.max(Time.deltaTime, 0.0001);
    let vx, vy, vz;
    if (this.rb) {
      const v = this.rb.velocity;
      vx = v.x; vy = v.y; vz = v.z;
    } else {
      const p = this.transform.position;
      const d = p.sub(this.avant).div(dt);
      this.avant = p.clone();
      vx = d.x; vy = d.y; vz = d.z;
    }
    const vitesse = Math.hypot(vx, vz);
    const enAir = Math.abs(vy) > 1.5;
    if (this.etaitEnAir && !enAir) this.ecrase = 0.8; // atterrissage
    this.etaitEnAir = enAir;
    this.k = Mathf.Lerp(this.k, Mathf.Clamp01(vitesse / 5), 10 * dt);
    this.air = Mathf.Lerp(this.air, enAir ? 1 : 0, 12 * dt);
    this.phase += dt * this.frequence * (0.3 + this.k);
    const s = Math.sin(this.phase) * this.amplitude * this.k * (1 - this.air);

    const tourner = (o, x, z) => { if (o) o.localEulerAngles = new Vector3(x, 0, z || 0); };
    tourner(this.jambeG, s + 30 * this.air);
    tourner(this.jambeD, -s - 15 * this.air);
    tourner(this.brasG, -s * 0.8 + 150 * this.air, -8 - 18 * this.air);
    tourner(this.brasD, s * 0.8 + 150 * this.air, 8 + 18 * this.air);

    if (this.corps) {
      const rebond = Math.abs(Math.sin(this.phase)) * 0.07 * this.k * (1 - this.air);
      const souffle = Math.sin(Time.time * 2.2) * 0.012;
      this.corps.localPosition = new Vector3(0, this.yCorps + rebond + souffle, 0);
      this.corps.localEulerAngles = new Vector3(-this.inclinaison * this.k, 0, Math.sin(this.phase) * 3 * this.k);
      this.ecrase = Mathf.Lerp(this.ecrase, 0, 8 * dt);
      const e = this.ecrase;
      this.corps.localScale = new Vector3(1 + e * 0.12, 1 - e * 0.18, 1 + e * 0.12);
    }
    if (this.tete) this.tete.localEulerAngles = new Vector3(Math.sin(this.phase * 2) * 3 * this.k, Math.sin(Time.time * 0.7) * 10 * (1 - this.k), 0);

    // clignement des yeux
    if (Time.time > this.prochainClin) {
      this.clin = 0.12;
      this.prochainClin = Time.time + Random.Float(2, 5);
    }
    this.clin -= dt;
    for (const o of this.yeux) o.localScale.y = this.clin > 0 ? this.hYeux * 0.1 : this.hYeux;
  }
}`),

  S('anim2d', 'AnimationPerso2D', 'Animation de perso 2D', '🤸', 'Animation',
    'Étirement au saut, écrasement à l’atterrissage, pieds qui courent, regard, clignement et retournement. Anime Visuel, Visuel/Corps, Visuel/PiedG, Visuel/PiedD, Visuel/Corps/OeilG…', `
class AnimationPerso2D extends MonoBehaviour {
  Start() {
    this.rb = this.GetComponent("Rigidbody");
    const t = this.transform;
    this.visuel = t.Find("Visuel");
    this.corps = t.Find("Visuel/Corps");
    this.piedG = t.Find("Visuel/PiedG");
    this.piedD = t.Find("Visuel/PiedD");
    this.yeux = [t.Find("Visuel/Corps/OeilG"), t.Find("Visuel/Corps/OeilD")].filter((o) => o);
    this.pupilles = [t.Find("Visuel/Corps/OeilG/Pupille"), t.Find("Visuel/Corps/OeilD/Pupille")].filter((o) => o);
    this.noeud = t.Find("Visuel/Corps/Bandeau/Noeud");
    this.pG = this.piedG ? this.piedG.localPosition.clone() : Vector3.zero;
    this.pD = this.piedD ? this.piedD.localPosition.clone() : Vector3.zero;
    this.pup = this.pupilles.length ? this.pupilles[0].localPosition.clone() : Vector3.zero;
    this.hYeux = this.yeux.length ? this.yeux[0].localScale.y : 1;
    this.phase = 0;
    this.ecrase = 0;
    this.dir = 1;
    this.enAir = false;
    this.clin = 0;
    this.prochainClin = Time.time + 2;
  }

  AuSaut() { this.ecrase = -1; }

  Update() {
    const dt = Time.deltaTime;
    const v = this.rb ? this.rb.velocity : Vector3.zero;
    const vitesse = Math.abs(v.x);
    const air = Math.abs(v.y) > 0.8;
    if (this.enAir && !air) this.ecrase = 0.9; // atterrissage
    this.enAir = air;
    if (v.x > 0.3) this.dir = 1;
    else if (v.x < -0.3) this.dir = -1;

    // retournement façon « carte qui pivote »
    if (this.visuel) {
      const sx = this.visuel.localScale.x;
      this.visuel.localScale = new Vector3(Mathf.Lerp(sx, this.dir, Mathf.Clamp01(18 * dt)), 1, 1);
    }
    // étirement / écrasement
    this.ecrase = Mathf.Lerp(this.ecrase, 0, 10 * dt);
    const e = this.ecrase + (air ? Mathf.Clamp(-v.y * 0.025, -0.3, 0.3) : 0);
    const k = air ? 0 : Mathf.Clamp01(vitesse / 6);
    if (vitesse > 0.2 && !air) this.phase += dt * (6 + vitesse * 2.2);
    if (this.corps) {
      this.corps.localScale = new Vector3(1 + e * 0.25, 1 - e * 0.3, 1);
      this.corps.localPosition = new Vector3(0, Math.abs(Math.sin(this.phase)) * 0.06 * k + Math.sin(Time.time * 3) * 0.015, 0);
      this.corps.localEulerAngles = new Vector3(0, 0, -7 * k);
    }
    // pieds qui courent
    const pied = (o, base, ph) => {
      if (!o) return;
      o.localPosition = new Vector3(base.x + Math.sin(ph) * 0.13 * k, base.y + Math.max(0, Math.cos(ph)) * 0.12 * k + (air ? 0.07 : 0), base.z);
    };
    pied(this.piedG, this.pG, this.phase);
    pied(this.piedD, this.pD, this.phase + Math.PI);
    // regard et bandeau qui flotte
    for (const p of this.pupilles) p.localPosition = new Vector3(this.pup.x + 0.02 * k, this.pup.y + (air ? Mathf.Clamp(v.y * 0.01, -0.04, 0.04) : 0), this.pup.z);
    if (this.noeud) this.noeud.localEulerAngles = new Vector3(0, 0, 90 + Math.sin(Time.time * 12) * (8 + 22 * k));
    // clignement
    if (Time.time > this.prochainClin) {
      this.clin = 0.12;
      this.prochainClin = Time.time + Random.Float(2, 5);
    }
    this.clin -= dt;
    for (const o of this.yeux) o.localScale.y = this.clin > 0 ? this.hYeux * 0.15 : this.hYeux;
  }
}`),

  S('rotation', 'Rotation', 'Rotation', '🔄', 'Animation', 'Fait tourner l’objet en continu (degrés par seconde sur chaque axe).', `
class Rotation extends MonoBehaviour {
  vitesse = new Vector3(0, 90, 0);

  Update() {
    this.transform.Rotate(this.vitesse.mul(Time.deltaTime));
  }
}`),

  S('flotter', 'Flotter', 'Flotter', '🎈', 'Animation', 'Monte et descend doucement, comme un objet magique.', `
class Flotter extends MonoBehaviour {
  hauteur = 0.25;
  vitesse = 2;

  Start() {
    this.y0 = this.transform.localPosition.y;
    this.phase = Random.Float(0, 6.28);
  }

  Update() {
    this.transform.localPosition.y = this.y0 + Math.sin(Time.time * this.vitesse + this.phase) * this.hauteur;
  }
}`),

  S('pulse', 'Pulsation', 'Pulsation', '💗', 'Animation', 'Grossit et rapetisse en rythme. À utiliser plutôt sur des objets sans collider.', `
class Pulsation extends MonoBehaviour {
  amplitude = 0.1;
  vitesse = 4;

  Start() {
    this.s0 = this.transform.localScale.clone();
  }

  Update() {
    const k = 1 + Math.sin(Time.time * this.vitesse) * this.amplitude;
    this.transform.localScale = this.s0.mul(k);
  }
}`),

  S('clignoter', 'Clignoter', 'Changer de couleur', '🌈', 'Animation', 'Passe de sa couleur à une autre en boucle (Mesh ou Sprite Renderer).', `
class Clignoter extends MonoBehaviour {
  couleur = new Color(1, 0.85, 0.2);
  vitesse = 1;

  Start() {
    this.mr = this.GetComponent("MeshRenderer");
    this.sr = this.GetComponent("SpriteRenderer");
    this.base = this.mr ? this.mr.material.color : this.sr ? this.sr.color : Color.white;
  }

  Update() {
    const t = (Math.sin(Time.time * this.vitesse * Math.PI * 2) + 1) / 2;
    const c = Color.Lerp(this.base, this.couleur, t);
    if (this.mr) this.mr.material.color = c;
    else if (this.sr) this.sr.color = c;
  }
}`),

  S('parallaxe', 'Parallaxe', 'Parallaxe (fond 2D)', '🏞️', 'Animation', 'Le décor de fond bouge moins vite que la caméra : effet de profondeur. facteur 0 = suit le monde, 1 = reste collé à la caméra.', `
class Parallaxe extends MonoBehaviour {
  facteur = 0.5;

  Start() {
    this.cam = Camera.main;
    this.depart = this.transform.position.clone();
    this.camDepart = this.cam ? this.cam.transform.position.clone() : Vector3.zero;
  }

  LateUpdate() {
    if (!this.cam) return;
    const d = this.cam.transform.position.sub(this.camDepart);
    this.transform.position = new Vector3(this.depart.x + d.x * this.facteur, this.depart.y + d.y * this.facteur * 0.6, this.depart.z);
  }
}`),

  // ================================================================ Ennemis
  S('poursuite', 'EnnemiPoursuite', 'Ennemi qui poursuit', '👾', 'Ennemis', 'Fonce sur le joueur quand il est assez près. Le toucher fait perdre de la vie et repousse.', `
class EnnemiPoursuite extends MonoBehaviour {
  cible = Ref.GameObject("Perso");
  vitesse = 2.5;
  portee = 10;
  degats = 1;
  mode2D = false;

  Start() {
    this.rb = this.GetComponent("Rigidbody");
    if (!this.cible) this.cible = GameObject.FindWithTag("Player");
  }

  Update() {
    if (!this.cible) return;
    const d = this.cible.transform.position.sub(this.transform.position);
    d.y = 0;
    if (this.mode2D) d.z = 0;
    let v = Vector3.zero;
    if (d.magnitude < this.portee && d.magnitude > 0.3) v = d.normalized.mul(this.vitesse);
    if (this.rb) {
      const vy = this.rb.velocity.y;
      this.rb.velocity = new Vector3(v.x, vy, v.z);
    } else this.transform.position = this.transform.position.add(v.mul(Time.deltaTime));
    if (!this.mode2D && v.sqrMagnitude > 0.01) this.transform.rotation = Quaternion.Slerp(this.transform.rotation, Quaternion.LookRotation(v), Mathf.Clamp01(8 * Time.deltaTime));
  }

  OnCollisionEnter(c) { this.Toucher(c.gameObject); }
  OnTriggerEnter(o) { this.Toucher(o.gameObject); }

  Toucher(go) {
    if (!go.CompareTag("Player")) return;
    go.SendMessage("Degats", this.degats);
    go.SendMessage("Repousser", 0.35);
    const rb = go.GetComponent("Rigidbody");
    if (rb) rb.velocity = go.transform.position.sub(this.transform.position).withY(0).normalized.mul(7).add(new Vector3(0, 4, 0));
  }
}`),

  S('slime', 'Slime', 'Slime qui sautille', '🟢', 'Ennemis', 'Petit monstre qui sautille au hasard puis vers le joueur, s’écrase en retombant. Anime l’enfant « Corps ».', `
class Slime extends MonoBehaviour {
  cible = Ref.GameObject("Perso");
  portee = 8;
  forceSaut = 5;

  Start() {
    this.rb = this.GetComponent("Rigidbody");
    if (!this.cible) this.cible = GameObject.FindWithTag("Player");
    this.corps = this.transform.Find("Corps");
    this.prochain = Time.time + Random.Float(0.5, 2);
    this.ecrase = 0;
    this.enAir = false;
  }

  Update() {
    const dt = Time.deltaTime;
    const vy = this.rb ? this.rb.velocity.y : 0;
    const air = Math.abs(vy) > 0.5;
    if (this.enAir && !air) this.ecrase = 1;
    this.enAir = air;
    if (!air && Time.time > this.prochain && this.rb) {
      let dir = Random.insideUnitSphere.withY(0).normalized;
      if (this.cible) {
        const d = this.cible.transform.position.sub(this.transform.position).withY(0);
        if (d.magnitude < this.portee) dir = d.normalized;
      }
      this.rb.velocity = dir.mul(2.5).add(new Vector3(0, this.forceSaut, 0));
      if (dir.sqrMagnitude > 0.01) this.transform.rotation = Quaternion.LookRotation(dir);
      this.prochain = Time.time + Random.Float(0.8, 1.8);
      this.ecrase = -0.6;
    }
    this.ecrase = Mathf.Lerp(this.ecrase, 0, 8 * dt);
    if (this.corps) this.corps.localScale = new Vector3(1 + this.ecrase * 0.3, 1 - this.ecrase * 0.35, 1 + this.ecrase * 0.3);
  }

  OnCollisionEnter(c) {
    const go = c.gameObject;
    if (!go.CompareTag("Player")) return;
    go.SendMessage("Degats", 1);
    go.SendMessage("Repousser", 0.35);
    const rb = go.GetComponent("Rigidbody");
    if (rb) rb.velocity = go.transform.position.sub(this.transform.position).withY(0).normalized.mul(7).add(new Vector3(0, 4, 0));
    Audio.Play("hit", 0.6);
  }
}`),

  S('ennemi2d', 'Ennemi2D', 'Ennemi 2D (on peut l’écraser)', '🐾', 'Ennemis', 'Fait des allers-retours. Saute dessus pour l’écraser ; sinon il fait perdre de la vie. Collider en « Déclencheur ».', `
class Ennemi2D extends MonoBehaviour {
  distance = 2.5;
  vitesse = 2;

  Start() {
    this.depart = this.transform.position.clone();
    this.t = Random.Float(0, 6);
    this.sr = this.GetComponent("SpriteRenderer");
    this.mort = false;
  }

  Update() {
    if (this.mort) return;
    this.t += Time.deltaTime * this.vitesse / Math.max(0.1, this.distance);
    this.transform.position = this.depart.add(new Vector3(Math.sin(this.t) * this.distance, Math.abs(Math.sin(this.t * 5)) * 0.08, 0));
    if (this.sr) this.sr.flipX = Math.cos(this.t) < 0;
  }

  OnTriggerEnter(other) {
    if (this.mort || !other.CompareTag("Player")) return;
    const rb = other.gameObject.GetComponent("Rigidbody");
    const dessus = rb && rb.velocity.y < 0 && other.transform.position.y > this.transform.position.y + 0.25;
    if (dessus) {
      this.mort = true;
      other.gameObject.SendMessage("Rebondir", 9);
      Audio.Play("hit");
      this.transform.localScale = new Vector3(1.3, 0.3, 1);
      Destroy(this.gameObject, 0.25);
    } else {
      other.gameObject.SendMessage("Degats", 1);
      other.gameObject.SendMessage("Repousser", 0.3);
      if (rb) rb.velocity = new Vector3(Math.sign(other.transform.position.x - this.transform.position.x) * 8, 7, 0);
    }
  }
}`),

  S('patrouille', 'Patrouille', 'Allers-retours', '↔️', 'Ennemis', 'Va et vient le long d’un axe (ennemi, plateforme, décor).', `
class Patrouille extends MonoBehaviour {
  distance = 3;
  vitesse = 2;
  axe = new Vector3(1, 0, 0);

  Start() {
    this.depart = this.transform.position.clone();
    this.t = 0;
    this.sr = this.GetComponent("SpriteRenderer");
  }

  Update() {
    this.t += Time.deltaTime * this.vitesse / Math.max(0.01, this.distance);
    this.transform.position = this.depart.add(this.axe.normalized.mul(Math.sin(this.t) * this.distance));
    if (this.sr) this.sr.flipX = Math.cos(this.t) * this.axe.x < 0;
  }
}`),

  // ================================================================ Gameplay
  S('ramassable', 'Ramassable', 'Objet à ramasser', '💎', 'Gameplay', 'Pièce, gemme, bonus… Disparaît quand le joueur le touche et donne des points au GameManager. Collider en « Déclencheur ».', `
class Ramassable extends MonoBehaviour {
  points = 1;
  son = Ref.Sound("coin");
  effet = Ref.Prefab("Étincelles");
  tourner = true;

  Start() {
    this.ramasse = false;
  }

  Update() {
    if (this.tourner) this.transform.Rotate(0, 120 * Time.deltaTime, 0, Space.World);
  }

  OnTriggerEnter(other) {
    if (this.ramasse || !other.CompareTag("Player")) return;
    this.ramasse = true;
    Audio.Play(this.son);
    if (this.effet) Destroy(Instantiate(this.effet, this.transform.position), 1.5);
    const gm = GameObject.Find("GameManager");
    if (gm) gm.SendMessage("AjouterPoints", this.points);
    Destroy(this.gameObject);
  }
}`),

  S('vie', 'PointsDeVie', 'Points de vie', '❤️', 'Gameplay', 'Vie du joueur, clignote quand il est touché, barre de vie optionnelle (une UI Image nommée « BarreDeVie »).', `
class PointsDeVie extends MonoBehaviour {
  vieMax = 3;
  invincibilite = 1.2;
  barre = Ref.GameObject("BarreDeVie");

  Start() {
    this.vie = this.vieMax;
    this.invincible = 0;
    this.rendus = this.gameObject.GetComponentsInChildren("Renderer");
    this.Afficher();
  }

  Update() {
    if (this.invincible <= 0) return;
    this.invincible -= Time.deltaTime;
    const visible = this.invincible <= 0 || Math.floor(this.invincible * 12) % 2 === 0;
    for (const r of this.rendus) r.enabled = visible;
  }

  Degats(n) {
    if (this.invincible > 0 || this.vie <= 0) return;
    this.vie -= typeof n === "number" ? n : 1;
    this.invincible = this.invincibilite;
    Audio.Play("hit");
    const cam = GameObject.Find("Main Camera");
    if (cam) cam.SendMessage("Trembler", 0.25);
    this.Afficher();
    if (this.vie <= 0) this.Mourir();
  }

  Soigner(n) {
    this.vie = Math.min(this.vieMax, this.vie + (typeof n === "number" ? n : 1));
    this.Afficher();
  }

  Afficher() {
    if (!this.barre) return;
    const img = this.barre.GetComponent("Image");
    if (img) img.fillAmount = this.vie / this.vieMax;
  }

  Mourir() {
    Audio.Play("lose");
    const gm = GameObject.Find("GameManager");
    if (gm) gm.SendMessage("GameOver");
    else SceneManager.ReloadScene();
  }
}`),

  S('spawner', 'Generateur', 'Générateur d’objets', '🏭', 'Gameplay', 'Crée un prefab à intervalle régulier dans une zone autour de l’objet (ennemis, pièces, astéroïdes…).', `
class Generateur extends MonoBehaviour {
  objet = Ref.Prefab();
  intervalle = 2;
  zone = new Vector3(5, 0, 5);
  maximum = 20;

  Start() {
    this.liste = [];
    if (this.objet) this.InvokeRepeating("Creer", this.intervalle, this.intervalle);
    else Debug.LogWarning("Générateur : choisis un prefab dans l'inspecteur (champ Objet)");
  }

  Creer() {
    this.liste = this.liste.filter((o) => !o.destroyed);
    if (this.liste.length >= this.maximum) return;
    const z = this.zone;
    const p = this.transform.position.add(new Vector3(Random.Float(-1, 1) * z.x, Random.Float(-1, 1) * z.y, Random.Float(-1, 1) * z.z));
    this.liste.push(Instantiate(this.objet, p));
  }
}`),

  S('plateforme', 'PlateformeMobile', 'Plateforme mobile', '🛗', 'Gameplay', 'Va d’un point à un autre avec une pause à chaque bout. Ajoute un Rigidbody cinématique pour un mouvement plus doux.', `
class PlateformeMobile extends MonoBehaviour {
  deplacement = new Vector3(0, 3, 0);
  duree = 2.5;
  pause = 0.6;

  Start() {
    this.a = this.transform.position.clone();
    this.t = 0;
  }

  Update() {
    this.t += Time.deltaTime;
    const d = this.duree, p = this.pause;
    const u = this.t % ((d + p) * 2);
    let k;
    if (u < d) k = u / d;
    else if (u < d + p) k = 1;
    else if (u < d * 2 + p) k = 1 - (u - d - p) / d;
    else k = 0;
    this.transform.position = this.a.add(this.deplacement.mul(Mathf.SmoothStep(0, 1, k)));
  }
}`),

  S('mort', 'ZoneDeMort', 'Zone de chute / piège', '☠️', 'Gameplay', 'Collider en « Déclencheur » : le joueur qui la touche revient au dernier point de contrôle (ou la scène recommence).', `
class ZoneDeMort extends MonoBehaviour {
  recommencerScene = false;

  OnTriggerEnter(other) {
    if (!other.CompareTag("Player")) return;
    Audio.Play("lose", 0.6);
    if (this.recommencerScene) SceneManager.ReloadScene();
    else {
      other.gameObject.SendMessage("Degats", 1);
      other.gameObject.SendMessage("Reapparaitre");
    }
  }
}`),

  S('checkpoint', 'PointDeControle', 'Point de contrôle', '🚩', 'Gameplay', 'Quand le joueur passe dessus, il réapparaîtra ici. Collider en « Déclencheur ».', `
class PointDeControle extends MonoBehaviour {
  couleurActive = new Color(0.2, 0.9, 0.4);

  Start() {
    this.actif = false;
  }

  OnTriggerEnter(other) {
    if (this.actif || !other.CompareTag("Player")) return;
    this.actif = true;
    other.gameObject.SendMessage("NouveauDepart", this.transform.position.add(new Vector3(0, 0.5, 0)));
    Audio.Play("powerup", 0.5);
    const mr = this.GetComponent("MeshRenderer");
    const sr = this.GetComponent("SpriteRenderer");
    if (mr) mr.material.color = this.couleurActive;
    if (sr) sr.color = this.couleurActive;
  }
}`),

  S('arrivee', 'Arrivee', 'Ligne d’arrivée', '🏁', 'Gameplay', 'Le joueur qui la touche gagne la partie (appelle Gagner sur le GameManager).', `
class Arrivee extends MonoBehaviour {
  OnTriggerEnter(other) {
    if (this.fini || !other.CompareTag("Player")) return;
    this.fini = true;
    const gm = GameObject.Find("GameManager");
    if (gm) gm.SendMessage("Gagner");
    else Audio.Play("win");
    const ps = this.GetComponent("ParticleSystem");
    if (ps) ps.Play();
  }
}`),

  S('tireur', 'Tireur', 'Tirer des projectiles', '🔫', 'Gameplay', 'Bouton B : tire le prefab choisi vers l’avant de l’objet.', `
class Tireur extends MonoBehaviour {
  projectile = Ref.Prefab();
  vitesse = 20;
  cadence = 0.25;
  bouton = "Fire1";

  Start() {
    this.prochain = 0;
  }

  Update() {
    if (!this.projectile || !Input.GetButton(this.bouton) || Time.time < this.prochain) return;
    this.prochain = Time.time + this.cadence;
    const avant = this.transform.forward;
    const p = Instantiate(this.projectile, this.transform.position.add(avant), this.transform.rotation);
    const rb = p.GetComponent("Rigidbody");
    if (rb) {
      rb.useGravity = false;
      rb.velocity = avant.mul(this.vitesse);
    }
    Destroy(p, 3);
    Audio.Play("laser", 0.4);
  }
}`),

  S('panneau', 'Panneau', 'Panneau / message', '🪧', 'Gameplay', 'Affiche un message quand le joueur s’approche (UI Text nommé « Message », caché au départ). Collider en « Déclencheur ».', `
class Panneau extends MonoBehaviour {
  message = "Bienvenue ! Explore le monde.";
  texte = Ref.GameObject("Message");

  OnTriggerEnter(other) {
    if (!other.CompareTag("Player") || !this.texte) return;
    const t = this.texte.GetComponent("Text");
    if (t) t.text = this.message;
    this.texte.SetActive(true);
    Audio.Play("blip", 0.4);
  }

  OnTriggerExit(other) {
    if (other.CompareTag("Player") && this.texte) this.texte.SetActive(false);
  }
}`),

  S('minuteur', 'Minuteur', 'Compte à rebours', '⏱️', 'Gameplay', 'Affiche le temps restant dans un UI Text et appelle FinDuTemps sur le GameManager à zéro.', `
class Minuteur extends MonoBehaviour {
  secondes = 60;
  texte = Ref.GameObject("Temps");

  Start() {
    this.reste = this.secondes;
    this.fini = false;
  }

  Update() {
    if (this.fini) return;
    this.reste -= Time.deltaTime;
    if (this.reste <= 0) {
      this.reste = 0;
      this.fini = true;
      const gm = GameObject.Find("GameManager");
      if (gm) gm.SendMessage("FinDuTemps");
      else Audio.Play("lose");
    }
    if (this.texte) {
      const t = this.texte.GetComponent("Text");
      if (t) t.text = "⏱ " + Math.ceil(this.reste);
    }
  }
}`),

  // ================================================================ Interface
  S('gestion', 'GestionJeu', 'Gestion du jeu (score, victoire, game over)', '🏆', 'Interface',
    'À mettre sur un objet nommé « GameManager ». Score (UI Text « Score »), record, objectif, écran « Victoire » et « Fin de partie » avec un bouton qui appelle Rejouer.', `
class GestionJeu extends MonoBehaviour {
  icone = "💎";
  objectif = 0;
  texte = Ref.GameObject("Score");
  victoire = Ref.GameObject("Victoire");
  finDePartie = Ref.GameObject("Fin de partie");

  Start() {
    Time.timeScale = 1;
    this.score = 0;
    this.record = PlayerPrefs.GetInt("record", 0);
    // objectif 0 : on compte les objets « Collectible » ; -1 : pas d'objectif
    if (this.objectif === 0) this.objectif = GameObject.FindGameObjectsWithTag("Collectible").length;
    this.Afficher();
  }

  AjouterPoints(n) {
    this.score += typeof n === "number" ? n : 1;
    if (this.score > this.record) {
      this.record = this.score;
      PlayerPrefs.SetInt("record", this.record);
    }
    this.Afficher();
    if (this.objectif > 0 && this.score >= this.objectif) this.Gagner();
  }

  Afficher() {
    if (!this.texte) return;
    const t = this.texte.GetComponent("Text");
    if (t) t.text = this.objectif > 0 ? this.icone + " " + this.score + " / " + this.objectif : this.icone + " " + this.score;
  }

  Gagner() {
    if (this.fini) return;
    this.fini = true;
    Audio.Play("win");
    if (this.victoire) this.victoire.SetActive(true);
  }

  GameOver() {
    if (this.fini) return;
    this.fini = true;
    if (this.finDePartie) {
      this.finDePartie.SetActive(true);
      Time.timeScale = 0;
    } else SceneManager.ReloadScene();
  }

  FinDuTemps() { this.GameOver(); }

  Rejouer() {
    Time.timeScale = 1;
    SceneManager.ReloadScene();
  }
}`),
];

export const LIB_BY_ID = new Map(SCRIPT_LIBRARY.map((e) => [e.id, e]));

/** Composants ajoutés automatiquement avec certains scripts */
export const LIB_NEEDS = {
  perso3d: { rb: { friction: 0, drag: 0, angularDrag: 0, freezeRot: [true, true, true] }, col: 'CapsuleCollider' },
  perso2d: { rb: { friction: 0, drag: 0, freezePos: [false, false, true], freezeRot: [true, true, true] } },
  voiture: { rb: { mass: 2, friction: 0.2, freezeRot: [true, true, true] } },
  slime: { rb: { friction: 0.3, drag: 0.3, freezeRot: [true, true, true] } },
};

export function renameClass(code, from, to) {
  if (from === to) return code;
  return code.replace(new RegExp('class\\s+' + from.replace(/[$]/g, '\\$') + '\\b'), 'class ' + to);
}

export function libCode(entry, name) {
  return renameClass(entry.code, entry.cls, name || entry.cls);
}

/** Crée un script de la bibliothèque dans le projet (nom unique) */
export function addLibScript(project, libId, name) {
  const e = LIB_BY_ID.get(libId);
  if (!e) throw new Error('Script inconnu : ' + libId);
  const n = uniqueName(name || e.cls, project.scripts.map((s) => s.name));
  const code = libCode(e, n);
  const s = { id: uid(), name: n, code, lib: libId, tplHash: codeHash(code) };
  project.scripts.push(s);
  return s;
}

/** Réutilise le script de la bibliothèque s'il est déjà dans le projet, sinon l'ajoute */
export function ensureLibScript(project, libId) {
  const existing = project.scripts.find((s) => s.lib === libId);
  if (existing) return { script: existing, created: false };
  return { script: addLibScript(project, libId), created: true };
}

/** Met à jour un script de bibliothèque jamais modifié. Retourne true si mis à jour. */
export function upgradeLibScript(s) {
  const e = LIB_BY_ID.get(s.lib);
  if (!e) return false;
  const fresh = libCode(e, s.name);
  if (!s.tplHash) {
    if (s.code === fresh) s.tplHash = codeHash(fresh);
    return false;
  }
  if (codeHash(s.code) !== s.tplHash || s.code === fresh) return false;
  s.code = fresh;
  s.tplHash = codeHash(fresh);
  return true;
}
