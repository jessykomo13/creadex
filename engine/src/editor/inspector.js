// Panneau Inspecteur

import { h, toast, actionSheet, pickFromList, promptText, pickFiles } from '../util.js';
import { COMPONENTS, CATEGORIES, createComponent, bestColliderFor, COLLIDERS, SFX } from '../components.js';
import { DEFAULT_ENV } from '../builder.js';
import { extractFields } from '../compiler.js';
import * as API from '../api.js';
import { EditorRef } from '../api.js';
import { numField, vecField, boolField, bool3Field, colorField, selectField, rangeField, textField, pickerField, row } from './fields.js';
import { unlockAudio, AudioSystem } from '../audio.js';

const mathApi = { Vector3: API.Vector3, Vector2: API.Vector2, Quaternion: API.Quaternion, Color: API.Color, Mathf: API.Mathf, Random: API.Random, Ref: EditorRef, KeyCode: API.KeyCode, ForceMode: API.ForceMode, Space: API.Space, WaitForSeconds: API.WaitForSeconds };

const ENV_FIELDS = [
  { k: 'sky', t: 'sel', label: 'Ciel', options: ['gradient', 'color'], labels: { gradient: 'Dégradé', color: 'Couleur unie' } },
  { k: 'skyTop', t: 'color', label: 'Haut du ciel', when: (e) => e.sky === 'gradient' },
  { k: 'skyHorizon', t: 'color', label: 'Horizon', when: (e) => e.sky === 'gradient' },
  { k: 'skyBottom', t: 'color', label: 'Bas', when: (e) => e.sky === 'gradient' },
  { k: 'bg', t: 'color', label: 'Couleur de fond', when: (e) => e.sky !== 'gradient' },
  { k: 'ambient', t: 'color', label: 'Lumière ambiante' },
  { k: 'ambientIntensity', t: 'range', label: 'Intensité ambiante', min: 0, max: 2 },
  { k: 'fog', t: 'bool', label: 'Brouillard' },
  { k: 'fogColor', t: 'color', label: 'Couleur brouillard', when: (e) => e.fog },
  { k: 'fogNear', t: 'num', label: 'Début', when: (e) => e.fog },
  { k: 'fogFar', t: 'num', label: 'Fin', when: (e) => e.fog },
];

const FIELD_VISIBILITY = {
  Camera: { fov: (c) => !c.ortho, orthoSize: (c) => c.ortho, bg: (c) => c.clear === 'color' },
  Light: { range: (c) => c.kind === 'Point' || c.kind === 'Spot', angle: (c) => c.kind === 'Spot', groundColor: (c) => c.kind === 'Hemisphere', shadows: (c) => c.kind !== 'Hemisphere' },
  MeshRenderer: { tiling: (c) => !!c.texture, metalness: (c) => !c.unlit, roughness: (c) => !c.unlit, emissive: (c) => !c.unlit, emissiveIntensity: (c) => !c.unlit, flatShading: (c) => !c.unlit },
  SpriteRenderer: { shape: (c) => !c.image, pixelated: (c) => !!c.image },
  ParticleSystem: { spread: (c) => c.shape === 'Cone', duration: (c) => !c.loop },
};

export class Inspector {
  constructor(ed, el) {
    this.ed = ed;
    this.el = el;
    this.collapsed = new Set();
    this.transformWidgets = null;
    this.sfxPreview = new AudioSystem(ed.project);
  }

  render() {
    const same = this.lastId === this.ed.selection;
    this.lastId = this.ed.selection;
    const scrollTop = same ? this.el.scrollTop : 0;
    this.el.innerHTML = '';
    this.transformWidgets = null;
    const go = this.ed.selection && this.ed.getGO(this.ed.selection);
    if (this.ed.playing) this.el.appendChild(h('div.play-note', '▶ Mode Jeu : les modifications seront perdues à l\'arrêt (comme Unity).'));
    if (!go) this.renderScene();
    else this.renderObject(go);
    this.el.scrollTop = scrollTop;
  }

