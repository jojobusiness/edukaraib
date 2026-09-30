// La barre du haut (30/09/2026) : un seul bouton « Nous contacter » qui mène à
// la page Contact, et « Connexion » à droite. ⛔ Plus de bandeau vert, plus de
// « Donner des cours » dans la barre.
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { rendre } from './rendre';
import Navbar from '../components/Navbar';
import { lienWhatsapp, EMAIL_CONTACT } from '../lib/contact';

describe('Navbar', () => {
  it('propose « Nous contacter » vers la page Contact', () => {
    rendre(<Navbar />);
    expect(screen.getByRole('link', { name: /nous contacter/i }).getAttribute('href')).toBe('/contact');
  });

  it("n'affiche plus « Donner des cours » ni de lien WhatsApp direct", () => {
    const { container } = rendre(<Navbar />);
    expect(screen.queryByRole('link', { name: /donner des cours/i })).toBeNull();
    expect(container.querySelector('a[href^="https://wa.me/"]')).toBeNull();
  });

  it('garde une action de compte à droite du bouton de contact', () => {
    rendre(<Navbar />);
    const compte = screen.queryByRole('link', { name: /connexion/i })
      || screen.queryByRole('button', { name: /mon compte|…/i });
    expect(compte).toBeTruthy();
  });
});

describe('Coordonnées publiques', () => {
  it('pointent vers le bon mail et le bon numéro WhatsApp', () => {
    expect(EMAIL_CONTACT).toBe('contact@edukaraib.com');
    expect(lienWhatsapp()).toContain('https://wa.me/33766437668');
    expect(lienWhatsapp()).toContain('text=');
  });
});
