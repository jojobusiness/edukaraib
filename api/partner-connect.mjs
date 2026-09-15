// Le partenaire connecte son compte bancaire via Stripe Connect (Express), comme
// les profs. Ses reversements lui sont ensuite transférés automatiquement par
// api/partner-payouts-cron.mjs, puis Stripe les vire sur son compte bancaire.
// Stripe vérifie l'identité du bénéficiaire : c'est le garde-fou anti-fraude
// d'une inscription sans validation manuelle.
//   GET  → état du compte (connecté ? transferts actifs ?)
//   POST → lien Stripe : inscription, ou tableau de bord Express si déjà fait
import { stripe } from './_stripe.mjs';
import { adminDb, verifyAuth } from './_firebaseAdmin.mjs';
import { captureError } from './_sentry.mjs';
import { PARTNERS_COLLECTION, PARTNER_ROLE } from './_partners.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const auth = await verifyAuth(req, res);
  if (!auth) return;

  const userSnap = await adminDb.collection('users').doc(auth.uid).get();
  if (!userSnap.exists || userSnap.data()?.role !== PARTNER_ROLE) {
    return res.status(403).json({ error: 'ONLY_PARTNER' });
  }
  const ref = adminDb.collection(PARTNERS_COLLECTION).doc(auth.uid);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: 'PARTNER_NOT_FOUND' });
  const partner = snap.data();
  let accountId = partner.stripe_account_id || null;

  try {
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      if (!accountId) return res.json({ connected: false, transfers_active: false, details_submitted: false });
      const acc = await stripe.accounts.retrieve(accountId);
      return res.json({
        connected: true,
        transfers_active: acc.capabilities?.transfers === 'active',
        details_submitted: !!acc.details_submitted,
        payouts_enabled: !!acc.payouts_enabled,
      });
    }

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'FR',
        email: partner.email || undefined,
        capabilities: { transfers: { requested: true } },
        business_profile: {
          name: partner.name || undefined,
          url: 'https://edukaraib.com',
          support_email: partner.email || undefined,
        },
        metadata: { partner_uid: auth.uid, partner_code: partner.code || '' },
      });
      accountId = account.id;
      await ref.update({ stripe_account_id: accountId });
    }

    // Compte déjà configuré : tableau de bord Express (changer de banque, voir les virements).
    const acc = await stripe.accounts.retrieve(accountId);
    if (acc.details_submitted) {
      const login = await stripe.accounts.createLoginLink(accountId);
      return res.json({ url: login.url });
    }

    const base = process.env.APP_BASE_URL || 'https://www.edukaraib.com';
    const link = await stripe.accountLinks.create({
      account: accountId,
      type: 'account_onboarding',
      return_url: `${base}/partenaire/espace`,
      refresh_url: `${base}/partenaire/espace`,
    });
    return res.json({ url: link.url });
  } catch (e) {
    console.error('[partner-connect]', e?.message);
    captureError(e, { partner_uid: auth.uid, context: 'partner_connect' });
    return res.status(500).json({ error: e?.code || 'STRIPE_ERROR', message: e?.message });
  }
}