  // ------------------------------------------------------------ scène
  renderScene() {
    const ed = this.ed;
    const sc = ed.scene;
    sc.env = { ...DEFAULT_ENV, ...(sc.env || {}) };
    const box = h('div.insp');
    box.appendChild(
      h('div.insp-head', h('span.big-ico', '🌄'), h('div.grow', h('div.insp-title', 'Scène : ' + sc.name), h('div.insp-sub', 'Aucun objet sélectionné — réglages de la scène')))
    );
    const sec = this.section('env', '🌤️', 'Environnement', null);
    const body = sec.querySelector('.csec-body');
    for (const f of ENV_FIELDS) {
      if (f.when && !f.when(sc.env)) continue;
      body.appendChild(
        this.field(f, sc.env[f.k], (v, commit) => {
          sc.env[f.k] = v;
          ed.sv.syncAll();
          if (commit) {
            ed.commit('Environnement');
            if (f.t === 'sel' || f.t === 'bool') this.render();
          }
        })
      );
    }
    box.appendChild(sec);
    const stats = h('div.insp-stats', `${sc.objects.length} objets • ${ed.project.scripts.length} scripts • ${ed.project.prefabs.length} prefabs`);
    box.appendChild(stats);
    box.appendChild(h('div.hint', '💡 Touche un objet dans la vue Scène ou la Hiérarchie pour l\'inspecter.'));
    this.el.appendChild(box);
  }

  // ------------------------------------------------------------ objet
  renderObject(go) {
    const ed = this.ed;
    const box = h('div.insp');
    const active = h('input.switch', { type: 'checkbox', checked: go.active !== false, title: 'Actif' });
    active.addEventListener('change', () => {
      go.active = active.checked;
      ed.updateGO(go, { hierarchy: true });
      ed.commit('Activer');
    });
    const name = h('input.name-input', { value: go.name, autocomplete: 'off', spellcheck: false, autocapitalize: 'off' });
    name.addEventListener('change', () => {
      go.name = name.value.trim() || 'GameObject';
      ed.updateGO(go, { hierarchy: true });
      ed.commit('Renommer');
    });
    name.addEventListener('keydown', (e) => e.key === 'Enter' && name.blur());
    const tags = ed.project.settings.tags || ['Untagged'];
    const tagSel = selectField({
      value: go.tag || 'Untagged',
      options: [...new Set([...tags, go.tag || 'Untagged']), '__new'],
      labels: { __new: '+ Nouveau tag…' },
      onChange: async (v) => {
        if (v === '__new') {
          const t = await promptText('Nouveau tag', '', { placeholder: 'ex. Ennemi' });
          if (t && t.trim()) {
            ed.project.settings.tags = [...new Set([...tags, t.trim()])];
            go.tag = t.trim();
            ed.commit('Tag');
          }
          this.render();
          return;
        }
        go.tag = v;
        ed.commit('Tag');
      },
    });
    const more = h('button.icon-btn', { title: 'Actions', onclick: () => ed.objectMenu(go.id) }, '⋯');
    box.appendChild(h('div.insp-head', active, name, more));
    box.appendChild(
      h(
        'div.insp-tagrow',
        h('span.lbl', 'Tag'),
        tagSel,
        go.prefabId ? h('span.badge.prefab', { title: 'Instance de prefab' }, '🧩 ' + ((ed.project.prefabs.find((p) => p.id === go.prefabId) || {}).name || 'prefab')) : null
      )
    );

    // Transform
    const tsec = this.section('transform', '📐', 'Transform', null, [{ label: 'Réinitialiser', icon: '↺', onClick: () => { go.t = { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }; ed.updateGO(go); ed.commit('Réinitialiser'); this.render(); } }]);
    const tb = tsec.querySelector('.csec-body');
    const live = (key) => (v) => {
      go.t[key] = v;
      ed.updateGO(go, { light: true });
    };
    const commit = () => ed.commit('Transform');
    const pos = vecField({ value: go.t.p, step: 0.05, onInput: live('p'), onCommit: commit });
    const rot = vecField({ value: go.t.r, step: 1, onInput: live('r'), onCommit: commit });
    const scl = vecField({ value: go.t.s, step: 0.02, onInput: live('s'), onCommit: commit });
    tb.appendChild(row('Position', pos));
    tb.appendChild(row('Rotation', rot));
    tb.appendChild(row('Échelle', scl));
    this.transformWidgets = { id: go.id, pos, rot, scl };
    box.appendChild(tsec);

    go.c.forEach((c, i) => box.appendChild(this.componentSection(go, c, i)));

    box.appendChild(h('button.btn.add-comp', { onclick: () => this.addComponentMenu(go) }, '＋ Ajouter un composant'));
    this.el.appendChild(box);
  }

