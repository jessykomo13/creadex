// Version de l'app et nouveautés affichées sur l'écran de mise à jour
// (ajouter une entrée en tête à chaque nouvelle version)

export const CHANGELOG = [
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
