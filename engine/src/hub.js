// Le Hub : liste des projets, modèles, apprentissage, réglages

import { h, timeAgo, actionSheet, promptText, confirmBox, modal, toast, pickFiles, readFile, clone, uid, isIOS, isStandalone, escapeHtml } from './util.js';
import { Store, Prefs, requestPersistence } from './storage.js';
import { TEMPLATES, createProject, normalizeProject } from './templates.js';
import { DOCS, TUTORIALS } from './docs.js';
import { exportProjectJSON, exportGameHTML } from './editor/build.js';
import { runPlayer } from './player-core.js';
import { APP_VERSION, CHANGELOG } from './version.js';
import { checkForUpdate, installedVersion, forceRefresh, applyUpdate } from './updater.js';

export const VERSION = APP_VERSION;

export class Hub {
  constructor(app) {
    this.app = app;
    this.tab = 'projects';
    this.query = '';
  }

  mount(container) {
    this.root = h('div.hub');
    container.appendChild(this.root);
    this.render();
  }

  destroy() {
    this.root && this.root.remove();
  }

  async render() {
    const r = this.root;
    r.innerHTML = '';
    const tabs = [
      ['projects', '📁', 'Projets'],
      ['learn', '🎓', 'Apprendre'],
      ['settings', '⚙️', 'Réglages'],
    ];
    const head = h(
      'header.hub-head',
      h('div.hub-logo', h('img', { src: 'icons/icon-192.png', alt: '' }), h('div', h('div.hub-name', 'CréaEngine'), h('div.hub-sub', `Hub • version ${APP_VERSION}`))),
      h('div.grow')
    );
    const nav = h(
      'nav.hub-tabs',
      tabs.map(([id, ic, label]) =>
        h('button.hub-tab' + (this.tab === id ? '.on' : ''), { onclick: () => { this.tab = id; this.render(); } }, h('span', ic), h('span', label))
      )
    );
    r.append(head);
    if (isIOS && !isStandalone() && !sessionStorage.getItem('crea.noinstall')) {
      const ban = h(
        'div.install-banner',
        h('div', h('b', '📲 Installe l\'app sur ton iPhone'), h('div', 'Touche ', h('span.share-ico', '⬆︎'), ' Partager, puis « Sur l\'écran d\'accueil ».')),
        h('button.icon-btn', { onclick: () => { sessionStorage.setItem('crea.noinstall', '1'); ban.remove(); } }, '✕')
      );
      r.append(ban);
    }
    const content = h('div.hub-content');
    r.append(content, nav);
    if (this.tab === 'projects') await this.renderProjects(content);
    else if (this.tab === 'learn') this.renderLearn(content);
    else await this.renderSettings(content);
  }

  // ------------------------------------------------------------ projets
  async renderProjects(c) {
    const list = await Store.listProjects();
    const search = h('input.search', { placeholder: 'Rechercher un projet…', value: this.query, autocomplete: 'off', spellcheck: false });
    const grid = h('div.proj-grid');
    const draw = () => {
      grid.innerHTML = '';
      const q = this.query.toLowerCase();
      const shown = list.filter((p) => !q || p.name.toLowerCase().includes(q));
      if (!list.length) {
        grid.appendChild(
          h(
            'div.empty-hero',
            h('div.big', '🎮'),
            h('h2', 'Crée ton premier jeu'),
            h('p', 'Choisis un modèle — balle roulante, plateforme 2D, shooter spatial… — et appuie sur ▶ pour jouer tout de suite.'),
            h('button.btn.primary.lg', { onclick: () => this.newProject() }, '＋ Nouveau projet')
          )
        );
        return;
      }
      for (const p of shown) grid.appendChild(this.card(p));
    };
    search.addEventListener('input', () => {
      this.query = search.value;
      draw();
    });
    c.append(
      h('div.hub-title-row', h('h1', 'Projets'), h('div.grow'), h('button.btn', { onclick: () => this.importProject() }, '📥 Importer'), h('button.btn.primary', { onclick: () => this.newProject() }, '＋ Nouveau')),
      ...(list.length ? [search] : []),
      grid
    );
    draw();
  }

