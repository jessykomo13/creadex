// Systèmes de particules et traînées (exécution)

import * as THREE from 'three';

const VERT = `
attribute float psize;
attribute vec4 pcolor;
varying vec4 vColor;
uniform float uScale;
uniform float uOrtho;
void main() {
  vColor = pcolor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uOrtho > 0.5 ? psize * uScale : psize * uScale / max(0.001, -mv.z);
}`;
const FRAG = `
varying vec4 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.12, d);
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}`;

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _d = new THREE.Vector3();

function hexRGB(hex) {
  const c = new THREE.Color(hex);
  // valeurs sRGB brutes (le shader n'applique pas de conversion)
  return [c.r, c.g, c.b].map((v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
}

export class ParticleEmitter {
  constructor(data, owner, scene) {
    this.data = data;
    this.owner = owner; // THREE.Object3D du GameObject
    this.scene = scene;
    this.max = Math.max(1, Math.min(5000, data.max | 0 || 400));
    const n = this.max;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);
    this.count = 0;
    this.geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.aPos);
    this.geo.setAttribute('pcolor', this.aCol);
    this.geo.setAttribute('psize', this.aSize);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 300 }, uOrtho: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: data.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.userData.isParticles = true;
    (data.worldSpace ? scene : owner).add(this.points);
    this.playing = false;
    this.paused = false;
    this.time = 0;
    this.acc = 0;
    this.refreshColors();
    if (data.playOnAwake) this.Play();
  }

  refreshColors() {
    this.c0 = hexRGB(this.data.startColor || '#ffffff');
    this.c1 = hexRGB(this.data.endColor || this.data.startColor || '#ffffff');
    this.mat.blending = this.data.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
  }

  Play() {
    this.playing = true;
    this.paused = false;
    this.time = 0;
    this.acc = 0;
    if (this.data.burst > 0) this.Emit(this.data.burst);
  }
  Stop() {
    this.playing = false;
  }
  Pause() {
    this.paused = true;
  }
  Clear() {
    this.count = 0;
  }

  Emit(n) {
    const d = this.data;
    const ws = d.worldSpace;
    if (ws) {
      this.owner.updateWorldMatrix(true, false);
      this.owner.matrixWorld.decompose(_p, _q, _s);
    } else {
      _p.set(0, 0, 0);
      _q.identity();
      _s.set(1, 1, 1);
    }
    const spread = ((d.spread ?? 25) * Math.PI) / 180;
    for (let k = 0; k < n; k++) {
      if (this.count >= this.max) break;
      const i = this.count++;
      // direction
      if (d.shape === 'Sphere') {
        const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
        _d.set(r * Math.cos(t), r * Math.sin(t), u);
      } else {
        const a = Math.acos(1 - Math.random() * (1 - Math.cos(spread)));
        const b = Math.random() * Math.PI * 2;
        _d.set(Math.sin(a) * Math.cos(b), Math.sin(a) * Math.sin(b), -Math.cos(a));
      }
      _d.applyQuaternion(_q);
      const sp = (d.speed ?? 3) * (0.75 + Math.random() * 0.5);
      let ox = 0, oy = 0, oz = 0;
      if (d.shape === 'Box') {
        const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiply(_s).applyQuaternion(_q);
        ox = v.x; oy = v.y; oz = v.z;
      }
      this.pos[i * 3] = _p.x + ox;
      this.pos[i * 3 + 1] = _p.y + oy;
      this.pos[i * 3 + 2] = _p.z + oz;
      this.vel[i * 3] = _d.x * sp;
      this.vel[i * 3 + 1] = _d.y * sp;
      this.vel[i * 3 + 2] = _d.z * sp;
      this.age[i] = 0;
      this.life[i] = (d.lifetime ?? 1) * (0.8 + Math.random() * 0.4);
    }
  }

  get isPlaying() {
    return this.playing && !this.paused;
  }
  get particleCount() {
    return this.count;
  }

  update(dt, camera, viewH) {
    const d = this.data;
    this.points.visible = this.owner.visible !== false && d.enabled !== false;
    if (!this.paused) {
      if (this.playing) {
        this.time += dt;
        if (!d.loop && this.time >= (d.duration ?? 2)) this.playing = false;
        else {
          this.acc += dt * (d.rate ?? 0);
          const n = Math.floor(this.acc);
          if (n > 0) {
            this.acc -= n;
            this.Emit(n);
          }
        }
      }
      const g = d.gravity || 0;
      for (let i = 0; i < this.count; i++) {
        this.age[i] += dt;
        if (this.age[i] >= this.life[i]) {
          // remplacer par la dernière
          const j = --this.count;
          if (i !== j) {
            for (let c = 0; c < 3; c++) {
              this.pos[i * 3 + c] = this.pos[j * 3 + c];
              this.vel[i * 3 + c] = this.vel[j * 3 + c];
            }
            this.age[i] = this.age[j];
            this.life[i] = this.life[j];
          }
          i--;
          continue;
        }
        this.vel[i * 3 + 1] -= g * 9.81 * dt;
        this.pos[i * 3] += this.vel[i * 3] * dt;
        this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
        this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      }
    }
    const P = this.aPos.array, C = this.aCol.array, S = this.aSize.array;
    const s0 = d.size ?? 0.25, s1 = d.endSize ?? s0;
    for (let i = 0; i < this.count; i++) {
      const t = this.age[i] / this.life[i];
      P[i * 3] = this.pos[i * 3];
      P[i * 3 + 1] = this.pos[i * 3 + 1];
      P[i * 3 + 2] = this.pos[i * 3 + 2];
      C[i * 4] = this.c0[0] + (this.c1[0] - this.c0[0]) * t;
      C[i * 4 + 1] = this.c0[1] + (this.c1[1] - this.c0[1]) * t;
      C[i * 4 + 2] = this.c0[2] + (this.c1[2] - this.c0[2]) * t;
      C[i * 4 + 3] = t < 0.1 ? t * 10 : 1 - Math.max(0, (t - 0.6) / 0.4);
      S[i] = s0 + (s1 - s0) * t;
    }
    this.geo.setDrawRange(0, this.count);
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = true;
    if (camera) {
      if (camera.isOrthographicCamera) {
        this.mat.uniforms.uOrtho.value = 1;
        this.mat.uniforms.uScale.value = (viewH * camera.zoom) / (camera.top - camera.bottom);
      } else {
        this.mat.uniforms.uOrtho.value = 0;
        this.mat.uniforms.uScale.value = viewH / (2 * Math.tan((camera.fov * Math.PI) / 360));
      }
    }
  }

  dispose() {
    this.points.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}

