// Point d'entrée de l'application (Hub + Éditeur)

import { Hub } from './hub.js';
import { Editor } from './editor/editor.js';
import { Store, requestPersistence } from './storage.js';
import { normalizeProject } from './templates.js';
import { injectRuntimeCSS } from './runtime-css.js';
import { toast, closeTopLayer, h } from './util.js';

class App {
  constructor(el) {
    this.el = el;
    this.hub = null;
    this.editor = null;
    window.addEventListener('hashchange', () => this.route());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeTopLayer();
    });
    this.route();
  }

  async route() {
    const m = /^#\/p\/([\w-]+)/.exec(location.hash);
    if (m) {
      if (this.editor && this.editor.project.id === m[1]) return;
      await this.showEditor(m[1]);
    } else {
      if (this.hub && !this.editor) return;
      await this.showHub();
    }
  }

  async showHub() {
    if (this.editor) {
      const ed = this.editor;
      this.editor = null;
      await ed.close();
    }
    if (!this.hub) {
      this.hub = new Hub(this);
      this.hub.mount(this.el);
    } else this.hub.render();
    document.title = 'CréaEngine';
  }

  async showEditor(id) {
    const p = await Store.getProject(id);
    if (!p) {
      toast('Projet introuvable', 'error');
      location.hash = '#/';
      return;
    }
    if (this.editor) {
      const old = this.editor;
      this.editor = null;
      await old.close();
    }
    if (this.hub) {
      this.hub.destroy();
      this.hub = null;
    }
    normalizeProject(p);
    this.editor = new Editor(this, p);
    this.editor.mount(this.el);
    document.title = p.name + ' — CréaEngine';
  }

  openProject(id) {
    location.hash = '#/p/' + id;
  }

  closeProject() {
    location.hash = '#/';
  }
}

function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  let reloading = false;
  const offer = (reg) => {
    if (document.querySelector('.update-banner')) return;
    const apply = async () => {
      if (window.creaApp && window.creaApp.editor) await window.creaApp.editor.save();
      reloading = true;
      if (reg.waiting) reg.waiting.postMessage('skip');
      else location.reload();
    };
    document.body.appendChild(h('div.update-banner', '✨ Nouvelle version disponible — ', h('button', { onclick: apply }, 'Mettre à jour')));
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) location.reload();
  });
  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) offer(reg);
        });
      });
      // vérifie les mises à jour au retour dans l'app
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && reg.update().catch(() => {}));
    })
    .catch(() => {});
}

injectRuntimeCSS();
document.documentElement.classList.toggle('touch', matchMedia('(pointer: coarse)').matches);
// empêche le zoom par pincement de Safari hors des zones prévues
document.addEventListener('gesturestart', (e) => e.preventDefault());
const splash = document.getElementById('splash');
if (splash) splash.remove();
window.creaApp = new App(document.getElementById('app'));
requestPersistence();
registerSW();
