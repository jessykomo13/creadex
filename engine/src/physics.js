// Physique 3D (cannon-es) : rigidbodies, colliders, déclencheurs, raycasts

import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { COLLIDERS } from './components.js';

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _pi = new THREE.Matrix4();

export class PhysicsWorld {
  constructor(settings = {}) {
    const g = settings.gravity || [0, -9.81, 0];
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(g[0], g[1], g[2]) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = true;
    this.world.solver.iterations = 12;
    this.world.defaultContactMaterial.friction = 0.35;
    this.world.defaultContactMaterial.restitution = 0;
    this.world.defaultContactMaterial.contactEquationStiffness = 1e7;
    this.bodies = new Map(); // rgo → body
    this.events = [];
    this.pairs = new Map(); // clé → {a, b, trigger}
    this.world.addEventListener('beginContact', (e) => this.onContact(e, true));
    this.world.addEventListener('endContact', (e) => this.onContact(e, false));
  }

  get gravity() {
    return this.world.gravity;
  }

  onContact(e, begin) {
    const A = e.bodyA, B = e.bodyB;
    if (!A || !B || !A.userData || !B.userData) return;
    const a = A.userData.rgo, b = B.userData.rgo;
    if (!a || !b) return;
    const trigger = A.isTrigger || B.isTrigger;
    const key = A.id < B.id ? A.id + '|' + B.id : B.id + '|' + A.id;
    if (begin) this.pairs.set(key, { A, B, a, b, trigger });
    else this.pairs.delete(key);
    this.events.push({ type: begin ? 'enter' : 'exit', A, B, a, b, trigger });
  }

  /** Crée / recrée le corps physique d'un GameObject d'exécution */
  sync(rgo) {
    this.remove(rgo);
    if (!rgo.activeInHierarchy || rgo._destroyed) return null;
    const cols = rgo.components.filter((c) => COLLIDERS.includes(c._data.type) && c._data.enabled !== false);
    const rbc = rgo.components.find((c) => c._data.type === 'Rigidbody');
    if (!cols.length && !rbc) return null;
    const rb = rbc ? rbc._data : null;
    const type = !rb ? CANNON.Body.STATIC : rb.isKinematic ? CANNON.Body.KINEMATIC : CANNON.Body.DYNAMIC;
    const mat = new CANNON.Material();
    mat.friction = rb ? rb.friction ?? 0.4 : 0.4;
    mat.restitution = rb ? rb.bounciness ?? 0 : 0;
    const body = new CANNON.Body({
      mass: type === CANNON.Body.DYNAMIC ? Math.max(0.0001, rb.mass ?? 1) : 0,
      type,
      material: mat,
      linearDamping: rb ? Math.min(0.99, rb.drag ?? 0.05) : 0,
      angularDamping: rb ? Math.min(0.99, rb.angularDrag ?? 0.05) : 0.05,
      allowSleep: true,
      sleepSpeedLimit: 0.08,
      sleepTimeLimit: 0.6,
    });
    if (rb) {
      const fp = rb.freezePos || [], fr = rb.freezeRot || [];
      body.linearFactor.set(fp[0] ? 0 : 1, fp[1] ? 0 : 1, fp[2] ? 0 : 1);
      body.angularFactor.set(fr[0] ? 0 : 1, fr[1] ? 0 : 1, fr[2] ? 0 : 1);
      body.userData_useGravity = rb.useGravity !== false;
    }
    const obj = rgo.obj;
    obj.updateWorldMatrix(true, false);
    obj.matrixWorld.decompose(_p, _q, _s);
    const sx = Math.abs(_s.x), sy = Math.abs(_s.y), sz = Math.abs(_s.z);
    const smax = Math.max(sx, sy, sz);
    let allTrigger = cols.length > 0;
    if (!cols.length) {
      // Rigidbody sans collider : petite sphère pour garder la masse
      body.addShape(new CANNON.Sphere(0.05));
      body.collisionResponse = false;
    }
    for (const cc of cols) {
      const c = cc._data;
      if (!c.isTrigger) allTrigger = false;
      const ctr = c.center || [0, 0, 0];
      const off = new CANNON.Vec3(ctr[0] * sx, ctr[1] * sy, ctr[2] * sz);
      switch (c.type) {
        case 'BoxCollider': {
          const sz3 = c.size || [1, 1, 1];
          body.addShape(new CANNON.Box(new CANNON.Vec3(Math.max(0.005, (Math.abs(sz3[0]) * sx) / 2), Math.max(0.005, (Math.abs(sz3[1]) * sy) / 2), Math.max(0.005, (Math.abs(sz3[2]) * sz) / 2))), off);
          break;
        }
        case 'SphereCollider':
          body.addShape(new CANNON.Sphere(Math.max(0.005, (c.radius ?? 0.5) * smax)), off);
          break;
        case 'CylinderCollider': {
          const r = Math.max(0.005, (c.radius ?? 0.5) * Math.max(sx, sz));
          body.addShape(new CANNON.Cylinder(r, r, Math.max(0.01, (c.height ?? 2) * sy), 16), off);
          break;
        }
        case 'CapsuleCollider': {
          const r = Math.max(0.005, (c.radius ?? 0.5) * Math.max(sx, sz));
          const hgt = Math.max(2 * r, (c.height ?? 2) * sy);
          const mid = hgt - 2 * r;
          if (mid > 0.001) body.addShape(new CANNON.Cylinder(r, r, mid, 16), off);
          body.addShape(new CANNON.Sphere(r), new CANNON.Vec3(off.x, off.y + mid / 2, off.z));
          body.addShape(new CANNON.Sphere(r), new CANNON.Vec3(off.x, off.y - mid / 2, off.z));
          break;
        }
      }
    }
    body.isTrigger = allTrigger;
    body.position.set(_p.x, _p.y, _p.z);
    body.quaternion.set(_q.x, _q.y, _q.z, _q.w);
    body.userData = { rgo, lastPos: _p.clone(), lastQuat: _q.clone(), scale: _s.clone() };
    if (type === CANNON.Body.DYNAMIC) body.updateMassProperties();
    this.world.addBody(body);
    this.bodies.set(rgo, body);
    return body;
  }

