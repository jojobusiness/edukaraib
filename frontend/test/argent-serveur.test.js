// Règles d'argent côté serveur (23/10/2026) : le prix vient du profil du
// prof, un cours ne se paie au prof qu'une fois passé, et les cours gratuits
// sont vérifiés. Chaque test correspond à une fraude possible avant.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { tarifsDuProf, montantProfCents, maxCoursDuPack } from '../../api/_tarifs.mjs';
import { debutDuCours, coursTermine } from '../../api/_coursHoraire.mjs';

const { verdictGratuite, retirerGratuite } = createRequire(import.meta.url)('../../functions/gratuites.js');

describe('tarifs : le profil du prof, jamais le cours', () => {
  const prof = { price_per_hour: 30, visio_enabled: true, visio_same_rate: false, visio_price_per_hour: 25, pack5_price: 140, visio_pack5_price: 115 };
  it('présentiel, visio, packs', () => {
    expect(tarifsDuProf(prof, false)).toEqual({ heure: 30, pack5: 140, pack10: 270 });
    expect(tarifsDuProf(prof, true)).toMatchObject({ heure: 25, pack5: 115 });
    expect(tarifsDuProf({ ...prof, visio_same_rate: true }, true)).toMatchObject({ heure: 30, pack5: 140 });
  });
  it('montant prof : 1 h, pack 5 h', () => {
    const t = tarifsDuProf(prof, false);
    expect(montantProfCents(t, { packMode: false, billedHours: 1 })).toBe(3000);
    expect(montantProfCents(t, { packMode: true, billedHours: 5 })).toBe(14000);
  });
  it('prof sans tarif : 0 (le paiement est refusé, jamais 1 € inventé)', () => {
    expect(montantProfCents(tarifsDuProf({}, false), { packMode: false, billedHours: 1 })).toBe(0);
  });
  it('un pack ne couvre jamais plus de cours que prévu', () => {
    expect(maxCoursDuPack(5)).toBe(7);
    expect(maxCoursDuPack(10)).toBe(12);
  });
});

describe('versement au prof : seulement après le cours', () => {
  const MAINTENANT = Date.parse('2026-10-23T18:00:00Z');
  it('cours à venir → pas de versement', () => {
    expect(coursTermine({ startAt: '2026-10-24T17:00:00Z' }, MAINTENANT)).toBe(false);
    expect(coursTermine({ startAt: '2026-10-23T17:30:00Z' }, MAINTENANT)).toBe(false); // en cours
  });
  it('cours fini → versement', () => {
    expect(coursTermine({ startAt: '2026-10-23T16:00:00Z' }, MAINTENANT)).toBe(true);
  });
  it('Timestamp Firestore et date + heure', () => {
    expect(debutDuCours({ startAt: { toDate: () => new Date(0) } }).getTime()).toBe(0);
    expect(debutDuCours({ date: '2026-10-25', slot_hour: 9 })).toBeInstanceOf(Date);
  });
  it('durée gonflée plafonnée à 8 h', () => {
    expect(coursTermine({ startAt: '2026-10-23T09:00:00Z', duration_hours: 50 }, MAINTENANT)).toBe(true);
  });
});

describe('cours gratuits vérifiés par le serveur', () => {
  const t = (ms) => ({ _created_ms: ms });
  it('essai : refusé si le prof ne le propose pas', () => {
    expect(verdictGratuite('l1', { is_trial: true, ...t(1) }, { prof: { trial_enabled: false } })).toMatchObject({ ok: false, raison: 'essai_non_propose' });
  });
  it('essai : un seul par prof et par élève (le plus ancien gagne)', () => {
    const ctx = { prof: { trial_enabled: true }, autresEssais: [{ id: 'l0', created_ms: 0 }] };
    expect(verdictGratuite('l1', { is_trial: true, ...t(5) }, ctx)).toMatchObject({ ok: false, raison: 'essai_deja_utilise' });
    expect(verdictGratuite('l0', { is_trial: true, ...t(0) }, { ...ctx, autresEssais: [{ id: 'l1', created_ms: 5 }] }).ok).toBe(true);
  });
  it('heure offerte hors pack : refusée', () => {
    expect(verdictGratuite('l1', { is_free_hour: true, ...t(1) }, {})).toMatchObject({ ok: false, raison: 'gratuit_hors_pack' });
  });
  it('pack 5 h : 1 heure offerte, la 2e est refusée', () => {
    const pack = { pack: true, pack_hours: 5, pack_id: 'p', is_free_hour: true };
    const premier = { id: 'a', created_ms: 1, l: pack };
    expect(verdictGratuite('a', { ...pack, ...t(1) }, { coursDuPack: [premier] }).ok).toBe(true);
    expect(verdictGratuite('b', { ...pack, ...t(2) }, { coursDuPack: [premier, { id: 'b', created_ms: 2, l: pack }] }))
      .toMatchObject({ ok: false, raison: 'trop_d_heures_offertes' });
  });
  it('code « premier avis » : valide une fois, refusé sans code actif', () => {
    const l = { pack: true, pack_hours: 5, is_free_hour: true, free_reason: 'first_review_promo', ...t(3) };
    const avant = [{ id: 'a', created_ms: 1, l: { is_free_hour: true } }];
    expect(verdictGratuite('c', l, { coursDuPack: avant, promoValide: true })).toEqual({ ok: true, utiliserPromo: true });
    expect(verdictGratuite('c', l, { coursDuPack: avant, promoValide: false })).toMatchObject({ ok: false, raison: 'code_avis_invalide' });
  });
  it('retirer la gratuité : prix du prof, participant plus « payé par essai »', () => {
    const c = retirerGratuite({ participantsMap: { e: { paid_by: 'trial', is_paid: true } } }, 30, 'DEL');
    expect(c).toMatchObject({ is_free_hour: false, price_per_hour: 30, 'participantsMap.e.is_paid': false, 'participantsMap.e.paid_by': null });
  });
});