const MAXP = 64;
const _cam = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _side = new THREE.Vector3();

export class Trail {
  constructor(data, owner, scene) {
    this.data = data;
    this.owner = owner;
    this.pts = []; // {p: Vector3, t}
    this.geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(MAXP * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(new Float32Array(MAXP * 2 * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const idx = [];
    for (let i = 0; i < MAXP - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo.setIndex(idx);
    this.geo.setAttribute('position', this.aPos);
    this.geo.setAttribute('color', this.aCol);
    this.mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: data.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.time = 0;
    this.emitting = true;
  }
  Clear() {
    this.pts = [];
  }
  update(dt, camera) {
    this.time += dt;
    const d = this.data;
    const life = d.time || 0.5;
    this.owner.updateWorldMatrix(true, false);
    const p = new THREE.Vector3().setFromMatrixPosition(this.owner.matrixWorld);
    if (this.emitting && d.enabled !== false && this.owner.visible) {
      const last = this.pts[this.pts.length - 1];
      if (!last || last.p.distanceToSquared(p) > 0.0004) this.pts.push({ p, t: this.time });
      else last.t = this.time;
    }
    while (this.pts.length && this.time - this.pts[0].t > life) this.pts.shift();
    while (this.pts.length > MAXP) this.pts.shift();
    const n = this.pts.length;
    const P = this.aPos.array, C = this.aCol.array;
    const col = new THREE.Color(d.color || '#ffffff');
    if (camera) camera.getWorldPosition(_cam);
    for (let i = 0; i < n; i++) {
      const cur = this.pts[i].p;
      const nxt = this.pts[Math.min(n - 1, i + 1)].p;
      const prv = this.pts[Math.max(0, i - 1)].p;
      _a.subVectors(nxt, prv);
      if (_a.lengthSq() < 1e-10) _a.set(1, 0, 0);
      _b.subVectors(_cam, cur);
      _side.crossVectors(_a, _b).normalize();
      const age = (this.time - this.pts[i].t) / life;
      const w = (d.width ?? 0.3) * 0.5 * (1 - age);
      P[i * 6] = cur.x + _side.x * w;
      P[i * 6 + 1] = cur.y + _side.y * w;
      P[i * 6 + 2] = cur.z + _side.z * w;
      P[i * 6 + 3] = cur.x - _side.x * w;
      P[i * 6 + 4] = cur.y - _side.y * w;
      P[i * 6 + 5] = cur.z - _side.z * w;
      const al = Math.max(0, 1 - age);
      for (let k = 0; k < 2; k++) {
        C[i * 8 + k * 4] = col.r;
        C[i * 8 + k * 4 + 1] = col.g;
        C[i * 8 + k * 4 + 2] = col.b;
        C[i * 8 + k * 4 + 3] = al;
      }
    }
    this.geo.setDrawRange(0, Math.max(0, (n - 1) * 6));
    this.aPos.needsUpdate = this.aCol.needsUpdate = true;
  }
  dispose() {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}
