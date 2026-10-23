// Fenêtres maison qui remplacent alert/confirm/prompt (23/10/2026).
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { DialoguesHote, confirmer, demanderTexte } from '../components/ui/Dialogues';

describe('Dialogues', () => {
  it('confirmer : true sur le bouton, false sur Annuler', async () => {
    render(<DialoguesHote />);
    let p;
    act(() => { p = confirmer({ titre: 'Supprimer ce document ?', libelleConfirmer: 'Supprimer', danger: true }); });
    fireEvent.click(await screen.findByRole('button', { name: 'Supprimer' }));
    await expect(p).resolves.toBe(true);
    act(() => { p = confirmer('Continuer ?'); });
    fireEvent.click(await screen.findByRole('button', { name: 'Annuler' }));
    await expect(p).resolves.toBe(false);
  });
  it('demanderTexte : renvoie la saisie, champ masqué pour un mot de passe', async () => {
    render(<DialoguesHote />);
    let p;
    act(() => { p = demanderTexte({ titre: 'Confirmez votre mot de passe', motDePasse: true }); });
    const champ = await screen.findByRole('dialog');
    const input = champ.querySelector('input');
    expect(input.type).toBe('password');
    fireEvent.change(input, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
    await expect(p).resolves.toBe('secret');
  });
  it('Échap annule une saisie (null)', async () => {
    render(<DialoguesHote />);
    let p;
    act(() => { p = demanderTexte({ titre: 'Motif' }); });
    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' });
    await expect(p).resolves.toBeNull();
  });
});
