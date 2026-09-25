// « Le prof ne sait pas qu'il est invisible » (plan du 25/09/2026).
// La règle affichée au prof doit être EXACTEMENT celle qu'appliquent les
// landings et diag-offre-profs.mjs : offer_enabled !== false ET (photo OU ≥1
// avis) ET au moins un créneau. Les trois derniers cas sont les trois profs
// réels qui ont déclenché le ticket.
import { describe, it, expect } from 'vitest';
import { etatProfil, nbCreneaux, estReservable } from './offreProf';

const codes = (profil, nbAvis = 0) => etatProfil({ profil, nbAvis }).map((m) => m.code);

describe('nbCreneaux — les deux formats présents en base', () => {
  it('compte un tableau, un objet jour → créneaux, et le vide', () => {
    expect(nbCreneaux([{ jour: 'Lun' }, { jour: 'Mar' }])).toBe(2);
    expect(nbCreneaux({ lundi: ['09:00', '10:00'], mardi: ['14:00'] })).toBe(3);
    expect(nbCreneaux({})).toBe(0);
    expect(nbCreneaux([])).toBe(0);
    expect(nbCreneaux(undefined)).toBe(0);
  });
});

describe('etatProfil', () => {
  const complet = { avatarUrl: 'https://img/a.png', availability: { lundi: ['09:00', '10:00'] } };

  it('1. profil complet → rien à afficher', () => {
    expect(codes(complet)).toEqual([]);
    expect(estReservable({ profil: complet })).toBe(true);
  });

  it('2. profil masqué → masque', () => {
    expect(codes({ ...complet, offer_enabled: false })).toContain('masque');
  });

  it('3. pas de photo et 0 avis → photo', () => {
    expect(codes({ ...complet, avatarUrl: '' })).toContain('photo');
  });

  it('4. pas de photo mais 3 avis → pas de photo demandée (le OU du filtre)', () => {
    expect(codes({ ...complet, avatarUrl: '' }, 3)).not.toContain('photo');
  });

  it('5. aucun créneau, dans les deux formats → creneaux', () => {
    expect(codes({ ...complet, availability: {} })).toContain('creneaux');
    expect(codes({ ...complet, availability: [] })).toContain('creneaux');
  });

  it('6. des créneaux, dans les deux formats → rien à signaler', () => {
    expect(codes({ ...complet, availability: { lundi: ['09:00'] } })).not.toContain('creneaux');
    expect(codes({ ...complet, availability: [{ jour: 'Lun', heure: 9 }] })).not.toContain('creneaux');
  });

  it('7. visio activée sans tarif → visioPrix', () => {
    expect(codes({ ...complet, visio_enabled: true, visio_price_per_hour: '' })).toContain('visioPrix');
  });

  it('8. visio au même tarif que le présentiel → rien à signaler', () => {
    expect(codes({ ...complet, visio_enabled: true, visio_same_rate: true })).not.toContain('visioPrix');
  });

  it('9. cas Aurélie ARCON : 3 créneaux, pas de photo → seulement la photo', () => {
    expect(codes({ avatarUrl: '', availability: { lundi: ['09:00'], mardi: ['10:00', '11:00'] } })).toEqual(['photo']);
  });

  it('10. cas Belgica Alfaro : photo, 0 créneau → seulement les créneaux', () => {
    expect(codes({ avatarUrl: 'https://img/b.png', availability: {} })).toEqual(['creneaux']);
  });

  it('11. cas Durock : réservable, mais tarif visio manquant → alerte non bloquante', () => {
    const durock = {
      avatarUrl: 'https://img/d.png',
      availability: { lundi: ['09:00'], mardi: ['09:00'], mercredi: ['09:00'], jeudi: ['09:00'], vendredi: ['09:00'] },
      visio_enabled: true,
      visio_same_rate: false,
      visio_price_per_hour: '',
    };
    expect(codes(durock)).toEqual(['visioPrix']);
    expect(etatProfil({ profil: durock }).every((m) => !m.bloquant)).toBe(true);
    expect(estReservable({ profil: durock })).toBe(true);
  });

  it('cumule les manques sans en cacher un seul', () => {
    expect(codes({ offer_enabled: false, avatarUrl: '', availability: {} })).toEqual(['masque', 'photo', 'creneaux']);
  });

  it('ne plante pas sur un profil vide', () => {
    expect(() => etatProfil({})).not.toThrow();
    expect(codes(undefined)).toEqual(['photo', 'creneaux']);
  });
});