  remove(rgo) {
    const b = this.bodies.get(rgo);
    if (!b) return;
    this.world.removeBody(b);
    this.bodies.delete(rgo);
    for (const [k, p] of this.pairs) if (p.A === b || p.B === b) this.pairs.delete(k);
  }

  bodyOf(rgo) {
    return this.bodies.get(rgo) || null;
  }

  /** Copie les transforms modifiés par les scripts vers les corps physiques */
  syncIn(dt) {
    for (const [rgo, body] of this.bodies) {
      const obj = rgo.obj;
      obj.updateWorldMatrix(true, false);
      obj.matrixWorld.decompose(_p, _q, _s);
      const ud = body.userData;
      if (!ud.scale.equals(_s) && Math.abs(ud.scale.x - _s.x) + Math.abs(ud.scale.y - _s.y) + Math.abs(ud.scale.z - _s.z) > 1e-4) {
        // l'échelle a changé : reconstruire les formes
        const v = body.velocity.clone(), av = body.angularVelocity.clone();
        const nb = this.sync(rgo);
        if (nb) {
          nb.velocity.copy(v);
          nb.angularVelocity.copy(av);
        }
        continue;
      }
      const moved = ud.lastPos.distanceToSquared(_p) > 1e-10 || Math.abs(ud.lastQuat.dot(_q)) < 0.9999999;
      if (body.type === CANNON.Body.DYNAMIC) {
        if (moved) {
          body.position.set(_p.x, _p.y, _p.z);
          body.quaternion.set(_q.x, _q.y, _q.z, _q.w);
          body.previousPosition.copy(body.position);
          body.interpolatedPosition.copy(body.position);
          body.aabbNeedsUpdate = true;
          body.wakeUp();
        }
        if (!body.userData_useGravity && body.userData_useGravity !== undefined) {
          const g = this.world.gravity;
          body.force.x -= g.x * body.mass;
          body.force.y -= g.y * body.mass;
          body.force.z -= g.z * body.mass;
        }
      } else if (body.type === CANNON.Body.KINEMATIC) {
        body.velocity.set((_p.x - body.position.x) / dt, (_p.y - body.position.y) / dt, (_p.z - body.position.z) / dt);
        body.quaternion.set(_q.x, _q.y, _q.z, _q.w);
        if (moved) body.wakeUp();
      } else if (moved) {
        body.position.set(_p.x, _p.y, _p.z);
        body.quaternion.set(_q.x, _q.y, _q.z, _q.w);
        body.aabbNeedsUpdate = true;
        // réveiller les corps proches
        for (const other of this.world.bodies) if (other.sleepState === CANNON.Body.SLEEPING) other.wakeUp();
      }
      ud.lastPos.copy(_p);
      ud.lastQuat.copy(_q);
    }
  }

