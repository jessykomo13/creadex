// Éditeur de code (CodeMirror 6) optimisé pour l'iPhone

import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, highlightSpecialChars } from '@codemirror/view';
import { EditorState, Compartment, EditorSelection } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo, toggleComment, cursorCharLeft, cursorCharRight, cursorLineUp, cursorLineDown, indentMore, indentLess, selectLine } from '@codemirror/commands';
import { javascript, javascriptLanguage } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap, snippetCompletion, acceptCompletion, completionStatus, startCompletion } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit } from '@codemirror/language';
import { linter, lintGutter, forEachDiagnostic } from '@codemirror/lint';
import { h, debounce, pickFromList, actionSheet, toast } from '../util.js';
import { Prefs } from '../storage.js';
import { checkSyntax, analyze } from '../compiler.js';
import { DOCS, MEMBER_TYPES, MATERIAL_MEMBERS, SNIPPETS } from '../docs.js';
import { KeyboardBar } from './fields.js';

// ---------------------------------------------------------------- Autocomplétion

const STATIC_CLASSES = ['Vector3', 'Vector2', 'Quaternion', 'Color', 'Mathf', 'Random', 'Time', 'Input', 'Debug', 'Physics', 'GameObject', 'Camera', 'SceneManager', 'PlayerPrefs', 'Application', 'Screen', 'KeyCode', 'ForceMode', 'Space', 'Ref', 'Audio'];
const TYPE_ALIASES = { Text: 'Text', UIText: 'Text', Button: 'Button', UIButton: 'Button', Image: 'Image', UIImage: 'Image', BoxCollider: 'Collider', SphereCollider: 'Collider', CapsuleCollider: 'Collider', CylinderCollider: 'Collider', Collider: 'Collider' };

function optionFor(m, isMethodCall) {
  const isFn = m.kind === 'm' || (m.kind === 's' && m.sig.includes('('));
  const detail = m.sig.replace(/^[\w.]+\./, '');
  if (isFn && isMethodCall !== false) return snippetCompletion(`${m.name}(\${})`, { label: m.name, type: 'method', detail, info: m.doc, boost: 1 });
  return { label: m.name, type: m.kind === 'c' ? 'constant' : m.kind === 'e' ? 'event' : 'property', detail, info: m.doc };
}

