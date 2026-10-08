// Version de l'app et nouveautés affichées sur l'écran de mise à jour
// (ajouter une entrée en tête à chaque nouvelle version)

export const CHANGELOG = [
  {
    version: '1.3.0',
    notes: [
      'Nouveau héros 3D modélisé, riggé et animé dans Blender : repos, marche, course, saut, chute, danse (bouton B) et salut',
      'Le modèle « Monde 3D » utilise ce héros ; il est aussi dans ＋ → Personnages animés',
      'Import de tes propres modèles Blender (.glb) avec leurs animations : Projet → 📥 Importer',
      'Nouveaux composants Modèle 3D et Animator (Play, CrossFade…) + script « Animation d’un modèle 3D »',
      'La caméra dans la vue Scène est un petit modèle de 10 cm au lieu d’une grosse icône',
    ],
  },
  {
    version: '1.2.2',
    notes: [
      'Le champ de vision des caméras est toujours visible dans la vue Scène (lignes blanches, en jaune si la caméra est sélectionnée), même pendant le jeu',
      'Toucher une ligne du champ de vision sélectionne la caméra',
      'L’aperçu caméra se déplace : fais-le glisser où tu veux (il garde sa place)',
      'Menu ☰ → Champ de vision des caméras pour les masquer',
    ],
  },
  {
    version: '1.2.1',
    notes: [
      'Aperçu caméra : dans la vue Scène, une petite fenêtre montre en direct ce que voit la caméra (même pendant le jeu)',
      '⤢ agrandit l’aperçu, ✕ le réduit en une pastille 🎥, et toucher l’aperçu ouvre la vue Jeu',
      'Bouton 📍 : place la caméra pour qu’elle voie exactement comme la vue Scène',
    ],
  },
  {
    version: '1.2.0',
    notes: [
      'Bibliothèque de scripts : plus de 30 scripts prêts (perso qui marche, caméras, ennemis, pièces, vie, plateformes…)',
      'Personnages animés prêts à jouer : perso 3D, héros 2D, slime, ennemi 2D et voiture (＋ → Personnages animés)',
      'Nouveaux modèles : « Monde 3D » (balade dans un monde ouvert) et « Aventure 2D »',
    ],
  },
  {
    version: '1.1.1',
    notes: ['La version installée est affichée en haut des Réglages, dans le Hub et dans le menu ☰ de l\'éditeur'],
  },
  {
    version: '1.1.0',
    notes: [
      'Mises à jour automatiques : plus besoin de réinstaller',
      'En paysage, Hiérarchie, Inspecteur, Projet et Console à droite',
      'Les scripts des modèles se mettent à jour dans tes projets',
    ],
  },
  { version: '1.0.0', notes: ['Première version de CréaEngine'] },
];

export const APP_VERSION = CHANGELOG[0].version;
