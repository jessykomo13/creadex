// Widgets de l'inspecteur + barre d'outils au-dessus du clavier (iPhone)

import { h, evalNumber, fmtNum, clamp, pickFromList, haptic } from '../util.js';

// ---------------------------------------------------------------- Barre clavier

export const KeyboardBar = {
  el: null,
  target: null,
  show(target, buttons, cls = '') {
    this.hide();
    const bar = h('div.kbbar' + (cls ? '.' + cls : ''));
    for (const b of buttons) {
      if (b === '|') {
        bar.appendChild(h('span.kb-sep'));
        continue;
      }
      const btn = h('button.kb-key' + (b.wide ? '.wide' : '') + (b.primary ? '.primary' : ''), { type: 'button' }, b.label);
      let rep = 0;
      const fire = () => b.action(target);
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        haptic(5);
        fire();
        if (b.repeat) {
          rep = setTimeout(function again() {
            fire();
            rep = setTimeout(again, 70);
          }, 380);
        }
      });
      const stop = () => clearTimeout(rep);
      btn.addEventListener('pointerup', stop);
      btn.addEventListener('pointercancel', stop);
      btn.addEventListener('pointerleave', stop);
      bar.appendChild(btn);
    }
    document.body.appendChild(bar);
    document.body.classList.add('kb-open');
    this.el = bar;
    this.target = target;
    this.place();
    if (!this._bound) {
      this._bound = true;
      const vv = window.visualViewport;
      const f = () => this.place();
      if (vv) {
        vv.addEventListener('resize', f);
        vv.addEventListener('scroll', f);
      }
      window.addEventListener('resize', f);
    }
    const onBlur = () =>
      setTimeout(() => {
        if (this.target === target && document.activeElement !== target && !(target.contains && target.contains(document.activeElement))) this.hide();
      }, 120);
    target.addEventListener('focusout', onBlur, { once: true });
  },
  place() {
    if (!this.el) return;
    const vv = window.visualViewport;
    const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    this.el.style.top = bottom - this.el.offsetHeight + 'px';
  },
  hide() {
    document.body.classList.remove('kb-open');
    if (this.el) this.el.remove();
    this.el = null;
    this.target = null;
  },
};

const isTouch = matchMedia('(pointer: coarse)').matches;

function numberBar(inp) {
  if (!isTouch) return;
  KeyboardBar.show(inp, [
    { label: '±', action: (t) => { const v = t.value.trim(); t.value = v.startsWith('-') ? v.slice(1) : '-' + v; } },
    { label: '−', action: (t) => insertAtCursor(t, '-') },
    { label: '.', action: (t) => insertAtCursor(t, '.') },
    { label: '0', action: (t) => { t.value = '0'; } },
    '|',
    { label: 'Terminé', wide: true, primary: true, action: (t) => t.blur() },
  ]);
}

function insertAtCursor(t, s) {
  const a = t.selectionStart ?? t.value.length, b = t.selectionEnd ?? t.value.length;
  t.value = t.value.slice(0, a) + s + t.value.slice(b);
  try {
    t.setSelectionRange(a + s.length, a + s.length);
  } catch {}
}

// ---------------------------------------------------------------- Champs

/** Champ numérique avec étiquette « glissable » (comme Unity). */
export function numField({ value, step = 0.05, min = -Infinity, max = Infinity, int = false, onInput, onCommit, label, labelCls = '' }) {
  let cur = value;
  const inp = h('input.num', { type: 'text', inputMode: 'decimal', value: fmtNum(value), autocomplete: 'off', spellcheck: false, enterKeyHint: 'done' });
  const norm = (v) => {
    v = clamp(v, min, max);
    return int ? Math.round(v) : v;
  };
  const apply = () => {
    const v = norm(evalNumber(inp.value, cur));
    inp.value = fmtNum(v);
    if (v !== cur) {
      cur = v;
      onInput && onInput(v);
      onCommit && onCommit(v);
    }
  };
  inp.addEventListener('change', apply);
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') inp.blur();
  });
  inp.addEventListener('focus', () => {
    setTimeout(() => inp.select(), 0);
    numberBar(inp);
  });
  const wrap = h('div.numwrap');
  let lab = null;
  if (label != null) {
    lab = h('span.scrub' + (labelCls ? '.' + labelCls : ''), label);
    scrub(lab, () => cur, (v) => {
      v = norm(v);
      cur = v;
      inp.value = fmtNum(v);
      onInput && onInput(v);
    }, step, () => onCommit && onCommit(cur), () => inp.focus());
    wrap.appendChild(lab);
  }
  wrap.appendChild(inp);
  wrap.setValue = (v) => {
    cur = v;
    if (document.activeElement !== inp) inp.value = fmtNum(v);
  };
  wrap.input = inp;
  return wrap;
}

