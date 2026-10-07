// Éditeur principal (mise en page, état, annuler/rétablir, mode Jeu…)

import { h, toast, actionSheet, promptText, confirmBox, debounce, clone, uid, readFile, haptic } from '../util.js';
import { Store, Prefs } from '../storage.js';
import { SceneView } from './sceneview.js';
import { Hierarchy } from './hierarchy.js';
import { Inspector } from './inspector.js';
import { ProjectPanel } from './projectpanel.js';
import { ConsolePanel } from './console.js';
import { CREATE_MENU, createFromMenu, createComponent, createGameObject } from '../components.js';
import { readTransform } from '../builder.js';
import { Runtime } from '../runtime.js';
import { unlockAudio } from '../audio.js';
import { requestMotionPermission } from '../input.js';
import { checkSyntax } from '../compiler.js';
import { scriptTemplate, sanitizeClassName, newScene } from '../templates.js';
import { exportGameHTML, exportProjectJSON, projectSettings, runFullscreen } from './build.js';
import { APP_VERSION } from '../version.js';

const TABS = [
  { id: 'hierarchy', label: 'Hiérarchie', icon: '🗂️' },
  { id: 'inspector', label: 'Inspecteur', icon: 'ⓘ' },
  { id: 'project', label: 'Projet', icon: '📁' },
  { id: 'console', label: 'Console', icon: '⌨️' },
];

export class Editor {
  constructor(app, project) {
    this.app = app;
    this.project = project;
    this.scene = project.scenes.find((s) => s.id === project.activeScene) || project.scenes[0];
    this.selection = null;
    this.undoStack = [];
    this.redoStack = [];
    this.playing = false;
    this.runtime = null;
    this.dirty = false;
    this.scriptErrors = {};
    this.loggedErrors = new Set();
    this.clipboard = null;
    this.tab = 'hierarchy';
    this.lastThumb = 0;
    this.saveSoon = debounce(() => this.save(), 1200);
    this.checkScriptsSoon = debounce(() => this.checkScripts(), 500);
  }

  mount(container) {
    this.build();
    container.appendChild(this.root);
    this.sv = new SceneView(this, this.viewport);
    this.hierarchy = new Hierarchy(this, this.panels.hierarchy);
    this.inspector = new Inspector(this, this.panels.inspector);
    this.projectPanel = new ProjectPanel(this, this.panels.project);
    this.console = new ConsolePanel(this, this.panels.console);
    this.sv.rebuild();
    this.sv.setTool('move');
    this.sv.setSnap(Prefs.get('snap'));
    this.lastSnap = this.snapshot();
    this.mq = matchMedia('(min-width: 900px) and (min-height: 500px)');
    // téléphone tenu en paysage : panneaux à droite de la vue
    this.mqSide = matchMedia('(orientation: landscape) and (max-height: 560px)');
    this.applyLayout();
    this.renderAll();
    this.checkScripts();
    this.updateUndo();
    this.bindKeys();
    this.onVis = () => {
      if (document.visibilityState === 'hidden' && this.dirty) this.save();
    };
    document.addEventListener('visibilitychange', this.onVis);
    this.onMq = () => this.applyLayout();
    this.mq.addEventListener('change', this.onMq);
    this.mqSide.addEventListener('change', this.onMq);
    this.console.log({ type: 'log', msg: `Projet « ${this.project.name} » ouvert. Appuie sur ▶ pour jouer.` });
  }