  card(p) {
    const tpl = TEMPLATES.find((t) => t.id === p.template);
    const card = h(
      'div.proj-card',
      h('div.proj-thumb', p.thumb ? h('img', { src: p.thumb, alt: '' }) : h('span', tpl ? tpl.icon : '🎮'), h('span.proj-badge', p.is2D ? '2D' : '3D')),
      h('div.proj-info', h('div.proj-name', p.name), h('div.proj-meta', `${tpl ? tpl.name : 'Projet'} • ${timeAgo(p.modified)}`)),
      h('button.icon-btn.proj-more', { onclick: (e) => { e.stopPropagation(); this.projectMenu(p); } }, '⋯')
    );
    card.addEventListener('click', () => this.app.openProject(p.id));
    return card;
  }

  async projectMenu(meta) {
    actionSheet(meta.name, [
      { label: 'Ouvrir', icon: '📂', onClick: () => this.app.openProject(meta.id) },
      { label: 'Jouer', icon: '▶️', onClick: async () => { const p = await Store.getProject(meta.id); if (p) runPlayer(normalizeProject(p), { closable: true, startScreen: false }); } },
      { label: 'Renommer', icon: '✏️', onClick: async () => {
        const n = await promptText('Renommer le projet', meta.name);
        if (!n || !n.trim()) return;
        const p = await Store.getProject(meta.id);
        p.name = n.trim();
        await Store.saveProject(p);
        this.render();
      } },
      { label: 'Dupliquer', icon: '📄', onClick: async () => {
        const p = clone(await Store.getProject(meta.id));
        p.id = uid();
        p.name += ' (copie)';
        p.created = p.modified = Date.now();
        await Store.saveProject(p);
        this.render();
      } },
      { label: 'Exporter le projet (.json)', icon: '💼', onClick: async () => exportProjectJSON(await Store.getProject(meta.id)) },
      { label: 'Exporter le jeu (.html)', icon: '📦', onClick: async () => exportGameHTML(normalizeProject(await Store.getProject(meta.id))) },
      '-',
      { label: 'Supprimer', icon: '🗑️', danger: true, onClick: async () => {
        if (!(await confirmBox('Supprimer le projet', `« ${meta.name} » sera définitivement supprimé de cet appareil.`, { okLabel: 'Supprimer', danger: true }))) return;
        await Store.deleteProject(meta.id);
        this.render();
      } },
    ]);
  }

  newProject() {
    let chosen = 'monde3d';
    const nameInp = h('input.input', { value: 'Mon jeu', autocomplete: 'off', spellcheck: false });
    const grid = h('div.tpl-grid');
    const draw = () => {
      grid.innerHTML = '';
      for (const t of TEMPLATES)
        grid.appendChild(
          h(
            'button.tpl-card' + (t.id === chosen ? '.on' : ''),
            {
              onclick: () => {
                chosen = t.id;
                if (/^Mon jeu/.test(nameInp.value) || TEMPLATES.some((x) => x.name === nameInp.value)) nameInp.value = t.name;
                draw();
              },
            },
            h('div.tpl-ico', t.icon),
            h('div.tpl-name', t.name),
            h('div.tpl-desc', t.desc)
          )
        );
    };
    draw();
    nameInp.value = TEMPLATES.find((t) => t.id === chosen).name;
    const body = h('div', h('label.lbl', 'Nom du projet'), nameInp, h('label.lbl', 'Modèle'), grid);
    modal({
      title: '✨ Nouveau projet',
      body,
      wide: true,
      buttons: [
        { label: 'Annuler', value: null },
        {
          label: 'Créer',
          primary: true,
          value: true,
          onClick: async () => {
            const p = createProject(nameInp.value.trim() || 'Mon jeu', chosen);
            await Store.saveProject(p);
            requestPersistence();
            setTimeout(() => this.app.openProject(p.id), 50);
          },
        },
      ],
    });
  }

  async importProject() {
    const files = await pickFiles('.json,application/json', false);
    if (!files.length) return;
    try {
      const txt = await readFile(files[0], 'text');
      let data = JSON.parse(txt);
      if (data.format === 'crea-engine-project') data = data.project;
      if (!data.scenes) throw new Error('fichier non reconnu');
      data.id = uid();
      data.modified = Date.now();
      data.created = data.created || Date.now();
      normalizeProject(data);
      await Store.saveProject(data);
      toast(`Projet « ${data.name} » importé`, 'ok');
      this.render();
    } catch (e) {
      toast('Import impossible : ' + e.message, 'error', 3500);
    }
  }

