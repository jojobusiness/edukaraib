// Test de fumée : monte CHAQUE page de l'application et échoue si l'une plante.
//
// Pourquoi ce test existe — incident Factur'Peyi du 29/07/2026 : un composant
// était utilisé dans le JSX de 4 pages sans être importé. `vite build` ET
// `eslint` étaient verts, et deux pages affichaient une page blanche EN
// PRODUCTION pendant 24 h. **Un build vert ne prouve pas qu'une page s'affiche.**
// EduKaraib n'avait aucun test : ce fichier ferme le trou (harmonisation 01/08/2026).
//
// Les pages sont découvertes automatiquement, sous-dossiers compris : toute
// nouvelle page est couverte sans rien ajouter ici.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rendre } from './rendre';

const modules = import.meta.glob('../pages/**/*.jsx');

/**
 * Pages exclues, avec la raison. Une exclusion doit TOUJOURS être justifiée :
 * sinon on retire silencieusement la couverture de ce qu'on ne sait pas tester.
 */
const EXCLUSIONS = {
  // Aucune pour le moment.
};

describe('Toutes les pages se montent sans planter', () => {
  beforeEach(() => {
    // Une page qui plante logue via console.error : on veut voir la vraie cause
    // dans la sortie du test, pas seulement l'échec de l'assertion.
    vi.spyOn(console, 'error').mockImplementation((...args) => {
      console.warn('[erreur pendant le rendu]', ...args);
    });
  });

  for (const [chemin, charger] of Object.entries(modules)) {
    // « ../pages/seo/CoursMaths.jsx » -> « seo/CoursMaths »
    const nom = chemin.replace('../pages/', '').replace(/\.jsx$/, '');
    const raison = EXCLUSIONS[nom];

    (raison ? it.skip : it)(`${nom} s'affiche`, async () => {
      const mod = await charger();
      const Page = mod.default;

      // Une page sans export par défaut ne serait jamais rendue par le routeur.
      expect(Page, `${nom} n'exporte pas de composant par défaut`).toBeTypeOf('function');

      // Le rendu ne doit lever aucune exception : c'est tout l'objet du test.
      expect(() => rendre(<Page />)).not.toThrow();
    });
  }
});
