// Contact en haut du site (30/09/2026) : mail + WhatsApp dans le bandeau, et
// un bouton « Nous écrire » dans la barre, à côté de Connexion / Mon compte.
// Un numéro cassé ou un lien perdu ne se voit pas à l'œil : on le verrouille.
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { rendre } from './rendre';
import BandeauContact from '../components/BandeauContact';
import Navbar from '../components/Navbar';

const NUMERO = '33766437668';

describe('BandeauContact', () => {
  it('propose le mail et le WhatsApp du bon numéro', () => {
    rendre(<BandeauContact />);
    expect(screen.getByRole('link', { name: /contact@edukaraib\.com/ }).getAttribute('href'))
      .toBe('mailto:contact@edukaraib.com');
    const wa = screen.getByRole('link', { name: /whatsapp/i }).getAttribute('href');
    expect(wa).toContain(`https://wa.me/${NUMERO}`);
    expect(wa).toContain('text=');
  });
});

describe('Navbar', () => {
  it('affiche le bandeau et un bouton « Nous écrire » à côté des actions de compte', () => {
    rendre(<Navbar />);
    // Le bandeau du haut + le bouton de la barre = deux liens WhatsApp
    const liens = screen.getAllByRole('link', { name: /whatsapp|nous écrire/i })
      .map((a) => a.getAttribute('href'))
      .filter((h) => h?.startsWith('https://wa.me/'));
    expect(liens.length).toBeGreaterThanOrEqual(2);
    liens.forEach((h) => expect(h).toContain(NUMERO));
    // Le bouton cohabite avec les actions de compte, il ne les remplace pas
    const compte = screen.queryByRole('link', { name: /connexion/i })
      || screen.queryByRole('button', { name: /mon compte|…/i });
    expect(compte).toBeTruthy();
  });
});
