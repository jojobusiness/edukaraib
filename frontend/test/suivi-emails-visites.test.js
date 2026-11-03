// Suivi des e-mails et compteur de visites (03/11/2026).
import { describe, it, expect } from 'vitest';
import { etatApresEvenement, tagType, motifRejet, libelleDernierMail } from '../../api/_suiviEmails.mjs';
import { cheminAnonyme, cleChemin, appareil, navigateur, sourceVisite } from '../../api/_visites.mjs';

const ev = (type, id = 'm1', extra = {}) => ({ type, created_at: '2026-11-03T10:00:00Z', data: { email_id: id, created_at: '2026-11-03T09:59:00Z', subject: 'Nouveau message', tags: { type: 'notif-message' }, ...extra } });

describe('suivi des e-mails', () => {
  it('envoyé → reçu → cliqué, sans jamais reculer', () => {
    let e = etatApresEvenement(null, ev('email.sent'));
    expect(e).toMatchObject({ statut: 'envoye', type: 'notif-message', resendId: 'm1' });
    e = etatApresEvenement(e, ev('email.clicked'));
    expect(e.statut).toBe('clique');
    e = etatApresEvenement(e, ev('email.delivered'));
    expect(e.statut).toBe('clique');
    expect(e.livreLe).toBeTruthy();
  });
  it('2 clics : 1re date gardée, compteur à 2', () => {
    let e = etatApresEvenement(null, ev('email.clicked'));
    const premier = e.cliqueLe;
    e = etatApresEvenement(e, { ...ev('email.clicked'), created_at: '2026-11-04T10:00:00Z' });
    expect(e.cliqueLe).toBe(premier);
    expect(e.nbClics).toBe(2);
  });
  it('rejeté l’emporte, avec un motif', () => {
    let e = etatApresEvenement(null, ev('email.delivered'));
    e = etatApresEvenement(e, ev('email.complained'));
    expect(e).toMatchObject({ statut: 'rejete', motif: 'classé spam' });
    expect(motifRejet(ev('email.bounced'))).toBe('adresse rejetée');
  });
  it('un événement d’un mail plus ancien ne remplace pas le dernier', () => {
    const recent = etatApresEvenement(null, ev('email.sent', 'm2', { created_at: '2026-11-05T00:00:00Z' }));
    expect(etatApresEvenement(recent, ev('email.delivered', 'm1'))).toBeNull();
  });
  it('ouverture ignorée, jamais « lu »', () => {
    expect(etatApresEvenement(null, ev('email.opened'))).toBeNull();
    for (const s of ['envoye', 'livre', 'clique', 'rejete']) expect(libelleDernierMail({ statut: s }).texte).not.toMatch(/lu|ouvert/i);
  });
  it('tags Resend : caractères interdits retirés', () => {
    expect(tagType('rappel cours é!')).toEqual([{ name: 'type', value: 'rappelcourse' }]);
    expect(tagType('')).toEqual([{ name: 'type', value: 'notification' }]);
  });
});

describe('compteur de visites', () => {
  it('jamais d’identifiant dans un chemin', () => {
    expect(cheminAnonyme('/profils/abc123?x=1')).toBe('/profils/*');
    expect(cheminAnonyme('/p/MARIE973')).toBe('/p/*');
    expect(cheminAnonyme('/chat/uid42')).toBe('/chat/*');
    expect(cheminAnonyme('/rentree/')).toBe('/rentree');
    expect(cleChemin('/rentree')).toBe('__SLASH__rentree');
  });
  it('appareil, navigateur intégré, source', () => {
    expect(appareil('Mozilla/5.0 (iPhone) Mobile')).toBe('mobile');
    expect(navigateur('Mozilla/5.0 (iPhone) musical_ly_33')).toBe('TikTok');
    expect(sourceVisite('https://www.tiktok.com/@marie/video/1?x=y')).toBe('tiktok_com');
    expect(sourceVisite('https://edukaraib.com/search')).toBe('');
  });
});
