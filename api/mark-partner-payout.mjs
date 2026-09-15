// Admin — enregistre un reversement fait au partenaire par virement bancaire.
//
// Le virement se fait à la main depuis la banque (même principe que
// Factur'Peyi) : Stripe Payouts ne vire que vers les comptes bancaires de la
// plateforme elle-même, jamais vers l'IBAN d'un tiers. L'ancien bouton
// « Virer » passait l'IBAN du partenaire à stripe.payouts.create et ne
// pouvait donc pas aboutir.
import { adminDb, verifyAuth } from './_firebaseAdmin.mjs';
import { captureError } from './_sentry.mjs';
import { PARTNERS_COLLECTION, isValidIban, maskIban } from './_partners.mjs';
import { sendPartnerPayoutEmail } from './_partnerEmails.mjs';

const round2 = (n) => Math.round(n * 100) / 100;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });

  const auth = await verifyAuth(req, res);
  if (!auth) return;
  const adminSnap = await adminDb.collection('users').doc(auth.uid).get();
  if (!adminSnap.exists || adminSnap.data()?.role !== 'admin') {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const { partnerUid } = body;
  const reference = String(body.reference || '').trim().slice(0, 80);
  if (!partnerUid) return res.status(400).json({ error: 'MISSING_PARTNER_UID' });

  const ref = adminDb.collection(PARTNERS_COLLECTION).doc(String(partnerUid));
  let partner;
  let amountEur;
  try {
    await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw Object.assign(new Error('PARTNER_NOT_FOUND'), { status: 404 });
      partner = snap.data() || {};
      const pending = round2(Number(partner.pendingPayout || 0));
      amountEur = body.amountEur != null ? round2(Number(body.amountEur)) : pending;
      if (!(amountEur > 0)) throw Object.assign(new Error('NOTHING_TO_PAY'), { status: 400 });
      if (amountEur > pending) throw Object.assign(new Error('AMOUNT_ABOVE_PENDING'), { status: 400 });
      if (!isValidIban(partner.rib)) throw Object.assign(new Error('NO_VALID_IBAN'), { status: 400 });

      tx.update(ref, {
        pendingPayout: round2(pending - amountEur),
        payoutHistory: [...(partner.payoutHistory || []), {
          amount_eur: amountEur,
          iban_masked: maskIban(partner.rib),
          method: 'virement',
          reference,
          status: 'paid',
          triggered_by: auth.uid,
          triggered_at: new Date(),
        }],
      });
    });
  } catch (e) {
    if (e?.status) return res.status(e.status).json({ error: e.message });
    captureError(e, { partner_uid: partnerUid, context: 'partner_payout' });
    return res.status(500).json({ error: 'FIRESTORE_ERROR', detail: e?.message });
  }

  const emailSent = await sendPartnerPayoutEmail({
    to: partner.email,
    structureName: partner.name || '',
    amountEur,
    maskedIban: maskIban(partner.rib),
    reference,
  });

  return res.json({ success: true, amount_eur: amountEur, name: partner.name, email_sent: emailSent });
}
