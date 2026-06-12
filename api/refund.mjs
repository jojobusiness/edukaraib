// refund.mjs
// -----------------------------------------------------------------------------
// Endpoint sécurisé pour rembourser un paiement (total ou partiel).
// Cas 1) status === 'held': Refund du PaymentIntent (simple).
// Cas 2) status === 'released': Reverse transfer + (si besoin) refund partiel du PI.
// -----------------------------------------------------------------------------

import { stripe } from './_stripe.mjs';
import { adminDb, verifyAuth } from './_firebaseAdmin.mjs';
import { captureError } from './_sentry.mjs';
import { Resend } from 'resend';

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

  // ADMIN UNIQUEMENT : le remboursement passe desormais par une demande
  // (refund_requests via /api/refund-request) validee dans le dashboard admin.
  const auth = await verifyAuth(req, res);
  if (!auth) return;
  const adminUid = auth.uid;

  const callerSnap = await adminDb.collection('users').doc(adminUid).get();
  const callerRole = callerSnap.exists ? callerSnap.data()?.role : null;
  if (callerRole !== 'admin') {
    return res.status(403).json({ error: 'ADMIN_ONLY' });
  }

  const { paymentId, amount_eur, reason, requestId } = readBody(req);
  if (!paymentId) return res.status(400).json({ error: 'MISSING_PAYMENT_ID' });

  // Charger le document payment
  const paymentRef = adminDb.collection('payments').doc(String(paymentId));
  const paySnap = await paymentRef.get();
  if (!paySnap.exists) return res.status(404).json({ error: 'PAYMENT_NOT_FOUND' });

  const pay = { id: paySnap.id, ...paySnap.data() };
  const amountCents = amount_eur ? Math.round(Number(amount_eur) * 100) : null;

  // ── Idempotence : réclamer le remboursement atomiquement ──────────────────
  // Sans ça, deux soumissions simultanées (ou un retry réseau) peuvent lancer
  // deux fois reverse transfer + refund → on rembourse deux fois.
  const originalStatus = pay.status;
  if (originalStatus !== 'held' && originalStatus !== 'released') {
    return res.status(400).json({ error: `INVALID_STATUS_${originalStatus}` });
  }
  const claimed = await adminDb.runTransaction(async (tx) => {
    const s = await tx.get(paymentRef);
    const st = s.data()?.status;
    if (st !== 'held' && st !== 'released') return false;
    tx.update(paymentRef, { status: 'refunding', refund_started_at: new Date() });
    return true;
  });
  if (!claimed) return res.status(409).json({ error: 'REFUND_ALREADY_IN_PROGRESS' });

  // Charger la leçon
  const lessonRef = adminDb.collection('lessons').doc(String(pay.lesson_id));
  const lessonSnap = await lessonRef.get();
  const lesson = lessonSnap.exists ? { id: lessonSnap.id, ...lessonSnap.data() } : null;

  try {
    if (originalStatus === 'held') {
      // --- Cas A: Non libéré au prof => simple Refund du PaymentIntent
      if (!pay.payment_intent_id) {
        return res.status(400).json({ error: 'MISSING_PAYMENT_INTENT' });
      }

      const refundParams = {
        payment_intent: pay.payment_intent_id,
        // si amountCents null => remboursement total
        ...(amountCents ? { amount: amountCents } : {}),
        // NE PAS passer `reason` a Stripe : il n'accepte que l'enum
        // duplicate/fraudulent/requested_by_customer — un texte libre = 400.
        // Le motif est conserve dans Firestore (refund_reason) et l'email client.
        reason: 'requested_by_customer',
      };
      const refund = await stripe.refunds.create(refundParams);

      // Met à jour payment
      await paymentRef.set({
        status: 'refunded',
        refunded_at: new Date(),
        refund_id: refund.id,
        refund_amount_eur: refund.amount / 100,
        refund_reason: reason || null,
        refunded_by: adminUid,
      }, { merge: true });

      // Révoque le flag "is_paid" + passe la leçon en "rejected" (libère le créneau)
      await revokeLessonPaidFlag(lessonRef, lesson, pay.for_student);
      await finalizeRefundSideEffects({ requestId, pay, adminUid, refundAmountEur: refund.amount / 100, reason });

      return res.json({ ok: true, type: 'refund', id: refund.id });
    }

    if (originalStatus === 'released') {
      // --- Cas B: Déjà libéré au prof => il faut reprendre l'argent (reverse transfer)
      // 1) Reverse transfer (total ou partiel)
      if (!pay.transfer_id) {
        return res.status(400).json({ error: 'MISSING_TRANSFER_ID' });
      }
      // montant reverse: par défaut, on reprend tout ce qui a été versé au prof
      let reverseAmountCents = null;
      if (amountCents !== null) {
        // Si tu veux rembourser partiellement côté client, tu peux splitter:
        // - reverse côté prof à hauteur de la part prof dans la somme remboursée (pro-rata)
        // Ici, on suppose remboursement TOTAL => reverse TOTAL. Si partiel, calcule un prorata.
        // Exemple simple (prorata):
        const totalGrossCents = Math.round(Number(pay.gross_eur || 0) * 100); // montant client
        const netToTeacherCents = Math.round(Number(pay.net_to_teacher_eur || 0) * 100);
        if (totalGrossCents > 0) {
          reverseAmountCents = Math.min(
            netToTeacherCents,
            Math.floor(netToTeacherCents * (amountCents / totalGrossCents))
          );
        }
      }

      const reversal = await stripe.transfers.createReversal(pay.transfer_id, {
        ...(reverseAmountCents ? { amount: reverseAmountCents } : {}),
        metadata: {
          payment_id: pay.id,
          lesson_id: String(pay.lesson_id || ''),
          reason: reason || 'refund',
          admin_uid: adminUid,
        },
      });

      // 2) (optionnel) Refund carte côté client pour la part “plateforme”
      //    Si remboursement total côté client:
      let refund = null;
      if (pay.payment_intent_id) {
        const refundParams = {
          payment_intent: pay.payment_intent_id,
          ...(amountCents ? { amount: amountCents } : {}),
          // enum Stripe uniquement — le motif texte reste dans Firestore/email
          reason: 'requested_by_customer',
        };
        refund = await stripe.refunds.create(refundParams);
      }

      await paymentRef.set({
        status: 'refunded',
        refunded_at: new Date(),
        refund_id: refund?.id || null,
        refund_amount_eur: refund ? refund.amount / 100 : (amountCents ? amountCents / 100 : pay.gross_eur || null),
        refund_reason: reason || null,
        refunded_by: adminUid,
        reverse_transfer_id: reversal.id,
        reverse_amount_eur: reversal.amount / 100,
      }, { merge: true });

      await revokeLessonPaidFlag(lessonRef, lesson, pay.for_student);
      await finalizeRefundSideEffects({ requestId, pay, adminUid, refundAmountEur: refund ? refund.amount / 100 : (amountCents ? amountCents / 100 : pay.gross_eur || 0), reason });

      return res.json({
        ok: true,
        type: 'reverse_and_refund',
        reverse_id: reversal.id,
        refund_id: refund?.id || null,
      });
    }

    // cas déjà remboursé / autre statut
    return res.status(400).json({ error: `INVALID_STATUS_${pay.status}` });

  } catch (e) {
    console.error('refund error', e);
    captureError(e, { payment_id: paymentId, caller_uid: adminUid });
    // Stripe a échoué après avoir réclamé le remboursement : on rend le paiement
    // à son état d'origine pour qu'une nouvelle tentative reste possible.
    try {
      await paymentRef.set({ status: originalStatus, refund_started_at: null }, { merge: true });
    } catch (revertErr) {
      console.warn('refund revert failed', revertErr?.message);
    }
    return res.status(500).json({ error: e.message });
  }
}

