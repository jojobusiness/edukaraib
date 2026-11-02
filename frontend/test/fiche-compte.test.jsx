// Fiche d'un compte dans l'admin (02/11/2026).
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { rendre } from './rendre';

const fetchWithAuth = vi.hoisted(() => vi.fn());
vi.mock('../utils/fetchWithAuth', () => ({ default: fetchWithAuth, fetchWithAuth }));
const { default: FicheCompte } = await import('../components/admin/FicheCompte');

const base = {
  compte: { uid: 'u1', role: 'teacher', nom: 'Durock Jean Louis', photo: 'a.png', email: 'd@x.fr', emailVerifie: true, telephone: '0694', ville: 'Matoury', creeLe: '2026-03-01T10:00:00Z', derniereVenue: '2026-10-25T10:00:00Z' },
  cours: { total: 5, termines: 3, aVenir: 1, enAttente: 1, refuses: 0 },
  paiements: { nb: 3, paye: 0, gagne: 75, rembourses: 0 },
  enfants: [], avis: { nb: 2, moyenne: 5 }, coupons: [],
  prof: { matieres: 'Maths', tarif: 20, tarifVisio: 20, presentiel: true, visible: true, creneauxAVenir: 0, stripePret: true },
};

describe('FicheCompte', () => {
  it('montre photo, cours, gains, dernière venue et état prof', async () => {
    fetchWithAuth.mockResolvedValue(base);
    rendre(<FicheCompte uid="u1" onClose={() => {}} />);
    expect(await screen.findByText('Durock Jean Louis')).toBeTruthy();
    expect(screen.getByText('cours donnés')).toBeTruthy();
    expect(screen.getByText('75,00 €')).toBeTruthy();
    expect(screen.getByText(/Dernière venue/)).toBeTruthy();
    expect(screen.getByText('oui (Stripe)')).toBeTruthy();
  });
  it('un parent voit ses enfants, pas de bloc prof', async () => {
    fetchWithAuth.mockResolvedValue({ ...base, compte: { ...base.compte, role: 'parent', nom: 'Parent Test' }, prof: null, enfants: [{ id: 'e', nom: 'Léa', niveau: 'CM2' }] });
    rendre(<FicheCompte uid="u2" onClose={() => {}} />);
    expect(await screen.findByText('Léa')).toBeTruthy();
    expect(screen.queryByText('Côté prof')).toBeNull();
  });
  it('erreur serveur : message lisible', async () => {
    fetchWithAuth.mockRejectedValue(new Error('NOT_FOUND'));
    rendre(<FicheCompte uid="x" onClose={() => {}} />);
    expect(await screen.findByText('NOT_FOUND')).toBeTruthy();
  });
});