  // ------------------------------------------------------------ interface
  build() {
    const b = (label, title, fn, cls = '') => h('button.icon-btn' + cls, { title, onclick: fn }, label);
    this.playBtn = h('button.play-btn', { title: 'Jouer', onclick: () => this.play() }, '▶');
    this.pauseBtn = h('button.play-btn', { title: 'Pause', onclick: () => this.togglePause() }, '⏸');
    this.stepBtn = h('button.play-btn', { title: 'Image suivante', onclick: () => this.step() }, '⏭');
    this.titleEl = h('div.ed-title');
    this.saveDot = h('span.save-dot', { title: 'Enregistré' });
    const top = h(
      'header.ed-top',
      b('☰', 'Menu', () => this.mainMenu()),
      h('div.ed-title-wrap', this.titleEl, this.saveDot),
      h('div.play-group', this.playBtn, this.pauseBtn, this.stepBtn),
      b('</>', 'Éditeur de code', () => this.openCodeEditor(), '.code-btn')
    );
    this.segScene = h('button.seg.on', { onclick: () => this.setViewMode('scene') }, '# Scène');
    this.segGame = h('button.seg', { onclick: () => this.setViewMode('game') }, '🎮 Jeu');
    this.undoBtn = b('↶', 'Annuler', () => this.undo());
    this.redoBtn = b('↷', 'Rétablir', () => this.redo());
    const viewBar = h('div.view-bar', h('div.segs', this.segScene, this.segGame), h('div.grow'), this.undoBtn, this.redoBtn, h('button.btn.sm.primary', { onclick: () => this.createMenu() }, '＋'));

    const tool = (id, label, title) => h('button.tool' + (id === 'move' ? '.on' : ''), { title, dataset: { tool: id }, onclick: () => this.setTool(id) }, label);
    this.spaceBtn = h('button.tool', { title: 'Repère global / local', onclick: () => this.toggleSpace() }, '🌐');
    this.snapBtn = h('button.tool' + (Prefs.get('snap') ? '.on' : ''), { title: 'Magnétisme', onclick: () => this.toggleSnap() }, '🧲');
    this.dimBtn = h('button.tool', { title: 'Vue 2D / 3D', onclick: () => this.toggle2D() }, this.project.settings.is2D ? '2D' : '3D');
    this.toolsEl = h(
      'div.vtools.scene-only',
      tool('view', '✋', 'Naviguer (Q)'),
      tool('move', '✥', 'Déplacer (W)'),
      tool('rotate', '⟳', 'Tourner (E)'),
      tool('scale', '⤢', 'Échelle (R)'),
      h('span.vsep'),
      this.spaceBtn,
      this.snapBtn,
      this.dimBtn,
      h('button.tool', { title: 'Cadrer la sélection (F)', onclick: () => this.selection && this.sv.focus(this.selection) }, '⌖')
    );
    this.maxBtn = h('button.tool', { title: 'Plein écran', onclick: () => this.toggleMax() }, '⛶');
    this.gameTools = h('div.vtools.game-only', this.maxBtn);
    this.statsEl = h('div.stats' + (Prefs.get('showStats') ? '' : '.hidden'));
    this.playBanner = h('div.play-banner', '▶ EN JEU');
    this.viewport = h('div.viewport.mode-scene', this.toolsEl, this.gameTools, this.statsEl, this.playBanner);
    const view = h('section.ed-view', viewBar, this.viewport);

    this.resizer = h('div.ed-resizer', h('span'));
    this.bindResizer();
    this.tabBtns = {};
    this.badge = h('span.tab-badge.hidden', '0');
    const tabs = h(
      'nav.dock-tabs',
      TABS.map((t) => {
        const btn = h('button.dock-tab' + (t.id === this.tab ? '.on' : ''), { dataset: { tab: t.id }, onclick: () => this.showTab(t.id) }, h('span.ti', t.icon), h('span.tl', t.label), t.id === 'console' ? this.badge : null);
        this.tabBtns[t.id] = btn;
        return btn;
      })
    );
    this.panels = {};
    const panelEls = TABS.map((t) => (this.panels[t.id] = h('section.panel.panel-' + t.id + (t.id === this.tab ? '.on' : ''))));
    this.main = h('main.ed-main', view, this.resizer, tabs, ...panelEls);
    this.root = h('div.editor' + (this.project.settings.is2D ? '.is2d' : ''), top, this.main);
    const vh = Prefs.get('viewH');
    if (vh) this.main.style.setProperty('--view-h', vh);
    const sw = Prefs.get('sideW');
    if (sw) this.main.style.setProperty('--side-w', sw);
  }

  applyLayout() {
    this.wide = this.mq ? this.mq.matches : false;
    this.side = !this.wide && !!this.mqSide && this.mqSide.matches;
    this.root.classList.toggle('wide', this.wide);
    this.root.classList.toggle('side', this.side);
    if (this.wide && (this.tab === 'hierarchy' || this.tab === 'inspector')) this.showTab('project');
    this.sv && this.sv.resize();
  }