/**
 * Révoque les drapeaux de paiement sur la leçon ET la passe en "rejected"
 * (le cours rembourse ne doit pas rester "confirmé" : le créneau est libéré,
 * l'élève peut réserver ailleurs — demande explicite de Joseph 2026-06-12)
 * - Groupé : participantsMap[forStudent] -> is_paid false + status rejected
 * - Individuel : is_paid false + status rejected
 */
async function revokeLessonPaidFlag(lessonRef, lesson, forStudent) {
  if (!lesson) return;
  const isGroup = Array.isArray(lesson.participant_ids) && lesson.participant_ids.length > 0;

  if (isGroup && forStudent) {
    await lessonRef.set({
      participantsMap: {
        [String(forStudent)]: {
          ...(lesson.participantsMap?.[String(forStudent)] || {}),
          is_paid: false,
          paid_at: null,
          paid_by: null,
          status: 'rejected',
        }
      }
    }, { merge: true });
    // Solo deguise en groupe (1 participant) : on rejette aussi la lecon
    if ((lesson.participant_ids || []).length === 1) {
      await lessonRef.set({ status: 'rejected', is_paid: false, paid_at: null, paid_by: null }, { merge: true });
    }
    return;
  }

  await lessonRef.set({
    is_paid: false,
    paid_at: null,
    paid_by: null,
    status: 'rejected',
  }, { merge: true });
}

