// Version de l'app et nouveautés affichées sur l'écran de mise à jour
// (ajouter une entrée en tête à chaque nouvelle version)

export const CHANGELOG = [
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
