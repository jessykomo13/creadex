// Service worker de CréaEngine (généré par build.mjs) — fonctionnement hors ligne
const VERSION = 'e0081bdf13fe';
const LABEL = '1.3.0';
const NOTES = ["Nouveau héros 3D modélisé, riggé et animé dans Blender : repos, marche, course, saut, chute, danse (bouton B) et salut","Le modèle « Monde 3D » utilise ce héros ; il est aussi dans ＋ → Personnages animés","Import de tes propres modèles Blender (.glb) avec leurs animations : Projet → 📥 Importer","Nouveaux composants Modèle 3D et Animator (Play, CrossFade…) + script « Animation d’un modèle 3D »","La caméra dans la vue Scène est un petit modèle de 10 cm au lieu d’une grosse icône"]; // nouveautés de la dernière version (texte)
const CHANGELOG = [{"version":"1.3.0","notes":["Nouveau héros 3D modélisé, riggé et animé dans Blender : repos, marche, course, saut, chute, danse (bouton B) et salut","Le modèle « Monde 3D » utilise ce héros ; il est aussi dans ＋ → Personnages animés","Import de tes propres modèles Blender (.glb) avec leurs animations : Projet → 📥 Importer","Nouveaux composants Modèle 3D et Animator (Play, CrossFade…) + script « Animation d’un modèle 3D »","La caméra dans la vue Scène est un petit modèle de 10 cm au lieu d’une grosse icône"]},{"version":"1.2.2","notes":["Le champ de vision des caméras est toujours visible dans la vue Scène (lignes blanches, en jaune si la caméra est sélectionnée), même pendant le jeu","Toucher une ligne du champ de vision sélectionne la caméra","L’aperçu caméra se déplace : fais-le glisser où tu veux (il garde sa place)","Menu ☰ → Champ de vision des caméras pour les masquer"]},{"version":"1.2.1","notes":["Aperçu caméra : dans la vue Scène, une petite fenêtre montre en direct ce que voit la caméra (même pendant le jeu)","⤢ agrandit l’aperçu, ✕ le réduit en une pastille 🎥, et toucher l’aperçu ouvre la vue Jeu","Bouton 📍 : place la caméra pour qu’elle voie exactement comme la vue Scène"]},{"version":"1.2.0","notes":["Bibliothèque de scripts : plus de 30 scripts prêts (perso qui marche, caméras, ennemis, pièces, vie, plateformes…)","Personnages animés prêts à jouer : perso 3D, héros 2D, slime, ennemi 2D et voiture (＋ → Personnages animés)","Nouveaux modèles : « Monde 3D » (balade dans un monde ouvert) et « Aventure 2D »"]},{"version":"1.1.1","notes":["La version installée est affichée en haut des Réglages, dans le Hub et dans le menu ☰ de l'éditeur"]},{"version":"1.1.0","notes":["Mises à jour automatiques : plus besoin de réinstaller","En paysage, Hiérarchie, Inspecteur, Projet et Console à droite","Les scripts des modèles se mettent à jour dans tes projets"]},{"version":"1.0.0","notes":["Première version de CréaEngine"]}]; // historique complet
const CACHE = 'crea-engine-' + VERSION;
const ASSETS = ["./","index.html","style.css","manifest.webmanifest","dist/app.js","dist/player.js","icons/icon-192.png","icons/icon-512.png","icons/icon-maskable-512.png","icons/apple-touch-icon.png","assets/heros.glb"];

self.addEventListener('install', (e) => {
  // « reload » : toujours télécharger les fichiers frais, jamais ceux du cache HTTP
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('crea-engine-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skip') self.skipWaiting();
  else if (e.data && e.data.type === 'info' && e.ports && e.ports[0]) e.ports[0].postMessage({ version: VERSION, label: LABEL, notes: NOTES, changelog: CHANGELOG });
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // la page : depuis le cache (version cohérente), réseau en secours
    e.respondWith(caches.match('index.html', { ignoreSearch: true }).then((r) => r || fetch(req)));
    return;
  }
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (r) =>
        r ||
        fetch(req).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
    )
  );
});