/**
 * Apres remboursement Stripe reussi : clore la demande + email au client.
 */
async function finalizeRefundSideEffects({ requestId, pay, adminUid, refundAmountEur, reason }) {
  if (requestId) {
    await adminDb.collection('refund_requests').doc(String(requestId)).set({
      status: 'approved',
      processed_at: new Date(),
      processed_by: adminUid,
      refund_amount_eur: refundAmountEur,
    }, { merge: true }).catch((e) => console.warn('[refund] request update failed:', e?.message));
  }

  // Email d'explication au payeur
  try {
    if (!process.env.RESEND_API_KEY || !pay.payer_uid) return;
    const payerSnap = await adminDb.collection('users').doc(String(pay.payer_uid)).get();
    const email = payerSnap.exists ? payerSnap.data()?.email : null;
    if (!email) return;
    const prenom = payerSnap.data()?.firstName || payerSnap.data()?.displayName?.split(' ')[0] || 'là';
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'EduKaraib <notifications@edukaraib.com>',
      to: [email],
      subject: `✅ Votre remboursement de ${Number(refundAmountEur || 0).toFixed(2)} € est validé`,
      html: `<div style="font-family:Inter,system-ui,Arial,sans-serif;background:#f5f7fb;padding:24px;">
<table width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:auto;background:#fff;border-radius:18px;overflow:hidden;border:1px solid #e2e8f0;">
<tr><td style="background:#00804B;padding:18px 24px;"><span style="color:#fff;font-weight:700;font-size:17px;">EduKaraib</span></td></tr>
<tr><td style="padding:28px;">
<h1 style="margin:0 0 12px;font-size:21px;color:#0f172a;">Remboursement validé ✅</h1>
<p style="color:#475569;font-size:15px;line-height:1.7;margin:0 0 16px;">
Bonjour ${prenom},<br/><br/>
Votre demande de remboursement a été acceptée. <strong>${Number(refundAmountEur || 0).toFixed(2)} €</strong> ont été renvoyés vers votre moyen de paiement — le montant apparaîtra sur votre compte sous <strong>5 à 10 jours ouvrés</strong> selon votre banque.
${reason ? `<br/><br/>Motif retenu : ${String(reason).slice(0, 300).replace(/</g, '&lt;')}` : ''}
</p>
<p style="color:#64748b;font-size:13px;margin:0;">Le cours concerné a été annulé. Vous pouvez réserver un autre professeur à tout moment.</p>
<div style="text-align:center;margin-top:20px;">
<a href="https://edukaraib.com/search" style="background:#facc15;color:#111827;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:12px;display:inline-block;">Trouver un cours →</a>
</div>
</td></tr>
<tr><td style="padding:12px 28px 20px;color:#94a3b8;font-size:12px;border-top:1px solid #f1f5f9;">
EduKaraib · <a href="mailto:contact@edukaraib.com" style="color:#00804B;">contact@edukaraib.com</a>
</td></tr>
</table>
</div>`,
    });
  } catch (e) {
    console.warn('[refund] confirmation email failed:', e?.message);
  }
}