// Compilation des scripts utilisateurs (JavaScript façon Unity)

import { parse } from 'acorn';

/** Noms injectés dans la portée de chaque script */
export const API_NAMES = [
  'Vector3', 'Vector2', 'Quaternion', 'Color', 'Mathf', 'Random', 'Ray',
  'Time', 'Input', 'Debug', 'print', 'Physics', 'Screen', 'Application', 'SceneManager', 'PlayerPrefs', 'Handheld', 'Audio',
  'GameObject', 'Transform', 'Component', 'Behaviour', 'MonoBehaviour', 'Instantiate', 'Destroy', 'DontDestroyOnLoad',
  'Camera', 'Rigidbody', 'Collider', 'BoxCollider', 'SphereCollider', 'CapsuleCollider', 'CylinderCollider',
  'MeshRenderer', 'SpriteRenderer', 'Text3D', 'Light', 'AudioSource', 'ParticleSystem', 'TrailRenderer', 'Text', 'Button', 'Image',
  'WaitForSeconds', 'WaitForSecondsRealtime', 'WaitUntil', 'WaitWhile', 'WaitForFixedUpdate', 'WaitForEndOfFrame',
  'KeyCode', 'ForceMode', 'Space', 'TouchPhase', 'Ref', 'Resources', 'Prefabs', 'Scripts',
];

export function checkSyntax(code) {
  try {
    const ast = parse(code, { ecmaVersion: 'latest', sourceType: 'script', locations: true, allowHashBang: true });
    return { ok: true, ast };
  } catch (e) {
    return {
      ok: false,
      error: {
        line: e.loc ? e.loc.line : 1,
        col: e.loc ? e.loc.column + 1 : 1,
        pos: e.pos ?? 0,
        message: traduire(e.message.replace(/\s*\(\d+:\d+\)$/, '')),
      },
    };
  }
}

function traduire(msg) {
  const t = [
    [/^Unexpected token/, 'Symbole inattendu'],
    [/^Unexpected character '(.*)'/, "Caractère inattendu '$1'"],
    [/^Unterminated string constant/, 'Chaîne de caractères non fermée'],
    [/^Unterminated template/, 'Gabarit non fermé'],
    [/^Unexpected keyword '(.*)'/, "Mot-clé inattendu '$1'"],
    [/^Identifier '(.*)' has already been declared/, "L'identifiant '$1' est déjà déclaré"],
    [/^Unterminated comment/, 'Commentaire non fermé'],
    [/^Unexpected reserved word/, 'Mot réservé inattendu'],
  ];
  for (const [re, fr] of t) if (re.test(msg)) return msg.replace(re, fr);
  return msg;
}

/** Analyse le code : classes et noms déclarés au niveau supérieur. */
export function analyze(ast) {
  const classes = [];
  const topNames = new Set();
  for (const node of ast.body) {
    if (node.type === 'ClassDeclaration' && node.id) {
      topNames.add(node.id.name);
      const methods = [];
      const fields = [];
      for (const m of node.body.body) {
        const name = m.key && (m.key.name || m.key.value);
        if (!name) continue;
        if (m.type === 'MethodDefinition') methods.push(name);
        else if (m.type === 'PropertyDefinition' && !m.static) fields.push(name);
      }
      classes.push({
        name: node.id.name,
        superName: node.superClass && node.superClass.type === 'Identifier' ? node.superClass.name : null,
        methods,
        fields,
        line: node.loc.start.line,
      });
    } else if (node.type === 'FunctionDeclaration' && node.id) topNames.add(node.id.name);
    else if (node.type === 'VariableDeclaration')
      for (const d of node.declarations) collectPattern(d.id, topNames);
  }
  return { classes, topNames };
}

function collectPattern(p, set) {
  if (!p) return;
  if (p.type === 'Identifier') set.add(p.name);
  else if (p.type === 'ObjectPattern') p.properties.forEach((q) => collectPattern(q.value || q.argument, set));
  else if (p.type === 'ArrayPattern') p.elements.forEach((q) => collectPattern(q, set));
  else if (p.type === 'RestElement') collectPattern(p.argument, set);
  else if (p.type === 'AssignmentPattern') collectPattern(p.left, set);
}

// Nombre de lignes ajoutées par « new Function » avant le corps (dépend du navigateur)
let HEADER_LINES = null;
function headerLines() {
  if (HEADER_LINES !== null) return HEADER_LINES;
  HEADER_LINES = 2;
  try {
    new Function('a', '"use strict";\nthrow new Error("probe")\n//# sourceURL=__crea_probe__.js')(0);
  } catch (e) {
    const m = /__crea_probe__\.js:(\d+)/.exec(String(e.stack));
    if (m) HEADER_LINES = Number(m[1]) - 2;
  }
  return HEADER_LINES;
}

const safeName = (n) => String(n).replace(/[^\w$-]/g, '_');

/**
 * Compile tous les scripts du projet.
 * api : objet { Nom: valeur } contenant les API_NAMES.
 * Retourne { classes: Map(nomScript → classe), infos: Map, errors: [{script, line, col, message}] }
 */
