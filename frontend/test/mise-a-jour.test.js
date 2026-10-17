// Mise à jour automatique des onglets ouverts (17/10/2026).
// Le risque n'est pas de rater une mise à jour : c'est de recharger la page
// de quelqu'un au mauvais moment. Chaque cas « prevenir » ci-dessous protège
// une situation réelle — un cours en visio, un message à moitié écrit, un
// paiement en train de se confirmer.
import { describe, it, expect } from 'vitest';
import {
  decision, doitSurveiller, estPageProtegee, versionDeployee, PAGES_PROTEGEES,
  tentativeEnregistree, enregistrerTentative, oublierTentative,
} from '../lib/miseAJour';

const base = {
  versionLocale: 'abc1234',
  versionDistante: 'def5678',
  saisieEnCours: false,
  dejaTentee: null,
  momentSur: true,
  pageProtegee: false,
};

describe('decision', () => {
  it('recharge quand une nouvelle version existe et que le moment est sûr', () => {
    expect(decision(base)).toBe('recharger');
  });

  it('ne fait rien quand la version est la même', () => {
    expect(decision({ ...base, versionDistante: 'abc1234' })).toBe('rien');
  });

  it('ne fait rien quand la version distante est illisible (hors ligne, 404)', () => {
    expect(decision({ ...base, versionDistante: null })).toBe('rien');
  });

  it('ne fait rien en local : il n’y a pas de déploiement à surveiller', () => {
    expect(decision({ ...base, versionLocale: 'local' })).toBe('rien');
  });

  it('prévient au lieu de recharger si quelqu’un est en train de taper', () => {
    expect(decision({ ...base, saisieEnCours: true })).toBe('prevenir');
  });

  it('⛔ prévient seulement sur une page protégée (visio, chat, paiement)', () => {
    expect(decision({ ...base, pageProtegee: true })).toBe('prevenir');
  });

  it('prévient hors d’un moment sûr : un envoi peut être en vol', () => {
    expect(decision({ ...base, momentSur: false })).toBe('prevenir');
  });

  it('prévient au lieu de boucler si le rechargement a déjà été tenté', () => {
    expect(decision({ ...base, dejaTentee: 'def5678' })).toBe('prevenir');
  });
});

describe('pages protégées', () => {
  it('couvre la visio, la messagerie et le paiement', () => {
    expect(estPageProtegee('/visio/abc123')).toBe(true);
    expect(estPageProtegee('/chat/u1')).toBe(true);
    expect(estPageProtegee('/messages')).toBe(true);
    expect(estPageProtegee('/pay/success')).toBe(true);
    expect(estPageProtegee('/register')).toBe(true);
  });

  it('laisse les pages de lecture se recharger seules', () => {
    expect(estPageProtegee('/')).toBe(false);
    expect(estPageProtegee('/search')).toBe(false);
    expect(estPageProtegee('/methode')).toBe(false);
    expect(estPageProtegee('/profils/u1')).toBe(false); // fiche publique, pas /profile
  });

  it('le cours en visio est protégé : c’est le pire moment pour recharger', () => {
    expect(PAGES_PROTEGEES).toContain('/visio');
  });
});

describe('versionDeployee', () => {
  it('rend la version publiée', async () => {
    const faux = async () => ({ ok: true, json: async () => ({ version: 'def5678' }) });
    expect(await versionDeployee(faux)).toBe('def5678');
  });

  it('rend null sur une réponse en erreur, hors ligne, ou sans version', async () => {
    expect(await versionDeployee(async () => ({ ok: false }))).toBeNull();
    expect(await versionDeployee(async () => { throw new Error('offline'); })).toBeNull();
    expect(await versionDeployee(async () => ({ ok: true, json: async () => ({}) }))).toBeNull();
    // Cas réel : la réécriture SPA renvoie du HTML, .json() lève
    expect(await versionDeployee(async () => ({ ok: true, json: async () => { throw new Error('html'); } }))).toBeNull();
  });
});

describe('mémoire de l’onglet', () => {
  it('retient puis oublie la tentative', () => {
    const faux = new Map();
    const store = {
      getItem: (k) => faux.get(k) ?? null,
      setItem: (k, v) => faux.set(k, v),
      removeItem: (k) => faux.delete(k),
    };
    enregistrerTentative('def5678', store);
    expect(tentativeEnregistree(store)).toBe('def5678');
    oublierTentative(store);
    expect(tentativeEnregistree(store)).toBeNull();
  });

  it('ne lève jamais quand le stockage est bloqué (navigation privée)', () => {
    const casse = { getItem() { throw new Error('bloqué'); }, setItem() { throw new Error('bloqué'); }, removeItem() { throw new Error('bloqué'); } };
    expect(() => enregistrerTentative('x', casse)).not.toThrow();
    expect(tentativeEnregistree(casse)).toBeNull();
    expect(() => oublierTentative(casse)).not.toThrow();
  });

  it('doitSurveiller ne surveille ni « local » ni le vide', () => {
    expect(doitSurveiller('abc1234')).toBe(true);
    expect(doitSurveiller('local')).toBe(false);
    expect(doitSurveiller('')).toBe(false);
    expect(doitSurveiller(undefined)).toBe(false);
  });
});