  step(dt) {
    this.world.step(dt);
  }

  /** Recopie les poses des corps dynamiques vers les objets three.js */
  syncOut() {
    for (const [rgo, body] of this.bodies) {
      const ud = body.userData;
      if (body.type === CANNON.Body.STATIC) continue;
      const obj = rgo.obj;
      if (body.type === CANNON.Body.KINEMATIC) {
        // la pose vient du script : on garde la position attendue
        body.velocity.set(0, 0, 0);
        continue;
      }
      // axes bloqués : annuler la vitesse résiduelle
      const lf = body.linearFactor, af = body.angularFactor;
      if (lf.x === 0) body.velocity.x = 0;
      if (lf.y === 0) body.velocity.y = 0;
      if (lf.z === 0) body.velocity.z = 0;
      if (af.x === 0) body.angularVelocity.x = 0;
      if (af.y === 0) body.angularVelocity.y = 0;
      if (af.z === 0) body.angularVelocity.z = 0;
      _p.set(body.position.x, body.position.y, body.position.z);
      _q.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
      const parent = obj.parent;
      if (!parent || parent.isScene) {
        obj.position.copy(_p);
        obj.quaternion.copy(_q);
      } else {
        parent.updateWorldMatrix(true, false);
        _m.compose(_p, _q, ud.scale);
        _pi.copy(parent.matrixWorld).invert();
        _m.premultiply(_pi);
        _m.decompose(obj.position, obj.quaternion, _s);
      }
      obj.updateMatrixWorld();
      ud.lastPos.copy(_p);
      ud.lastQuat.copy(_q);
    }
  }

  takeEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  contactInfo(A, B) {
    for (const c of this.world.contacts) {
      if ((c.bi === A && c.bj === B) || (c.bi === B && c.bj === A)) {
        const sign = c.bi === A ? 1 : -1;
        const pt = c.bi.position.vadd(c.ri);
        return { point: [pt.x, pt.y, pt.z], normal: [c.ni.x * sign, c.ni.y * sign, c.ni.z * sign] };
      }
    }
    return null;
  }

  raycast(origin, dir, maxDist = 1000, all = false, includeTriggers = false) {
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const from = new CANNON.Vec3(origin.x, origin.y, origin.z);
    const to = new CANNON.Vec3(origin.x + (dir.x / len) * maxDist, origin.y + (dir.y / len) * maxDist, origin.z + (dir.z / len) * maxDist);
    const hits = [];
    this.world.raycastAll(from, to, { skipBackfaces: true, checkCollisionResponse: false }, (r) => {
      if (!includeTriggers && r.body.isTrigger) return;
      if (!r.body.userData) return;
      hits.push({
        point: [r.hitPointWorld.x, r.hitPointWorld.y, r.hitPointWorld.z],
        normal: [r.hitNormalWorld.x, r.hitNormalWorld.y, r.hitNormalWorld.z],
        distance: r.distance,
        rgo: r.body.userData.rgo,
        body: r.body,
      });
    });
    hits.sort((a, b) => a.distance - b.distance);
    return all ? hits : hits[0] || null;
  }

  overlapSphere(center, radius) {
    const out = [];
    for (const [rgo, body] of this.bodies) {
      if (body.aabbNeedsUpdate) body.updateAABB();
      const a = body.aabb;
      const cx = Math.max(a.lowerBound.x, Math.min(center.x, a.upperBound.x));
      const cy = Math.max(a.lowerBound.y, Math.min(center.y, a.upperBound.y));
      const cz = Math.max(a.lowerBound.z, Math.min(center.z, a.upperBound.z));
      const d2 = (cx - center.x) ** 2 + (cy - center.y) ** 2 + (cz - center.z) ** 2;
      if (d2 <= radius * radius) out.push(rgo);
    }
    return out;
  }

  clear() {
    for (const b of [...this.world.bodies]) this.world.removeBody(b);
    this.bodies.clear();
    this.pairs.clear();
    this.events = [];
  }
}

export { CANNON };
