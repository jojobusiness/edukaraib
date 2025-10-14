// refund.mjs
// -----------------------------------------------------------------------------
// Endpoint sécurisé pour rembourser un paiement (total ou partiel).
// Cas 1) status === 'held': Refund du PaymentIntent (simple).
// Cas 2) status === 'released': Reverse transfer + (si besoin) refund partiel du PI.
// -----------------------------------------------------------------------------

import { stripe } from './_stripe.mjs';
import { adminDb, verifyAuth } from './_firebaseAdmin.mjs';

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

  // Protège cet endpoint (ex: admin uniquement)
  const auth = await verifyAuth(req, res);
  if (!auth) return;
  const adminUid = auth.uid;

  const { paymentId, amount_eur, reason } = readBody(req);
  if (!paymentId) return res.status(400).json({ error: 'MISSING_PAYMENT_ID' });

  // Charger le document payment
  const paymentRef = adminDb.collection('payments').doc(String(paymentId));
  const paySnap = await paymentRef.get();
  if (!paySnap.exists) return res.status(404).json({ error: 'PAYMENT_NOT_FOUND' });

  const pay = { id: paySnap.id, ...paySnap.data() };
  const amountCents = amount_eur ? Math.round(Number(amount_eur) * 100) : null;

  // Charger la leçon
  const lessonRef = adminDb.collection('lessons').doc(String(pay.lesson_id));
  const lessonSnap = await lessonRef.get();
  const lesson = lessonSnap.exists ? { id: lessonSnap.id, ...lessonSnap.data() } : null;

  try {
    if (pay.status === 'held') {
      // --- Cas A: Non libéré au prof => simple Refund du PaymentIntent
      if (!pay.payment_intent_id) {
        return res.status(400).json({ error: 'MISSING_PAYMENT_INTENT' });
      }

      const refundParams = {
        payment_intent: pay.payment_intent_id,
        // si amountCents null => remboursement total
        ...(amountCents ? { amount: amountCents } : {}),
        ...(reason ? { reason } : {}),
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

      // Révoque le flag "is_paid" sur la leçon pour l'élève concerné
      await revokeLessonPaidFlag(lessonRef, lesson, pay.for_student);

      return res.json({ ok: true, type: 'refund', id: refund.id });
    }

    if (pay.status === 'released') {
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
          ...(reason ? { reason } : {}),
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
    return res.status(500).json({ error: e.message });
  }
}

/**
 * Révoque les drapeaux de paiement sur la leçon
 * - Groupé : participantsMap[forStudent].is_paid = false
 * - Individuel : is_paid = false
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
        }
      }
    }, { merge: true });
    return;
  }

  await lessonRef.set({
    is_paid: false,
    paid_at: null,
    paid_by: null,
  }, { merge: true });
}