/** Rend un élément « glissable » horizontalement pour modifier une valeur. */
export function scrub(el, get, set, step, commit, tap) {
  el.style.touchAction = 'none';
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const x0 = e.clientX;
    const v0 = get();
    let moved = false;
    el.setPointerCapture(e.pointerId);
    el.classList.add('scrubbing');
    const move = (ev) => {
      const dx = ev.clientX - x0;
      if (Math.abs(dx) > 3) moved = true;
      if (moved) {
        const k = ev.shiftKey ? 0.1 : 1;
        set(Math.round((v0 + dx * step * k) / (step / 10)) * (step / 10));
      }
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.classList.remove('scrubbing');
      if (moved) commit && commit();
      else tap && tap();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
}

export function vecField({ value, step = 0.05, onInput, onCommit, labels = ['X', 'Y', 'Z'] }) {
  const v = [...value];
  const wrap = h('div.vec');
  const parts = labels.map((l, i) =>
    numField({
      value: v[i],
      step,
      label: l,
      labelCls: 'ax' + l.toLowerCase(),
      onInput: (x) => {
        v[i] = x;
        onInput && onInput([...v]);
      },
      onCommit: () => onCommit && onCommit([...v]),
    })
  );
  parts.forEach((p) => wrap.appendChild(p));
  wrap.setValue = (nv) => nv.forEach((x, i) => {
    v[i] = x;
    parts[i].setValue(x);
  });
  return wrap;
}

export function boolField({ value, onChange }) {
  const inp = h('input.switch', { type: 'checkbox', checked: !!value });
  inp.addEventListener('change', () => onChange(inp.checked));
  return inp;
}

export function bool3Field({ value, onChange, labels = ['X', 'Y', 'Z'] }) {
  const v = [...value];
  return h(
    'div.bool3',
    labels.map((l, i) =>
      h(
        'label.chk',
        h('input', {
          type: 'checkbox',
          checked: !!v[i],
          onchange: (e) => {
            v[i] = e.target.checked;
            onChange([...v]);
          },
        }),
        l
      )
    )
  );
}

export function colorField({ value, onInput, onCommit }) {
  const inp = h('input.color', { type: 'color', value: (value || '#ffffff').slice(0, 7) });
  const hex = h('span.hex', (value || '#ffffff').slice(0, 7).toUpperCase());
  inp.addEventListener('input', () => {
    hex.textContent = inp.value.toUpperCase();
    onInput && onInput(inp.value);
  });
  inp.addEventListener('change', () => onCommit && onCommit(inp.value));
  return h('label.colorwrap', inp, hex);
}

export function selectField({ value, options, labels = {}, onChange, groups }) {
  const sel = h('select.sel');
  const addOpt = (parent, o) => parent.appendChild(h('option', { value: o, selected: o === value }, labels[o] || o));
  if (groups) {
    for (const g of groups) {
      const og = h('optgroup', { label: g.label });
      g.options.forEach((o) => og.appendChild(h('option', { value: o.value, selected: o.value === value }, o.label)));
      sel.appendChild(og);
    }
  } else options.forEach((o) => addOpt(sel, o));
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

export function rangeField({ value, min = 0, max = 1, step, onInput, onCommit }) {
  step = step || (max - min) / 100;
  const r = h('input.range', { type: 'range', min, max, step, value });
  const n = numField({
    value,
    step,
    min,
    max,
    onInput: (v) => {
      r.value = v;
      onInput && onInput(v);
    },
    onCommit,
  });
  r.addEventListener('input', () => {
    const v = Number(r.value);
    n.setValue(v);
    onInput && onInput(v);
  });
  r.addEventListener('change', () => onCommit && onCommit(Number(r.value)));
  return h('div.rangewrap', r, n);
}

export function textField({ value, multiline = false, onInput, onCommit, placeholder = '' }) {
  const inp = multiline
    ? h('textarea.txt', { rows: 3, value: value ?? '', placeholder, spellcheck: false })
    : h('input.txt', { type: 'text', value: value ?? '', placeholder, autocomplete: 'off', spellcheck: false, autocapitalize: 'off' });
  inp.addEventListener('input', () => onInput && onInput(inp.value));
  inp.addEventListener('change', () => onCommit && onCommit(inp.value));
  if (!multiline)
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') inp.blur();
    });
  return inp;
}

/** Bouton qui ouvre une liste de choix (images, objets, prefabs…) */
export function pickerField({ label, thumb, title, items, onPick }) {
  const btn = h('button.picker', { type: 'button' }, thumb ? h('img.pthumb', { src: thumb }) : null, h('span', label || '— Aucun —'), h('span.pchev', '▾'));
  btn.addEventListener('click', async () => {
    const list = typeof items === 'function' ? await items() : items;
    const r = await pickFromList(title, list);
    if (r) onPick(r.value);
  });
  return btn;
}

export function row(label, widget, cls = '') {
  return h('div.frow' + (cls ? '.' + cls : ''), h('div.flabel', label), h('div.fval', widget));
}
