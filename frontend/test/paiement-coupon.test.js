// Ticket 4 (14/09/2026) — un code influenceur refusé ne doit JAMAIS bloquer le paiement.
// On appelle le vrai handler de checkout avec un Firestore et un Stripe simulés.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => {
  const state = { store: {} };
  const create = vi.fn(async () => ({ id: 'cs_test_1', url: 'https://checkout.stripe.test/cs_test_1' }));

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
      doc: (id) => ({
        async get() {
          const d = state.store[name]?.[id];
          return { id, exists: !!d, data: () => d };
        },
        async set(v) {
          state.store[name] = state.store[name] || {};
          state.store[name][id] = { ...(state.store[name][id] || {}), ...v };
        },
      }),
    };
  }

  return { state, create, makeRef };
});

vi.mock('../../api/_firebaseAdmin.mjs', () => ({
  adminDb: { collection: (name) => h.makeRef(name) },
  verifyAuth: async () => ({ uid: 'parent1' }),
}));
vi.mock('../../api/_stripe.mjs', () => ({
  stripe: { checkout: { sessions: { create: h.create } } },
}));
vi.mock('../../api/_sentry.mjs', () => ({ captureError: () => {} }));

const { default: handler } = await import('../../api/pay/create-checkout-session.mjs');

const IP = '1.2.3.4';
const SEPT_MOIS_MS = 7 * 30 * 24 * 60 * 60 * 1000;

function seed({ influencerCreatedAt = new Date(), usages = [] } = {}) {
  h.state.store = {
    lessons: {
      L1: {
        teacher_id: 't1', student_id: 'child1', parent_id: 'parent1',
        status: 'confirmed', price_per_hour: 25, duration_hours: 1, mode: 'presentiel',
      },
    },
    influencers: { inf1: { code: 'ASSO42', active: true, created_at: influencerCreatedAt } },
    influencer_usages: Object.fromEntries(usages.map((u, i) => [`u${i}`, { influencer_uid: 'inf1', ...u }])),
    coupons: {},
    students: {},
    payments: {},
  };
}

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

const sessionArgs = () => h.create.mock.calls.at(-1)?.[0];

describe('checkout — code influenceur refusé', () => {
  beforeEach(() => { h.create.mockClear(); });

  it.each([
    ['2 usages déjà faits par ce payeur', { usages: [{ payer_uid: 'parent1' }, { payer_uid: 'parent1' }] }, 'COUPON_MAX_USAGE_REACHED'],
    ['IP déjà vue pour ce code', { usages: [{ payer_uid: 'autre', client_ip: IP }] }, 'COUPON_IP_LIMIT_REACHED'],
    ['code créé il y a 7 mois', { influencerCreatedAt: new Date(Date.now() - SEPT_MOIS_MS) }, 'COUPON_EXPIRED'],
  ])('%s → le paiement se crée quand même, sans remise', async (_label, setup, reason) => {
    seed(setup);
    const res = await pay('ASSO42');

    expect(res.statusCode).toBe(200);
    expect(res.body.url).toBe('https://checkout.stripe.test/cs_test_1');
    expect(res.body.couponIgnored).toEqual([{ code: 'ASSO42', reason }]);

    const args = sessionArgs();
    expect(args.line_items[0].price_data.unit_amount).toBe(3500); // 25 € prof + 10 € site
    expect(args.metadata.teacher_amount_cents).toBe('2500');      // le prof n'est jamais touché
    expect(args.metadata.influencer_uid).toBe('');                // aucune commission
    expect(args.metadata.coupon_discount_cents).toBe('0');
  });

  it('code valide → la remise s’applique toujours (non-régression)', async () => {
    seed();
    const res = await pay('ASSO42');

    expect(res.statusCode).toBe(200);
    expect(res.body.couponIgnored).toBeUndefined();
    const args = sessionArgs();
    expect(args.line_items[0].price_data.unit_amount).toBe(3000);
    expect(args.metadata.teacher_amount_cents).toBe('2500');
    expect(args.metadata.influencer_uid).toBe('inf1');
  });

  it('coupon nominatif inconnu → reste une erreur 400 (tapé par l’utilisateur)', async () => {
    seed();
    const res = await pay('BIENVENUE-XYZ');

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('COUPON_INVALID_OR_USED');
    expect(h.create).not.toHaveBeenCalled();
  });
});