function guessVarTypes(doc) {
  const map = {};
  const re = /(?:this\.|(?:const|let|var)\s+)([\w$]+)\s*=\s*[^;\n]*?GetComponent(?:InChildren|InParent)?\(\s*["'`]?([\w$]+)["'`]?\s*\)/g;
  let m;
  while ((m = re.exec(doc))) map[m[1]] = TYPE_ALIASES[m[2]] || m[2];
  const re2 = /(?:this\.|(?:const|let|var)\s+)([\w$]+)\s*=\s*new\s+(Vector3|Vector2|Color|Quaternion)\b/g;
  while ((m = re2.exec(doc))) map[m[1]] = m[2];
  const re3 = /^\s*([\w$]+)\s*=\s*new\s+(Vector3|Vector2|Color)\b/gm;
  while ((m = re3.exec(doc))) map[m[1]] = m[2];
  const re4 = /(?:this\.|(?:const|let|var)\s+)([\w$]+)\s*=\s*(?:GameObject\.Find\w*|Instantiate)\(/g;
  while ((m = re4.exec(doc))) map[m[1]] = 'GameObject';
  const re5 = /^\s*([\w$]+)\s*=\s*Ref\.GameObject\(/gm;
  while ((m = re5.exec(doc))) map[m[1]] = 'GameObject';
  return map;
}

function thisMembers(doc) {
  const names = new Map();
  const re = /this\.([\w$]+)/g;
  let m;
  while ((m = re.exec(doc))) names.set(m[1], 'property');
  try {
    const r = checkSyntax(doc);
    if (r.ok) {
      const info = analyze(r.ast);
      for (const c of info.classes) {
        c.fields.forEach((f) => names.set(f, 'property'));
        c.methods.forEach((f) => names.set(f, 'method'));
      }
    }
  } catch {}
  return names;
}

function membersOf(type, isStatic) {
  if (type === 'Material') return MATERIAL_MEMBERS;
  const d = DOCS[type];
  if (!d) return [];
  return d.members.filter((m) => (isStatic ? m.kind === 's' || m.kind === 'c' : m.kind === 'p' || m.kind === 'm'));
}

function engineCompletions(context) {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  if (/\/\/.*$/.test(before.replace(/(["'`]).*?\1/g, ''))) return null;
  const doc = context.state.doc.toString();
  const m = /([A-Za-z_$][\w$]*(?:\(\s*["'`]?[\w$]*["'`]?\s*\))?(?:\.[A-Za-z_$][\w$]*(?:\(\s*["'`]?[\w$]*["'`]?\s*\))?)*)\.([\w$]*)$/.exec(before);
  if (m) {
    const parts = m[1].split('.');
    const typed = m[2];
    const vars = guessVarTypes(doc);
    let type = null;
    let isStatic = false;
    const first = parts[0];
    if (first === 'this') type = 'this';
    else if (STATIC_CLASSES.includes(first) && parts.length === 1) {
      type = first;
      isStatic = true;
    } else if (first === 'Camera' && parts[1] === 'main') type = 'Camera';
    else if (first === 'Prefabs' || first === 'Scripts') type = null;
    else type = vars[first] || MEMBER_TYPES[first] || null;
    for (let i = 1; i < parts.length && type; i++) {
      const p = parts[i];
      const gc = /^GetComponent\w*\(\s*["'`]?([\w$]+)/.exec(p);
      if (gc) type = TYPE_ALIASES[gc[1]] || gc[1];
      else if (type === 'this') type = vars[p] || MEMBER_TYPES[p] || null;
      else if (p === 'main' && type === 'Camera') type = 'Camera';
      else type = MEMBER_TYPES[p] || null;
      isStatic = false;
    }
    let options = [];
    if (type === 'this') {
      options = membersOf('MonoBehaviour', false).map((x) => optionFor(x));
      const own = thisMembers(doc);
      for (const [n, kind] of own) if (!options.some((o) => o.label === n)) options.push(kind === 'method' ? snippetCompletion(`${n}(\${})`, { label: n, type: 'method', detail: 'ta méthode', boost: 2 }) : { label: n, type: 'variable', detail: 'ton champ', boost: 2 });
    } else if (type) {
      options = membersOf(type, isStatic).map((x) => optionFor(x));
      if (!isStatic && ['Rigidbody', 'Collider', 'MeshRenderer', 'SpriteRenderer', 'Camera', 'Light', 'AudioSource', 'ParticleSystem', 'Text', 'Button', 'Image'].includes(type))
        options.push(...membersOf('MonoBehaviour', false).filter((x) => ['gameObject', 'transform', 'enabled', 'GetComponent', 'CompareTag'].includes(x.name)).map((x) => optionFor(x)));
    }
    if (!options.length) return null;
    return { from: context.pos - typed.length, options, validFor: /^[\w$]*$/ };
  }
  const w = context.matchBefore(/[\w$]+/);
  if (!w && !context.explicit) return null;
  if (w && w.text.length < 1 && !context.explicit) return null;
  const options = [];
  for (const c of [...STATIC_CLASSES, 'Rigidbody', 'MeshRenderer', 'SpriteRenderer', 'AudioSource', 'ParticleSystem', 'Light', 'Text', 'Button', 'Image', 'Transform', 'MonoBehaviour', 'Prefabs', 'Resources', 'WaitForSeconds', 'WaitUntil', 'WaitWhile'])
    options.push({ label: c, type: 'class', detail: DOCS[c] ? DOCS[c].desc.slice(0, 60) : '', boost: -1 });
  for (const g of DOCS.Global.members) options.push(optionFor(g));
  for (const e of DOCS['Événements'].members) options.push(snippetCompletion(`${e.sig.replace(/\)$/, '')}) {\n\t\${}\n}`, { label: e.name, type: 'event', detail: 'événement', info: e.doc }));
  for (const s of SNIPPETS) options.push(snippetCompletion(s.code, { label: s.label, type: 'text', detail: s.detail, boost: -2 }));
  return { from: w ? w.from : context.pos, options, validFor: /^[\w$]*$/ };
}

function lintSource(view) {
  const code = view.state.doc.toString();
  const r = checkSyntax(code);
  if (!r.ok) {
    const pos = Math.max(0, Math.min(r.error.pos, code.length));
    const end = Math.min(code.length, pos + 1);
    return [{ from: pos, to: end, severity: 'error', message: r.error.message }];
  }
  const info = analyze(r.ast);
  const out = [];
  if (!info.classes.length) out.push({ from: 0, to: Math.min(code.length, 1), severity: 'warning', message: 'Aucune classe : écris class MonScript extends MonoBehaviour { … }' });
  for (const c of info.classes) {
    for (const meth of c.methods) {
      const lower = meth.toLowerCase();
      const fix = { start: 'Start', update: 'Update', awake: 'Awake', fixedupdate: 'FixedUpdate', lateupdate: 'LateUpdate', oncollisionenter: 'OnCollisionEnter', ontriggerenter: 'OnTriggerEnter', onmousedown: 'OnMouseDown' }[lower];
      if (fix && fix !== meth) {
        const idx = code.indexOf(meth + '(');
        if (idx >= 0) out.push({ from: idx, to: idx + meth.length, severity: 'warning', message: `Attention à la casse : le moteur appelle « ${fix} »` });
      }
    }
  }
  return out;
}

const fontTheme = (size) =>
  EditorView.theme({
    '&': { fontSize: size + 'px', height: '100%' },
    '.cm-content': { fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', paddingBottom: '40vh' },
    '.cm-gutters': { fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace' },
    '.cm-scroller': { lineHeight: '1.55' },
  });

// ---------------------------------------------------------------- Éditeur

export class CodeEditor {
  constructor(ed) {
    this.ed = ed;
    this.states = new Map();
    this.tabs = [];
    this.current = null;
    this.fontComp = new Compartment();
    this.wrapComp = new Compartment();
    this.size = Prefs.get('codeFontSize') || 14;
    this.saveSoon = debounce(() => this.flush(), 350);
    this.build();
  }

  build() {
    this.tabsEl = h('div.ce-tabs');
    this.status = h('div.ce-status');
    this.host = h('div.ce-host');
    const tb = (label, title, fn) => h('button.ce-tool', { title, onclick: fn }, label);
    const bar = h(
      'div.ce-toolbar',
      tb('↶', 'Annuler', () => { undo(this.view); this.view.focus(); }),
      tb('↷', 'Rétablir', () => { redo(this.view); this.view.focus(); }),
      tb('🔍', 'Rechercher / remplacer', () => openSearchPanel(this.view)),
      tb('//', 'Commenter', () => toggleComment(this.view)),
      tb('A−', 'Texte plus petit', () => this.setSize(this.size - 1)),
      tb('A+', 'Texte plus grand', () => this.setSize(this.size + 1)),
      tb('↩︎', 'Retour à la ligne', () => this.toggleWrap()),
      tb('📖', 'Aide API', () => this.help()),
      h('div.grow'),
      h('button.ce-play', { title: 'Jouer', onclick: () => { this.flush(); this.close(); this.ed.play(); } }, '▶')
    );
    this.root = h(
      'div.code-editor',
      h(
        'div.ce-head',
        h('button.ce-back', { onclick: () => this.close() }, '‹ Scène'),
        this.tabsEl,
        h('button.icon-btn', { title: 'Nouveau script', onclick: async () => { const s = await this.ed.createScriptInteractive(false); if (s) this.open(s.id); } }, '＋'),
        h('button.icon-btn', { title: 'Plus', onclick: () => this.menu() }, '⋯')
      ),
      bar,
      this.host,
      this.status
    );
    document.body.appendChild(this.root);
    this.view = new EditorView({ parent: this.host, state: EditorState.create({ doc: '' }) });
    this.view.contentDOM.addEventListener('focus', () => this.showKeys());
    // suivre le clavier iOS
    const vv = window.visualViewport;
    const fit = () => {
      if (!this.root.classList.contains('open')) return;
      if (vv) {
        this.root.style.height = vv.height + 'px';
        this.root.style.top = vv.offsetTop + 'px';
      }
    };
    if (vv) {
      vv.addEventListener('resize', fit);
      vv.addEventListener('scroll', fit);
    }
    this.fit = fit;
  }

  extensions() {
    return [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      drawSelection(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion({ activateOnTyping: true, icons: true, maxRenderedOptions: 60 }),
      highlightActiveLine(),
      highlightSelectionMatches(),
      keymap.of([
        { key: 'Mod-s', run: () => { this.flush(); toast('Enregistré', 'ok', 900); return true; } },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        indentWithTab,
      ]),
      javascript(),
      javascriptLanguage.data.of({ autocomplete: engineCompletions }),
      linter(lintSource, { delay: 350 }),
      lintGutter(),
      oneDark,
      indentUnit.of('  '),
      EditorState.tabSize.of(2),
      this.fontComp.of(fontTheme(this.size)),
      this.wrapComp.of(Prefs.get('wrapCode') ? EditorView.lineWrapping : []),
      EditorView.contentAttributes.of({ autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', autocomplete: 'off' }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) this.saveSoon();
        if (u.docChanged || u.selectionSet) this.updateStatus();
      }),
    ];
  }

  stateFor(script) {
    let st = this.states.get(script.id);
    if (!st || st.doc.toString() !== script.code) {
      st = EditorState.create({ doc: script.code, extensions: this.extensions() });
      this.states.set(script.id, st);
    }
    return st;
  }

  open(scriptId, line) {
    const script = this.ed.project.scripts.find((s) => s.id === scriptId);
    if (!script) return;
    if (this.current && this.current !== scriptId) {
      this.flush();
      this.states.set(this.current, this.view.state);
    }
    if (!this.tabs.includes(scriptId)) this.tabs.push(scriptId);
    this.current = scriptId;
    this.view.setState(this.stateFor(script));
    this.root.classList.add('open');
    document.body.classList.add('code-open');
    this.fit();
    this.renderTabs();
    this.updateStatus();
    if (line) {
      const ln = this.view.state.doc.line(Math.max(1, Math.min(line, this.view.state.doc.lines)));
      this.view.dispatch({ selection: EditorSelection.single(ln.from, ln.to), scrollIntoView: true });
      requestAnimationFrame(() => this.view.dispatch({ effects: EditorView.scrollIntoView(ln.from, { y: 'center' }) }));
    }
  }

  get isOpen() {
    return this.root.classList.contains('open');
  }

  close() {
    this.flush();
    if (this.current) this.states.set(this.current, this.view.state);
    this.view.contentDOM.blur();
    KeyboardBar.hide();
    this.root.classList.remove('open');
    document.body.classList.remove('code-open');
    this.ed.onCodeEditorClosed();
  }

  flush() {
    this.saveSoon.cancel();
    if (!this.current) return;
    const script = this.ed.project.scripts.find((s) => s.id === this.current);
    if (!script) return;
    const code = this.view.state.doc.toString();
    if (code !== script.code) {
      script.code = code;
      this.ed.onScriptEdited(script);
    }
  }

  renderTabs() {
    this.tabs = this.tabs.filter((id) => this.ed.project.scripts.some((s) => s.id === id));
    this.tabsEl.innerHTML = '';
    for (const id of this.tabs) {
      const s = this.ed.project.scripts.find((x) => x.id === id);
      const err = this.ed.scriptErrors && this.ed.scriptErrors[id];
      const t = h('div.ce-tab' + (id === this.current ? '.active' : ''), h('span', (err ? '⚠️ ' : '') + s.name + '.js'), h('button.ce-x', { onclick: (e) => { e.stopPropagation(); this.closeTab(id); } }, '×'));
      t.addEventListener('click', () => this.open(id));
      this.tabsEl.appendChild(t);
    }
    const a = this.tabsEl.querySelector('.active');
    if (a) a.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }

  closeTab(id) {
    if (id === this.current) this.flush();
    this.tabs = this.tabs.filter((x) => x !== id);
    if (id === this.current) {
      this.current = null;
      if (this.tabs.length) this.open(this.tabs[this.tabs.length - 1]);
      else this.close();
    } else this.renderTabs();
  }

  forget(id) {
    this.states.delete(id);
    if (this.tabs.includes(id)) this.closeTab(id);
  }

  updateStatus() {
    const st = this.view.state;
    const pos = st.selection.main.head;
    const line = st.doc.lineAt(pos);
    let err = null;
    let warn = 0;
    forEachDiagnostic(st, (d) => {
      if (d.severity === 'error' && !err) err = d;
      else if (d.severity === 'warning') warn++;
    });
    const chk = checkSyntax(st.doc.toString());
    this.status.innerHTML = '';
    const left = h('span', `Ligne ${line.number}, col ${pos - line.from + 1}`);
    let right;
    if (!chk.ok) {
      right = h('button.ce-err', { onclick: () => this.gotoPos(chk.error.pos) }, `⛔ Ligne ${chk.error.line} : ${chk.error.message}`);
    } else right = h('span.ce-ok', warn ? `⚠️ ${warn} avertissement(s)` : '✓ Aucune erreur');
    void err;
    this.status.append(left, right);
  }

  gotoPos(pos) {
    pos = Math.min(pos, this.view.state.doc.length);
    this.view.dispatch({ selection: EditorSelection.cursor(pos), scrollIntoView: true });
    this.view.focus();
  }

  setSize(s) {
    this.size = Math.max(9, Math.min(26, s));
    Prefs.set('codeFontSize', this.size);
    this.view.dispatch({ effects: this.fontComp.reconfigure(fontTheme(this.size)) });
  }

  toggleWrap() {
    const w = !Prefs.get('wrapCode');
    Prefs.set('wrapCode', w);
    this.view.dispatch({ effects: this.wrapComp.reconfigure(w ? EditorView.lineWrapping : []) });
  }

  insert(text) {
    const v = this.view;
    const sel = v.state.selection.main;
    const pairs = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
    if (pairs[text]) {
      const inner = v.state.sliceDoc(sel.from, sel.to);
      v.dispatch({
        changes: { from: sel.from, to: sel.to, insert: text + inner + pairs[text] },
        selection: inner ? EditorSelection.range(sel.from + 1, sel.from + 1 + inner.length) : EditorSelection.cursor(sel.from + 1),
        userEvent: 'input.type',
      });
    } else {
      v.dispatch(v.state.replaceSelection(text), { userEvent: 'input.type', scrollIntoView: true });
    }
    if (/[\w.]/.test(text)) startCompletion(v);
  }

  showKeys() {
    if (!matchMedia('(pointer: coarse)').matches) return;
    const v = this.view;
    const k = (label, fn, extra = {}) => ({ label, action: fn, ...extra });
    const ins = (s) => k(s, () => this.insert(s));
    KeyboardBar.show(
      v.contentDOM,
      [
        k('⇥', () => { if (completionStatus(v.state) === 'active') acceptCompletion(v); else indentMore(v); }),
        k('⇤', () => indentLess(v)),
        k('←', () => cursorCharLeft(v), { repeat: true }),
        k('→', () => cursorCharRight(v), { repeat: true }),
        k('↑', () => cursorLineUp(v), { repeat: true }),
        k('↓', () => cursorLineDown(v), { repeat: true }),
        ...['.', '(', '{', '[', ';', '=', '"', "'", '+', '-', '*', '/', '<', '>', '!', '&', '|', ':', ',', '?', '`', '$', '#', '_'].map(ins),
        k('ligne', () => selectLine(v)),
        k('↶', () => undo(v)),
        k('↷', () => redo(v)),
        k('⌨︎↓', () => v.contentDOM.blur(), { primary: true }),
      ],
      'code'
    );
  }

  async help() {
    const items = [];
    for (const [cls, d] of Object.entries(DOCS)) for (const m of d.members) items.push({ label: m.sig, value: m.sig, sub: m.doc, group: cls, icon: m.kind === 'e' ? '⚡' : m.kind === 'm' || (m.kind === 's' && m.sig.includes('(')) ? 'ƒ' : '•' });
    const r = await pickFromList('Aide API — touche pour insérer', items);
    if (r) {
      this.view.focus();
      this.insert(r.value);
    }
  }

  async menu() {
    const s = this.ed.project.scripts.find((x) => x.id === this.current);
    actionSheet(s ? s.name + '.js' : 'Script', [
      { label: 'Rechercher / remplacer', icon: '🔍', onClick: () => openSearchPanel(this.view) },
      { label: 'Aller à la ligne…', icon: '#️⃣', onClick: async () => {
        const { promptText } = await import('../util.js');
        const n = await promptText('Aller à la ligne', '', { placeholder: 'numéro' });
        const ln = parseInt(n, 10);
        if (ln > 0) this.open(this.current, ln);
      } },
      { label: 'Aide API', icon: '📖', onClick: () => this.help() },
      s ? { label: 'Renommer le script', icon: '🏷️', onClick: () => this.ed.renameScript(s) } : null,
      s ? { label: 'Dupliquer', icon: '📄', onClick: () => this.ed.duplicateScript(s) } : null,
      { label: Prefs.get('wrapCode') ? 'Ne plus couper les lignes' : 'Couper les longues lignes', icon: '↩︎', onClick: () => this.toggleWrap() },
      '-',
      s ? { label: 'Supprimer le script', icon: '🗑️', danger: true, onClick: () => this.ed.deleteScript(s) } : null,
    ]);
  }
}
