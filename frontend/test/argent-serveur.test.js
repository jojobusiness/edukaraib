// Règles d'argent côté serveur (23/10/2026) : le prix vient du profil du
// prof, un cours ne se paie au prof qu'une fois passé, et les cours gratuits
// sont vérifiés. Chaque test correspond à une fraude possible avant.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { tarifsDuProf, montantProfCents, maxCoursDuPack } from '../../api/_tarifs.mjs';
import { debutDuCours, coursTermine } from '../../api/_coursHoraire.mjs';
import { compteProfPret } from '../../api/_compteProf.mjs';
import { resumeCours, resumePaiements } from '../../api/_ficheCompte.mjs';
import { nbCreneaux } from '../lib/offreProf';

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

describe('compte Stripe du prof : on demande à Stripe (02/11/2026)', () => {
  const stripe = (compte) => ({ accounts: { retrieve: async () => { if (!compte) throw new Error('down'); return compte; } } });
  it('prêt seulement si virements et transferts sont actifs', async () => {
    expect(await compteProfPret(stripe({ payouts_enabled: true, capabilities: { transfers: 'active' } }), 'a')).toBe(true);
    expect(await compteProfPret(stripe({ payouts_enabled: false, capabilities: { transfers: 'inactive' } }), 'a')).toBe(false);
  });
  it('pas de compte ou Stripe injoignable : pas prêt, sans planter', async () => {
    expect(await compteProfPret(stripe({}), null)).toBe(false);
    expect(await compteProfPret(stripe(null), 'a')).toBe(false);
  });
});

describe('créneaux : les semaines passées ne comptent plus', () => {
  const NOW = Date.parse('2026-11-02T12:00:00Z');
  it('semaine passée 0, semaine en cours et future comptées', () => {
    expect(nbCreneaux({ '2026-03-09': { Lun: [9, 10] } }, NOW)).toBe(0);
    expect(nbCreneaux({ '2026-11-02': { Lun: [9] }, '2026-12-14': { Mar: [10, 11] } }, NOW)).toBe(3);
  });
  it('ancien format récurrent : toujours compté, sauf si des semaines existent', () => {
    expect(nbCreneaux({ Lun: [9, 10] }, NOW)).toBe(2);
    expect(nbCreneaux({ Lun: [9, 10], '2026-03-09': { Lun: [9] } }, NOW)).toBe(0);
  });
});

describe('fiche de compte admin', () => {
  it('compte les cours sans doublon', () => {
    const r = resumeCours([{ id: 'a', status: 'completed' }, { id: 'a', status: 'completed' }, { id: 'b', status: 'rejected' }, { id: 'c', status: 'confirmed', date: '2099-01-01' }, { id: 'd', status: 'booked' }]);
    expect(r).toEqual({ total: 4, termines: 1, aVenir: 1, enAttente: 1, refuses: 1 });
  });
  it('ne compte pas un paiement non abouti', () => {
    const r = resumePaiements([{ status: 'pending', gross_eur: 130 }, { status: 'refunded', gross_eur: 5 }, { status: 'released', gross_eur: 40, net_to_teacher_eur: 30 }]);
    expect(r).toEqual({ nb: 1, paye: 40, gagne: 30, rembourses: 1 });
  });
});
