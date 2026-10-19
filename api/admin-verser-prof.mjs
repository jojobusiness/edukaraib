// Verser à un prof l'argent qu'on lui doit — depuis l'admin (19/10/2026).
//
// Cas traité : un cours fait, payé, mais le prof n'avait pas connecté Stripe
// au moment du versement → `trigger-payout` a posé `payout_pending_rib`. Rien
// ne relançait ce versement ensuite : `trigger-payout` n'accepte que `held`,
// et le bouton « Marquer viré » de l'ancien onglet écrivait directement dans
// `payments`, ce que les règles Firestore interdisent (`allow write: if false`).
// L'argent restait donc bloqué chez nous.
//
// Ici : on refait le versement par Stripe Connect, comme trigger-payout — un
// transfert du montant ENTIER dû au prof. Jamais de virement manuel vers un
// IBAN (cf. CLAUDE.md : payer un tiers = Connect + transfers.create).
import { stripe } from './_stripe.mjs';
import { adminDb } from './_firebaseAdmin.mjs';
import { requireAdmin } from './_adminAuth.mjs';
import { captureError } from './_sentry.mjs';

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { paymentId } = readBody(req);
  if (!paymentId) return res.status(400).json({ error: 'MISSING_PAYMENT_ID' });

  const ref = adminDb.collection('payments').doc(String(paymentId));
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: 'PAYMENT_NOT_FOUND' });
  const pay = snap.data();
  if (pay.status !== 'payout_pending_rib') return res.status(409).json({ error: 'PAS_A_VERSER', status: pay.status });

  const teacherUid = pay.teacher_uid || pay.teacher_id;
  const amountCents = Math.round(Number(pay.net_to_teacher_eur || 0) * 100);
  if (!teacherUid || !(amountCents > 0)) return res.status(400).json({ error: 'MONTANT_OU_PROF_MANQUANT' });

  // Même condition que trigger-payout pour considérer le compte Stripe prêt.
  const teacherSnap = await adminDb.collection('users').doc(String(teacherUid)).get();
  const teacher = teacherSnap.exists ? teacherSnap.data() : {};
  if (!teacher.stripeAccountId || !teacher.stripeChargesEnabled) {
    return res.status(409).json({ error: 'PROF_SANS_STRIPE' });
  }

  // Verrou : un double clic ne doit jamais verser deux fois.
  const claimed = await adminDb.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (s.data()?.status !== 'payout_pending_rib') return false;
    tx.update(ref, { status: 'processing', payout_processing_at: new Date() });
    return true;
  });
  if (!claimed) return res.status(409).json({ error: 'DEJA_EN_COURS' });

  try {
    const transfer = await stripe.transfers.create(
      {
        amount: amountCents,
        currency: 'eur',
        destination: teacher.stripeAccountId,
        metadata: { payment_id: String(paymentId), lesson_id: String(pay.lesson_id || ''), teacher_uid: String(teacherUid), source: 'admin' },
      },
      { idempotencyKey: `verser-prof-${paymentId}` },
    );
    await ref.set({
      status: 'released',
      transfer_id: transfer.id,
      released_at: new Date(),
      released_by: admin.uid,
    }, { merge: true });
    return res.status(200).json({ ok: true, transfer_id: transfer.id, amount_eur: amountCents / 100 });
  } catch (e) {
    // Rien n'est parti : on rend le paiement à son état pour pouvoir réessayer.
    await ref.set({ status: 'payout_pending_rib' }, { merge: true }).catch(() => {});
    captureError(e, { payment_id: paymentId, teacher_uid: teacherUid });
    return res.status(502).json({ error: 'STRIPE_TRANSFER_FAILED', message: e?.message });
  }
}
