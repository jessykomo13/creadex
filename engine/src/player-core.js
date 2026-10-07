// Lecteur de jeu (plein écran) : utilisé par « Build & Run » et par les jeux exportés

import { Runtime } from './runtime.js';
import { unlockAudio } from './audio.js';
import { requestMotionPermission } from './input.js';
import { injectRuntimeCSS } from './runtime-css.js';

const PLAYER_CSS = `
.crea-player{position:fixed;inset:0;background:#000;z-index:9000;overflow:hidden;touch-action:none;-webkit-user-select:none;user-select:none}
.crea-player .pl-close{position:absolute;z-index:20;top:calc(10px + env(safe-area-inset-top));left:calc(10px + env(safe-area-inset-left));width:38px;height:38px;border-radius:50%;border:none;background:rgba(0,0,0,.45);color:#fff;font-size:20px;line-height:38px;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.crea-player .pl-start,.crea-player .pl-end{position:absolute;inset:0;z-index:30;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;color:#fff;font-family:-apple-system,system-ui,sans-serif;background:radial-gradient(circle at 50% 35%,#2b3550,#0b0d14 70%);text-align:center;padding:24px}
.crea-player .pl-start img{width:min(70vw,320px);aspect-ratio:16/10;object-fit:cover;border-radius:18px;box-shadow:0 10px 40px rgba(0,0,0,.6)}
.crea-player .pl-title{font-size:28px;font-weight:800}
.crea-player .pl-btn{font:700 19px -apple-system,system-ui,sans-serif;padding:15px 34px;border-radius:999px;border:none;background:#22c55e;color:#04140a;box-shadow:0 6px 0 #15803d}
.crea-player .pl-sub{opacity:.6;font-size:13px}
.crea-player .pl-err{position:absolute;z-index:25;left:10px;right:10px;bottom:calc(10px + env(safe-area-inset-bottom));max-height:30%;overflow:auto;background:rgba(127,29,29,.88);color:#fff;font:12px/1.4 ui-monospace,Menlo,monospace;border-radius:10px;padding:8px 10px;pointer-events:auto}
`;

function injectPlayerCSS() {
  injectRuntimeCSS();
  if (document.getElementById('crea-player-css')) return;
  const s = document.createElement('style');
  s.id = 'crea-player-css';
  s.textContent = PLAYER_CSS;
  document.head.appendChild(s);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/**
 * Lance un projet en plein écran.
 * opts: { closable, onClose, log, startScreen }
 */
export function runPlayer(project, opts = {}) {
  injectPlayerCSS();
  const root = el('div', 'crea-player');
  document.body.appendChild(root);
  const errBox = el('div', 'pl-err');
  errBox.style.display = 'none';
  root.appendChild(errBox);
  let rt = null;
  let ro = null;
  const errors = [];
  const showErr = (msg) => {
    errors.push(msg);
    if (errors.length > 6) errors.shift();
    errBox.textContent = errors.join('\n');
    errBox.style.display = '';
  };
  errBox.addEventListener('click', () => (errBox.style.display = 'none'));

  const close = () => {
    if (rt) rt.stop();
    rt = null;
    if (ro) ro.disconnect();
    root.remove();
    opts.onClose && opts.onClose();
  };

  if (opts.closable) {
    const x = el('button', 'pl-close', '✕');
    x.addEventListener('click', close);
    root.appendChild(x);
  }

  const start = () => {
    unlockAudio();
    if ((project.scripts || []).some((s) => /Input\.acceleration/.test(s.code))) requestMotionPermission();
    rt = new Runtime({
      project,
      container: root,
      log: (e) => {
        opts.log && opts.log(e);
        if (e.type === 'error') showErr((e.script ? `${e.script}.js${e.line ? ':' + e.line : ''} — ` : '') + e.msg);
      },
      onQuit: () => end(),
    });
    const fit = () => rt && rt.resize(root.clientWidth, root.clientHeight);
    fit();
    ro = new ResizeObserver(fit);
    ro.observe(root);
    if (!rt.start()) {
      rt.stop();
      rt = null;
      const box = el('div', 'pl-end');
      box.append(el('div', 'pl-title', '⚠️ Erreurs de compilation'), el('div', 'pl-sub', errors.join('\n')));
      root.appendChild(box);
    }
  };

  const end = () => {
    if (rt) rt.stop();
    rt = null;
    const box = el('div', 'pl-end');
    const again = el('button', 'pl-btn', '↻ Rejouer');
    again.addEventListener('click', () => {
      box.remove();
      start();
    });
    box.append(el('div', 'pl-title', project.name), el('div', 'pl-sub', 'Fin de la partie'), again);
    if (opts.closable) {
      const q = el('button', 'pl-btn', 'Fermer');
      q.style.background = '#94a3b8';
      q.style.boxShadow = '0 6px 0 #475569';
      q.addEventListener('click', close);
      box.appendChild(q);
    }
    root.appendChild(box);
  };

  if (opts.startScreen) {
    const s = el('div', 'pl-start');
    if (project.thumb) {
      const img = el('img');
      img.src = project.thumb;
      s.appendChild(img);
    }
    const b = el('button', 'pl-btn', '▶ Jouer');
    s.append(el('div', 'pl-title', project.name), b, el('div', 'pl-sub', 'Fait avec CréaEngine'));
    s.addEventListener('click', () => {
      s.remove();
      start();
    });
    root.appendChild(s);
  } else start();

  return { close };
}