  // ------------------------------------------------------------ apprendre
  renderLearn(c) {
    c.append(h('div.hub-title-row', h('h1', 'Apprendre')));
    const tut = h('div.tuto-list');
    for (const t of TUTORIALS) {
      const d = h('details.tuto', h('summary', h('span.tuto-ico', t.icon), t.title), h('ol', t.steps.map((s) => h('li', s))));
      tut.appendChild(d);
    }
    c.append(h('h2.sec-title', 'Tutoriels'), tut);

    c.append(
      h('h2.sec-title', 'Différences avec Unity'),
      h(
        'div.note-card',
        h('ul', [
          h('li', 'Les scripts sont en JavaScript, avec une API calquée sur Unity : MonoBehaviour, Start(), Update(), transform, GetComponent, Instantiate…'),
          h('li', 'Les champs publics sont les propriétés de classe : vitesse = 5; (pas de type). Ils apparaissent dans l\'inspecteur.'),
          h('li', 'Pas de surcharge d\'opérateurs : a.add(b), a.mul(2) au lieu de a + b, a * 2. Mais transform.position.x += 1 fonctionne.'),
          h('li', '« Avant » = -Z (convention three.js). Vector3.forward vaut (0, 0, -1).'),
          h('li', 'Coroutines : méthode avec étoile *Routine() et yield new WaitForSeconds(1).'),
          h('li', 'Références : cible = Ref.GameObject("Joueur"); balle = Ref.Prefab("Balle");'),
          h('li', 'Physics.Raycast renvoie l\'impact (ou null) au lieu d\'un booléen + out.'),
        ])
      )
    );

    const q = h('input.search', { placeholder: 'Rechercher dans l\'API (ex. AddForce, Lerp)…', autocomplete: 'off', spellcheck: false });
    const ref = h('div.api-ref');
    const draw = () => {
      ref.innerHTML = '';
      const s = q.value.trim().toLowerCase();
      for (const [cls, d] of Object.entries(DOCS)) {
        const mem = d.members.filter((m) => !s || cls.toLowerCase().includes(s) || m.name.toLowerCase().includes(s) || m.doc.toLowerCase().includes(s));
        if (!mem.length) continue;
        const det = h('details.api-cls' + (s ? '' : ''), { open: !!s }, h('summary', h('b', cls), h('span.api-desc', d.desc)), h('div.api-members', mem.map((m) => h('div.api-m', h('code', m.sig), h('span', m.doc)))));
        ref.appendChild(det);
      }
      if (!ref.childNodes.length) ref.appendChild(h('div.empty-note', 'Aucun résultat'));
    };
    q.addEventListener('input', draw);
    draw();
    c.append(h('h2.sec-title', 'Référence de l\'API'), q, ref);
  }

