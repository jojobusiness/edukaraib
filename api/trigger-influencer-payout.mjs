import { adminDb, verifyAuth } from './_firebaseAdmin.mjs';
import { stripe } from './_stripe.mjs';
import { captureError } from './_sentry.mjs';

const APP_BASE_URL = process.env.APP_BASE_URL || 'https://www.edukaraib.com';

function validateIban(iban) {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.split('').map(c => {
    const n = c.charCodeAt(0) - 55;
    return n >= 10 ? String(n) : c;
  }).join('');
  let remainder = 0;
  for (const char of numeric) remainder = (remainder * 10 + parseInt(char, 10)) % 97;
  return remainder === 1;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  // Admin only
  const auth = await verifyAuth(req, res);
  if (!auth) return;

  const adminSnap = await adminDb.collection('users').doc(auth.uid).get();
  if (!adminSnap.exists || adminSnap.data()?.role !== 'admin') {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const { influencerUid } = body;

  if (!influencerUid) {
    return res.status(400).json({ error: 'MISSING_INFLUENCER_UID' });
  }

  const influRef = adminDb.collection('influencers').doc(influencerUid);
  const influSnap = await influRef.get();

  if (!influSnap.exists) {
    return res.status(404).json({ error: 'INFLUENCER_NOT_FOUND' });
  }

  const influ = influSnap.data() || {};
  const pendingEur = Number(influ.pendingPayout || 0);

  if (pendingEur <= 0) {
    return res.status(400).json({ error: 'NOTHING_TO_PAY' });
  }

  if (!influ.rib) {
    return res.status(400).json({ error: 'NO_IBAN_ON_FILE' });
  }

  // Validation IBAN : format + checksum mod97
  const iban = influ.rib.trim().replace(/\s/g, '').toUpperCase();
  const ibanRegex = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/;
  if (!ibanRegex.test(iban) || iban.length < 15 || iban.length > 34 || !validateIban(iban)) {
    return res.status(400).json({ error: 'INVALID_IBAN', detail: 'Format ou checksum IBAN incorrect.' });
  }

  // ── 1. Virement SEPA réel via Stripe Payouts ──────────────────────────────
  // Nécessite : compte Stripe live vérifié + solde disponible suffisant
  // Stripe retient les fonds ~7 jours avant qu'ils soient disponibles pour payout
  let stripePayout = null;
  let stripeError  = null;

  try {
    stripePayout = await stripe.payouts.create({
      amount:               Math.round(pendingEur * 100), // en centimes
      currency:             'eur',
      method:               'standard',                   // SEPA standard 1-2 jours ouvrés
      destination:          influ.rib,                    // IBAN directement
      statement_descriptor: 'EDUKARAIB COMMISSION',
      metadata: {
        influencer_uid:   influencerUid,
        influencer_name:  influ.name  || '',
        influencer_email: influ.email || '',
        triggered_by:     auth.uid,
      },
    });
  } catch (e) {
    stripeError = e?.message || String(e);
    console.error('[payout] Stripe error:', stripeError);
    captureError(e, { influencer_uid: influencerUid, amount_eur: pendingEur, context: 'influencer_payout' });
  }

  // ── 2. Mise à jour Firestore ──────────────────────────────────────────────
  // On enregistre le payout même si Stripe a échoué (status = 'failed')
  // pour garder une trace complète et permettre une correction manuelle
  const payoutEntry = {
    amount_eur:        pendingEur,
    iban:              influ.rib,
    triggered_by:      auth.uid,
    triggered_at:      new Date(),
    stripe_payout_id:  stripePayout?.id   || null,
    stripe_status:     stripePayout?.status || (stripeError ? 'failed' : null),
    stripe_error:      stripeError || null,
    // 'processing' -> Stripe confirmera 'paid' via webhook stripe.payout.paid
    // 'failed'     -> Stripe a refusé (solde insuffisant, IBAN invalide, etc.)
    status: stripeError ? 'failed' : 'processing',
  };

  try {
    await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(influRef);
      if (!snap.exists) throw new Error('not_found');
      const data    = snap.data() || {};
      const history = data.payoutHistory || [];
      tx.update(influRef, {
        pendingPayout: stripeError ? data.pendingPayout : 0, // remet à 0 seulement si Stripe OK
        payoutHistory: [...history, payoutEntry],
      });
    });
  } catch (txErr) {
    console.error('[payout] Firestore transaction error:', txErr?.message);
    captureError(txErr, { influencer_uid: influencerUid, context: 'influencer_payout_firestore' });
    return res.status(500).json({ error: 'FIRESTORE_ERROR', detail: txErr?.message });
  }

  // ── 3. Email de confirmation à l'influenceur ──────────────────────────────
  if (!stripeError && influ.email) {
    try {
      const { Resend } = await import('resend');
      const resendClient = new Resend(process.env.RESEND_API_KEY);
      const firstName = (influ.name || '').split(' ')[0] || 'là';
      const maskedIban = influ.rib.slice(0, 4) + ' •••• •••• ' + influ.rib.slice(-4);

      await resendClient.emails.send({
        from: 'EduKaraib <notifications@edukaraib.com>',
        to:   [influ.email],
        subject: `Virement de ${pendingEur.toFixed(2)} EUR en cours — EduKaraib`,
        html: `
          <div style="font-family:Inter,system-ui,sans-serif;background:#f5f7fb;padding:24px;">
            <table width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;margin:auto;background:#fff;border-radius:18px;overflow:hidden;border:1px solid #eef0f4;">
              <tr><td style="background:#0ea5e9;padding:18px 20px;">
                <span style="color:#fff;font-weight:700;font-size:16px;">EduKaraib</span>
              </td></tr>
              <tr><td style="padding:26px;">
                <h1 style="margin:0 0 10px;font-size:20px;color:#0f172a;">
                  Ton virement est en cours, ${firstName} ! 💸
                </h1>
                <p style="color:#334155;font-size:15px;line-height:1.65;">
                  Nous avons declenche un virement bancaire pour tes commissions EduKaraib.
                </p>

                <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:18px;margin:20px 0;">
                  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
                    <div>
                      <div style="font-size:13px;color:#166534;font-weight:600;">Montant vire</div>
                      <div style="font-size:28px;font-weight:800;color:#15803d;">${pendingEur.toFixed(2)} EUR</div>
                    </div>
                    <div style="text-align:right;">
                      <div style="font-size:13px;color:#166534;font-weight:600;">Vers le compte</div>
                      <div style="font-size:14px;font-weight:700;color:#15803d;font-family:monospace;">${maskedIban}</div>
                    </div>
                  </div>
                </div>

                <div style="background:#fafafa;border:1px solid #e2e8f0;border-radius:10px;padding:14px;font-size:13px;color:#64748b;line-height:1.7;">
                  <strong style="color:#0f172a;">Delai de reception :</strong> 1 a 2 jours ouvrés (virement SEPA standard).<br>
                  Si tu ne recois rien sous 3 jours, contacte-nous a
                  <a href="mailto:contact@edukaraib.com" style="color:#0ea5e9;">contact@edukaraib.com</a>.
                </div>

                <div style="margin-top:20px;">
                  <a href="${APP_BASE_URL}/influencer/commissions" style="background:#facc15;color:#111827;text-decoration:none;font-weight:700;padding:13px 20px;border-radius:12px;display:inline-block;">
                    Voir mes commissions
                  </a>
                </div>
              </td></tr>
              <tr><td style="padding:12px 26px 24px;color:#64748b;font-size:12px;">
                L'equipe EduKaraib &middot;
                <a href="mailto:contact@edukaraib.com" style="color:#0ea5e9;">contact@edukaraib.com</a>
              </td></tr>
            </table>
          </div>
        `,
      });
    } catch (mailErr) {
      console.warn('[payout] email failed:', mailErr?.message);
    }
  }

  // ── 4. Log RGPD (IBAN masqué) ─────────────────────────────────────────────
  const maskedIban = influ.rib.slice(0, 4) + '****' + influ.rib.slice(-4);
  console.log(`[payout] ${stripeError ? 'ECHEC' : 'OK'} — ${influ.name} (${influ.email}) — ${pendingEur} EUR → ${maskedIban}${stripePayout ? ' — Stripe ID: ' + stripePayout.id : ''}`);

  // ── 5. Réponse ────────────────────────────────────────────────────────────
  if (stripeError) {
    // L'admin voit l'erreur et peut corriger (IBAN invalide, solde insuffisant, etc.)
    return res.status(422).json({
      success:    false,
      error:      'STRIPE_PAYOUT_FAILED',
      detail:     stripeError,
      amount_eur: pendingEur,
      name:       influ.name,
    });
  }

  return res.json({
    success:          true,
    amount_eur:       pendingEur,
    stripe_payout_id: stripePayout.id,
    stripe_status:    stripePayout.status,
    name:             influ.name,
    email:            influ.email,
  });
}