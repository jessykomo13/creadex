// Panneau Hiérarchie

import { h, haptic } from '../util.js';
import { goIcon } from '../components.js';

export class Hierarchy {
  constructor(ed, el) {
    this.ed = ed;
    this.el = el;
    this.collapsed = new Set();
    this.filter = '';
    this.search = h('input.search', { placeholder: 'Rechercher…', autocomplete: 'off', spellcheck: false, autocapitalize: 'off' });
    this.search.addEventListener('input', () => {
      this.filter = this.search.value.trim().toLowerCase();
      this.render();
    });
    this.list = h('div.hlist');
    const add = h('button.btn.sm.primary', { onclick: () => ed.createMenu() }, '＋ Créer');
    el.appendChild(h('div.panel-head', this.search, add));
    el.appendChild(this.list);
  }

  render() {
    const ed = this.ed;
    const objs = ed.scene.objects;
    const kids = new Map();
    const ids = new Set(objs.map((o) => o.id));
    for (const o of objs) {
      const p = o.parent && ids.has(o.parent) ? o.parent : null;
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p).push(o);
    }
    const scroll = this.list.scrollTop;
    this.list.innerHTML = '';
    const root = h('div.hrow.hroot' + (!ed.selection ? '.sel' : ''), { dataset: { id: '' } }, h('span.ico', '🎬'), h('span.nm', ed.scene.name), h('span.count', String(objs.length)));
    root.addEventListener('click', () => ed.select(null, 'hierarchy'));
    this.list.appendChild(root);
    const match = (o) => !this.filter || o.name.toLowerCase().includes(this.filter);
    const subtreeMatch = (o) => match(o) || (kids.get(o.id) || []).some(subtreeMatch);
    const walk = (parent, depth) => {
      for (const o of kids.get(parent) || []) {
        if (this.filter && !subtreeMatch(o)) continue;
        const ch = kids.get(o.id) || [];
        const open = !this.collapsed.has(o.id) || !!this.filter;
        this.list.appendChild(this.row(o, depth, ch.length > 0, open));
        if (ch.length && open) walk(o.id, depth + 1);
      }
    };
    walk(null, 0);
    if (!objs.length) this.list.appendChild(h('div.empty-note', 'Scène vide. Touche « ＋ Créer » pour ajouter un objet.'));
    this.list.scrollTop = scroll;
  }

  row(o, depth, hasKids, open) {
    const ed = this.ed;
    const sel = ed.selection === o.id;
    const tw = h('span.tw', hasKids ? (open ? '▾' : '▸') : '');
    const eye = h('button.eye' + (o.active === false ? '.off' : ''), { title: 'Actif / inactif' }, o.active === false ? '◌' : '●');
    const drag = h('span.drag', { title: 'Glisser pour changer de parent' }, '⠿');
    const r = h(
      'div.hrow' + (sel ? '.sel' : '') + (o.active === false ? '.inactive' : '') + (o.prefabId ? '.prefab' : ''),
      { dataset: { id: o.id }, style: { paddingLeft: 6 + depth * 16 + 'px' } },
      tw,
      h('span.ico', goIcon(o)),
      h('span.nm', o.name),
      eye,
      drag
    );
    tw.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!hasKids) return;
      if (this.collapsed.has(o.id)) this.collapsed.delete(o.id);
      else this.collapsed.add(o.id);
      this.render();
    });
    eye.addEventListener('click', (e) => {
      e.stopPropagation();
      o.active = o.active === false;
      ed.updateGO(o, { hierarchy: true });
      ed.commit('Activer');
    });
    let lp = 0;
    let longPressed = false;
    r.addEventListener('pointerdown', (e) => {
      if (e.target === drag) return;
      longPressed = false;
      lp = setTimeout(() => {
        longPressed = true;
        haptic(15);
        ed.select(o.id, 'hierarchy');
        ed.objectMenu(o.id);
      }, 550);
    });
    const cancel = () => clearTimeout(lp);
    r.addEventListener('pointerup', cancel);
    r.addEventListener('pointercancel', cancel);
    r.addEventListener('pointermove', (e) => {
      if (Math.abs(e.movementY) > 2 || Math.abs(e.movementX) > 2) cancel();
    });
    r.addEventListener('click', () => {
      if (longPressed) return;
      if (ed.selection === o.id) ed.showTab('inspector');
      else ed.select(o.id, 'hierarchy');
    });
    r.addEventListener('dblclick', () => ed.sv.focus(o.id));
    r.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      ed.select(o.id, 'hierarchy');
      ed.objectMenu(o.id);
    });
    this.bindDrag(drag, o);
    return r;
  }

  bindDrag(handle, o) {
    const ed = this.ed;
    handle.style.touchAction = 'none';
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      haptic(8);
      const ghost = h('div.drag-ghost', o.name);
      document.body.appendChild(ghost);
      let target = undefined;
      const rowAt = (x, y) => {
        ghost.style.display = 'none';
        const el = document.elementFromPoint(x, y);
        ghost.style.display = '';
        return el && el.closest('.hrow');
      };
      const move = (ev) => {
        ghost.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY - 14}px)`;
        this.list.querySelectorAll('.drop').forEach((x) => x.classList.remove('drop'));
        const rr = rowAt(ev.clientX, ev.clientY);
        target = rr ? rr.dataset.id : undefined;
        if (rr && target !== o.id) rr.classList.add('drop');
        // défilement automatique
        const lr = this.list.getBoundingClientRect();
        if (ev.clientY < lr.top + 30) this.list.scrollTop -= 8;
        else if (ev.clientY > lr.bottom - 30) this.list.scrollTop += 8;
      };
      move(e);
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        ghost.remove();
        this.list.querySelectorAll('.drop').forEach((x) => x.classList.remove('drop'));
        if (target === undefined || target === o.id) return;
        ed.reparent(o.id, target || null);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }
}