  bindResizer() {
    const r = this.resizer;
    r.style.touchAction = 'none';
    r.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      r.setPointerCapture(e.pointerId);
      const rect = this.main.getBoundingClientRect();
      const side = this.side;
      const move = (ev) => {
        if (side) {
          // paysage : largeur du panneau de droite
          const w = Math.max(220, Math.min(rect.width - 220, rect.right - ev.clientX));
          this.main.style.setProperty('--side-w', Math.round((w / rect.width) * 1000) / 10 + '%');
        } else {
          const y = Math.max(120, Math.min(rect.height - 140, ev.clientY - rect.top));
          this.main.style.setProperty('--view-h', Math.round((y / rect.height) * 1000) / 10 + '%');
        }
        this.sv.resize();
      };
      const up = () => {
        r.removeEventListener('pointermove', move);
        r.removeEventListener('pointerup', up);
        if (side) Prefs.set('sideW', this.main.style.getPropertyValue('--side-w'));
        else Prefs.set('viewH', this.main.style.getPropertyValue('--view-h'));
      };
      r.addEventListener('pointermove', move);
      r.addEventListener('pointerup', up);
    });
    r.addEventListener('dblclick', () => {
      this.main.style.removeProperty(this.side ? '--side-w' : '--view-h');
      Prefs.set(this.side ? 'sideW' : 'viewH', '');
      this.sv.resize();
    });
  }

  showTab(id) {
    if (this.wide && (id === 'hierarchy' || id === 'inspector')) {
      this.panels[id].classList.add('flash');
      setTimeout(() => this.panels[id].classList.remove('flash'), 400);
      return;
    }
    this.tab = id;
    for (const [k, btn] of Object.entries(this.tabBtns)) btn.classList.toggle('on', k === id);
    for (const [k, p] of Object.entries(this.panels)) p.classList.toggle('on', k === id);
    if (id === 'console') {
      this.badge.classList.add('hidden');
      this.unseenErrors = 0;
    }
  }

  renderAll() {
    this.refreshTitle();
    this.hierarchy.render();
    this.inspector.render();
    this.projectPanel.render();
    this.console.render();
  }

  refreshTitle() {
    this.titleEl.innerHTML = '';
    this.titleEl.append(h('div.t1', this.project.name), h('div.t2', '🎬 ' + this.scene.name + (this.project.settings.is2D ? ' • 2D' : '')));
  }

  onConsoleEntry(type) {
    if (type === null) {
      this.badge.classList.add('hidden');
      return;
    }
    if (type === 'error' && this.tab !== 'console') {
      this.unseenErrors = (this.unseenErrors || 0) + 1;
      this.badge.textContent = String(Math.min(99, this.unseenErrors));
      this.badge.classList.remove('hidden');
    }
  }

  // ------------------------------------------------------------ outils de vue
  setTool(t) {
    this.sv.setTool(t);
    this.toolsEl.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  }
  toggleSpace() {
    const s = this.sv.space === 'world' ? 'local' : 'world';
    this.sv.setSpace(s);
    this.spaceBtn.textContent = s === 'world' ? '🌐' : '📍';
    toast(s === 'world' ? 'Repère global' : 'Repère local', 'info', 900);
  }
  toggleSnap() {
    const s = !this.sv.snap;
    this.sv.setSnap(s);
    Prefs.set('snap', s);
    this.snapBtn.classList.toggle('on', s);
    toast(s ? 'Magnétisme activé (0,5 / 15° / 0,1)' : 'Magnétisme désactivé', 'info', 1100);
  }
  toggle2D() {
    const b = !this.sv.is2D;
    this.project.settings.is2D = b;
    this.sv.setMode2D(b);
    this.dimBtn.textContent = b ? '2D' : '3D';
    this.root.classList.toggle('is2d', b);
    this.refreshTitle();
    this.markDirty();
  }
  setViewMode(m) {
    this.viewMode = m;
    this.segScene.classList.toggle('on', m === 'scene');
    this.segGame.classList.toggle('on', m === 'game');
    this.viewport.classList.toggle('mode-scene', m === 'scene');
    this.viewport.classList.toggle('mode-game', m === 'game');
    this.sv.setMode(m);
    if (m !== 'game' && this.root.classList.contains('maximized')) this.toggleMax();
  }
  toggleMax() {
    this.root.classList.toggle('maximized');
    this.maxBtn.textContent = this.root.classList.contains('maximized') ? '🗗' : '⛶';
    setTimeout(() => this.sv.resize(), 30);
  }

  // ------------------------------------------------------------ état & annuler
  getGO(id) {
    return this.scene.objects.find((o) => o.id === id) || null;
  }
  childrenOf(id) {
    return this.scene.objects.filter((o) => o.parent === id);
  }
  subtreeIds(id) {
    const out = [id];
    for (let i = 0; i < out.length; i++) for (const o of this.scene.objects) if (o.parent === out[i]) out.push(o.id);
    return out;
  }

  snapshot() {
    return JSON.stringify({ sceneId: this.scene.id, objects: this.scene.objects, env: this.scene.env, sel: this.selection });
  }

  commit() {
    const snap = this.snapshot();
    if (snap === this.lastSnap) return;
    this.undoStack.push(this.lastSnap);
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack = [];
    this.lastSnap = snap;
    this.markDirty();
    this.updateUndo();
  }

  restore(s) {
    const d = JSON.parse(s);
    if (d.sceneId !== this.scene.id) {
      const sc = this.project.scenes.find((x) => x.id === d.sceneId);
      if (!sc) return;
      this.scene = sc;
      this.project.activeScene = sc.id;
    }
    this.scene.objects = d.objects;
    this.scene.env = d.env;
    this.selection = d.sel && this.getGO(d.sel) ? d.sel : null;
    this.sv.syncAll();
    this.renderAll();
    this.markDirty();
  }

  undo() {
    if (this.playing) return toast('Arrête le jeu pour annuler', 'warn');
    if (!this.undoStack.length) return;
    this.redoStack.push(this.lastSnap);
    const s = this.undoStack.pop();
    this.lastSnap = s;
    this.restore(s);
    this.updateUndo();
    haptic(6);
  }
  redo() {
    if (this.playing) return;
    if (!this.redoStack.length) return;
    this.undoStack.push(this.lastSnap);
    const s = this.redoStack.pop();
    this.lastSnap = s;
    this.restore(s);
    this.updateUndo();
    haptic(6);
  }
  updateUndo() {
    this.undoBtn.disabled = !this.undoStack.length;
    this.redoBtn.disabled = !this.redoStack.length;
  }

  markDirty() {
    this.dirty = true;
    this.saveDot.classList.add('dirty');
    if (Prefs.get('autosave') !== false) this.saveSoon();
  }

  async save(withThumb = false) {
    this.saveSoon.cancel();
    if (this.code) this.code.flush();
    this.project.modified = Date.now();
    this.project.activeScene = this.scene.id;
    if (!this.playing && (withThumb || Date.now() - this.lastThumb > 20000 || !this.project.thumb)) {
      const t = this.sv.captureThumb();
      if (t) this.project.thumb = t;
      this.lastThumb = Date.now();
    }
    try {
      await Store.saveProject(this.project);
      this.dirty = false;
      this.saveDot.classList.remove('dirty');
    } catch (e) {
      toast('Échec de l\'enregistrement : ' + e.message, 'error', 4000);
    }
  }

  // ------------------------------------------------------------ sélection & objets
  select(id, source) {
    if (this.selection === id) {
      if (id && source === 'view' && !this.wide && this.tab !== 'inspector') this.showTab('inspector');
      return;
    }
    this.selection = id;
    this.sv.updateSelection();
    this.hierarchy.render();
    this.inspector.render();
    if (id && source === 'view' && !this.wide && this.tab !== 'inspector') this.showTab('inspector');
    const row = this.hierarchy.list.querySelector('.hrow.sel');
    if (row) row.scrollIntoView({ block: 'nearest' });
  }

  updateGO(go, opts = {}) {
    this.sv.syncObject(go);
    if (opts.hierarchy) this.hierarchy.render();
  }

  onTransformLive(go) {
    this.inspector.refreshTransform(go);
  }

  createMenu() {
    if (this.playing) return toast('Arrête le jeu pour modifier la scène', 'warn');
    actionSheet(
      'Créer',
      CREATE_MENU.map((m) => (m.header ? m : { label: m.label, icon: m.icon, onClick: () => this.createObject(m.id) }))
    );
  }

  createObject(menuId) {
    const go = createFromMenu(menuId, { is2D: this.sv.is2D });
    const isUI = menuId.startsWith('ui:');
    if (!isUI && !menuId.startsWith('light:Directional') && menuId !== 'camera') {
      const sp = this.sv.spawnPoint();
      go.t.p = [sp[0], menuId.startsWith('mesh:') && !this.sv.is2D && menuId !== 'mesh:Plane' ? Math.max(sp[1], 0.5) : sp[1], sp[2]];
    }
    if (this.sv.is2D && menuId === 'camera') go.t.p = [0, 0, 10];
    if (menuId === 'camera' && !this.scene.objects.some((o) => o.c.some((c) => c.type === 'Camera'))) {
      go.c[0].main = true;
      go.tag = 'MainCamera';
    }
    this.addObject(go);
  }

  addObject(go, { select = true } = {}) {
    this.scene.objects.push(go);
    this.sv.syncObject(go);
    if (select) this.select(go.id);
    else this.hierarchy.render();
    this.commit('Créer');
  }

  deleteObject(id) {
    if (this.playing) return toast('Arrête le jeu pour modifier la scène', 'warn');
    const ids = new Set(this.subtreeIds(id));
    this.scene.objects = this.scene.objects.filter((o) => !ids.has(o.id));
    if (ids.has(this.selection)) this.selection = null;
    this.sv.syncAll();
    this.hierarchy.render();
    this.inspector.render();
    this.commit('Supprimer');
  }

  /** Copie un sous-arbre avec de nouveaux identifiants */
  cloneSubtree(rootId, objects = this.scene.objects) {
    const ids = [rootId];
    for (let i = 0; i < ids.length; i++) for (const o of objects) if (o.parent === ids[i]) ids.push(o.id);
    const map = new Map(ids.map((id) => [id, uid()]));
    const out = ids.map((id) => {
      const o = clone(objects.find((x) => x.id === id));
      o.id = map.get(id);
      o.parent = id === rootId ? null : map.get(o.parent);
      return o;
    });
    remapRefs(out, map);
    return out;
  }

  duplicate(id) {
    if (this.playing) return;
    const src = this.getGO(id);
    if (!src) return;
    const copy = this.cloneSubtree(id);
    copy[0].parent = src.parent;
    const base = src.name.replace(/\s*\(\d+\)$/, '');
    let n = 1;
    while (this.scene.objects.some((o) => o.name === `${base} (${n})`)) n++;
    copy[0].name = `${base} (${n})`;
    const ids = this.subtreeIds(id);
    const lastIdx = Math.max(...ids.map((x) => this.scene.objects.findIndex((o) => o.id === x)));
    this.scene.objects.splice(lastIdx + 1, 0, ...copy);
    this.sv.syncAll();
    this.select(copy[0].id);
    this.commit('Dupliquer');
  }

  copy(id) {
    this.clipboard = this.cloneSubtree(id);
    toast('Copié : ' + this.clipboard[0].name, 'info', 1000);
  }
  paste() {
    if (!this.clipboard || this.playing) return;
    const map = new Map(this.clipboard.map((o) => [o.id, uid()]));
    const objs = clone(this.clipboard).map((o) => ({ ...o, id: map.get(o.id), parent: o.parent ? map.get(o.parent) : null }));
    remapRefs(objs, map);
    this.scene.objects.push(...objs);
    this.sv.syncAll();
    this.select(objs[0].id);
    this.commit('Coller');
  }

  reparent(id, parentId) {
    if (this.playing) return;
    if (parentId && this.subtreeIds(id).includes(parentId)) return toast('Impossible : un objet ne peut pas être son propre enfant', 'warn');
    const go = this.getGO(id);
    if (!go || (go.parent || null) === (parentId || null)) return;
    const e = this.sv.goMap.get(id);
    const pe = parentId ? this.sv.goMap.get(parentId) : null;
    (pe ? pe.group : this.sv.scene).attach(e.group);
    go.t = readTransform(e.group);
    go.parent = parentId || null;
    // l'enfant passe après son nouveau parent dans la liste
    if (parentId) {
      const sub = this.subtreeIds(id);
      const moved = this.scene.objects.filter((o) => sub.includes(o.id));
      this.scene.objects = this.scene.objects.filter((o) => !sub.includes(o.id));
      const pSub = this.subtreeIds(parentId);
      const at = Math.max(...pSub.map((x) => this.scene.objects.findIndex((o) => o.id === x)));
      this.scene.objects.splice(at + 1, 0, ...moved);
      this.hierarchy.collapsed.delete(parentId);
    }
    this.sv.syncAll();
    this.hierarchy.render();
    this.inspector.render();
    this.commit('Parent');
  }

  moveSibling(id, dir) {
    const go = this.getGO(id);
    const sibs = this.scene.objects.filter((o) => (o.parent || null) === (go.parent || null));
    const i = sibs.indexOf(go);
    const other = sibs[i + dir];
    if (!other) return;
    const a = this.scene.objects.indexOf(go), b = this.scene.objects.indexOf(other);
    this.scene.objects[a] = other;
    this.scene.objects[b] = go;
    this.hierarchy.render();
    this.commit('Ordre');
  }

  async renameObject(id) {
    const go = this.getGO(id);
    const n = await promptText('Renommer', go.name);
    if (n && n.trim()) {
      go.name = n.trim();
      this.hierarchy.render();
      this.inspector.render();
      this.commit('Renommer');
    }
  }

  objectMenu(id) {
    const go = this.getGO(id);
    if (!go) return;
    const lock = this.playing;
    actionSheet(go.name, [
      { label: 'Renommer', icon: '✏️', disabled: lock, onClick: () => this.renameObject(id) },
      { label: 'Dupliquer', icon: '📄', disabled: lock, onClick: () => this.duplicate(id) },
      { label: 'Copier', icon: '📋', onClick: () => this.copy(id) },
      { label: 'Coller', icon: '📌', disabled: !this.clipboard || lock, onClick: () => this.paste() },
      { label: 'Créer un enfant vide', icon: '↳', disabled: lock, onClick: () => {
        const c = createGameObject('Enfant', { parent: id });
        this.scene.objects.splice(this.scene.objects.indexOf(go) + 1, 0, c);
        this.hierarchy.collapsed.delete(id);
        this.sv.syncAll();
        this.select(c.id);
        this.commit('Enfant');
      } },
      go.parent ? { label: 'Détacher du parent', icon: '⤴️', disabled: lock, onClick: () => this.reparent(id, null) } : null,
      { label: 'Monter', icon: '⬆️', disabled: lock, onClick: () => this.moveSibling(id, -1) },
      { label: 'Descendre', icon: '⬇️', disabled: lock, onClick: () => this.moveSibling(id, 1) },
      { label: 'Cadrer dans la vue', icon: '⌖', onClick: () => this.sv.focus(id) },
      '-',
      { label: 'Créer un prefab', icon: '🧩', disabled: lock, onClick: () => this.createPrefab(id) },
      go.prefabId && this.project.prefabs.some((p) => p.id === go.prefabId) ? { label: 'Appliquer au prefab', icon: '🔄', disabled: lock, onClick: () => this.applyPrefab(go.prefabId, id) } : null,
      '-',
      { label: 'Supprimer', icon: '🗑️', danger: true, disabled: lock, onClick: () => this.deleteObject(id) },
    ]);
  }

  createPrefab(id) {
    const go = this.getGO(id);
    const objs = this.cloneSubtree(id);
    let name = go.name.replace(/\s*\(\d+\)$/, '');
    let n = 2;
    const base = name;
    while (this.project.prefabs.some((p) => p.name === name)) name = `${base} ${n++}`;
    objs[0].name = name;
    const pf = { id: uid(), name, objects: objs };
    this.project.prefabs.push(pf);
    go.prefabId = pf.id;
    this.hierarchy.render();
    this.projectPanel.render();
    this.commit('Prefab');
    toast(`Prefab « ${name} » créé. Utilise Ref.Prefab("${name}") dans un script.`, 'ok', 3200);
  }

  applyPrefab(prefabId, goId) {
    const pf = this.project.prefabs.find((p) => p.id === prefabId);
    if (!pf) return;
    const objs = this.cloneSubtree(goId);
    objs[0].name = pf.name;
    pf.objects = objs;
    this.markDirty();
    this.projectPanel.render();
    toast(`Prefab « ${pf.name} » mis à jour`, 'ok');
  }

  placePrefab(prefabId) {
    if (this.playing) return toast('Arrête le jeu pour modifier la scène', 'warn');
    const pf = this.project.prefabs.find((p) => p.id === prefabId);
    if (!pf || !pf.objects.length) return;
    const rootId = pf.objects.find((o) => !o.parent)?.id || pf.objects[0].id;
    const objs = this.cloneSubtree(rootId, pf.objects);
    const sp = this.sv.spawnPoint();
    objs[0].t.p = [sp[0], this.sv.is2D ? sp[1] : Math.max(sp[1], objs[0].t.p[1]), sp[2]];
    objs[0].prefabId = pf.id;
    this.scene.objects.push(...objs);
    this.sv.syncAll();
    this.select(objs[0].id);
    this.commit('Placer prefab');
  }

  createSpriteFromImage(asset) {
    const img = new Image();
    img.onload = () => {
      const a = img.width / img.height;
      const go = createGameObject(asset.name);
      go.c.push(createComponent('SpriteRenderer', go, { image: asset.id, size: a >= 1 ? [Math.round(a * 100) / 100, 1] : [1, Math.round((1 / a) * 100) / 100] }));
      const sp = this.sv.spawnPoint();
      go.t.p = sp;
      this.addObject(go);
    };
    img.src = asset.data;
  }

  async importAsset(file) {
    const name = file.name.replace(/\.[^.]+$/, '');
    if (file.type.startsWith('image/')) {
      let data = await readFile(file);
      data = await shrinkImage(data, 1024);
      const a = { id: uid(), name: uniqueName(name, this.project.assets.map((x) => x.name)), kind: 'image', data };
      this.project.assets.push(a);
      this.markDirty();
      this.projectPanel.render();
      return a;
    }
    if (file.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac)$/i.test(file.name)) {
      if (file.size > 6 * 1024 * 1024) {
        toast('Son trop lourd (max 6 Mo)', 'error');
        return null;
      }
      const data = await readFile(file);
      const a = { id: uid(), name: uniqueName(name, this.project.assets.map((x) => x.name)), kind: 'audio', data };
      this.project.assets.push(a);
      this.markDirty();
      this.projectPanel.render();
      return a;
    }
    if (/\.(js|txt)$/i.test(file.name)) {
      const code = await readFile(file, 'text');
      const cls = /class\s+([\w$]+)/.exec(code);
      const s = { id: uid(), name: uniqueName(sanitizeClassName(cls ? cls[1] : name), this.project.scripts.map((x) => x.name)), code };
      this.project.scripts.push(s);
      this.markDirty();
      this.checkScripts();
      this.projectPanel.render();
      return s;
    }
    toast('Format non pris en charge : ' + file.name, 'warn');
    return null;
  }

  // ------------------------------------------------------------ scènes
  openScene(id) {
    if (this.playing) this.stop();
    const sc = this.project.scenes.find((s) => s.id === id);
    if (!sc) return;
    this.scene = sc;
    this.project.activeScene = id;
    this.selection = null;
    this.undoStack = [];
    this.redoStack = [];
    this.lastSnap = this.snapshot();
    this.updateUndo();
    this.sv.rebuild();
    this.renderAll();
    this.markDirty();
  }

  async newSceneInteractive() {
    const n = await promptText('Nouvelle scène', 'Niveau ' + (this.project.scenes.length + 1));
    if (!n || !n.trim()) return;
    const sc = newScene(n.trim(), this.project.settings.is2D);
    this.project.scenes.push(sc);
    this.openScene(sc.id);
    toast('Scène créée. Charge-la en jeu avec SceneManager.LoadScene("' + sc.name + '")', 'ok', 3000);
  }

  // ------------------------------------------------------------ scripts
  async createScriptInteractive(open = true) {
    const n = await promptText('Nouveau script', 'MonScript', { placeholder: 'NomDuScript' });
    if (!n || !n.trim()) return null;
    const name = uniqueName(sanitizeClassName(n.trim()), this.project.scripts.map((s) => s.name));
    const s = { id: uid(), name, code: scriptTemplate(name) };
    this.project.scripts.push(s);
    this.markDirty();
    this.projectPanel.render();
    if (open) this.openScript(s.id);
    return s;
  }

  async openCodeEditor() {
    const s = (this.code && this.code.current) || (this.project.scripts[0] && this.project.scripts[0].id);
    if (!s) {
      const created = await this.createScriptInteractive(true);
      return created;
    }
    this.openScript(s);
  }

  async openScript(id, line) {
    if (!this.code) {
      try {
        const m = await import('./codeeditor.js');
        this.code = new m.CodeEditor(this);
      } catch (e) {
        toast("Impossible de charger l'éditeur de code : " + e.message, 'error', 4000);
        return;
      }
    }
    this.code.open(id, line);
  }

  openScriptByName(name, line) {
    const s = this.project.scripts.find((x) => x.name === name || x.name.replace(/[^\w$-]/g, '_') === name);
    if (s) this.openScript(s.id, line);
  }

  onScriptEdited() {
    this.markDirty();
    this.checkScriptsSoon();
  }

  onCodeEditorClosed() {
    this.checkScripts();
    this.inspector.render();
  }

  checkScripts() {
    const errs = {};
    for (const s of this.project.scripts) {
      const r = checkSyntax(s.code);
      if (!r.ok) {
        errs[s.id] = r.error;
        const key = s.id + ':' + r.error.line + ':' + r.error.message;
        if (!this.loggedErrors.has(key)) {
          this.loggedErrors.add(key);
          this.console && this.console.log({ type: 'error', msg: 'Erreur de compilation : ' + r.error.message, script: s.name, line: r.error.line, compile: true });
        }
      }
    }
    const changed = JSON.stringify(Object.keys(errs)) !== JSON.stringify(Object.keys(this.scriptErrors));
    this.scriptErrors = errs;
    if (changed || true) {
      this.projectPanel && this.projectPanel.render();
      this.code && this.code.renderTabs();
    }
  }

  async renameScript(s) {
    const n = await promptText('Renommer le script', s.name);
    if (!n || !n.trim()) return;
    const name = uniqueName(sanitizeClassName(n.trim()), this.project.scripts.filter((x) => x !== s).map((x) => x.name));
    const old = s.name;
    s.code = s.code.replace(new RegExp('class\\s+' + old.replace(/[$]/g, '\\$') + '\\b'), 'class ' + name);
    s.name = name;
    if (this.code) {
      this.code.states.delete(s.id);
      if (this.code.current === s.id) this.code.open(s.id);
      this.code.renderTabs();
    }
    this.markDirty();
    this.checkScripts();
    this.inspector.render();
  }

  duplicateScript(s) {
    const name = uniqueName(s.name + 'Copie', this.project.scripts.map((x) => x.name));
    const code = s.code.replace(new RegExp('class\\s+' + s.name.replace(/[$]/g, '\\$') + '\\b'), 'class ' + name);
    const n = { id: uid(), name, code };
    this.project.scripts.push(n);
    this.markDirty();
    this.projectPanel.render();
    toast('Script dupliqué : ' + name, 'ok');
  }

  async deleteScript(s) {
    if (!(await confirmBox('Supprimer le script', `Supprimer « ${s.name} » ? Les objets qui l'utilisent afficheront « Script manquant ».`, { okLabel: 'Supprimer', danger: true }))) return;
    this.project.scripts = this.project.scripts.filter((x) => x !== s);
    if (this.code) this.code.forget(s.id);
    this.markDirty();
    this.checkScripts();
    this.inspector.render();
  }

  // ------------------------------------------------------------ mode Jeu
  play() {
    if (this.playing) return this.stop();
    if (this.code && this.code.isOpen) this.code.close();
    if (this.code) this.code.flush();
    unlockAudio();
    if (this.project.scripts.some((s) => /Input\.acceleration/.test(s.code))) requestMotionPermission();
    if (Prefs.get('clearOnPlay')) {
      this.console.clear();
      this.loggedErrors.clear();
    }
    const proj = clone(this.project);
    proj.settings.startScene = this.scene.id;
    const [w, hh] = this.sv.viewSize();
    const rt = new Runtime({
      project: proj,
      container: this.viewport,
      renderer: this.sv.renderer,
      isEditor: true,
      errorPause: Prefs.get('errorPause'),
      log: (e) => this.console.log(e),
      onPause: () => this.updatePlayUI(),
      onStats: (s) => this.showStats(s),
      onQuit: () => {
        this.console.log({ type: 'log', msg: 'Application.Quit() appelé — arrêt du jeu.' });
        setTimeout(() => this.stop(), 0);
      },
      onClear: () => this.console.clear(),
      renderHook: () => this.sv.renderPlay(),
    });
    rt.resize(w, hh);
    this.runtime = rt;
    this.playing = true;
    const ok = rt.start(this.scene.id);
    if (!ok) {
      rt.stop();
      this.runtime = null;
      this.playing = false;
      this.showTab('console');
      toast('Corrige les erreurs de compilation avant de jouer', 'error', 3000);
      return;
    }
    this.prevViewMode = this.viewMode || 'scene';
    this.root.classList.add('playing');
    this.sv.onPlayStart();
    this.setViewMode('game');
    if (Prefs.get('maximizeOnPlay') && !this.root.classList.contains('maximized')) this.toggleMax();
    if (!this.wide && this.tab !== 'console') {
      this.prevTab = this.tab;
    }
    this.inspector.render();
    this.updatePlayUI();
    haptic(12);
  }

  stop() {
    if (!this.playing) return;
    this.runtime.stop();
    this.runtime = null;
    this.playing = false;
    this.root.classList.remove('playing');
    if (this.root.classList.contains('maximized')) this.toggleMax();
    this.sv.onPlayStop();
    this.setViewMode(this.prevViewMode || 'scene');
    this.statsEl.textContent = '';
    this.inspector.render();
    this.updatePlayUI();
  }

  togglePause() {
    if (!this.playing) return;
    this.runtime.setPaused(!this.runtime.paused);
  }
  step() {
    if (!this.playing) return;
    if (!this.runtime.paused) this.runtime.setPaused(true);
    this.runtime.stepOnce();
  }
  updatePlayUI() {
    this.playBtn.classList.toggle('on', this.playing);
    this.playBtn.textContent = this.playing ? '■' : '▶';
    this.pauseBtn.classList.toggle('on', !!(this.runtime && this.runtime.paused));
    this.pauseBtn.disabled = !this.playing;
    this.stepBtn.disabled = !this.playing;
  }
  showStats(s) {
    if (!Prefs.get('showStats')) return;
    this.statsEl.textContent = `${s.fps} FPS • ${s.calls} appels • ${(s.tris / 1000).toFixed(1)}k tri • ${s.objects} obj • ${s.bodies} corps`;
  }

  // ------------------------------------------------------------ menus
  mainMenu() {
    const p = Prefs;
    actionSheet(this.project.name, [
      { header: 'Fichier' },
      { label: 'Enregistrer', icon: '💾', onClick: async () => { await this.save(true); toast('Projet enregistré', 'ok'); } },
      { label: 'Nouvelle scène', icon: '🎬', onClick: () => this.newSceneInteractive() },
      { label: 'Paramètres du projet', icon: '⚙️', onClick: () => projectSettings(this) },
      { label: 'Build & Run (plein écran)', icon: '📱', onClick: () => this.buildAndRun() },
      { label: 'Exporter le jeu (.html autonome)', icon: '📦', onClick: async () => { await this.save(true); exportGameHTML(this.project); } },
      { label: 'Exporter le projet (.json)', icon: '💼', onClick: () => exportProjectJSON(this.project) },
      { header: 'Édition' },
      { label: 'Annuler', icon: '↶', disabled: !this.undoStack.length, onClick: () => this.undo() },
      { label: 'Rétablir', icon: '↷', disabled: !this.redoStack.length, onClick: () => this.redo() },
      { label: 'Dupliquer la sélection', icon: '📄', disabled: !this.selection, onClick: () => this.duplicate(this.selection) },
      { label: 'Supprimer la sélection', icon: '🗑️', disabled: !this.selection, onClick: () => this.deleteObject(this.selection) },
      { header: 'Fenêtre' },
      { label: 'Éditeur de code', icon: '</>', onClick: () => this.openCodeEditor() },
      { label: 'Statistiques de rendu', icon: '📊', checked: p.get('showStats'), sub: p.get('showStats') ? 'activé' : '', onClick: () => { p.set('showStats', !p.get('showStats')); this.statsEl.classList.toggle('hidden', !p.get('showStats')); } },
      { label: 'Plein écran en jeu', icon: '⛶', checked: p.get('maximizeOnPlay'), sub: p.get('maximizeOnPlay') ? 'activé' : '', onClick: () => p.set('maximizeOnPlay', !p.get('maximizeOnPlay')) },
      { label: 'Sauvegarde automatique', icon: '⏱️', checked: p.get('autosave') !== false, sub: p.get('autosave') !== false ? 'activée' : 'désactivée', onClick: () => p.set('autosave', p.get('autosave') === false) },
      '-',
      { label: 'Retour au Hub', icon: '🏠', onClick: () => this.app.closeProject() },
      { header: `CréaEngine • version ${APP_VERSION}` },
    ]);
  }

  async buildAndRun() {
    if (this.playing) this.stop();
    if (this.code) this.code.flush();
    await this.save();
    runFullscreen(clone(this.project), { log: (e) => this.console.log(e) });
  }

  // ------------------------------------------------------------ clavier
  bindKeys() {
    this.onKey = (e) => {
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      const mod = e.metaKey || e.ctrlKey;
      if (this.code && this.code.isOpen) {
        if (mod && e.key.toLowerCase() === 'p') {
          e.preventDefault();
          this.play();
        }
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        this.save(true).then(() => toast('Projet enregistré', 'ok', 900));
        return;
      }
      if (mod && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        this.play();
        return;
      }
      if (typing || (this.playing && this.viewMode === 'game')) return;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.redo();
      } else if (mod && e.key.toLowerCase() === 'd' && this.selection) {
        e.preventDefault();
        this.duplicate(this.selection);
      } else if (mod && e.key.toLowerCase() === 'c' && this.selection) this.copy(this.selection);
      else if (mod && e.key.toLowerCase() === 'v') this.paste();
      else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selection) {
        e.preventDefault();
        this.deleteObject(this.selection);
      } else if (!mod) {
        const k = e.key.toLowerCase();
        if (k === 'q') this.setTool('view');
        else if (k === 'w') this.setTool('move');
        else if (k === 'e') this.setTool('rotate');
        else if (k === 'r') this.setTool('scale');
        else if (k === 'f' && this.selection) this.sv.focus(this.selection);
      }
    };
    window.addEventListener('keydown', this.onKey);
  }

  async close() {
    if (this.playing) this.stop();
    if (this.code) {
      this.code.flush();
      this.code.root.remove();
    }
    await this.save(true);
    window.removeEventListener('keydown', this.onKey);
    document.removeEventListener('visibilitychange', this.onVis);
    this.mq.removeEventListener('change', this.onMq);
    this.mqSide.removeEventListener('change', this.onMq);
    this.sv.dispose();
    this.root.remove();
  }
}

function uniqueName(name, existing) {
  if (!existing.includes(name)) return name;
  let i = 2;
  while (existing.includes(name + i)) i++;
  return name + i;
}

/** Remplace les références internes (champs de scripts) après un changement d'identifiants */
function remapRefs(objs, map) {
  for (const o of objs)
    for (const c of o.c)
      if (c.type === 'Script' && c.props)
        for (const k of Object.keys(c.props)) {
          const v = c.props[k];
          if (v && v.ref === 'go' && map.has(v.id)) c.props[k] = { ...v, id: map.get(v.id) };
        }
}

function shrinkImage(dataURL, max) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      if (s >= 1 && dataURL.length < 900000) return res(dataURL);
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(img.width * s));
      cv.height = Math.max(1, Math.round(img.height * s));
      const g = cv.getContext('2d');
      g.drawImage(img, 0, 0, cv.width, cv.height);
      const isPng = dataURL.startsWith('data:image/png') || dataURL.startsWith('data:image/gif');
      res(cv.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.88));
    };
    img.onerror = () => res(dataURL);
    img.src = dataURL;
  });
}
