// Persistance locale (IndexedDB) des projets et préférences

const DB_NAME = 'crea-engine';
const DB_VERSION = 1;
let dbp = null;

function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

function tx(store, mode, fn) {
  return db().then(
    (d) =>
      new Promise((resolve, reject) => {
        const t = d.transaction(store, mode);
        const stores = Array.isArray(store) ? store.map((s) => t.objectStore(s)) : t.objectStore(store);
        let result;
        Promise.resolve(fn(stores)).then((r) => (result = r));
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

const req2p = (r) =>
  new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

function metaOf(p) {
  return {
    id: p.id,
    name: p.name,
    template: p.template || '',
    created: p.created,
    modified: p.modified,
    thumb: p.thumb || '',
    is2D: !!p.settings?.is2D,
    scenes: p.scenes?.length || 0,
    scripts: p.scripts?.length || 0,
  };
}

export const Store = {
  async listProjects() {
    const list = await tx('meta', 'readonly', (s) => req2p(s.getAll()));
    return (list || []).sort((a, b) => b.modified - a.modified);
  },
  getProject(id) {
    return tx('projects', 'readonly', (s) => req2p(s.get(id)));
  },
  saveProject(p) {
    return tx(['projects', 'meta'], 'readwrite', ([ps, ms]) => {
      ps.put(p);
      ms.put(metaOf(p));
    });
  },
  deleteProject(id) {
    return tx(['projects', 'meta'], 'readwrite', ([ps, ms]) => {
      ps.delete(id);
      ms.delete(id);
    });
  },
  getKV(key, def = null) {
    return tx('kv', 'readonly', (s) => req2p(s.get(key))).then((v) => (v === undefined ? def : v));
  },
  setKV(key, value) {
    return tx('kv', 'readwrite', (s) => s.put(value, key));
  },
  async clearAll() {
    await tx(['projects', 'meta', 'kv'], 'readwrite', (stores) => stores.forEach((s) => s.clear()));
  },
};

// Préférences de l'éditeur (synchrones, localStorage)
const PREF_KEY = 'crea.prefs';
const defaults = {
  codeFontSize: 14,
  autosave: true,
  showStats: false,
  maximizeOnPlay: false,
  clearOnPlay: true,
  errorPause: false,
  snap: false,
  wrapCode: false,
};
let prefs = { ...defaults };
try {
  prefs = { ...defaults, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') };
} catch {}

export const Prefs = {
  get(k) {
    return prefs[k];
  },
  set(k, v) {
    prefs[k] = v;
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
    } catch {}
  },
  all() {
    return { ...prefs };
  },
};

export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
  } catch {}
}
