// Pièces jointes de la messagerie (photos, vidéos, messages vocaux).
//
// Le test de fumée des pages monte <Messages /> sans destinataire : il ne
// traverse donc JAMAIS le rendu des bulles. Ces tests couvrent le morceau qui
// s'affiche réellement en conversation, plus les règles métier (taille max,
// résumé pour l'aperçu de conversation et pour l'email admin).

import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { rendre } from './rendre';
import AttachmentGrid from '../components/chat/AttachmentGrid';
import Composer from '../components/chat/Composer';
import {
  LIMITES_MO,
  erreurFichier,
  formatDuree,
  kindDepuisMime,
  nomSur,
  resumeAttachments,
} from '../lib/chatAttachments';

function fauxFichier(nom, type, octets) {
  const f = new File(['x'], nom, { type });
  Object.defineProperty(f, 'size', { value: octets });
  return f;
}

describe('chatAttachments — règles métier', () => {
  it('classe les fichiers par type MIME', () => {
    expect(kindDepuisMime('image/jpeg')).toBe('image');
    expect(kindDepuisMime('video/mp4')).toBe('video');
    expect(kindDepuisMime('audio/webm;codecs=opus')).toBe('audio');
    expect(kindDepuisMime('application/pdf')).toBe('file');
  });

  it('refuse un fichier au-dessus de la limite de son type', () => {
    const trop = fauxFichier('film.mp4', 'video/mp4', (LIMITES_MO.video + 1) * 1024 * 1024);
    expect(erreurFichier(trop)).toMatch(/dépasse/);
    const ok = fauxFichier('photo.jpg', 'image/jpeg', 1024 * 1024);
    expect(erreurFichier(ok)).toBeNull();
  });

  it('refuse un fichier vide', () => {
    expect(erreurFichier(fauxFichier('vide.jpg', 'image/jpeg', 0))).toMatch(/vide/);
  });

  it('assainit les noms de fichiers pour Storage', () => {
    expect(nomSur('Ma Photo été (1).PNG')).toMatch(/^[a-zA-Z0-9._-]+$/);
  });

  it('résume un message sans texte pour l’aperçu de conversation', () => {
    expect(resumeAttachments([{ kind: 'audio' }], '')).toBe('🎤 Message vocal');
    expect(resumeAttachments([{ kind: 'image' }, { kind: 'image' }], '')).toBe('📷 2 photos');
    // Le texte prime toujours sur le résumé des pièces jointes.
    expect(resumeAttachments([{ kind: 'image' }], 'Bonjour')).toBe('Bonjour');
  });

  it('formate les durées en m:ss', () => {
    expect(formatDuree(9)).toBe('0:09');
    expect(formatDuree(75)).toBe('1:15');
  });
});

describe('AttachmentGrid', () => {
  it('affiche une photo cliquable', () => {
    rendre(
      <AttachmentGrid
        attachments={[{ kind: 'image', url: 'https://exemple.fr/a.jpg', name: 'a.jpg' }]}
      />
    );
    expect(screen.getByRole('button', { name: /photo/i })).toBeTruthy();
  });

  it('affiche un lecteur de message vocal', () => {
    rendre(<AttachmentGrid attachments={[{ kind: 'audio', url: 'https://exemple.fr/v.webm', durationSec: 12 }]} />);
    expect(screen.getByRole('button', { name: /message vocal/i })).toBeTruthy();
  });

  it('signale les médias au-delà des 4 vignettes affichées', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({
      kind: 'image',
      url: `https://exemple.fr/${i}.jpg`,
    }));
    rendre(<AttachmentGrid attachments={six} />);
    expect(screen.getByText('+2')).toBeTruthy();
  });
});

describe('Composer', () => {
  it('propose de joindre un fichier et désactive l’envoi à vide', () => {
    rendre(<Composer value="" onChange={() => {}} onSend={() => true} sending={false} progress={0} />);
    expect(screen.getByLabelText(/joindre une photo/i)).toBeTruthy();
    // jsdom n'expose pas MediaRecorder : on retombe sur le bouton « Envoyer ».
    expect(screen.getByLabelText('Envoyer').disabled).toBe(true);
  });
});
