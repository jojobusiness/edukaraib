// Préparation des créateurs de contenu (02/11/2026).
import { describe, it, expect, beforeEach } from 'vitest';
import { onAuthStateChanged } from 'firebase/auth';
import { screen } from '@testing-library/react';
import { rendre } from './rendre';
import { codeDepuisUrl, saveCampaign, getCampaignCode, codeARattacher, noterCodeRattache } from '../lib/bacCampaign';
import { getAcquisitionRecord } from '../lib/acquisition';
import { navigateurIntegre } from '../lib/navigateur';
import { partnerShareLink, partnerShareMessage } from '../lib/partner';
import { resumePartenaire } from '../../api/_partners.mjs';
import PartnerHome from '../pages/PartnerHome';

beforeEach(() => localStorage.clear());

describe('capture du code', () => {
  it('?code=, ?partenaire= et lien court', () => {
    expect(codeDepuisUrl('?code=marie973', '/')).toBe('MARIE973');
    expect(codeDepuisUrl('?partenaire=APEL973', '/search')).toBe('APEL973');
    expect(codeDepuisUrl('', '/p/marie973')).toBe('MARIE973');
    expect(codeDepuisUrl('', '/profils/abc')).toBeNull();
    expect(codeDepuisUrl('?code=<script>', '/')).toBeNull();
  });
  it('le code entre dans la fiche, même si une autre source était déjà connue', () => {
    localStorage.setItem('ek_acquisition', JSON.stringify({ source: 'facebook', date: Date.now() }));
    saveCampaign({ code: 'MARIE973' });
    const f = getAcquisitionRecord();
    expect(f.code).toBe('MARIE973');
    expect(f.source).toBe('facebook');
  });
  it('sans autre source : la source devient « partenaire »', () => {
    saveCampaign({ code: 'MARIE973' });
    expect(getAcquisitionRecord().source).toBe('partenaire');
  });
  it('le code est toujours là après 60 jours', () => {
    saveCampaign({ code: 'MARIE973' });
    const brut = JSON.parse(localStorage.getItem('edk_bac_campaign'));
    expect(brut.exp - Date.now()).toBeGreaterThan(60 * 864e5);
    expect(getCampaignCode()).toBe('MARIE973');
  });
  it('posé une seule fois sur le compte', () => {
    saveCampaign({ code: 'MARIE973' });
    expect(codeARattacher('u1')).toBe('MARIE973');
    noterCodeRattache('u1', 'MARIE973');
    expect(codeARattacher('u1')).toBeNull();
  });
});

describe('navigateurs intégrés', () => {
  it('TikTok, Instagram, Facebook : oui ; Safari, Chrome : non', () => {
    expect(navigateurIntegre('Mozilla/5.0 (iPhone) Mobile/15E148 musical_ly_33.0.0')).toBe(true);
    expect(navigateurIntegre('Mozilla/5.0 (iPhone) Instagram 300.0')).toBe(true);
    expect(navigateurIntegre('Mozilla/5.0 [FBAN/FBIOS;FBAV/400]')).toBe(true);
    expect(navigateurIntegre('Mozilla/5.0 (iPhone) Version/17.0 Mobile/15E148 Safari/604.1')).toBe(false);
    expect(navigateurIntegre('Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36')).toBe(false);
  });
});

describe('textes créateur', () => {
  it('lien court', () => expect(partnerShareLink('MARIE973')).toBe('https://edukaraib.com/p/MARIE973'));
  it('une légende, pas un message d’association', () => {
    const t = partnerShareMessage({ code: 'MARIE973', structureName: 'Marie', kind: 'createur' });
    expect(t).toContain('edukaraib.com/p/MARIE973');
    expect(t).not.toMatch(/association|structure|influenceu/i);
  });
  it('association : message inchangé', () => {
    expect(partnerShareMessage({ code: 'APEL973', structureName: 'APEL', kind: 'association' })).toContain('partenariat');
  });
  it('/partenaire?type=createur parle au créateur', () => {
    onAuthStateChanged.mockImplementation((_a, cb) => { cb(null); return () => {}; });
    rendre(<PartnerHome />, { route: '/partenaire?type=createur' });
    return screen.findByText('Vous gagnez 2 € par heure de cours.').then(() => {
      expect(screen.queryByText(/Votre structure/)).toBeNull();
      expect(screen.queryByText(/influenceu/i)).toBeNull();
    });
  });
});

describe('chiffres d’un partenaire', () => {
  it('un cours remboursé ne compte plus', () => {
    const r = resumePartenaire({ clicks: 12, familiesCount: 1, conversions: [{ amount_eur: 2 }, { amount_eur: 2, refunded_eur: 2 }] }, 3);
    expect(r).toEqual({ clics: 12, inscrits: 3, coursPayes: 1, familles: 1 });
  });
});
