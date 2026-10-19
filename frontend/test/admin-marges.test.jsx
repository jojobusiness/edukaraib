// « 💶 Ce que les paiements nous laissent » — onglet Paiements & Revenus
// (18/10/2026, déplacé depuis Diagnostics le 19/10). Le prof touche 100 % de
// son tarif ; ce bloc doit nommer les paiements où notre commission n'a pas
// couvert les frais Stripe — sans jamais rien bloquer.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { rendre } from './rendre';

const fetchWithAuth = vi.hoisted(() => vi.fn());
vi.mock('../utils/fetchWithAuth', () => ({ default: fetchWithAuth, fetchWithAuth }));

const { default: MargesSection } = await import('../components/admin/MargesSection');

const RELEVE = {
  genere_le: '2026-10-19T10:00:00.000Z',
  nbPaiements: 2, estimes: 1, encaisse: 60, verseProfs: 50, commission: 10,
  fraisStripe: 1.41, fraisVirement: 0, net: -0.41, comptesActifsCeMois: 1, coutComptesActifs: 2,
  negatifs: [{
    id: 'pay1', date: '2026-10-17T10:00:00.000Z', prof: 'Durock Jean Louis', methode: 'carte_eee',
    estime: true, rembourse: false, brut: 25, partProf: 25, commission: 0, fraisStripe: 0.63, net: -0.63,
  }],
};

describe('MargesSection', () => {
  beforeEach(() => fetchWithAuth.mockReset());

  it('🚨 nomme les paiements qui nous ont coûté plus qu’ils n’ont rapporté', async () => {
    fetchWithAuth.mockResolvedValue(RELEVE);
    rendre(<MargesSection />);
    await screen.findByText(/Ce que les paiements nous laissent/i);
    // Le prof a bien touché ses 25 € : c'est notre commission qui est à zéro.
    expect(screen.getByText(/1 paiement à perte/i)).toBeTruthy();
    expect(screen.getByText('-0,63 €')).toBeTruthy();
    expect(screen.getByText('Durock Jean Louis')).toBeTruthy();
    expect(fetchWithAuth).toHaveBeenCalledWith('/api/admin-marges');
  });

  it('dit clairement quand aucun paiement n’est à perte', async () => {
    fetchWithAuth.mockResolvedValue({ ...RELEVE, net: 9.22, negatifs: [] });
    rendre(<MargesSection />);
    expect(await screen.findByText(/Aucun paiement à perte/i)).toBeTruthy();
  });
});
