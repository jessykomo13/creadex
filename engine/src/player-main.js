// Point d'entrée des jeux exportés (fichier HTML autonome)

import { runPlayer } from './player-core.js';

window.CreaPlayer = {
  boot(project) {
    const go = () => runPlayer(project, { startScreen: true, closable: false });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
    else go();
  },
};