  refreshTransform(go) {
    const w = this.transformWidgets;
    if (!w || w.id !== go.id) return;
    w.pos.setValue(go.t.p);
    w.rot.setValue(go.t.r);
    w.scl.setValue(go.t.s);
  }

  section(key, icon, title, enabledCtl, menu) {
    const collapsed = this.collapsed.has(key);
    const body = h('div.csec-body');
    const head = h(
      'div.csec-head',
      h('span.chev', collapsed ? '▸' : '▾'),
      h('span.csec-ico', icon),
      enabledCtl,
      h('span.csec-title', title),
      menu ? h('button.icon-btn.sm', { onclick: (e) => { e.stopPropagation(); actionSheet(title, menu); } }, '⋯') : null
    );
    const sec = h('div.csec' + (collapsed ? '.collapsed' : ''), head, body);
    head.addEventListener('click', (e) => {
      if (e.target.closest('input,button,select')) return;
      if (this.collapsed.has(key)) this.collapsed.delete(key);
      else this.collapsed.add(key);
      sec.classList.toggle('collapsed');
      head.querySelector('.chev').textContent = sec.classList.contains('collapsed') ? '▸' : '▾';
    });
    return sec;
  }

  componentSection(go, c, index) {
    const ed = this.ed;
    const def = COMPONENTS[c.type];
    if (!def) return h('div.csec', h('div.csec-head', '⚠️ Composant inconnu : ' + c.type));
    const en = h('input', { type: 'checkbox', checked: c.enabled !== false, className: 'mini-chk' });
    en.addEventListener('change', () => {
      c.enabled = en.checked;
      ed.updateGO(go);
      ed.commit('Activer composant');
    });
    let title = def.label;
    const script = c.type === 'Script' ? ed.project.scripts.find((s) => s.id === c.script) : null;
    if (c.type === 'Script') title = script ? `${script.name} (Script)` : 'Script (manquant)';
    const menu = [
      c.type === 'Script' && script ? { label: 'Ouvrir le script', icon: '📝', onClick: () => ed.openScript(script.id) } : null,
      { label: 'Monter', icon: '⬆️', disabled: index === 0, onClick: () => this.moveComp(go, index, -1) },
      { label: 'Descendre', icon: '⬇️', disabled: index === go.c.length - 1, onClick: () => this.moveComp(go, index, 1) },
      { label: 'Réinitialiser', icon: '↺', onClick: () => { const n = createComponent(c.type, go, c.type === 'Script' ? { script: c.script } : {}); go.c[index] = n; ed.updateGO(go); ed.commit('Réinitialiser'); this.render(); } },
      { label: 'Copier vers…', icon: '📋', onClick: () => this.copyCompTo(go, c) },
      '-',
      { label: 'Supprimer le composant', icon: '🗑️', danger: true, onClick: () => { go.c.splice(index, 1); ed.updateGO(go, { hierarchy: true }); ed.commit('Supprimer composant'); this.render(); } },
    ];
    const sec = this.section(go.id + ':' + index + ':' + c.type, def.icon, title, en, menu);
    const body = sec.querySelector('.csec-body');
    if (c.type === 'Script') this.scriptBody(go, c, body, script);
    else {
      const vis = FIELD_VISIBILITY[c.type] || {};
      for (const f of def.fields) {
        if (vis[f.k] && !vis[f.k](c)) continue;
        body.appendChild(
          this.field(f, c[f.k], (v, commit) => {
            c[f.k] = v;
            ed.updateGO(go, { hierarchy: f.k === 'main' });
            if (commit) {
              ed.commit(def.label);
              if (vis && Object.keys(vis).length && (f.t === 'sel' || f.t === 'bool' || f.t === 'image')) this.render();
            }
          })
        );
      }
      if (c.type === 'Camera')
        body.appendChild(h('button.btn.sm', { onclick: () => ed.sv.alignCameraToView(go.id) }, '📍 Placer comme la vue Scène'));
      if (c.type === 'AudioSource')
        body.appendChild(h('button.btn.sm', { onclick: () => { unlockAudio(); this.sfxPreview.project = ed.project; this.sfxPreview.play(c.clip, { volume: c.volume, pitch: c.pitch }); } }, '▶ Écouter'));
    }
    return sec;
  }

