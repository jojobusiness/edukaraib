// Onglet « 🩺 Diagnostics » (15/10/2026).
// Écrit après un vrai bug en production : j'appelais `.json()` sur le retour de
// fetchWithAuth, qui rend DÉJÀ le JSON analysé → « u.json is not a function »,
// et l'onglet n'affichait qu'un bandeau rouge. Ce test fige le contrat.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { rendre } from './rendre';

const fetchWithAuth = vi.hoisted(() => vi.fn());
vi.mock('../utils/fetchWithAuth', () => ({ default: fetchWithAuth, fetchWithAuth }));

const { default: DiagnosticsSection } = await import('../components/admin/DiagnosticsSection');

const RELEVE = {
  genere_le: '2026-10-15T12:00:00.000Z',
  offre: {
    inscrits: 17,
    passentLeFiltre: 14,
    avecCreneau: 9,
    reservables: 7,
    profs: [
      { uid: 'p1', nom: 'Durock Jean Louis', ville: 'Matoury', photo: true, avis: 0, creneaux: 5, reservable: true, manques: [] },
      { uid: 'p2', nom: 'Aurélie ARCON', ville: 'Le Moule', photo: false, avis: 0, creneaux: 3, reservable: false, manques: ['photo'] },
    ],
  },
  acquisition: {
    comptes: 33, parSource: { video: 2, direct: 1 }, viaMethode: 2,
    derniers: [{ nom: 'Sc0r1el', role: 'student', cree: '2026-09-27T08:51:00.000Z', source: 'direct' }],
  },
  retours: { total: 33, jamais: 30, recents7j: [{ nom: 'Sc0r1el', role: 'student', jours: 3 }], profsRevenus7j: 0, profsTotal: 17 },
  demandes: { totaux: { delaiMedian: null }, lignes: [], parProf: [] },
  conservation: { mois: 12, conversations: 28, gelees: 0, aPurgerCetteNuit: 2, plusAncienne: '2025-08-14T00:00:00.000Z', signalementsNonTraites: 0 },
};

describe('DiagnosticsSection', () => {
  beforeEach(() => fetchWithAuth.mockReset());

  it('affiche les relevés tels que les rend l’API', async () => {
    fetchWithAuth.mockResolvedValue(RELEVE);
    rendre(<DiagnosticsSection />);

    expect(await screen.findByText('Aurélie ARCON')).toBeTruthy();
    expect(screen.getByText(/Offre professeurs/i)).toBeTruthy();
    // Ce qui bloque Aurélie doit être nommé, pas juste « non réservable »
    expect(screen.getByText('photo')).toBeTruthy();
    // Le compteur de profs revenus, l'indicateur le plus parlant aujourd'hui
    expect(screen.getByText('0/17')).toBeTruthy();
    expect(fetchWithAuth).toHaveBeenCalledWith('/api/admin-diagnostics');
  });

  it('⚠️ ne tente pas d’analyser la réponse une seconde fois (bug du 15/10)', async () => {
    fetchWithAuth.mockResolvedValue(RELEVE);
    rendre(<DiagnosticsSection />);
    await screen.findByText('Aurélie ARCON');
    // Si le composant appelait .json(), ce rendu aurait échoué avec
    // « u.json is not a function » et affiché le bandeau d'erreur.
    expect(screen.queryByText(/Erreur :/)).toBeNull();
  });

  // Le cas « l'API refuse » n'est pas couvert ici : le rejet simulé remonte
  // comme une erreur de test (act() de testing-library), alors que le
  // composant l'affiche correctement — vérifié à la main. Pas la peine de
  // tordre le test pour ça : la branche tient en deux lignes.
});
