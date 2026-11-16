// Côté famille : horaires habituels du prof, affichés à l'heure de la famille (16/11/2026).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BookingModal from '../components/BookingModal';

describe('réservation : horaires habituels + fuseaux', () => {
  it('prof en Guyane, 18 h chaque lundi → famille en Martinique voit 17 h ; le créneau garde l’heure du prof', () => {
    const onBook = vi.fn();
    render(
      <BookingModal
        availability={{ modele: { Lun: [18] }, fuseau: 'America/Cayenne' }}
        fuseauFamille="America/Martinique"
        onBook={onBook}
        onClose={() => {}}
        multiSelect={false}
      />,
    );
    expect(screen.getByText(/l'heure de chez vous \(Martinique\)/)).toBeTruthy();
    const cases = screen.getAllByTitle('Disponible : 17 h chez vous · 18 h pour le prof');
    expect(cases.length).toBe(1); // un lundi par semaine affichée
    fireEvent.click(cases[0]);
    expect(screen.getByText(/17 h chez vous · 18 h pour le prof/, { selector: 'li' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Réserver ce créneau' }));
    const slot = onBook.mock.calls[0][0];
    expect(slot).toMatchObject({ day: 'Lun', hour: 18, fuseau_prof: 'America/Cayenne' });
    expect(new Date(slot.start_utc).getUTCHours()).toBe(21); // 18 h Guyane = 21 h UTC
    expect(slot.week).toBe(slot.date); // lundi
  });

  it('même fuseau : rien ne change pour la famille (pas de bandeau)', () => {
    render(
      <BookingModal availability={{ modele: { Mar: [10] }, fuseau: 'America/Cayenne' }} fuseauFamille="America/Cayenne" onBook={() => {}} onClose={() => {}} />,
    );
    expect(screen.queryByText(/l'heure de chez vous/)).toBeNull();
    expect(screen.getAllByTitle('Disponible : 10 h chez vous').length).toBe(1);
  });
});
