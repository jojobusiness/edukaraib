// Programme partenaires (refonte du 15/09/2026) — on appelle le vrai handler de
// checkout avec un Firestore et un Stripe simulés, plus les règles pures.
//  - Un code refusé ne bloque JAMAIS le paiement (ticket 4, 14/09/2026).
//  - Nouveau modèle : 2 €/h famille + 2 €/h partenaire, sans limite d'usage,
//    famille rattachée une fois pour toutes.
//  - Anciens codes (LHATIEN81…) : grille et limites historiques.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  partnerAmounts, partnerRefusalReason, partnerTransferDue, linkFamilyToPartner, PARTNER_MODEL,
} from '../../api/_partners.mjs';

const h = vi.hoisted(() => {
  const state = { store: {} };
  const create = vi.fn(async () => ({ id: 'cs_test_1', url: 'https://checkout.stripe.test/cs_test_1' }));

  function docRef(name, id) {
    return {
      id,
      async get() {
        const d = state.store[name]?.[id];
        return { id, exists: !!d, data: () => d };
      },
      async set(v) {
        state.store[name] = state.store[name] || {};
        state.store[name][id] = { ...(state.store[name][id] || {}), ...v };
      },
      async update(v) {
        state.store[name][id] = { ...state.store[name][id], ...v };
      },
    };
  }

  function makeRef(name, filters = [], lim = 0) {
    return {
      where: (f, op, v) => makeRef(name, [...filters, [f, op, v]], lim),
      limit: (n) => makeRef(name, filters, n),
      async get() {
        let docs = Object.entries(state.store[name] || {})
          .filter(([, d]) => filters.every(([f, op, v]) =>
            op === 'array-contains' ? (d[f] || []).includes(v) : d[f] === v))
          .map(([id, d]) => ({ id, exists: true, data: () => d }));
        if (lim) docs = docs.slice(0, lim);
        return { empty: docs.length === 0, size: docs.length, docs };
      },
      doc: (id) => docRef(name, id),
    };
  }

  const db = {
    collection: (name) => makeRef(name),
    runTransaction: async (fn) => fn({ get: (ref) => ref.get(), update: (ref, v) => ref.update(v) }),
  };

  return { state, create, db };
});

vi.mock('../../api/_firebaseAdmin.mjs', () => ({
  adminDb: h.db,
  verifyAuth: async () => ({ uid: 'parent1' }),
}));
vi.mock('../../api/_stripe.mjs', () => ({
  stripe: { checkout: { sessions: { create: h.create } } },
}));
vi.mock('../../api/_sentry.mjs', () => ({ captureError: () => {} }));

const { default: handler } = await import('../../api/pay/create-checkout-session.mjs');

const IP = '1.2.3.4';
const SEPT_MOIS_MS = 7 * 30 * 24 * 60 * 60 * 1000;
const LESSON = {
  teacher_id: 't1', student_id: 'child1', parent_id: 'parent1',
  status: 'confirmed', price_per_hour: 25, duration_hours: 1, mode: 'presentiel',
};

function seed({ partners = {}, usages = [], parent = {} } = {}) {
  h.state.store = {
    lessons: { L1: { ...LESSON } },
    users: { parent1: { role: 'parent', ...parent } },
    influencers: partners,
    influencer_usages: Object.fromEntries(usages.map((u, i) => [`u${i}`, u])),
    coupons: {},
    students: {},
    payments: {},
  };
}

const legacy = (extra = {}) => ({ code: 'LEGACY42', active: true, created_at: new Date(), ...extra });
const asso = (extra = {}) => ({
  code: 'APEL973', active: true, model: PARTNER_MODEL, created_at: new Date(),
  expires_at: new Date(Date.now() + 86400000), ...extra,
});

