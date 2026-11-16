// L'éditeur de dispos se comprend sans explication (16/11/2026) : une prof a
// écrit « les clics sur les dates ne fonctionnent pas, il n'y a aucun tableau ».
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import TeacherAvailabilityEditor from '../components/TeacherAvailabilityEditor';

describe('éditeur des disponibilités', () => {
  it('ouvre sur les horaires habituels, heures visibles tout de suite ; un clic écrit le modèle', () => {
    const onChange = vi.fn();
    render(<TeacherAvailabilityEditor value={{}} onChange={onChange} fuseau="America/Cayenne" />);
    expect(screen.getByRole('tab', { name: 'Mes horaires habituels' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText(/heure de Guyane \(UTC−3\)/)).toBeTruthy();
    const lundi = screen.getByText('Lundi').closest('li');
    fireEvent.click(within(lundi).getByRole('button', { name: '18 h' }));
    const ecrit = onChange.mock.calls.at(-1)[0];
    expect(ecrit.modele.Lun).toEqual([18]);
    expect(ecrit.fuseau).toBe('America/Cayenne');
  });

  it('raccourci « Bureau » : lundi → vendredi, 8 h par jour, sur le modèle', () => {
    const onChange = vi.fn();
    render(<TeacherAvailabilityEditor value={{}} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Bureau/ }));
    const { modele } = onChange.mock.calls.at(-1)[0];
    expect(modele.Ven).toEqual([8, 9, 10, 11, 14, 15, 16, 17]);
    expect(modele.Sam).toEqual([]);
  });

  it('semaine particulière : un clic sur une date l’annonce, la 1re modification copie le modèle', () => {
    const onChange = vi.fn();
    const value = { modele: { Lun: [9], Mar: [9], Mer: [9], Jeu: [9], Ven: [9], Sam: [9], Dim: [9] } };
    render(<TeacherAvailabilityEditor value={value} onChange={onChange} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Une semaine particulière' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mois suivant' }));
    fireEvent.click(screen.getAllByRole('button', { name: '15' })[0]);
    expect(screen.getByText(/: cochez vos heures ci-dessous\./)).toBeTruthy();
    expect(screen.getByText(/suit vos horaires habituels/)).toBeTruthy();
    const jeudi = screen.getByText('Jeudi').closest('li');
    fireEvent.click(within(jeudi).getByRole('button', { name: '18 h' }));
    const ecrit = onChange.mock.calls.at(-1)[0];
    const semaine = Object.keys(ecrit).find((k) => /^\d{4}-\d{2}-\d{2}$/.test(k));
    expect(ecrit[semaine].Jeu).toEqual([9, 18]);
    expect(ecrit[semaine].Lun).toEqual([9]);
    expect(ecrit.modele).toBe(value.modele);
  });
});
