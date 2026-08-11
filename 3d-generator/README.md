# CréaDex 3D — Générateur IA (image → 3D / texte → 3D)

Petite application web pour importer une image ou écrire un texte, générer un
modèle 3D correspondant via une IA externe, le prévisualiser en 3D dans le
navigateur (Three.js) et le télécharger en `.glb` pour l'utiliser dans un jeu.

## ⚠️ Important : ce n'est pas un moteur d'IA 3D "maison"

Cette application **n'entraîne pas** et **ne fait pas tourner** de modèle de
génération 3D localement — ça nécessiterait des GPU et une infrastructure
massive, hors de portée d'un environnement de développement classique.

Elle sert de **client/orchestrateur** : elle envoie ta demande (image ou
texte) à un service tiers qui possède réellement un modèle de génération 3D
entraîné, attend le résultat, puis l'affiche.

Deux providers sont déjà câblés :

- **Replicate** (`PROVIDER=replicate`) — héberge des modèles open-source
  (TripoSR, Stable Fast 3D, Shap-E...). Tu choisis le modèle exact via l'ID de
  version dans `.env`.
- **Meshy** (`PROVIDER=meshy`) — l'API officielle de meshy.ai.

Le code est écrit pour qu'on puisse ajouter facilement un autre provider
(`src/providers/<nom>.js`, même interface que les deux existants).

## Installation

```bash
cd 3d-generator
npm install
cp .env.example .env
```

Édite `.env` :

```env
PROVIDER=replicate
API_KEY=ta_cle_api
REPLICATE_IMAGE_TO_3D_VERSION=xxxxxxxx   # ID de version du modèle image->3D sur Replicate
REPLICATE_TEXT_TO_3D_VERSION=xxxxxxxx    # ID de version du modèle texte->3D sur Replicate
```

Pour trouver un ID de version Replicate : va sur la page du modèle choisi
(ex: `replicate.com/camenduru/tripo-sr` ou équivalent), onglet "API", tu y
trouveras la valeur `version`.

Pour Meshy, mets `PROVIDER=meshy` et `API_KEY=` ta clé depuis
[app.meshy.ai](https://app.meshy.ai) (Settings → API).

## Lancer

```bash
npm start
```

Puis ouvre `http://localhost:3000`.

## Utilisation sur mobile

L'app est responsive (mise en page adaptée aux petits écrans, cibles tactiles
≥ 44px, viewer 3D en priorité en haut sur mobile) et peut être "installée"
comme une app via **Ajouter à l'écran d'accueil** (manifest + icône fournis).

### Tester depuis ton téléphone dès maintenant (sans déploiement)

1. Lance le serveur sur ton ordi : `npm start`
2. Trouve l'IP locale de ton ordi (même réseau Wi-Fi que le téléphone) :
   - macOS/Linux : `ipconfig getifaddr en0` ou `hostname -I`
   - Windows : `ipconfig` (champ "Adresse IPv4")
3. Sur le téléphone, ouvre `http://<IP-de-ton-ordi>:3000` (ex: `http://192.168.1.23:3000`)
4. Depuis Safari (iOS) ou Chrome (Android) : menu → **Ajouter à l'écran d'accueil**
   pour un lancement en plein écran comme une vraie app.

⚠️ Le mode "Image → 3D" restera bloqué en local (voir section suivante) tant
que le serveur n'est pas accessible publiquement — le mode "Texte → 3D"
fonctionne déjà tel quel en réseau local.

### Pour un accès mobile permanent (pas juste sur le même Wi-Fi)

Déploie le serveur sur un hébergeur public (Render, Fly.io, Railway...), le
téléphone y accédera alors via l'URL publique, de n'importe où — et ça règle
en même temps la contrainte "image publique" ci-dessous. Dis-moi si tu veux
que je prépare la config de déploiement pour un hébergeur en particulier.

## Limite connue : image publique requise

Certains providers (dont Replicate) exigent une URL d'image **accessible
publiquement** pour le mode image→3D. En local (`localhost`), l'image
uploadée n'est joignable que depuis ta machine : le provider distant ne
pourra pas la télécharger.

Pour que le mode "Image → 3D" fonctionne en dehors d'un simple test local,
déploie l'app sur un serveur public (Render, Fly.io, VPS...) ou remplace le
stockage local par un service de stockage public (S3, Cloudinary...) dans
`src/server.js`.

Le mode "Texte → 3D" n'a pas cette contrainte et fonctionne dès que la clé
API est valide.

## Utiliser le résultat dans un jeu

Le `.glb` généré est un format standard glTF binaire, directement
compatible avec :

- **Three.js** (`GLTFLoader`, comme dans le viewer de cette app)
- **Babylon.js** (`SceneLoader.ImportMesh`)
- **Unity** (via un plugin glTF, ou conversion `.fbx`)
- **Godot** (import natif de `.glb` depuis Godot 4)
- **Blender**, pour retoucher/optimiser avant export (réduction de polys,
  nettoyage UV, export vers un autre format) — en mode headless :

```bash
blender --background --python nettoyage.py -- modele.glb modele_optimise.glb
```

## Structure du projet

```
3d-generator/
├── public/           # frontend (viewer Three.js)
│   ├── index.html
│   └── app.js
├── src/
│   ├── server.js      # serveur Express : upload, appel provider, polling
│   └── providers/
│       ├── index.js
│       ├── replicate.js
│       └── meshy.js
├── uploads/           # images uploadées temporairement
├── .env.example
└── package.json
```
