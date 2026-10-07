// Build : export du jeu, export du projet, paramètres, lancement plein écran

import { h, modal, toast, downloadFile, escapeHtml, promptText } from '../util.js';
import { runPlayer } from '../player-core.js';
import { boolField, selectField, textField, vecField, row } from './fields.js';

const fileSafe = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'jeu';

export async function exportGameHTML(project) {
  toast('Préparation du jeu…', 'info', 1200);
  let js;
  try {
    const res = await fetch(new URL('./dist/player.js', document.baseURI));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    js = await res.text();
  } catch (e) {
    toast('Impossible de lire le moteur (dist/player.js) : ' + e.message, 'error', 4000);
    return;
  }
  const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
  const data = JSON.stringify(project).replace(/</g, '\\u003c').split(LS).join('\\u2028').split(PS).join('\\u2029');
  const name = escapeHtml(project.name);
  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="${name}">
<meta name="theme-color" content="#000000">
${project.thumb ? `<link rel="apple-touch-icon" href="${project.thumb}">` : ''}
<title>${name}</title>
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden;overscroll-behavior:none}</style>
</head><body>
<script>${js.replace(/<\/script/gi, '<\\/script')}</script>
<script>CreaPlayer.boot(${data});</script>
</body></html>`;
  await downloadFile(fileSafe(project.name) + '.html', html, 'text/html');
}

export async function exportProjectJSON(project) {
  const data = JSON.stringify({ format: 'crea-engine-project', version: 1, project }, null, 0);
  await downloadFile(fileSafe(project.name) + '.creaproj.json', data, 'application/json');
}

export function runFullscreen(project, { log } = {}) {
  runPlayer(project, { closable: true, log });
}

export function projectSettings(ed) {
  const p = ed.project;
  const s = p.settings;
  const c = s.controls;
  const body = h('div.settings');
  const sec = (t) => body.appendChild(h('div.set-sec', t));
  const changed = () => ed.markDirty();

  sec('Général');
  body.appendChild(row('Nom du projet', textField({ value: p.name, onCommit: (v) => { p.name = v.trim() || p.name; ed.refreshTitle(); changed(); } })));
  body.appendChild(
    row(
      'Scène de départ',
      selectField({ value: s.startScene, options: p.scenes.map((x) => x.id), labels: Object.fromEntries(p.scenes.map((x) => [x.id, x.name])), onChange: (v) => { s.startScene = v; changed(); } })
    )
  );
  body.appendChild(row('Projet 2D', boolField({ value: s.is2D, onChange: (v) => { if (v !== ed.sv.is2D) ed.toggle2D(); } })));

  sec('Contrôles tactiles');
  body.appendChild(row('Joystick virtuel', boolField({ value: c.joystick, onChange: (v) => { c.joystick = v; changed(); } })));
  body.appendChild(row('Bouton A (Jump)', boolField({ value: c.buttonA, onChange: (v) => { c.buttonA = v; changed(); } })));
  body.appendChild(row('Libellé A', textField({ value: c.labelA, onCommit: (v) => { c.labelA = v.slice(0, 6); changed(); } })));
  body.appendChild(row('Bouton B (Fire1)', boolField({ value: c.buttonB, onChange: (v) => { c.buttonB = v; changed(); } })));
  body.appendChild(row('Libellé B', textField({ value: c.labelB, onCommit: (v) => { c.labelB = v.slice(0, 6); changed(); } })));

  sec('Physique');
  body.appendChild(row('Gravité', vecField({ value: s.gravity, onCommit: (v) => { s.gravity = v; changed(); } })));
  body.appendChild(row('Fréquence (Hz)', selectField({ value: String(s.fixedHz || 60), options: ['30', '50', '60', '90', '120'], onChange: (v) => { s.fixedHz = Number(v); changed(); } })));

  sec('Qualité');
  body.appendChild(row('Ombres', boolField({ value: s.shadows !== false, onChange: (v) => { s.shadows = v; changed(); toast('Pris en compte à la réouverture du projet', 'info'); } })));
  body.appendChild(row('Anticrénelage', boolField({ value: s.antialias !== false, onChange: (v) => { s.antialias = v; changed(); toast('Pris en compte à la réouverture du projet', 'info'); } })));
  body.appendChild(row('Résolution', selectField({ value: String(s.pixelRatio || 2), options: ['1', '1.5', '2', '3'], labels: { 1: 'Économie (1x)', 1.5: 'Moyenne (1,5x)', 2: 'Rétina (2x)', 3: 'Max (3x)' }, onChange: (v) => { s.pixelRatio = Number(v); changed(); } })));

  sec('Tags');
  const tagsBox = h('div.tags');
  const renderTags = () => {
    tagsBox.innerHTML = '';
    for (const t of s.tags) {
      tagsBox.appendChild(
        h('span.tag-chip', t, t === 'Untagged' ? null : h('button', { onclick: () => { s.tags = s.tags.filter((x) => x !== t); renderTags(); changed(); } }, '×'))
      );
    }
    tagsBox.appendChild(h('button.btn.sm', { onclick: async () => { const t = await promptText('Nouveau tag', ''); if (t && t.trim() && !s.tags.includes(t.trim())) { s.tags.push(t.trim()); renderTags(); changed(); } } }, '＋ Tag'));
  };
  renderTags();
  body.appendChild(tagsBox);

  sec('Infos');
  const size = JSON.stringify(p).length;
  body.appendChild(h('div.hint.sm', `${p.scenes.length} scène(s) • ${p.scripts.length} script(s) • ${p.prefabs.length} prefab(s) • ${p.assets.length} fichier(s) • ${(size / 1024).toFixed(0)} Ko`));
  return modal({ title: '⚙️ Paramètres du projet', body, buttons: [{ label: 'Fermer', value: true, primary: true }], wide: true });
}