  moveComp(go, i, d) {
    const j = i + d;
    if (j < 0 || j >= go.c.length) return;
    [go.c[i], go.c[j]] = [go.c[j], go.c[i]];
    this.ed.updateGO(go);
    this.ed.commit('Déplacer composant');
    this.render();
  }

  async copyCompTo(go, c) {
    const ed = this.ed;
    const items = ed.scene.objects.filter((o) => o.id !== go.id).map((o) => ({ label: o.name, value: o.id, icon: '⬜' }));
    const r = await pickFromList('Copier « ' + (COMPONENTS[c.type]?.label || c.type) + ' » vers…', items);
    if (!r) return;
    const target = ed.getGO(r.value);
    const copy = JSON.parse(JSON.stringify(c));
    const def = COMPONENTS[c.type];
    const ix = def.unique ? target.c.findIndex((x) => x.type === c.type) : -1;
    if (ix >= 0) target.c[ix] = copy;
    else target.c.push(copy);
    ed.updateGO(target, { hierarchy: true });
    ed.commit('Copier composant');
    toast('Composant copié sur ' + target.name);
  }

  scriptBody(go, c, body, script) {
    const ed = this.ed;
    const sel = selectField({
      value: c.script,
      options: ['', ...ed.project.scripts.map((s) => s.id)],
      labels: Object.fromEntries([['', '— Choisir un script —'], ...ed.project.scripts.map((s) => [s.id, s.name])]),
      onChange: (v) => {
        c.script = v;
        c.props = {};
        ed.updateGO(go, { hierarchy: true });
        ed.commit('Script');
        this.render();
      },
    });
    body.appendChild(row('Script', h('div.inline', sel, script ? h('button.btn.sm', { onclick: () => ed.openScript(script.id) }, '✏️') : null)));
    if (!script) return;
    const info = extractFields(script, mathApi);
    if (info.error) {
      body.appendChild(h('div.warn-box', '⚠️ ' + info.error));
      return;
    }
    if (!info.fields.length) body.appendChild(h('div.hint.sm', 'Ajoute des champs à ta classe (ex. vitesse = 5;) pour les régler ici.'));
    c.props = c.props || {};
    for (const f of info.fields) {
      const has = Object.prototype.hasOwnProperty.call(c.props, f.k);
      const val = has ? c.props[f.k] : f.d;
      const set = (v, commit) => {
        c.props[f.k] = v;
        if (commit) ed.commit('Champ de script');
      };
      let w;
      if (f.t === 'go' || f.t === 'prefab') {
        const ref = has ? c.props[f.k] : null;
        const isGo = f.t === 'go';
        const list = isGo ? ed.scene.objects : ed.project.prefabs;
        const cur = ref && ref.id ? list.find((o) => o.id === ref.id) : null;
        const label = cur ? cur.name : ref && ref.id === '' ? '— Aucun —' : f.d ? `(auto : ${f.d})` : '— Aucun —';
        w = pickerField({
          label: (isGo ? '' : '🧩 ') + label,
          title: f.k,
          items: () => [
            { label: f.d ? `Automatique (« ${f.d} »)` : 'Automatique', value: '__auto', icon: '✨' },
            { label: '— Aucun —', value: '', icon: '⊘' },
            ...list.map((o) => ({ label: o.name, value: o.id, icon: isGo ? '⬜' : '🧩' })),
          ],
          onPick: (v) => {
            if (v === '__auto') delete c.props[f.k];
            else c.props[f.k] = { ref: f.t, id: v };
            ed.commit('Référence');
            this.render();
          },
        });
      } else if (f.t === 'num') w = numField({ value: val, step: Math.abs(f.d) >= 10 ? 0.5 : 0.05, onInput: (v) => set(v), onCommit: (v) => set(v, true) });
      else if (f.t === 'range') w = rangeField({ value: val, min: f.min, max: f.max, onInput: (v) => set(v), onCommit: (v) => set(v, true) });
      else if (f.t === 'bool') w = boolField({ value: val, onChange: (v) => set(v, true) });
      else if (f.t === 'str') w = textField({ value: val, onCommit: (v) => set(v, true) });
      else if (f.t === 'color') w = colorField({ value: val, onInput: (v) => set(v), onCommit: (v) => set(v, true) });
      else if (f.t === 'vec3') w = vecField({ value: val, onInput: (v) => set(v), onCommit: (v) => set(v, true) });
      else if (f.t === 'vec2') w = vecField({ value: val, labels: ['X', 'Y'], onInput: (v) => set(v), onCommit: (v) => set(v, true) });
      else if (f.t === 'sfx') w = this.sfxSelect(val, (v) => set(v, true));
      else if (f.t === 'image') w = this.imagePicker(val, (v) => { set(v, true); this.render(); });
      if (w) {
        const r = row(prettify(f.k), w);
        if (has && f.t !== 'go' && f.t !== 'prefab') {
          const reset = h('button.reset-btn', { title: 'Valeur du script', onclick: () => { delete c.props[f.k]; ed.commit('Champ'); this.render(); } }, '↺');
          r.querySelector('.flabel').appendChild(reset);
        }
        body.appendChild(r);
      }
    }
  }

