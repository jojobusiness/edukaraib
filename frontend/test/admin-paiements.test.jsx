// Onglet « Paiements & Revenus » refait le 19/10/2026. L'ancien affichait 0
// partout (champs morts). Ce test monte l'écran sur de vrais documents
// `payments` tels que les écrit le webhook.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { getDocs } from 'firebase/firestore';
import { rendre } from './rendre';

const fetchWithAuth = vi.hoisted(() => vi.fn());
vi.mock('../utils/fetchWithAuth', () => ({ default: fetchWithAuth, fetchWithAuth }));

const { default: PaiementsSection } = await import('../components/admin/PaiementsSection');

const snap = (docs) => ({ docs: docs.map((d) => ({ id: d.id, data: () => d })), size: docs.length, empty: !docs.length });
const USERS = [
  { id: 'prof1', fullName: 'Durock Jean Louis', stripeAccountId: 'acct_1', stripeChargesEnabled: true },
  { id: 'prof2', fullName: 'Aurélie ARCON' },
  { id: 'fam1', fullName: 'Famille Test' },
];
const PAIEMENTS = [
  { id: 'a', status: 'released', gross_eur: 35, fee_eur: 10, net_to_teacher_eur: 25, teacher_uid: 'prof1', payer_uid: 'fam1', created_at: new Date('2026-10-10') },
  { id: 'b', status: 'payout_pending_rib', gross_eur: 45, fee_eur: 10, net_to_teacher_eur: 35, teacher_uid: 'prof2', payer_uid: 'fam1', created_at: new Date('2026-10-12') },
  { id: 'c', status: 'pending', gross_eur: 99, fee_eur: 10, net_to_teacher_eur: 89, teacher_uid: 'prof1', created_at: new Date('2026-10-13') },
];

describe('PaiementsSection', () => {
  beforeEach(() => {
    fetchWithAuth.mockReset();
    // MargesSection, montée en tête de l'onglet
    fetchWithAuth.mockResolvedValue({ nbPaiements: 0, estimes: 0, encaisse: 0, verseProfs: 0, fraisStripe: 0, fraisVirement: 0, net: 0, coutComptesActifs: 0, negatifs: [] });
    getDocs.mockResolvedValue(snap(PAIEMENTS));
  });

  it('affiche les vrais montants au lieu de 0', async () => {
    rendre(<PaiementsSection users={USERS} onRembourser={() => {}} />);
    // 35 + 45 encaissés ; le paiement non finalisé (99 €) est exclu
    expect(await screen.findByText('80,00 €')).toBeTruthy();
    expect(screen.getByText('Encaissé (2 paiements)')).toBeTruthy();
    expect(screen.queryByText('99,00 €')).toBeNull();
  });

  it("met en avant l'argent dû au prof, avec le versement Stripe", async () => {
    rendre(<PaiementsSection users={USERS} onRembourser={() => {}} />);
    expect(await screen.findByText(/Argent qu'on doit aux profs/)).toBeTruthy();
    // Aurélie n'a pas connecté Stripe : le bouton est désactivé
    const bouton = screen.getByRole('button', { name: 'Verser via Stripe' });
    expect(bouton.disabled).toBe(true);
    expect(screen.getByText('pas encore connecté')).toBeTruthy();
  });

  it('propose le remboursement sur un paiement versé', async () => {
    rendre(<PaiementsSection users={USERS} onRembourser={() => {}} />);
    await screen.findByText('Encaissé (2 paiements)');
    expect(screen.getAllByRole('button', { name: 'Rembourser' })).toHaveLength(1);
  });
});
