// Mises à jour de l'app : détection au lancement, écran « Mise à jour disponible », installation

import { h, toast } from './util.js';
import { APP_VERSION } from './version.js';

let reloading = false;
let current = null; // écran affiché
let lastCheck = 0;
let regPromise = null;

const supported = () => 'serviceWorker' in navigator && location.protocol !== 'file:';

/** Identifiant du build actuellement installé (nom du cache) */
export async function installedVersion() {
  try {
    const keys = await caches.keys();
    const k = keys.find((x) => x.startsWith('crea-engine-'));
    return k ? k.slice('crea-engine-'.length) : null;
  } catch {
    return null;
  }
}

function askInfo(worker) {
  return new Promise((res) => {
    const t = setTimeout(() => res(null), 1500);
    try {
      const ch = new MessageChannel();
      ch.port1.onmessage = (e) => {
        clearTimeout(t);
        res(e.data);
      };
      worker.postMessage({ type: 'info' }, [ch.port2]);
    } catch {
      clearTimeout(t);
      res(null);
    }
  });
}

function waitInstalled(worker, ms = 30000) {
  return new Promise((res) => {
    const t = setTimeout(res, ms);
    const check = () => {
      if (worker.state !== 'installing') {
        clearTimeout(t);
        res();
      }
    };
    worker.addEventListener('statechange', check);
    check();
  });
}

/** Installe la version en attente puis rouvre l'app (les projets sont enregistrés avant) */
export async function applyUpdate(reg) {
  const app = window.creaApp;
  try {
    if (app && app.editor) await app.editor.save();
  } catch {}
  reloading = true;
  if (reg && reg.waiting) reg.waiting.postMessage('skip');
  else location.reload();
  // filet de sécurité si le changement de version tarde
  setTimeout(() => location.reload(), 6000);
}

async function showUpdateScreen(reg) {
  if (current || !reg.waiting) return;
  const info = (await askInfo(reg.waiting)) || {};
  if (current) return;
  const btn = h('button.upd-btn', 'Mettre à jour');
  const later = h('button.upd-later', 'Plus tard');
  const notes = (info.notes || []).map((n) => h('li', n));
  const screen = h(
    'div.update-screen',
    h(
      'div.upd-card',
      h('img.upd-icon', { src: 'icons/icon-192.png', alt: '' }),
      h('div.upd-name', 'CréaEngine'),
      h('div.upd-title', 'Mise à jour disponible'),
      h('div.upd-ver', info.label ? `Version ${info.label}` + (info.label === APP_VERSION ? ' (correctifs)' : '') : 'Nouvelle version'),
      notes.length ? h('div.upd-notes', h('div.upd-notes-title', 'Nouveautés'), h('ul', notes)) : null,
      btn,
      later,
      h('div.upd-foot', 'Tes projets sont conservés.')
    )
  );
  btn.addEventListener('click', () => {
    btn.disabled = true;
    later.disabled = true;
    btn.textContent = 'Installation…';
    btn.classList.add('busy');
    applyUpdate(reg);
  });
  later.addEventListener('click', () => {
    screen.remove();
    current = null;
    showBadge(reg);
  });
  document.body.appendChild(screen);
  current = screen;
  requestAnimationFrame(() => screen.classList.add('show'));
}

function showBadge(reg) {
  if (document.querySelector('.update-banner')) return;
  const b = h('div.update-banner', '✨ Mise à jour prête — ', h('button', { onclick: () => applyUpdate(reg) }, 'Installer'));
  document.body.appendChild(b);
}

/** Cherche une mise à jour. Retourne { status: 'ready'|'none'|'unsupported', reg } */
export async function checkForUpdate({ show = true } = {}) {
  if (!supported()) return { status: 'unsupported' };
  const reg = await (regPromise || navigator.serviceWorker.getRegistration());
  if (!reg) return { status: 'unsupported' };
  lastCheck = Date.now();
  try {
    await reg.update();
  } catch {}
  if (reg.installing) await waitInstalled(reg.installing);
  if (reg.waiting && navigator.serviceWorker.controller) {
    if (show) showUpdateScreen(reg);
    return { status: 'ready', reg };
  }
  return { status: 'none', reg };
}

/** Dernier recours : oublie la version en cache et recharge depuis internet (les projets sont conservés) */
export async function forceRefresh() {
  try {
    const app = window.creaApp;
    if (app && app.editor) await app.editor.save();
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('crea-engine-')).map((k) => caches.delete(k)));
  } catch {}
  location.reload();
}

/** Enregistre le service worker et vérifie les mises à jour au lancement et au retour dans l'app */
export function initUpdates() {
  if (!supported()) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) location.reload();
  });
  regPromise = navigator.serviceWorker.register('./sw.js').catch(() => null);
  regPromise.then((reg) => {
    if (!reg) return;
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdateScreen(reg);
      });
    });
    if (reg.waiting && navigator.serviceWorker.controller) showUpdateScreen(reg);
    else checkForUpdate();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastCheck > 30000) checkForUpdate();
  });
  window.addEventListener('online', () => checkForUpdate());
}

/** Après une mise à jour : petit message de confirmation */
export async function announceIfUpdated() {
  const v = await installedVersion();
  if (!v) return;
  let prev = null;
  try {
    prev = localStorage.getItem('crea.build');
    localStorage.setItem('crea.build', v);
  } catch {}
  if (prev && prev !== v) setTimeout(() => toast(`✅ CréaEngine est à jour (version ${APP_VERSION})`, 'ok', 3500), 600);
}