  // ------------------------------------------------------------ réglages
  async renderSettings(c) {
    c.append(h('div.hub-title-row', h('h1', 'Réglages')));
    const box = h('div.settings-list');
    const build = await installedVersion();
    const checkBtn = h('button.btn.primary', {
      onclick: async () => {
        checkBtn.disabled = true;
        checkBtn.textContent = 'Recherche…';
        const r = await checkForUpdate({ show: false });
        checkBtn.disabled = false;
        checkBtn.textContent = '🔄 Rechercher une mise à jour';
        if (r.status === 'ready') applyUpdate(r.reg);
        else if (r.status === 'none') toast('Tu as déjà la dernière version ✓', 'ok');
        else toast('Mises à jour indisponibles ici (ouvre l\'app installée)', 'warn', 3000);
      },
    }, '🔄 Rechercher une mise à jour');
    box.append(
      h(
        'div.ver-card',
        h('img', { src: 'icons/icon-192.png', alt: '' }),
        h('div', h('div.ver-label', 'Version installée'), h('div.ver-num', APP_VERSION), build ? h('div.set-sub', 'build ' + build) : null)
      ),
      h('div.set-sub.ver-hint', 'CréaEngine se met à jour tout seul : à l\'ouverture, un écran te propose la nouvelle version. Tes projets sont conservés.'),
      h('div.upd-actions', checkBtn, h('button.btn', {
        onclick: async () => {
          if (await confirmBox('Réparer l\'app', 'Recharge l\'app depuis internet (si elle semble bloquée sur une ancienne version). Tes projets sont conservés.', { okLabel: 'Réparer' })) forceRefresh();
        },
      }, '🛠️ Réparer')),
      h('details.tuto', h('summary', h('span.tuto-ico', '📝'), 'Historique des versions'), h('div.changelog', CHANGELOG.map((c) => h('div', h('b', 'Version ' + c.version), h('ul', c.notes.map((n) => h('li', n)))))))
    );
    const sw = (label, key, sub) => {
      const inp = h('input.switch', { type: 'checkbox', checked: Prefs.get(key) !== false && !!Prefs.get(key) });
      inp.addEventListener('change', () => Prefs.set(key, inp.checked));
      return h('label.set-row', h('div', h('div', label), sub ? h('div.set-sub', sub) : null), inp);
    };
    const autosave = h('input.switch', { type: 'checkbox', checked: Prefs.get('autosave') !== false });
    autosave.addEventListener('change', () => Prefs.set('autosave', autosave.checked));
    box.append(
      h('div.set-sec', 'Éditeur'),
      h('label.set-row', h('div', h('div', 'Sauvegarde automatique'), h('div.set-sub', 'Enregistre après chaque modification')), autosave),
      sw('Vider la console au lancement', 'clearOnPlay'),
      sw('Pause sur erreur', 'errorPause', 'Met le jeu en pause à la première erreur'),
      sw('Plein écran en mode Jeu', 'maximizeOnPlay'),
      sw('Statistiques de rendu', 'showStats', 'FPS, appels de dessin…'),
      sw('Magnétisme des gizmos', 'snap')
    );
    const fs = h('select.sel', { onchange: (e) => Prefs.set('codeFontSize', Number(e.target.value)) }, [11, 12, 13, 14, 15, 16, 18, 20].map((n) => h('option', { value: n, selected: Prefs.get('codeFontSize') === n }, n + ' px')));
    box.append(h('label.set-row', h('div', 'Taille du code'), fs));

    box.append(h('div.set-sec', 'Stockage'));
    let usage = '…';
    try {
      const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
      if (est) usage = `${(est.usage / 1048576).toFixed(1)} Mo utilisés sur ${(est.quota / 1048576).toFixed(0)} Mo`;
      const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
      usage += persisted ? ' • stockage persistant ✓' : '';
    } catch {}
    box.append(
      h('div.set-row', h('div', h('div', 'Espace'), h('div.set-sub', usage))),
      h('div.set-row', h('div', h('div', 'Sauvegarde'), h('div.set-sub', 'Exporte régulièrement tes projets (⋯ → Exporter) pour ne rien perdre.'))),
      h('button.btn.danger', { onclick: async () => {
        if (!(await confirmBox('Tout effacer', 'Supprimer TOUS les projets et réglages de cet appareil ?', { okLabel: 'Tout effacer', danger: true }))) return;
        await Store.clearAll();
        localStorage.clear();
        toast('Données effacées', 'ok');
        this.render();
      } }, '🗑️ Effacer toutes les données')
    );

    box.append(
      h('div.set-sec', 'Installation'),
      h('div.note-card', isStandalone() ? h('p', '✅ CréaEngine est installé sur l\'écran d\'accueil et fonctionne hors ligne.') : h('ol', [h('li', 'Ouvre cette page dans Safari.'), h('li', 'Touche Partager ⬆︎.'), h('li', '« Sur l\'écran d\'accueil » → Ajouter.')]))
    );
    box.append(
      h('div.set-sec', 'À propos'),
      h('div.note-card', h('p', h('b', 'CréaEngine ' + VERSION)), h('p', 'Moteur de jeu 2D/3D inspiré de Unity, conçu pour l\'iPhone : éditeur de scène, physique, scripts JavaScript, particules, interface, export de jeux autonomes.'), h('p.set-sub', 'Rendu three.js • Physique cannon-es • Éditeur de code CodeMirror'))
    );
    c.append(box);
    void escapeHtml;
  }
}
