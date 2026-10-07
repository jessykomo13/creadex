# CréaEngine — moteur de jeu façon Unity pour iPhone

Application web installable (PWA) qui s'ajoute à l'écran d'accueil de l'iPhone et fonctionne hors ligne.

## Contenu

- **Hub** : liste des projets (miniatures), 6 modèles (3D vide, 2D vide, Balle roulante 3D, Plateforme 2D, Shooter spatial, Bac à sable physique), import/export, tutoriels, référence de l'API, réglages.
- **Éditeur** : vues Scène / Jeu, gizmos tactiles (déplacer, tourner, échelle, magnétisme, global/local), vue 2D/3D, Hiérarchie (glisser-déposer pour changer de parent), Inspecteur (champs glissables façon Unity), Projet (scènes, scripts, prefabs, images, sons), Console (renvoi vers la ligne fautive), annuler/rétablir, sauvegarde automatique, disposition en colonnes sur iPad ou en paysage.
- **Éditeur de code** (CodeMirror) : coloration, autocomplétion de l'API, détection d'erreurs en direct, recherche/remplacement, barre de touches au-dessus du clavier iPhone (Tab, { } ( ) ; = …).
- **Moteur** : rendu three.js (ombres, ciel, brouillard), physique cannon-es (Rigidbody, colliders, déclencheurs, raycasts), scripts JavaScript avec API Unity (MonoBehaviour, Start/Update/FixedUpdate, OnCollisionEnter, OnTriggerEnter, coroutines, Instantiate/Destroy, prefabs, SceneManager, PlayerPrefs…), joystick virtuel + boutons A/B, particules, traînées, UI (textes, boutons, barres), sons synthétisés ou importés.
- **Build** : Build & Run en plein écran, export du jeu en fichier HTML autonome jouable hors ligne, export du projet en JSON.

## Développement

```sh
cd engine
npm install
npm run build      # génère dist/app.js, dist/player.js et sw.js
python3 -m http.server 8080   # puis ouvrir http://localhost:8080/
```

Les fichiers `dist/` et `sw.js` sont générés mais commités : le dossier `engine/` est servi tel quel (GitHub Pages).
