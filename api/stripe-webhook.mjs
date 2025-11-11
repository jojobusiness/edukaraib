import { stripe } from './_stripe.mjs';
import { adminDb, rawBody } from './_firebaseAdmin.mjs';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    const buf = await rawBody(req);
    event = stripe.webhooks.constructEvent(
      buf,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        // Peut suffire (les metadata sont sur la Session ET sur le PI via payment_intent_data.metadata)
        await markPaymentHeldAndUpdateLesson({ sessionId: session.id, paymentIntentId: session.payment_intent }, session.metadata);
        break;
      }
      case 'payment_intent.succeeded': {
        const pi = event.data.object;
        await markPaymentHeldAndUpdateLesson({ sessionId: null, paymentIntentId: pi.id }, pi.metadata);
        break;
      }
      default:
        break;
    }
    res.json({ received: true });
  } catch (e) {
    console.error('webhook handler error:', e);
    res.status(500).json({ error: 'webhook_error' });
  }
}

async function markPaymentHeldAndUpdateLesson(refs, metadata) {
  // Récup métadonnées robustes
  const md = metadata || {};
  const lessonId  = md.lesson_id || md.lessonId;

  // ⚠️ DÉFINIR AVANT TOUT USAGE
  const forStudent = md.for_student || md.student_id || md.studentId || null;
  const payerUid   = md.payer_uid || md.payerUid || null;
  const teacherUid = md.teacher_uid || md.teacher_id || null;

  // ✅ Support des packs : plusieurs leçons dans metadata.lesson_ids
  const lessonIds = (md.lesson_ids || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

  if (lessonIds.length > 1) {
    console.log(`Webhook: paiement pack détecté (${lessonIds.length} leçons)`);

    for (const id of lessonIds) {
      const ref  = adminDb.collection('lessons').doc(String(id));
      const snap = await ref.get();
      if (!snap.exists) continue;

      if (forStudent) {
        await ref.set({
          participantsMap: {
            [String(forStudent)]: {
              ...(snap.data()?.participantsMap?.[String(forStudent)] || {}),
              is_paid: true,
              paid_at: new Date(),
              paid_by: payerUid || null,
            },
          },
        }, { merge: true });
      } else {
        await ref.set({
          is_paid: true,
          paid_at: new Date(),
          paid_by: payerUid || null,
        }, { merge: true });
      }
    }
  }

  const teacherAmountCents = Number(md.teacher_amount_cents || 0);
  const siteFeeCents = Number(md.site_fee_cents || 0);
  const isGroup = String(md.is_group || '') === 'true';

  if (!lessonId) return; // rien à faire sans leçon

  // Récupérer le PaymentIntent complet (pour charge / montants exacts)
  let pi = null;
  if (refs.paymentIntentId) {
    pi = await stripe.paymentIntents.retrieve(refs.paymentIntentId, { expand: ['latest_charge.balance_transaction'] });
  }
  const charge = pi?.charges?.data?.[0] || null;
  const grossCents = pi?.amount_received ?? pi?.amount ?? 0;

  // 1) Mettre à jour la leçon : payé POUR L'ÉLÈVE ciblé, afin d'éviter un double paiement
  const lessonRef = adminDb.collection('lessons').doc(String(lessonId));
  const lessonSnap = await lessonRef.get();
  if (lessonSnap.exists) {
    if (isGroup && forStudent) {
      await lessonRef.set({
        participantsMap: {
          [String(forStudent)]: {
            is_paid: true,
            paid_at: new Date(),
            paid_by: payerUid || null,
            ...(lessonSnap.data()?.participantsMap?.[String(forStudent)] || {}),
          }
        }
      }, { merge: true });
    } else {
      await lessonRef.set({
        is_paid: true,
        paid_at: new Date(),
        paid_by: payerUid || null,
        total_amount: (grossCents || 0) / 100,
        payment_intent_id: pi?.id || null,
        stripe_charge_id: charge?.id || null,
      }, { merge: true });
    }
  }

  // 2) Marquer le paiement “held” côté payments (en attente de versement prof)
  const paymentDocId = refs.sessionId || refs.paymentIntentId;
  if (paymentDocId) {
    await adminDb.collection('payments').doc(paymentDocId).set({
      status: 'held',                  // ✅ argent encaissé par la plateforme, pas encore versé au prof
      updated_at: new Date(),
      lesson_id: String(lessonId),
      for_student: forStudent ? String(forStudent) : null,
      teacher_uid: teacherUid || null,
      gross_eur: (grossCents || 0) / 100,
      fee_eur: (siteFeeCents || 0) / 100,
      net_to_teacher_eur: Math.max(0, teacherAmountCents) / 100,
      payment_intent_id: pi?.id || refs.paymentIntentId || null,
      stripe_charge_id: charge?.id || null,
      // Tu pourras plus tard compléter lors du “release” avec transfer_id, released_at, etc.
    }, { merge: true });
  } else {
    // fallback: ajouter un record si pas de sessionId
    await adminDb.collection('payments').add({
      status: 'held',
      created_at: new Date(),
      updated_at: new Date(),
      lesson_id: String(lessonId),
      for_student: forStudent ? String(forStudent) : null,
      teacher_uid: teacherUid || null,
      gross_eur: (grossCents || 0) / 100,
      fee_eur: (siteFeeCents || 0) / 100,
      net_to_teacher_eur: Math.max(0, teacherAmountCents) / 100,
      payment_intent_id: pi?.id || null,
      stripe_charge_id: charge?.id || null,
    });
  }
}