  // ------------------------------------------------------------ champ générique
  field(f, value, onChange) {
    const label = f.label || prettify(f.k);
    const inp = (v) => onChange(v, false);
    const com = (v) => onChange(v, true);
    switch (f.t) {
      case 'num':
      case 'int':
        return row(label, numField({ value, step: f.t === 'int' ? 1 : f.step || (Math.abs(value) >= 20 ? 0.5 : 0.05), min: f.min ?? -Infinity, max: f.max ?? Infinity, int: f.t === 'int', onInput: inp, onCommit: com }));
      case 'range':
        return row(label, rangeField({ value, min: f.min, max: f.max, onInput: inp, onCommit: com }));
      case 'bool':
        return row(label, boolField({ value, onChange: com }), 'boolrow');
      case 'bool3':
        return row(label, bool3Field({ value, onChange: com }));
      case 'color':
        return row(label, colorField({ value, onInput: inp, onCommit: com }));
      case 'sel':
        return row(label, selectField({ value, options: f.options, labels: f.labels, onChange: com }));
      case 'vec3':
        return row(label, vecField({ value, onInput: inp, onCommit: com }));
      case 'vec2':
        return row(label, vecField({ value, labels: ['X', 'Y'], step: Math.abs(value[0]) >= 10 ? 1 : 0.05, onInput: inp, onCommit: com }));
      case 'str':
        return row(label, textField({ value, onInput: inp, onCommit: com }));
      case 'text':
        return row(label, textField({ value, multiline: true, onInput: inp, onCommit: com }));
      case 'image':
        return row(label, this.imagePicker(value, com));
      case 'sfx':
        return row(label, this.sfxSelect(value, com));
      default:
        return row(label, h('span', String(value)));
    }
  }

