// Cron quotidien (vercel.json) — reverse automatiquement aux partenaires ce qui
// leur est dû, par transfert Stripe Connect vers leur compte connecté. Stripe
// vire ensuite l'argent sur leur compte bancaire.
//
// Un cours n'est reversé que 7 jours après son paiement : le délai de
// remboursement de la 1ʳᵉ séance est passé. Un remboursement ultérieur est
// déduit du solde (api/refund.mjs), donc repris sur les reversements suivants.
import { adminDb } from './_firebaseAdmin.mjs';
import { stripe } from './_stripe.mjs';
import { captureError } from './_sentry.mjs';
import { PARTNERS_COLLECTION, PARTNER_MIN_TRANSFER_CENTS, partnerTransferDue } from './_partners.mjs';
import { sendPartnerPayoutEmail } from './_partnerEmails.mjs';

const round2 = (n) => Math.round(n * 100) / 100;

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(500).json({ error: 'SERVER_MISCONFIGURED' });
  // Vercel Cron envoie « Authorization: Bearer <CRON_SECRET> »
  const authHeader = req.headers.authorization || '';
  const key = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : req.headers['x-cron-secret'];
  if (!key || key !== secret) return res.status(403).json({ error: 'FORBIDDEN' });

  const snap = await adminDb.collection(PARTNERS_COLLECTION).where('pendingPayout', '>', 0).get();
  const report = { checked: snap.size, transferred: 0, total_eur: 0, not_connected: 0, not_due: 0, errors: 0 };

  for (const docSnap of snap.docs) {
    const id = docSnap.id;
    const partner = docSnap.data();
    try {
      if (!partner.stripe_account_id) { report.not_connected += 1; continue; }
      const acc = await stripe.accounts.retrieve(partner.stripe_account_id);
      if (acc.capabilities?.transfers !== 'active') { report.not_connected += 1; continue; }

      const { amountCents, cutoff } = partnerTransferDue({
        conversions: partner.conversions,
        transferredUntil: partner.transferred_until,
        pendingPayout: partner.pendingPayout,
      });
      if (amountCents < PARTNER_MIN_TRANSFER_CENTS) { report.not_due += 1; continue; }

      // Clé d'idempotence : un 2e passage le même jour ne vire pas deux fois
      const transfer = await stripe.transfers.create({
        amount: amountCents,
        currency: 'eur',
        destination: partner.stripe_account_id,
        description: `Reversement partenaire EduKaraib (${partner.code || id})`,
        metadata: { partner_uid: id, partner_code: partner.code || '', kind: 'partner_commission' },
      }, { idempotencyKey: `partner-${id}-${cutoff.toISOString().slice(0, 10)}-${amountCents}` });

      const amountEur = amountCents / 100;
      const ref = adminDb.collection(PARTNERS_COLLECTION).doc(id);
      await adminDb.runTransaction(async (tx) => {
        const fresh = (await tx.get(ref)).data() || {};
        tx.update(ref, {
          pendingPayout: round2(Number(fresh.pendingPayout || 0) - amountEur),
          transferred_until: cutoff,
          payoutHistory: [...(fresh.payoutHistory || []), {
            amount_eur: amountEur,
            method: 'stripe',
            transfer_id: transfer.id,
            status: 'paid',
            triggered_at: new Date(),
          }],
        });
      });

      await sendPartnerPayoutEmail({ to: partner.email, structureName: partner.name || '', amountEur, reference: transfer.id });
      report.transferred += 1;
      report.total_eur = round2(report.total_eur + amountEur);
    } catch (e) {
      // Solde Stripe pas encore disponible, compte restreint… : on retente demain
      report.errors += 1;
      console.error('[partner-payouts-cron]', id, e?.message);
      captureError(e, { partner_uid: id, context: 'partner_payouts_cron' });
    }
  }

  return res.json(report);
}
