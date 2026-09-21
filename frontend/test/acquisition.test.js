// Attribution des inscrits (plan du 20/09/2026) : la source d'arrivée doit
// survivre jusqu'à l'inscription, la première vraie source gagne, et rien ne
// doit jamais faire échouer une inscription.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  touchFromArrival, shouldReplaceTouch, acquisitionRecord, sourceFromHost, externalHost,
} from '../../api/_acquisition.mjs';
import { captureAcquisition, getAcquisitionRecord } from '../lib/acquisition';

const J = 24 * 60 * 60 * 1000;

describe('touchFromArrival', () => {
  it('lit les utm en priorité', () => {
    const t = touchFromArrival({
      search: '?utm_source=Facebook&utm_medium=video&utm_campaign=M3&utm_content=a',
      referrer: 'https://www.tiktok.com/',
      pathname: '/bac',
      now: 1000,
    });
    expect(t).toMatchObject({ source: 'facebook', medium: 'video', campaign: 'm3', content: 'a', landing: '/bac', date: 1000 });
  });

  it("reconnaît Facebook par le fbclid quand le référent est perdu (navigateur in-app)", () => {
    expect(touchFromArrival({ search: '?fbclid=IwAR123', referrer: '' }).source).toBe('facebook');
  });

  it('déduit la source du référent externe et ne garde ni la query ni le hash', () => {
    const t = touchFromArrival({ referrer: 'https://l.facebook.com/l.php?u=https%3A%2F%2Fedukaraib.com&h=secret' });
    expect(t.source).toBe('facebook');
    expect(t.medium).toBe('referral');
    expect(t.referrer).toBe('https://l.facebook.com/l.php');
  });

  it('ignore le site lui-même comme référent → direct', () => {
    const t = touchFromArrival({ referrer: 'https://www.edukaraib.com/search' });
    expect(t.source).toBe('direct');
    expect(t.referrer).toBe('');
  });

  it('garde le code partenaire de l’URL', () => {
    expect(touchFromArrival({ search: '?code=lhatien81' }).code).toBe('LHATIEN81');
  });

  it('classe les principaux référents', () => {
    expect(sourceFromHost('m.youtube.com')).toBe('youtube');
    expect(sourceFromHost('google.fr')).toBe('google');
    expect(sourceFromHost('mail.zoho.eu')).toBe('mail');
    expect(sourceFromHost('exemple.org')).toBe('exemple.org');
    expect(externalHost('pas une url')).toBe('');
  });
});

describe('shouldReplaceTouch — la première source gagne', () => {
  const fb = { source: 'facebook', date: 1000 };
  const direct = { source: 'direct', date: 1000 };
  it('ne remplace pas une vraie source par une autre', () => {
    expect(shouldReplaceTouch(fb, { source: 'tiktok' }, { now: 2000, maxAgeMs: 90 * J })).toBe(false);
  });
  it('remplace « direct » par une vraie source trouvée ensuite', () => {
    expect(shouldReplaceTouch(direct, { source: 'facebook' }, { now: 2000 })).toBe(true);
    expect(shouldReplaceTouch(direct, { source: 'direct' }, { now: 2000 })).toBe(false);
  });
  it('remplace un contact expiré (90 jours)', () => {
    expect(shouldReplaceTouch(fb, { source: 'direct' }, { now: 1000 + 91 * J, maxAgeMs: 90 * J })).toBe(true);
  });
});

describe('acquisitionRecord — ne lève jamais', () => {
  it("met 'inconnu' quand rien n'a été capturé", () => {
    const r = acquisitionRecord(null);
    expect(r.source).toBe('inconnu');
    expect(r.premierContact).toBeNull();
  });
  it('ne garde que les réponses déclarées de la liste', () => {
    expect(acquisitionRecord({ source: 'direct', date: 1 }, 'Facebook').declared).toBe('facebook');
    expect(acquisitionRecord({ source: 'direct', date: 1 }, '<script>').declared).toBe('');
  });
  it('re-nettoie un enregistrement envoyé par le client (API) sans planter sur une date absurde', () => {
    const ok = acquisitionRecord({ source: 'tiktok', premierContact: '2026-09-20T10:00:00.000Z', declared: 'tiktok' });
    expect(ok).toMatchObject({ source: 'tiktok', declared: 'tiktok', premierContact: '2026-09-20T10:00:00.000Z' });
    expect(() => acquisitionRecord({ date: 1e20 })).not.toThrow();
    expect(acquisitionRecord({ date: 1e20 }).premierContact).toBeNull();
    expect(acquisitionRecord({ source: 'x'.repeat(500) }).source.length).toBeLessThanOrEqual(60);
  });
});

describe('capture navigateur (jsdom)', () => {
  beforeEach(() => localStorage.clear());

  it('capture à l’arrivée puis restitue la source à l’inscription, même après une visite directe', () => {
    window.history.replaceState({}, '', '/bac?utm_source=facebook&utm_medium=video');
    captureAcquisition();
    // Retour le lendemain, sans paramètre : la source d'origine reste
    window.history.replaceState({}, '', '/register');
    captureAcquisition();
    const r = getAcquisitionRecord('facebook');
    expect(r).toMatchObject({ source: 'facebook', medium: 'video', landing: '/bac', declared: 'facebook' });
    expect(r.premierContact).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('survit à un localStorage corrompu', () => {
    localStorage.setItem('ek_acquisition', '{pas du json');
    expect(() => captureAcquisition()).not.toThrow();
    expect(getAcquisitionRecord().source).toBe('direct');
  });
});
