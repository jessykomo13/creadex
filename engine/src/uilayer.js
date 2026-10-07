// Couche d'interface (UI Text / Button / Image) superposée à la vue Jeu

import { h } from './util.js';

export const UI_REF = 400; // côté court de référence (px)

export function placeEl(el, anchor, pos, s) {
  const [v, hz] = anchor === 'center' ? ['middle', 'center'] : String(anchor || 'top-left').split('-');
  const x = (pos?.[0] || 0) * s, y = (pos?.[1] || 0) * s;
  el.style.left = el.style.right = el.style.top = el.style.bottom = '';
  let tx = '0', ty = '0';
  if (hz === 'left') el.style.left = x + 'px';
  else if (hz === 'right') el.style.right = x + 'px';
  else {
    el.style.left = `calc(50% + ${x}px)`;
    tx = '-50%';
  }
  if (v === 'top') el.style.top = y + 'px';
  else if (v === 'bottom') el.style.bottom = y + 'px';
  else {
    el.style.top = `calc(50% + ${y}px)`;
    ty = '-50%';
  }
  el.style.transform = `translate(${tx}, ${ty})`;
}

function hexA(hex, a) {
  const s = String(hex || '#ffffff').replace('#', '');
  const n = parseInt(s.slice(0, 6), 16) || 0;
  const aa = s.length >= 8 ? (parseInt(s.slice(6, 8), 16) / 255) * a : a;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${aa})`;
}

export class UILayer {
  constructor(container, { interactive = true, findImage } = {}) {
    this.root = h('div.ui-layer' + (interactive ? '' : '.preview'));
    container.appendChild(this.root);
    this.items = new Map(); // clé → {el, data, type}
    this.scale = 1;
    this.findImage = findImage || (() => null);
  }

  resize(w, hgt) {
    this.scale = Math.max(0.4, Math.min(w, hgt) / UI_REF);
    for (const it of this.items.values()) this.layout(it);
  }

  add(key, type, data, onClick) {
    let el;
    if (type === 'UIText') el = h('div.ui-text');
    else if (type === 'UIButton') {
      el = h('button.ui-button');
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (it.interactable !== false) onClick && onClick();
      });
    } else el = h('div.ui-image', h('div.ui-fill'));
    const it = { key, type, data, el, visible: true, interactable: true };
    this.items.set(key, it);
    this.root.appendChild(el);
    this.layout(it);
    return it;
  }

  remove(key) {
    const it = this.items.get(key);
    if (it) {
      it.el.remove();
      this.items.delete(key);
    }
  }

  setVisible(key, v) {
    const it = this.items.get(key);
    if (it) {
      it.visible = v;
      it.el.style.display = v && it.data.enabled !== false ? '' : 'none';
    }
  }

  layout(it) {
    const d = it.data, s = this.scale, el = it.el;
    el.style.display = it.visible && d.enabled !== false ? '' : 'none';
    if (it.type === 'UIText') {
      el.textContent = d.text ?? '';
      el.style.fontSize = (d.fontSize || 24) * s + 'px';
      el.style.color = d.color || '#fff';
      el.style.fontWeight = d.bold ? '800' : '500';
      el.style.textAlign = d.align || 'left';
      el.style.textShadow = d.shadow ? `0 ${2 * s}px ${4 * s}px rgba(0,0,0,.6)` : 'none';
      placeEl(el, d.anchor, d.pos, s);
    } else if (it.type === 'UIButton') {
      el.textContent = d.label ?? '';
      el.style.width = (d.size?.[0] || 160) * s + 'px';
      el.style.height = (d.size?.[1] || 50) * s + 'px';
      el.style.background = d.color || '#3b82f6';
      el.style.color = d.textColor || '#fff';
      el.style.fontSize = (d.fontSize || 18) * s + 'px';
      el.style.borderRadius = (d.radius ?? 12) * s + 'px';
      el.style.opacity = it.interactable === false ? 0.5 : 1;
      placeEl(el, d.anchor, d.pos, s);
    } else {
      const fill = el.firstChild;
      const w = (d.size?.[0] || 100) * s, hh = (d.size?.[1] || 100) * s;
      el.style.width = w + 'px';
      el.style.height = hh + 'px';
      el.style.borderRadius = (d.radius ?? 0) * s + 'px';
      el.style.opacity = d.opacity ?? 1;
      const f = Math.max(0, Math.min(1, d.fill ?? 1));
      fill.style.width = f * 100 + '%';
      const img = d.image ? this.findImage(d.image) : null;
      fill.style.background = img ? `url(${img}) center/cover no-repeat` : d.color || '#fff';
      fill.style.borderRadius = el.style.borderRadius;
      el.style.background = f < 1 ? hexA(d.color, 0.25) : 'transparent';
      placeEl(el, d.anchor, d.pos, s);
    }
  }

  update(key) {
    const it = this.items.get(key);
    if (it) this.layout(it);
  }

  clear() {
    for (const it of this.items.values()) it.el.remove();
    this.items.clear();
  }

  dispose() {
    this.clear();
    this.root.remove();
  }
}
