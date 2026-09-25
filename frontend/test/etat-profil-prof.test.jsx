// Le bandeau d'état du prof s'affiche vraiment, avec le bon ton et le bon lien
// (plan docs/plans/PLAN_PROF_INVISIBLE_25-09-2026.md).
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { rendre } from './rendre';
import EtatProfilProf from '../components/EtatProfilProf';

describe('EtatProfilProf', () => {
  it('reste invisible quand le prof est réservable', () => {
    const { container } = rendre(
      <EtatProfilProf profil={{ avatarUrl: 'https://img/a.png', availability: { lundi: ['09:00'] } }} nbAvis={0} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('cas Aurélie : annonce la photo manquante et mène au profil', () => {
    rendre(<EtatProfilProf profil={{ avatarUrl: '', availability: { lundi: ['09:00'] } }} nbAvis={0} />);
    expect(screen.getByText(/n'apparaît pas encore dans les résultats/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /ajouter ma photo/i }).getAttribute('href')).toBe('/prof/profile');
  });

  it('affiche les deux manques à la fois, sans en cacher un', () => {
    rendre(<EtatProfilProf profil={{ avatarUrl: '', availability: {} }} nbAvis={0} />);
    expect(screen.getByRole('link', { name: /ajouter ma photo/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /ouvrir mes créneaux/i }).getAttribute('href')).toBe('/prof/planning');
    expect(screen.getByText(/n'est pas encore réservable/i)).toBeTruthy();
  });

  it('cas Durock : tarif visio manquant = alerte non bloquante', () => {
    rendre(
      <EtatProfilProf
        profil={{ avatarUrl: 'https://img/d.png', availability: { lundi: ['09:00'] }, visio_enabled: true, visio_price_per_hour: '' }}
        nbAvis={0}
      />,
    );
    expect(screen.getByText(/vous fait perdre des réservations/i)).toBeTruthy();
    expect(screen.queryByText(/n'est pas encore réservable/i)).toBeNull();
  });
});