async function pay(couponCode) {
  const req = {
    method: 'POST',
    body: { lessonId: 'L1', forStudent: 'child1', couponCode },
    headers: { 'x-forwarded-for': IP, origin: 'https://edukaraib.com' },
    socket: {},
  };
  const res = {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  await handler(req, res);
  return res;
}

const session = () => h.create.mock.calls.at(-1)?.[0];
const amount = () => session().line_items[0].price_data.unit_amount;

beforeEach(() => { h.create.mockClear(); });

describe('checkout — ancien code refusé : le paiement passe quand même, sans remise', () => {
  it.each([
    ['2 usages déjà faits par ce payeur', { usages: [{ influencer_uid: 'inf1', payer_uid: 'parent1' }, { influencer_uid: 'inf1', payer_uid: 'parent1' }] }, 'COUPON_MAX_USAGE_REACHED'],
    ['IP déjà vue pour ce code', { usages: [{ influencer_uid: 'inf1', payer_uid: 'autre', client_ip: IP }] }, 'COUPON_IP_LIMIT_REACHED'],
    ['code créé il y a 7 mois', { created_at: new Date(Date.now() - SEPT_MOIS_MS) }, 'COUPON_EXPIRED'],
  ])('%s', async (_label, setup, reason) => {
    seed({ partners: { inf1: legacy(setup.created_at ? { created_at: setup.created_at } : {}) }, usages: setup.usages || [] });
    const res = await pay('LEGACY42');

    expect(res.statusCode).toBe(200);
    expect(res.body.couponIgnored).toEqual([{ code: 'LEGACY42', reason }]);
    expect(amount()).toBe(3500);                                   // 25 € prof + 10 € site
    expect(session().metadata.teacher_amount_cents).toBe('2500');  // le prof n'est jamais touché
    expect(session().metadata.partner_uid).toBe('');
  });

  it('ancien code valable → grille historique (−5 € / +5 €)', async () => {
    seed({ partners: { inf1: legacy() } });
    const res = await pay('LEGACY42');
    expect(res.body.couponIgnored).toBeUndefined();
    expect(amount()).toBe(3000);
    expect(session().metadata.partner_commission_cents).toBe('500');
    expect(session().metadata.partner_link).toBe(''); // pas de rattachement pour l'ancien modèle
  });

  it('coupon nominatif inconnu → reste une erreur 400 (tapé par l’utilisateur)', async () => {
    seed();
    const res = await pay('BIENVENUE-XYZ');
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('COUPON_INVALID_OR_USED');
    expect(h.create).not.toHaveBeenCalled();
  });
});

describe('checkout — partenaire (2 €/h famille + 2 €/h partenaire)', () => {
  it('1er achat avec le code → remise 2 €, reversement 2 €, famille à rattacher', async () => {
    seed({ partners: { asso1: asso() } });
    await pay('APEL973');
    expect(amount()).toBe(3300);
    expect(session().metadata.teacher_amount_cents).toBe('2500');
    expect(session().metadata.partner_uid).toBe('asso1');
    expect(session().metadata.partner_commission_cents).toBe('200');
    expect(session().metadata.partner_link).toBe('1');
  });

  it('aucune limite d’usage ni d’IP (famille de 3 enfants, même réseau)', async () => {
    seed({
      partners: { asso1: asso() },
      usages: [
        { influencer_uid: 'asso1', payer_uid: 'parent1', client_ip: IP },
        { influencer_uid: 'asso1', payer_uid: 'parent1', client_ip: IP },
        { influencer_uid: 'asso1', payer_uid: 'parent1', client_ip: IP },
      ],
    });
    const res = await pay('APEL973');
    expect(res.body.couponIgnored).toBeUndefined();
    expect(amount()).toBe(3300);
  });

  it('famille déjà rattachée → la remise s’applique sans code', async () => {
    seed({ partners: { asso1: asso() }, parent: { partner_uid: 'asso1' } });
    await pay(undefined);
    expect(amount()).toBe(3300);
    expect(session().metadata.partner_uid).toBe('asso1');
    expect(session().metadata.partner_link).toBe(''); // déjà rattachée
  });

  it('famille rattachée à A qui saisit le code de B → A garde la main', async () => {
    seed({
      partners: { asso1: asso(), asso2: asso({ code: 'APE971' }) },
      parent: { partner_uid: 'asso1' },
    });
    const res = await pay('APE971');
    expect(session().metadata.partner_uid).toBe('asso1');
    expect(res.body.couponIgnored).toEqual([{ code: 'APE971', reason: 'ONE_PARTNER_PER_FAMILY' }]);
  });

  it('le partenaire ne peut pas utiliser son propre code', async () => {
    seed({ partners: { parent1: asso() } });
    const res = await pay('APEL973');
    expect(amount()).toBe(3500);
    expect(res.body.couponIgnored).toEqual([{ code: 'APEL973', reason: 'COUPON_SELF' }]);
  });

  it('partenariat arrivé à échéance → ignoré, le paiement passe', async () => {
    seed({ partners: { asso1: asso({ expires_at: new Date(Date.now() - 1000) }) } });
    const res = await pay('APEL973');
    expect(res.statusCode).toBe(200);
    expect(amount()).toBe(3500);
    expect(res.body.couponIgnored).toEqual([{ code: 'APEL973', reason: 'COUPON_EXPIRED' }]);
  });

  it('partenaire en attente de validation (inactif) → aucun effet', async () => {
    seed({ partners: { asso1: asso({ active: false, pending_review: true }) } });
    const res = await pay('APEL973');
    expect(res.statusCode).toBe(400); // code inconnu des coupons actifs : l'utilisateur voit « code invalide »
    expect(h.create).not.toHaveBeenCalled();
  });
});

describe('règles partenaires (module pur)', () => {
  it('grille par heure facturée : packs 5 h et 10 h', () => {
    const p = { model: PARTNER_MODEL };
    expect(partnerAmounts({ partner: p, packMode: true, billedHours: 5 })).toEqual({ discountCents: 1000, commissionCents: 1000 });
    expect(partnerAmounts({ partner: p, packMode: true, billedHours: 10 })).toEqual({ discountCents: 2000, commissionCents: 2000 });
    // Ancienne grille inchangée pour les codes historiques
    expect(partnerAmounts({ partner: {}, packMode: true, billedHours: 10 })).toEqual({ discountCents: 3000, commissionCents: 2000 });
  });

  it('pas de date de fin = pas d’échéance pour un partenaire', () => {
    expect(partnerRefusalReason({ partner: { model: PARTNER_MODEL }, partnerId: 'a', payerUid: 'b' })).toBeNull();
  });

  it('reverse les cours payés il y a plus de 7 jours, remboursements déduits', () => {
    const now = new Date('2026-10-20T12:00:00Z');
    const ilYa = (jours) => new Date(now.getTime() - jours * 86400000);
    const conversions = [
      { amount_eur: 20, paid_at: ilYa(10) },                  // pack 10 h : reversable
      { amount_eur: 2, paid_at: ilYa(8), refunded_eur: 2 },   // remboursé
      { amount_eur: 10, paid_at: ilYa(3) },                   // trop récent (délai de remboursement)
    ];
    expect(partnerTransferDue({ conversions, pendingPayout: 30, now }).amountCents).toBe(2000);
    // Déjà transféré jusqu'à J-9 : plus rien de mûr
    expect(partnerTransferDue({ conversions, transferredUntil: ilYa(9), pendingPayout: 30, now }).amountCents).toBe(0);
    // Un remboursement après transfert a réduit le solde : on ne vire jamais plus que le dû
    expect(partnerTransferDue({ conversions, pendingPayout: 5, now }).amountCents).toBe(500);
    expect(partnerTransferDue({ conversions, pendingPayout: -3, now }).amountCents).toBe(0);
  });
});

describe('rattachement de la famille au partenaire (webhook)', () => {
  it('rattache une seule fois, compte la famille, et le premier partenaire gagne', async () => {
    seed({ partners: { asso1: asso(), asso2: asso({ code: 'APE971' }) } });

    expect(await linkFamilyToPartner(h.db, 'parent1', 'asso1')).toBe(true);
    expect(h.state.store.users.parent1.partner_uid).toBe('asso1');
    expect(h.state.store.influencers.asso1.familiesCount).toBe(1);

    // 2e paiement, même partenaire : rien ne bouge
    expect(await linkFamilyToPartner(h.db, 'parent1', 'asso1')).toBe(false);
    // Autre partenaire : le premier garde la famille
    expect(await linkFamilyToPartner(h.db, 'parent1', 'asso2')).toBe(false);
    expect(h.state.store.users.parent1.partner_uid).toBe('asso1');
    expect(h.state.store.influencers.asso1.familiesCount).toBe(1);
  });

  it('refuse l’auto-rattachement', async () => {
    seed({ partners: { parent1: asso() } });
    expect(await linkFamilyToPartner(h.db, 'parent1', 'parent1')).toBe(false);
  });
});
