// Panneau Console

import { h } from '../util.js';
import { Prefs } from '../storage.js';

const ICONS = { log: 'ⓘ', warn: '⚠️', error: '⛔' };
const MAX = 600;

export class ConsolePanel {
  constructor(ed, el) {
    this.ed = ed;
    this.el = el;
    this.entries = [];
    this.show = { log: true, warn: true, error: true };
    this.counts = { log: 0, warn: 0, error: 0 };
    this.collapse = true;
    const mk = (type) => {
      const b = h('button.cfilter.on', { onclick: () => { this.show[type] = !this.show[type]; b.classList.toggle('on', this.show[type]); this.render(); } }, ICONS[type] + ' ', h('span', '0'));
      return b;
    };
    this.fLog = mk('log');
    this.fWarn = mk('warn');
    this.fErr = mk('error');
    const clearOnPlay = h('label.chk', h('input', { type: 'checkbox', checked: Prefs.get('clearOnPlay'), onchange: (e) => Prefs.set('clearOnPlay', e.target.checked) }), 'Vider au lancement');
    const errPause = h('label.chk', h('input', { type: 'checkbox', checked: Prefs.get('errorPause'), onchange: (e) => Prefs.set('errorPause', e.target.checked) }), 'Pause sur erreur');
    el.appendChild(h('div.panel-head.wrap', h('button.btn.sm', { onclick: () => this.clear() }, 'Vider'), this.fLog, this.fWarn, this.fErr, h('div.grow'), clearOnPlay, errPause));
    this.list = h('div.clist');
    el.appendChild(this.list);
    this.pending = false;
  }

  log(e) {
    const type = e.type === 'warn' ? 'warn' : e.type === 'error' ? 'error' : 'log';
    const last = this.entries[this.entries.length - 1];
    if (this.collapse && last && last.type === type && last.msg === e.msg && last.script === e.script && last.line === e.line) {
      last.count++;
      last.time = Date.now();
    } else {
      this.entries.push({ type, msg: String(e.msg), script: e.script, line: e.line, stack: e.stack, count: 1, time: Date.now(), compile: e.compile });
      if (this.entries.length > MAX) this.entries.shift();
    }
    this.counts[type]++;
    this.schedule();
    this.ed.onConsoleEntry(type);
  }

  clear() {
    this.entries = [];
    this.counts = { log: 0, warn: 0, error: 0 };
    this.render();
    this.ed.onConsoleEntry(null);
  }

  schedule() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.render();
    });
  }

  render() {
    this.fLog.lastChild.textContent = String(this.counts.log);
    this.fWarn.lastChild.textContent = String(this.counts.warn);
    this.fErr.lastChild.textContent = String(this.counts.error);
    const atBottom = this.list.scrollTop + this.list.clientHeight >= this.list.scrollHeight - 30;
    this.list.innerHTML = '';
    const shown = this.entries.filter((e) => this.show[e.type]);
    if (!shown.length) this.list.appendChild(h('div.empty-note', 'Console vide. Debug.Log("…") affiche des messages ici.'));
    const start = Math.max(0, shown.length - 300);
    for (let i = start; i < shown.length; i++) {
      const e = shown[i];
      const t = new Date(e.time);
      const time = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
      const loc = e.script ? h('button.cloc', { onclick: (ev) => { ev.stopPropagation(); this.ed.openScriptByName(e.script, e.line); } }, `${e.script}.js${e.line ? ':' + e.line : ''}`) : null;
      const row = h(
        'div.centry.' + e.type,
        h('span.cico', ICONS[e.type]),
        h('div.cbody', h('div.cmsg', e.msg), h('div.cmeta', h('span', time), loc)),
        e.count > 1 ? h('span.ccount', String(e.count)) : null
      );
      row.addEventListener('click', () => {
        if (e.script) this.ed.openScriptByName(e.script, e.line);
      });
      this.list.appendChild(row);
    }
    if (atBottom) this.list.scrollTop = this.list.scrollHeight;
  }
}
