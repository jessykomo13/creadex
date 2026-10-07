# Consignes pour ce dépôt

## CréaEngine (`engine/`)

- À chaque modification livrée de CréaEngine :
  1. incrémenter la version dans `engine/src/version.js` (nouvelle entrée en tête de `CHANGELOG`, avec les nouveautés en français simple) ;
  2. reconstruire avec `cd engine && npm run build` et commiter `dist/`, `index.html` et `sw.js` ;
  3. pousser sur la branche servie par GitHub Pages (`claude/unity-iphone-engine`) ;
  4. **terminer le message à l'utilisateur en indiquant le numéro de version** (celui qu'il verra dans Réglages → Version installée).
- Les projets de l'utilisateur sont dans IndexedDB : ne jamais casser la compatibilité (`normalizeProject` met à niveau les anciens projets).
- L'utilisateur parle français et teste sur iPhone (app installée sur l'écran d'accueil).
