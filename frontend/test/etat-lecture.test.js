// « Vu » sous mon dernier message (plan du 23/10/2026 § 3).
import { describe, it, expect } from 'vitest';
import { etatLecture, libelleVu } from '../lib/etatLecture';

const MOI = 'moi';
const AUTRE = 'autre';
const ENVOI = Date.parse('2026-10-23T18:30:00+02:00');

describe('etatLecture', () => {
  it('lu au même instant que l’envoi = vu (frontière exacte)', () => {
    expect(etatLecture({ sender_uid: MOI, sent_at: ENVOI }, { [AUTRE]: ENVOI }, MOI, AUTRE)).toEqual({ etat: 'vu', le: ENVOI });
  });
  it('lu avant l’envoi, ou jamais lu = envoyé', () => {
    expect(etatLecture({ sender_uid: MOI, sent_at: ENVOI }, { [AUTRE]: ENVOI - 1 }, MOI, AUTRE)).toEqual({ etat: 'envoye' });
    expect(etatLecture({ sender_uid: MOI, sent_at: ENVOI }, undefined, MOI, AUTRE)).toEqual({ etat: 'envoye' });
  });
  it("le message de l'autre : rien à afficher", () => {
    expect(etatLecture({ sender_uid: AUTRE, sent_at: ENVOI }, { [AUTRE]: ENVOI }, MOI, AUTRE)).toBeNull();
    expect(etatLecture(null, {}, MOI, AUTRE)).toBeNull();
  });
  it('accepte les Timestamp Firestore', () => {
    const ts = (ms) => ({ toMillis: () => ms });
    expect(etatLecture({ sender_uid: MOI, sent_at: ts(ENVOI) }, { [AUTRE]: ts(ENVOI + 600000) }, MOI, AUTRE).etat).toBe('vu');
  });
});

describe('libelleVu', () => {
  const MAINTENANT = Date.parse('2026-10-23T20:00:00+02:00');
  it('aujourd’hui, hier, puis la date', () => {
    expect(libelleVu(Date.parse('2026-10-23T18:40:00+02:00'), MAINTENANT)).toBe('Vu à 18 h 40');
    expect(libelleVu(Date.parse('2026-10-22T09:00:00+02:00'), MAINTENANT)).toBe('Vu hier');
    expect(libelleVu(Date.parse('2026-10-20T09:00:00+02:00'), MAINTENANT)).toBe('Vu le 20/10');
  });
});