  imagePicker(value, onPick) {
    const ed = this.ed;
    const asset = value && ed.project.assets.find((a) => a.id === value || a.name === value);
    return pickerField({
      label: asset ? asset.name : '— Aucune —',
      thumb: asset ? asset.data : null,
      title: 'Choisir une image',
      items: () => [
        { label: 'Importer une image…', value: '__import', icon: '📥' },
        { label: '— Aucune —', value: '', icon: '⊘' },
        ...ed.project.assets.filter((a) => a.kind === 'image').map((a) => ({ label: a.name, value: a.id, icon: '🖼️' })),
      ],
      onPick: async (v) => {
        if (v === '__import') {
          const files = await pickFiles('image/*', false);
          if (!files.length) return;
          const a = await ed.importAsset(files[0]);
          if (a) onPick(a.id);
          return;
        }
        onPick(v);
      },
    });
  }

  sfxSelect(value, onChange) {
    const ed = this.ed;
    const audio = ed.project.assets.filter((a) => a.kind === 'audio');
    const sel = selectField({
      value,
      groups: [
        { label: 'Effets intégrés', options: SFX.map((s) => ({ value: 'sfx:' + s, label: s })) },
        ...(audio.length ? [{ label: 'Sons importés', options: audio.map((a) => ({ value: a.id, label: a.name })) }] : []),
      ],
      onChange,
    });
    const play = h('button.icon-btn.sm', { type: 'button', onclick: () => { unlockAudio(); this.sfxPreview.project = ed.project; this.sfxPreview.play(sel.value); } }, '▶');
    return h('div.inline', sel, play);
  }

  // ------------------------------------------------------------ ajout de composant
  async addComponentMenu(go) {
    const ed = this.ed;
    const items = [];
    for (const cat of CATEGORIES) {
      for (const [type, def] of Object.entries(COMPONENTS)) {
        if (def.cat !== cat || type === 'Script') continue;
        const has = go.c.some((c) => c.type === type);
        items.push({ label: def.label, value: type, icon: def.icon, group: cat, sub: has && def.unique ? 'déjà présent' : '' });
      }
      if (cat === 'Scripts') {
        items.push({ label: 'Bibliothèque de scripts…', value: '__lib', icon: '📚', group: 'Scripts', desc: 'Scripts prêts : perso qui marche, caméra, ennemis, animations…' });
        for (const s of ed.project.scripts) items.push({ label: s.name, value: 'script:' + s.id, icon: '📜', group: 'Scripts' });
        items.push({ label: 'Nouveau script vide…', value: '__newscript', icon: '✨', group: 'Scripts' });
      }
    }
    const r = await pickFromList('Ajouter un composant', items);
    if (!r) return;
    let comp;
    if (r.value === '__lib') {
      const id = await ed.pickLibraryScript({ includeEmpty: false });
      if (id) {
        ed.attachLibScript(go, id);
        requestAnimationFrame(() => (this.el.scrollTop = this.el.scrollHeight));
      }
      return;
    }
    if (r.value === '__newscript') {
      const s = await ed.createScriptInteractive();
      if (!s) return;
      comp = createComponent('Script', go, { script: s.id });
    } else if (r.value.startsWith('script:')) comp = createComponent('Script', go, { script: r.value.slice(7) });
    else {
      const def = COMPONENTS[r.value];
      if (def.unique && go.c.some((c) => c.type === r.value)) {
        toast(def.label + ' est déjà présent', 'warn');
        return;
      }
      comp = createComponent(r.value, go);
    }
    go.c.push(comp);
    // un Rigidbody sans collider : on en ajoute un adapté
    if (comp.type === 'Rigidbody' && !go.c.some((c) => COLLIDERS.includes(c.type)) && go.c.some((c) => c.type === 'MeshRenderer' || c.type === 'SpriteRenderer')) {
      go.c.push(createComponent(bestColliderFor(go), go));
      toast('Collider ajouté automatiquement');
    }
    ed.updateGO(go, { hierarchy: true });
    ed.commit('Ajouter composant');
    this.render();
    requestAnimationFrame(() => (this.el.scrollTop = this.el.scrollHeight));
  }
}

function prettify(k) {
  const s = String(k).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

