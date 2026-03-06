import { stripe } from './_stripe.mjs';
import { adminDb, verifyAuth } from './_firebaseAdmin.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });

  const auth = await verifyAuth(req, res);
  if (!auth) return;

  const { lessonId } = req.body || {};
  if (!lessonId) return res.status(400).json({ error: 'MISSING_LESSON_ID' });

  const lessonSnap = await adminDb.collection('lessons').doc(lessonId).get();
  if (!lessonSnap.exists) return res.status(404).json({ error: 'LESSON_NOT_FOUND' });
  const lesson = { id: lessonSnap.id, ...lessonSnap.data() };

  if (lesson.status !== 'completed') {
    return res.status(400).json({ error: 'LESSON_NOT_COMPLETED' });
  }

  const teacherUid = lesson.teacher_id;
  if (!teacherUid) return res.status(400).json({ error: 'NO_TEACHER' });

  // Récupérer le prof
  const teacherSnap = await adminDb.collection('users').doc(teacherUid).get();
  const teacher = teacherSnap.exists ? teacherSnap.data() : null;
  const stripeAccountId = teacher?.stripeAccountId || null;
  const stripeReady = !!(stripeAccountId && teacher?.stripeChargesEnabled);

  try {
    // ── CAS PACK ──────────────────────────────────────────────
    if (lesson.pack_id) {
      const packSnap = await adminDb.collection('lessons')
        .where('pack_id', '==', lesson.pack_id)
        .where('teacher_id', '==', teacherUid)
        .get();

      const packLessons = packSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const allCompleted = packLessons.every(l => l.status === 'completed');
      const allPaid = packLessons.every(l => {
        if (l.is_group) {
          return (l.participant_ids || []).every(sid => !!l.participantsMap?.[sid]?.is_paid);
        }
        return !!l.is_paid;
      });

      if (!allCompleted || !allPaid) {
        return res.json({ ok: true, skipped: 'pack_not_fully_done' });
      }

      // Vérifier si un payout pack a déjà été fait
      const existingPayout = await adminDb.collection('payments')
        .where('pack_id', '==', lesson.pack_id)
        .where('status', 'in', ['released', 'payout_pending_rib'])
        .limit(1).get();

      if (!existingPayout.empty) {
        return res.json({ ok: true, skipped: 'pack_already_paid_out' });
      }

      // Calculer le total net prof pour tout le pack
      const paymentSnaps = await adminDb.collection('payments')
        .where('pack_id', '==', lesson.pack_id).get();

      const totalNetCents = paymentSnaps.docs.reduce((acc, d) => {
        return acc + Math.round(Number(d.data().net_to_teacher_eur || 0) * 100);
      }, 0);

      return await doPayout({
        res, stripeReady, stripeAccountId, teacherUid,
        amountCents: totalNetCents,
        lessonId: lesson.id,
        packId: lesson.pack_id,
        label: `Pack ${lesson.pack_id}`,
      });
    }

    // ── CAS INDIVIDUEL ────────────────────────────────────────
    const isPaid = lesson.is_group
      ? (lesson.participant_ids || []).some(sid => !!lesson.participantsMap?.[sid]?.is_paid)
      : !!lesson.is_paid;

    if (!isPaid) {
      return res.json({ ok: true, skipped: 'not_paid' });
    }

    // Chercher le payment document
    const paySnap = await adminDb.collection('payments')
      .where('lesson_id', '==', lessonId)
      .where('status', '==', 'held')
      .limit(1).get();

    if (paySnap.empty) {
      return res.json({ ok: true, skipped: 'no_held_payment' });
    }

    const payDoc = paySnap.docs[0];
    const netCents = Math.round(Number(payDoc.data().net_to_teacher_eur || 0) * 100);

    return await doPayout({
      res, stripeReady, stripeAccountId, teacherUid,
      amountCents: netCents,
      lessonId,
      paymentDocId: payDoc.id,
      label: `Cours ${lessonId}`,
    });

  } catch (e) {
    console.error('trigger-payout error:', e);
    return res.status(500).json({ error: e.message });
  }
}

async function doPayout({ res, stripeReady, stripeAccountId, teacherUid, amountCents, lessonId, packId, paymentDocId, label }) {
  if (amountCents <= 0) return res.json({ ok: true, skipped: 'zero_amount' });

  if (stripeReady) {
    // ✅ Virement Stripe automatique
    const transfer = await stripe.transfers.create({
      amount: amountCents,
      currency: 'eur',
      destination: stripeAccountId,
      metadata: { lesson_id: lessonId, pack_id: packId || '', teacher_uid: teacherUid },
    });

    const updateData = {
      status: 'released',
      transfer_id: transfer.id,
      released_at: new Date(),
      net_to_teacher_eur: amountCents / 100,
    };
    if (packId) updateData.pack_id = packId;

    if (paymentDocId) {
      await adminDb.collection('payments').doc(paymentDocId).set(updateData, { merge: true });
    } else {
      await adminDb.collection('payments').add({ ...updateData, lesson_id: lessonId, teacher_uid: teacherUid, created_at: new Date() });
    }

    return res.json({ ok: true, type: 'stripe_transfer', transfer_id: transfer.id, amount_eur: amountCents / 100 });

  } else {
    // ⚠️ Pas de Stripe → marqué pour virement manuel (RIB)
    const updateData = {
      status: 'payout_pending_rib',
      payout_pending_since: new Date(),
      net_to_teacher_eur: amountCents / 100,
      teacher_uid: teacherUid,
    };
    if (packId) updateData.pack_id = packId;

    if (paymentDocId) {
      await adminDb.collection('payments').doc(paymentDocId).set(updateData, { merge: true });
    } else {
      await adminDb.collection('payments').add({ ...updateData, lesson_id: lessonId, created_at: new Date() });
    }

    return res.json({ ok: true, type: 'pending_rib', amount_eur: amountCents / 100 });
  }
}