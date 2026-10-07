// Petits utilitaires partagés (DOM, dialogues, fichiers…)

export const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const uid = () =>
  Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

export const clone = (o) => JSON.parse(JSON.stringify(o));

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function debounce(fn, ms) {
  let t = 0;
  const d = (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  d.flush = (...a) => {
    clearTimeout(t);
    fn(...a);
  };
  d.cancel = () => clearTimeout(t);
  return d;
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Constructeur DOM : h('div.cls#id', {onclick}, enfants...) */
export function h(tag, attrs, ...children) {
  const m = /^([a-z0-9-]*)((?:[.#][\w-]+)*)$/i.exec(tag);
  const el = document.createElement((m && m[1]) || 'div');
  if (m && m[2]) {
    for (const part of m[2].match(/[.#][\w-]+/g)) {
      if (part[0] === '.') el.classList.add(part.slice(1));
      else el.id = part.slice(1);
    }
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && k !== 'list' && k !== 'type') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) appendChildren(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return "à l'instant";
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const hh = Math.round(m / 60);
  if (hh < 24) return `il y a ${hh} h`;
  const d = Math.round(hh / 24);
  if (d < 30) return `il y a ${d} j`;
  return new Date(ts).toLocaleDateString('fr-FR');
}

/** Évalue une petite expression arithmétique (« 2*3 », « -1.5 ») sans eval global. */
export function evalNumber(str, fallback = 0) {
  const s = String(str).replace(',', '.').trim();
  if (s === '') return fallback;
  const n = Number(s);
  if (!Number.isNaN(n)) return n;
  if (!/^[\d+\-*/().\s e]+$/i.test(s)) return fallback;
  try {
    const v = Function(`"use strict";return (${s});`)();
    return Number.isFinite(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

export function fmtNum(v) {
  if (!Number.isFinite(v)) return '0';
  const r = Math.round(v * 1000) / 1000;
  return String(Object.is(r, -0) ? 0 : r);
}

export function haptic(ms = 8) {
  try {
    navigator.vibrate && navigator.vibrate(ms);
  } catch {}
}

// ---------------------------------------------------------------- Fichiers

export function readFile(file, as = 'dataURL') {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    if (as === 'text') r.readAsText(file);
    else r.readAsDataURL(file);
  });
}

export function pickFiles(accept, multiple = true) {
  return new Promise((res) => {
    const inp = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    inp.addEventListener('change', () => {
      res([...inp.files]);
      inp.remove();
    });
    document.body.appendChild(inp);
    inp.click();
  });
}

export async function downloadFile(name, content, mime = 'application/octet-stream') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const file = new File([blob], name, { type: mime });
  // Sur iPhone, la feuille de partage permet « Enregistrer dans Fichiers », AirDrop…
  if (navigator.canShare && navigator.canShare({ files: [file] }) && isIOS) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      if (e && e.name === 'NotAllowedError') {
        // le geste a expiré pendant la préparation : on redemande un toucher
        await modal({
          title: 'Fichier prêt',
          body: h('p', `« ${name} » est prêt. Touche « Partager » puis « Enregistrer dans Fichiers », AirDrop…`),
          buttons: [
            { label: 'Annuler', value: false },
            { label: 'Partager', primary: true, value: true, onClick: () => { navigator.share({ files: [file], title: name }).catch(() => {}); } },
          ],
        });
        return;
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ---------------------------------------------------------------- Toasts

let toastBox;
export function toast(msg, type = 'info', ms = 2200) {
  if (!toastBox) {
    toastBox = h('div.toasts');
    document.body.appendChild(toastBox);
  }
  const t = h('div.toast.' + type, msg);
  toastBox.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, ms);
}

// ---------------------------------------------------------------- Dialogues

const layers = [];

function openLayer(node, { sheet = false, onClose } = {}) {
  const back = h('div.overlay' + (sheet ? '.sheet-overlay' : ''));
  back.appendChild(node);
  document.body.appendChild(back);
  requestAnimationFrame(() => back.classList.add('show'));
  const layer = {
    back,
    close(v) {
      if (layer.closed) return;
      layer.closed = true;
      back.classList.remove('show');
      setTimeout(() => back.remove(), 220);
      const i = layers.indexOf(layer);
      if (i >= 0) layers.splice(i, 1);
      onClose && onClose(v);
    },
  };
  back.addEventListener('pointerdown', (e) => {
    if (e.target === back) {
      back._downOnBack = true;
    }
  });
  back.addEventListener('click', (e) => {
    if (e.target === back && back._downOnBack) layer.close(null);
    back._downOnBack = false;
  });
  layers.push(layer);
  return layer;
}

export function closeTopLayer() {
  const l = layers[layers.length - 1];
  if (l) {
    l.close(null);
    return true;
  }
  return false;
}

/** Fenêtre modale générique. Retourne une promesse résolue avec la valeur du bouton. */
export function modal({ title, body, buttons = [{ label: 'OK', value: true, primary: true }], wide = false, onOpen }) {
  return new Promise((resolve) => {
    const content = h('div.modal-body');
    if (typeof body === 'string') content.innerHTML = body;
    else if (body) content.appendChild(body);
    const btns = h(
      'div.modal-btns',
      buttons.map((b) =>
        h(
          'button.btn' + (b.primary ? '.primary' : '') + (b.danger ? '.danger' : ''),
          {
            onclick: async () => {
              if (b.onClick) {
                const r = await b.onClick();
                if (r === false) return;
              }
              layer.close(typeof b.value === 'function' ? b.value() : b.value);
            },
          },
          b.label
        )
      )
    );
    const box = h('div.modal' + (wide ? '.wide' : ''), title ? h('div.modal-title', title) : null, content, buttons.length ? btns : null);
    const layer = openLayer(box, { onClose: (v) => resolve(v === undefined ? null : v) });
    layer.content = content;
    onOpen && onOpen(layer, content);
  });
}

export function confirmBox(title, message, { okLabel = 'OK', danger = false } = {}) {
  return modal({
    title,
    body: h('p', message),
    buttons: [
      { label: 'Annuler', value: false },
      { label: okLabel, value: true, primary: !danger, danger },
    ],
  }).then((v) => v === true);
}

export function promptText(title, value = '', { placeholder = '', okLabel = 'OK', multiline = false } = {}) {
  const inp = multiline
    ? h('textarea.input', { value, placeholder, rows: 5 })
    : h('input.input', { value, placeholder, autocapitalize: 'off', autocomplete: 'off', spellcheck: false });
  return modal({
    title,
    body: inp,
    buttons: [
      { label: 'Annuler', value: null },
      { label: okLabel, value: () => inp.value, primary: true },
    ],
    onOpen: (layer) => {
      setTimeout(() => {
        inp.focus();
        inp.select && inp.select();
      }, 60);
      if (!multiline)
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') layer.close(inp.value);
        });
    },
  });
}

/** Feuille d'actions (menu contextuel façon iOS). items: {label, icon, danger, disabled, onClick, sub} | {header} | '-' */
export function actionSheet(title, items) {
  return new Promise((resolve) => {
    const list = h('div.sheet-list');
    let layer;
    for (const it of items) {
      if (!it) continue;
      if (it === '-') {
        list.appendChild(h('div.sheet-sep'));
        continue;
      }
      if (it.header) {
        list.appendChild(h('div.sheet-header', it.header));
        continue;
      }
      list.appendChild(
        h(
          'button.sheet-item' + (it.danger ? '.danger' : '') + (it.checked ? '.checked' : ''),
          {
            disabled: !!it.disabled,
            onclick: () => {
              layer.close(it.value ?? it.label);
              it.onClick && setTimeout(() => it.onClick(), 10);
            },
          },
          h('span.sheet-icon', it.icon || ''),
          h('span.sheet-label', it.label),
          it.sub ? h('span.sheet-sub', it.sub) : null
        )
      );
    }
    const box = h(
      'div.sheet',
      h('div.sheet-grab'),
      title ? h('div.sheet-title', title) : null,
      list,
      h('button.sheet-cancel', { onclick: () => layer.close(null) }, 'Annuler')
    );
    layer = openLayer(box, { sheet: true, onClose: resolve });
  });
}

/** Liste de choix avec recherche. items: {label, value, icon, sub, group} */
export function pickFromList(title, items, { search = true, emptyText = 'Aucun élément' } = {}) {
  return new Promise((resolve) => {
    let layer;
    const listEl = h('div.pick-list');
    const inp = search ? h('input.input.pick-search', { placeholder: 'Rechercher…', autocapitalize: 'off', autocomplete: 'off', spellcheck: false }) : null;
    const render = () => {
      const q = inp ? inp.value.trim().toLowerCase() : '';
      listEl.innerHTML = '';
      let lastGroup = null;
      const shown = items.filter((i) => !q || (i.label + ' ' + (i.sub || '') + ' ' + (i.group || '')).toLowerCase().includes(q));
      if (!shown.length) listEl.appendChild(h('div.pick-empty', emptyText));
      for (const it of shown) {
        if (it.group && it.group !== lastGroup) {
          lastGroup = it.group;
          listEl.appendChild(h('div.sheet-header', it.group));
        }
        listEl.appendChild(
          h(
            'button.sheet-item' + (it.selected ? '.checked' : ''),
            { onclick: () => layer.close({ value: it.value }) },
            h('span.sheet-icon', it.icon || ''),
            h('span.sheet-label', it.label),
            it.sub ? h('span.sheet-sub', it.sub) : null
          )
        );
      }
    };
    inp && inp.addEventListener('input', render);
    render();
    const box = h('div.sheet.tall', h('div.sheet-grab'), h('div.sheet-title', title), inp, listEl, h('button.sheet-cancel', { onclick: () => layer.close(null) }, 'Annuler'));
    layer = openLayer(box, { sheet: true, onClose: (v) => resolve(v ? v : null) });
  });
}

export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
