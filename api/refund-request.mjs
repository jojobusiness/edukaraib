// refund-request.mjs
// -----------------------------------------------------------------------------
// Demande de remboursement par le payeur : motif obligatoire + justificatif
// (URL Firebase Storage). Cree un doc refund_requests en 'pending' et previent
// l'admin par email. Le remboursement reel n'est execute que par un admin
// via /api/refund (voir AdminDashboard, onglet Remboursements).
// -----------------------------------------------------------------------------

import { adminDb, verifyAuth } from './_firebaseAdmin.mjs';
import { Resend } from 'resend';
import { captureError } from './_sentry.mjs';

const ADMIN_EMAIL = 'edukaraib@gmail.com';

function readBody(req) {
  try {
    if (!req.body) return {};
    if (typeof req.body === 'string') return JSON.parse(req.body);
    return req.body;
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });

  const auth = await verifyAuth(req, res);
  if (!auth) return;

  const { paymentId, reason, proofUrl } = readBody(req);
  const cleanReason = String(reason || '').trim();
  if (!paymentId) return res.status(400).json({ error: 'MISSING_PAYMENT_ID' });
  if (cleanReason.length < 10) return res.status(400).json({ error: 'REASON_TOO_SHORT' });

  try {
    const paySnap = await adminDb.collection('payments').doc(String(paymentId)).get();
    if (!paySnap.exists) return res.status(404).json({ error: 'PAYMENT_NOT_FOUND' });
    const pay = paySnap.data();

    // Seul le payeur d'origine peut demander
    if (String(pay.payer_uid || '') !== String(auth.uid)) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }
    if (pay.status !== 'held' && pay.status !== 'released') {
      return res.status(400).json({ error: `INVALID_STATUS_${pay.status}` });
    }

    // Une seule demande en attente par paiement
    const dup = await adminDb.collection('refund_requests')
      .where('payment_id', '==', String(paymentId))
      .where('status', '==', 'pending')
      .limit(1)
      .get();
    if (!dup.empty) return res.status(409).json({ error: 'ALREADY_REQUESTED' });

    const reqDoc = await adminDb.collection('refund_requests').add({
      payment_id: String(paymentId),
      lesson_id: String(pay.lesson_id || ''),
      requester_uid: String(auth.uid),
      for_student: pay.for_student || null,
      amount_eur: Number(pay.gross_eur || 0),
      reason: cleanReason.slice(0, 2000),
      proof_url: proofUrl ? String(proofUrl) : null,
      status: 'pending',
      created_at: new Date(),
    });

    // Prevenir l'admin (non bloquant pour la reponse, mais await — Vercel gele apres res)
    if (process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: 'EduKaraib <notifications@edukaraib.com>',
        to: [ADMIN_EMAIL],
        subject: `🔔 Demande de remboursement — ${Number(pay.gross_eur || 0).toFixed(2)} €`,
        html: `<div style="font-family:Inter,system-ui,Arial,sans-serif;font-size:15px;color:#0f172a;line-height:1.7;">
<p><strong>Nouvelle demande de remboursement</strong></p>
<p>Montant : <strong>${Number(pay.gross_eur || 0).toFixed(2)} €</strong><br/>
Paiement : ${String(paymentId).slice(0, 40)}…<br/>
Motif : ${cleanReason.slice(0, 500).replace(/</g, '&lt;')}<br/>
Justificatif : ${proofUrl ? `<a href="${String(proofUrl)}">voir le fichier</a>` : 'aucun'}</p>
<p><a href="https://edukaraib.com/admin/dashboard" style="background:#00804B;color:#fff;text-decoration:none;font-weight:700;padding:10px 20px;border-radius:10px;display:inline-block;">Traiter dans le dashboard admin</a></p>
</div>`,
      }).catch((e) => console.warn('[refund-request] email admin failed:', e?.message));
    }

    return res.json({ ok: true, id: reqDoc.id });
  } catch (e) {
    console.error('refund-request error', e);
    captureError(e, { payment_id: paymentId, caller_uid: auth.uid });
    return res.status(500).json({ error: e.message });
  }
}
