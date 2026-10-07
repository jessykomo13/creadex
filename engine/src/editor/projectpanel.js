// Panneau Projet (scènes, scripts, prefabs, images, sons)

import { h, actionSheet, promptText, confirmBox, pickFiles, toast, clone, uid } from '../util.js';
import { createComponent } from '../components.js';
import { unlockAudio, AudioSystem } from '../audio.js';

export class ProjectPanel {
  constructor(ed, el) {
    this.ed = ed;
    this.el = el;
    this.collapsed = new Set();
    this.audio = new AudioSystem(ed.project);
    const bar = h(
      'div.panel-head.wrap',
      h('button.btn.sm.primary', { onclick: () => ed.createScriptFromLibrary({ open: true, askAttach: true }) }, '＋ Script'),
      h('button.btn.sm', { onclick: () => ed.newSceneInteractive() }, '＋ Scène'),
      h('button.btn.sm', { onclick: () => this.importFiles() }, '📥 Importer')
    );
    this.body = h('div.plist');
    el.appendChild(bar);
    el.appendChild(this.body);
  }

  async importFiles() {
    const files = await pickFiles('image/*,audio/*,.mp3,.wav,.ogg,.m4a,.js,.txt', true);
    let n = 0;
    for (const f of files) if (await this.ed.importAsset(f)) n++;
    if (n) toast(`${n} fichier(s) importé(s)`, 'ok');
  }

  section(key, icon, title, items, emptyText) {
    const closed = this.collapsed.has(key);
    const head = h('div.psec-head', h('span.chev', closed ? '▸' : '▾'), h('span', icon + ' ' + title), h('span.count', String(items.length)));
    const grid = h('div.pgrid');
    if (!items.length) grid.appendChild(h('div.empty-note.sm', emptyText));
    items.forEach((i) => grid.appendChild(i));
    const sec = h('div.psec' + (closed ? '.collapsed' : ''), head, grid);
    head.addEventListener('click', () => {
      if (this.collapsed.has(key)) this.collapsed.delete(key);
      else this.collapsed.add(key);
      this.render();
    });
    return sec;
  }