export function compileAll(scripts, api) {
  const errors = [];
  const classes = new Map();
  const infos = new Map();
  const parsed = [];
  for (const s of scripts) {
    const chk = checkSyntax(s.code);
    if (!chk.ok) {
      errors.push({ script: s.name, scriptId: s.id, ...chk.error });
      continue;
    }
    const info = analyze(chk.ast);
    const cls =
      info.classes.find((c) => c.name === s.name) ||
      info.classes.find((c) => c.superName === 'MonoBehaviour') ||
      info.classes[0];
    if (!cls) {
      errors.push({ script: s.name, scriptId: s.id, line: 1, col: 1, message: `Aucune classe trouvée. Écris : class ${s.name} extends MonoBehaviour { … }` });
      continue;
    }
    parsed.push({ s, info, cls });
  }
  const allClassNames = parsed.map((p) => p.cls.name);
  const links = [];
  for (const { s, info, cls } of parsed) {
    const params = API_NAMES.filter((n) => !info.topNames.has(n));
    const others = allClassNames.filter((n) => !info.topNames.has(n) && !API_NAMES.includes(n));
    const decl = `"use strict";${others.length ? 'let ' + others.join(',') + ';' : ''}`;
    const body = `${decl}\n${s.code}\n;return {cls:${cls.name},link:function(m){${others.map((n) => `${n}=m.${n};`).join('')}}};\n//# sourceURL=${safeName(s.name)}.js`;
    try {
      const factory = new Function(...params, body);
      const res = factory(...params.map((n) => api[n]));
      Object.defineProperty(res.cls, '__scriptName', { value: s.name });
      Object.defineProperty(res.cls, '__scriptId', { value: s.id });
      classes.set(s.name, res.cls);
      infos.set(s.name, { ...cls, scriptId: s.id });
      links.push(res.link);
    } catch (e) {
      const loc = mapError(e, [s.name]);
      errors.push({ script: s.name, scriptId: s.id, line: loc ? loc.line : 1, col: loc ? loc.col : 1, message: `${e.name}: ${e.message}` });
    }
  }
  const map = Object.fromEntries(classes.entries());
  // aussi accessibles par le nom de classe
  for (const [sn, c] of classes) map[c.name] = c, void sn;
  for (const l of links) {
    try {
      l(map);
    } catch {}
  }
  return { classes, infos, errors, byClassName: map };
}

/** Retrouve script + ligne d'une erreur d'exécution à partir de sa pile d'appels */
export function mapError(err, scriptNames) {
  const stack = String((err && err.stack) || '');
  const re = /([\w$-]+)\.js:(\d+):(\d+)/g;
  let m;
  const names = new Set((scriptNames || []).map(safeName));
  while ((m = re.exec(stack))) {
    if (names.size && !names.has(m[1])) continue;
    if (m[1] === '__crea_probe__') continue;
    const line = Number(m[2]) - headerLines() - 1;
    if (line >= 1) return { script: m[1], line, col: Number(m[3]) };
  }
  return null;
}

// ---------------------------------------------------------------- Extraction des champs (inspecteur)

const stub = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined : stub),
  apply: () => stub,
  construct: () => stub,
});

const fieldCache = new Map();

/**
 * Lit les champs publics d'un script (valeurs par défaut des propriétés de classe).
 * mathApi fournit les vraies classes Vector3/Color… ; Ref doit être EditorRef.
 */
export function extractFields(script, mathApi) {
  const key = script.id + '\u0000' + script.code;
  if (fieldCache.has(key)) return fieldCache.get(key);
  let result = { fields: [], error: null, className: null, methods: [] };
  const chk = checkSyntax(script.code);
  if (!chk.ok) {
    result.error = `Ligne ${chk.error.line} : ${chk.error.message}`;
  } else {
    const info = analyze(chk.ast);
    const cls = info.classes.find((c) => c.name === script.name) || info.classes.find((c) => c.superName === 'MonoBehaviour') || info.classes[0];
    if (!cls) result.error = 'Aucune classe trouvée';
    else {
      result.className = cls.name;
      result.methods = cls.methods;
      class StubBehaviour {}
      const api = {};
      for (const n of API_NAMES) api[n] = mathApi[n] !== undefined ? mathApi[n] : stub;
      api.MonoBehaviour = StubBehaviour;
      api.Behaviour = StubBehaviour;
      api.Component = StubBehaviour;
      const params = API_NAMES.filter((n) => !info.topNames.has(n));
      try {
        const body = `"use strict";\n${script.code}\n;return ${cls.name};`;
        const C = new Function(...params, body)(...params.map((n) => api[n]));
        const inst = new C();
        for (const k of Object.keys(inst)) {
          if (k.startsWith('_')) continue;
          const f = describeField(k, inst[k], mathApi);
          if (f) result.fields.push(f);
        }
      } catch (e) {
        result.error = `Impossible de lire les champs : ${e.message}`;
      }
    }
  }
  fieldCache.set(key, result);
  if (fieldCache.size > 200) fieldCache.delete(fieldCache.keys().next().value);
  return result;
}

function describeField(k, v, api) {
  if (typeof v === 'number') return { k, t: 'num', d: v };
  if (typeof v === 'boolean') return { k, t: 'bool', d: v };
  if (typeof v === 'string') return { k, t: 'str', d: v };
  if (v && typeof v === 'object') {
    if (v.__ref === 'go') return { k, t: 'go', d: v.def };
    if (v.__ref === 'prefab') return { k, t: 'prefab', d: v.def };
    if (v.__ref === 'range') return { k, t: 'range', min: v.min, max: v.max, d: v.def };
    if (v.__ref === 'sound') return { k, t: 'sfx', d: 'sfx:' + v.def };
    if (v.__ref === 'image') return { k, t: 'image', d: '' };
    if (v instanceof api.Color) return { k, t: 'color', d: v.toHex() };
    if (v instanceof api.Vector3) return { k, t: 'vec3', d: [v.x, v.y, v.z] };
    if (v instanceof api.Vector2) return { k, t: 'vec2', d: [v.x, v.y] };
  }
  return null;
}
