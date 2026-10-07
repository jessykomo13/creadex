// Service worker de CréaEngine (généré par build.mjs) — fonctionnement hors ligne
const VERSION = 'f43b108066e1';
const LABEL = '1.1.0';
const NOTES = ["Mises à jour automatiques : plus besoin de réinstaller","En paysage, Hiérarchie, Inspecteur, Projet et Console à droite","Les scripts des modèles se mettent à jour dans tes projets"];
const CACHE = 'crea-engine-' + VERSION;
const ASSETS = ["./","index.html","style.css","manifest.webmanifest","dist/app.js","dist/player.js","icons/icon-192.png","icons/icon-512.png","icons/icon-maskable-512.png","icons/apple-touch-icon.png"];

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
  else if (e.data && e.data.type === 'info' && e.ports && e.ports[0]) e.ports[0].postMessage({ version: VERSION, label: LABEL, notes: NOTES });
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