  tile({ icon, thumb, name, sub, active, onTap, menu }) {
    const t = h(
      'div.ptile' + (active ? '.active' : ''),
      thumb ? h('div.ptimg', { style: { backgroundImage: `url(${thumb})` } }) : h('div.picon', icon),
      h('div.pname', name),
      sub ? h('div.psub', sub) : null
    );
    t.addEventListener('click', onTap);
    t.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      menu && actionSheet(name, menu());
    });
    let lp = 0;
    t.addEventListener('pointerdown', () => (lp = setTimeout(() => { lp = -1; menu && actionSheet(name, menu()); }, 550)));
    t.addEventListener('pointerup', () => clearTimeout(lp));
    t.addEventListener('pointermove', (e) => (Math.abs(e.movementX) + Math.abs(e.movementY) > 3) && clearTimeout(lp));
    t.addEventListener('pointercancel', () => clearTimeout(lp));
    t.addEventListener(
      'click',
      (e) => {
        if (lp === -1) {
          e.stopImmediatePropagation();
          lp = 0;
        }
      },
      true
    );
    if (menu) {
      const more = h('button.ptile-more', { onclick: (e) => { e.stopPropagation(); actionSheet(name, menu()); } }, '⋯');
      t.appendChild(more);
    }
    return t;
  }

  render() {
    const ed = this.ed;
    const p = ed.project;
    this.audio.project = p;
    this.body.innerHTML = '';
    const scenes = p.scenes.map((s, i) =>
      this.tile({
        icon: '🎬',
        name: s.name,
        sub: (i === 0 ? '#0 ' : '#' + i + ' ') + (p.settings.startScene === s.id ? '• départ' : ''),
        active: s.id === ed.scene.id,
        onTap: () => s.id !== ed.scene.id && ed.openScene(s.id),
        menu: () => [
          { label: 'Ouvrir', icon: '📂', onClick: () => ed.openScene(s.id) },
          { label: 'Scène de départ', icon: '🚩', onClick: () => { p.settings.startScene = s.id; ed.markDirty(); this.render(); } },
          { label: 'Renommer', icon: '✏️', onClick: async () => { const n = await promptText('Renommer la scène', s.name); if (n && n.trim()) { s.name = n.trim(); ed.markDirty(); ed.refreshTitle(); this.render(); ed.hierarchy.render(); } } },
          { label: 'Dupliquer', icon: '📄', onClick: () => { const c = clone(s); c.id = uid(); c.name = s.name + ' copie'; p.scenes.splice(i + 1, 0, c); ed.markDirty(); this.render(); } },
          { label: 'Monter (ordre de build)', icon: '⬆️', disabled: i === 0, onClick: () => { [p.scenes[i - 1], p.scenes[i]] = [p.scenes[i], p.scenes[i - 1]]; ed.markDirty(); this.render(); } },
          '-',
          { label: 'Supprimer', icon: '🗑️', danger: true, disabled: p.scenes.length < 2, onClick: async () => {
            if (!(await confirmBox('Supprimer la scène', `Supprimer « ${s.name} » ?`, { okLabel: 'Supprimer', danger: true }))) return;
            p.scenes.splice(i, 1);
            if (p.settings.startScene === s.id) p.settings.startScene = p.scenes[0].id;
            if (ed.scene.id === s.id) ed.openScene(p.scenes[0].id);
            ed.markDirty();
            this.render();
          } },
        ],
      })
    );
    this.body.appendChild(this.section('scenes', '🎬', 'Scènes', scenes, ''));

    const errs = ed.scriptErrors || {};
    const scripts = p.scripts.map((s) =>
      this.tile({
        icon: errs[s.id] ? '⚠️' : '📜',
        name: s.name,
        sub: errs[s.id] ? 'erreur l.' + errs[s.id].line : s.code.split('\n').length + ' lignes',
        onTap: () => ed.openScript(s.id),
        menu: () => [
          { label: 'Modifier', icon: '✏️', onClick: () => ed.openScript(s.id) },
          { label: 'Ajouter à la sélection', icon: '➕', disabled: !ed.selection, onClick: () => this.attachScript(s) },
          { label: 'Renommer', icon: '🏷️', onClick: () => ed.renameScript(s) },
          { label: 'Dupliquer', icon: '📄', onClick: () => ed.duplicateScript(s) },
          '-',
          { label: 'Supprimer', icon: '🗑️', danger: true, onClick: () => ed.deleteScript(s) },
        ],
      })
    );
    this.body.appendChild(this.section('scripts', '📜', 'Scripts', scripts, 'Aucun script. Touche « ＋ Script ».'));

    const prefabs = p.prefabs.map((pf) =>
      this.tile({
        icon: '🧩',
        name: pf.name,
        sub: pf.objects.length + ' objet(s)',
        onTap: () => ed.placePrefab(pf.id),
        menu: () => [
          { label: 'Placer dans la scène', icon: '📍', onClick: () => ed.placePrefab(pf.id) },
          { label: 'Mettre à jour depuis la sélection', icon: '🔄', disabled: !ed.selection, onClick: () => ed.applyPrefab(pf.id, ed.selection) },
          { label: 'Renommer', icon: '🏷️', onClick: async () => { const n = await promptText('Renommer le prefab', pf.name); if (n && n.trim()) { pf.name = n.trim(); ed.markDirty(); this.render(); } } },
          '-',
          { label: 'Supprimer', icon: '🗑️', danger: true, onClick: async () => { if (await confirmBox('Supprimer le prefab', `Supprimer « ${pf.name} » ?`, { okLabel: 'Supprimer', danger: true })) { p.prefabs = p.prefabs.filter((x) => x !== pf); ed.markDirty(); this.render(); } } },
        ],
      })
    );
    this.body.appendChild(this.section('prefabs', '🧩', 'Prefabs', prefabs, 'Hiérarchie → ⋯ → « Créer un prefab ».'));

    const images = p.assets.filter((a) => a.kind === 'image').map((a) =>
      this.tile({
        thumb: a.data,
        name: a.name,
        onTap: () => actionSheet(a.name, this.imageMenu(a)),
        menu: () => this.imageMenu(a),
      })
    );
    this.body.appendChild(this.section('images', '🖼️', 'Images', images, 'Importe des images depuis ta photothèque.'));

    const sounds = p.assets.filter((a) => a.kind === 'audio').map((a) =>
      this.tile({
        icon: '🔊',
        name: a.name,
        onTap: () => { unlockAudio(); this.audio.play(a.id); },
        menu: () => [
          { label: 'Écouter', icon: '▶️', onClick: () => { unlockAudio(); this.audio.play(a.id); } },
          { label: 'Ajouter une Audio Source à la sélection', icon: '➕', disabled: !ed.selection, onClick: () => {
            const go = ed.getGO(ed.selection);
            const ex = go.c.find((c) => c.type === 'AudioSource');
            if (ex) ex.clip = a.id;
            else go.c.push(createComponent('AudioSource', go, { clip: a.id }));
            ed.updateGO(go, { hierarchy: true });
            ed.commit('Audio');
          } },
          { label: 'Renommer', icon: '🏷️', onClick: () => this.renameAsset(a) },
          '-',
          { label: 'Supprimer', icon: '🗑️', danger: true, onClick: () => this.deleteAsset(a) },
        ],
      })
    );
    this.body.appendChild(this.section('sounds', '🔊', 'Sons', sounds, 'Importe des sons (mp3, wav, m4a…).'));
  }

  imageMenu(a) {
    const ed = this.ed;
    return [
      { label: 'Appliquer à la sélection', icon: '🎨', disabled: !ed.selection, onClick: () => {
        const go = ed.getGO(ed.selection);
        const sr = go.c.find((c) => c.type === 'SpriteRenderer');
        const mr = go.c.find((c) => c.type === 'MeshRenderer');
        const ui = go.c.find((c) => c.type === 'UIImage');
        if (sr) sr.image = a.id;
        else if (mr) mr.texture = a.id;
        else if (ui) ui.image = a.id;
        else go.c.push(createComponent('SpriteRenderer', go, { image: a.id }));
        ed.updateGO(go, { hierarchy: true });
        ed.commit('Image');
        ed.inspector.render();
      } },
      { label: 'Créer un sprite', icon: '🖼️', onClick: () => ed.createSpriteFromImage(a) },
      { label: 'Renommer', icon: '🏷️', onClick: () => this.renameAsset(a) },
      '-',
      { label: 'Supprimer', icon: '🗑️', danger: true, onClick: () => this.deleteAsset(a) },
    ];
  }

  attachScript(s) {
    const ed = this.ed;
    const go = ed.getGO(ed.selection);
    if (!go) return;
    go.c.push(createComponent('Script', go, { script: s.id }));
    ed.updateGO(go, { hierarchy: true });
    ed.commit('Ajouter script');
    toast(`${s.name} ajouté à ${go.name}`, 'ok');
  }

  async renameAsset(a) {
    const n = await promptText('Renommer', a.name);
    if (n && n.trim()) {
      a.name = n.trim();
      this.ed.markDirty();
      this.render();
    }
  }

  async deleteAsset(a) {
    if (!(await confirmBox('Supprimer', `Supprimer « ${a.name} » ? Les objets qui l'utilisent ne l'afficheront plus.`, { okLabel: 'Supprimer', danger: true }))) return;
    this.ed.project.assets = this.ed.project.assets.filter((x) => x !== a);
    this.ed.markDirty();
    this.ed.sv.invalidateTextures();
    this.render();
  }
}
