import { stripe } from './_stripe.mjs';
import { adminDb, verifyAuth } from './_firebaseAdmin.mjs';
import { Resend } from 'resend';
import { captureError } from './_sentry.mjs';

const GOOGLE_REVIEW_URL = 'https://www.google.com/search?q=EduKaraib+cours+particuliers+Antilles&hl=fr';
const APP_BASE_URL = process.env.APP_BASE_URL || 'https://edukaraib.com';

async function sendGoogleReviewEmail(payerUid, lessonId) {
  if (!payerUid || !process.env.RESEND_API_KEY) return;
  try {
    const payerSnap = await adminDb.collection('users').doc(payerUid).get();
    if (!payerSnap.exists) return;
    const payer = payerSnap.data();
    if (!payer.email) return;
    const prenom = payer.firstName || payer.displayName?.split(' ')[0] || 'là';
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'EduKaraib <notifications@edukaraib.com>',
      to: [payer.email],
      subject: '⭐ Comment s\'est passée votre expérience EduKaraib ?',
      html: `<div style="font-family:Inter,system-ui,sans-serif;background:#f5f7fb;padding:24px;">
<table width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:auto;background:#fff;border-radius:18px;overflow:hidden;border:1px solid #e2e8f0;">
<tr><td style="background:#00804B;padding:18px 24px;"><span style="color:#fff;font-weight:700;font-size:17px;">EduKaraib</span></td></tr>
<tr><td style="padding:28px;">
<h1 style="margin:0 0 12px;font-size:22px;color:#0f172a;">Votre avis compte beaucoup, ${prenom} 🙏</h1>
<p style="color:#475569;font-size:15px;line-height:1.7;margin:0 0 20px;">
Votre pack de cours est terminé ! Nous espérons que l'expérience a été à la hauteur de vos attentes.<br><br>
Pourriez-vous prendre 30 secondes pour laisser un avis ? Cela aide d'autres familles à trouver de bons professeurs.
</p>
<div style="text-align:center;margin-bottom:24px;">
<a href="${GOOGLE_REVIEW_URL}" style="background:#facc15;color:#111827;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:12px;display:inline-block;font-size:16px;">⭐ Laisser un avis Google</a>
</div>
<p style="color:#94a3b8;font-size:13px;text-align:center;">Ça ne prend que 30 secondes et c'est une aide précieuse pour notre équipe.</p>
<hr style="border:none;border-top:1px solid #f1f5f9;margin:20px 0;" />
<p style="color:#64748b;font-size:13px;text-align:center;">
Vous pouvez aussi consulter <a href="${APP_BASE_URL}/search" style="color:#00804B;">nos autres professeurs</a> pour continuer l'aventure.
</p>
</td></tr>
<tr><td style="padding:12px 28px 20px;color:#94a3b8;font-size:12px;border-top:1px solid #f1f5f9;">
EduKaraib · <a href="mailto:contact@edukaraib.com" style="color:#00804B;">contact@edukaraib.com</a>
</td></tr>
</table>
</div>`,
    });
  } catch (e) {
    console.warn('[trigger-payout] google review email failed:', e?.message);
  }
}

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

  // ✅ Seul le prof concerné ou un admin peut déclencher le virement
  // Sans ce check, n'importe quel utilisateur connecté peut forcer un payout
  if (auth.uid !== teacherUid) {
    const callerSnap = await adminDb.collection('users').doc(auth.uid).get();
    const isAdmin = callerSnap.exists && callerSnap.data()?.role === 'admin';
    if (!isAdmin) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }
  }

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
      const totalCount = packLessons.length;
      if (totalCount === 0) return res.json({ ok: true, skipped: 'empty_pack' });

      // Seules les leçons complétées ET payées donnent lieu au payout prof
      const completedAndPaid = packLessons.filter(l => {
        const done = l.status === 'completed';
        const paid = l.is_group
          ? (l.participant_ids || []).some(sid => !!l.participantsMap?.[sid]?.is_paid)
          : !!l.is_paid;
        return done && paid;
      });
      const completedCount = completedAndPaid.length;

      if (completedCount === 0) {
        return res.json({ ok: true, skipped: 'no_completed_paid_lessons' });
      }

      // Retrouver le document payment (lesson_ids est un tableau dans Firestore)
      const paySnap = await adminDb.collection('payments')
        .where('lesson_ids', 'array-contains', lessonId)
        .limit(1).get();

      if (!paySnap.empty) {
        const currentStatus = paySnap.docs[0].data().status;
        if (currentStatus === 'released' || currentStatus === 'payout_pending_rib') {
          return res.json({ ok: true, skipped: 'pack_already_paid_out' });
        }
      }

      if (paySnap.empty) {
        return res.json({ ok: true, skipped: 'no_held_payment' });
      }

      const payDoc = paySnap.docs[0];
      const payData = payDoc.data();
      const totalNetCents   = Math.round(Number(payData.net_to_teacher_eur || 0) * 100);
      const totalGrossCents = Math.round(Number(payData.gross_eur || 0) * 100);

      // Prorata : prof payé pour les leçons faites, client remboursé pour les non faites
      const uncompletedCount   = totalCount - completedCount;
      const teacherAmountCents = Math.round(totalNetCents * completedCount / totalCount);
      const refundCents        = Math.round(totalGrossCents * uncompletedCount / totalCount);

      return await doPackSettlement({
        res, stripeReady, stripeAccountId, teacherUid,
        teacherAmountCents, refundCents,
        chargeId: payData.stripe_charge_id || null,
        paymentIntentId: payData.payment_intent_id || null,
        lessonId: lesson.id,
        packId: lesson.pack_id,
        payDoc,
        completedCount, totalCount,
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
    captureError(e, { lesson_id: lessonId, teacher_uid: teacherUid });
    return res.status(500).json({ error: e.message });
  }
}

async function doPackSettlement({
  res, stripeReady, stripeAccountId, teacherUid,
  teacherAmountCents, refundCents,
  chargeId, paymentIntentId,
  lessonId, packId, payDoc,
  completedCount, totalCount,
}) {
  let transferId = null;
  let refundId   = null;
  let refundError = null;

  // 1) Payer le prof pour les leçons complétées
  if (teacherAmountCents > 0) {
    if (stripeReady) {
      const transfer = await stripe.transfers.create({
        amount: teacherAmountCents,
        currency: 'eur',
        destination: stripeAccountId,
        metadata: {
          lesson_id: String(lessonId),
          pack_id: String(packId || ''),
          teacher_uid: String(teacherUid),
          completed_lessons: String(completedCount),
          total_lessons: String(totalCount),
        },
      });
      transferId = transfer.id;
    }
  }

  // 2) Rembourser le client pour les leçons non réalisées
  if (refundCents > 0 && (chargeId || paymentIntentId)) {
    try {
      const refundParams = { amount: refundCents };
      if (chargeId) refundParams.charge = chargeId;
      else refundParams.payment_intent = paymentIntentId;
      const refund = await stripe.refunds.create(refundParams);
      refundId = refund.id;
    } catch (e) {
      console.error('[pack-settlement] refund failed:', e?.message);
      captureError(e, { lesson_id: lessonId, pack_id: packId, context: 'pack_refund' });
      refundError = e?.message || 'refund_failed';
    }
  }

  // 3) Mettre à jour le document payment (visibilité admin)
  const settlementData = {
    status: stripeReady ? 'released' : 'payout_pending_rib',
    released_at: new Date(),
    pack_id: packId,
    teacher_uid: teacherUid,
    net_to_teacher_eur: teacherAmountCents / 100,
    pack_completed_lessons: completedCount,
    pack_total_lessons: totalCount,
    ...(transferId  ? { transfer_id: transferId }                        : {}),
    ...(refundId    ? { refund_id: refundId, refund_eur: refundCents / 100 } : {}),
    ...(refundError ? { refund_error: refundError }                      : {}),
  };
  await adminDb.collection('payments').doc(payDoc.id).set(settlementData, { merge: true });

  // Email d'avis Google envoyé de façon non-bloquante après un pack terminé
  const payerUid = payDoc.data()?.payer_uid;
  if (payerUid) {
    sendGoogleReviewEmail(payerUid, lessonId).catch(() => {});
  }

  return res.json({
    ok: true,
    type: stripeReady ? 'stripe_transfer' : 'pending_rib',
    teacher_paid_eur:  teacherAmountCents / 100,
    refund_eur:        refundId ? refundCents / 100 : 0,
    refund_error:      refundError || null,
    completed_lessons: completedCount,
    total_lessons:     totalCount,
    ...(transferId ? { transfer_id: transferId } : {}),
    ...(refundId   ? { refund_id: refundId }     : {}),
  });
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

    // Rappel Stripe Connect : le prof n'a pas encore configuré son compte
    sendStripeConnectReminderEmail(teacherUid, amountCents / 100).catch(() => {});

    return res.json({ ok: true, type: 'pending_rib', amount_eur: amountCents / 100 });
  }
}

async function sendStripeConnectReminderEmail(teacherUid, amountEur) {
  if (!teacherUid || !process.env.RESEND_API_KEY) return;
  try {
    const snap = await adminDb.collection('users').doc(teacherUid).get();
    if (!snap.exists) return;
    const teacher = snap.data();
    if (!teacher.email) return;
    const prenom = teacher.firstName || teacher.displayName?.split(' ')[0] || 'là';
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'EduKaraib <notifications@edukaraib.com>',
      to: [teacher.email],
      subject: `💳 ${amountEur.toFixed(2)} € vous attendent — finalisez votre compte Stripe`,
      html: `<div style="font-family:Inter,system-ui,sans-serif;background:#f5f7fb;padding:24px;">
<table width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:auto;background:#fff;border-radius:18px;overflow:hidden;border:1px solid #e2e8f0;">
<tr><td style="background:#00804B;padding:18px 24px;"><span style="color:#fff;font-weight:700;font-size:17px;">EduKaraib</span></td></tr>
<tr><td style="padding:28px;">
<h1 style="margin:0 0 12px;font-size:22px;color:#0f172a;">Votre virement est prêt, ${prenom} 💰</h1>
<p style="color:#475569;font-size:15px;line-height:1.7;margin:0 0 20px;">
Un paiement de <strong>${amountEur.toFixed(2)} €</strong> vous est dû pour votre cours.<br><br>
Pour recevoir vos virements automatiquement, vous devez finaliser votre compte Stripe Connect depuis votre profil EduKaraib.<br><br>
Sans ça, vos paiements sont mis en attente et vous devrez contacter le support pour chaque virement.
</p>
<div style="text-align:center;margin-bottom:20px;">
<a href="${APP_BASE_URL}/prof/profile" style="background:#facc15;color:#111827;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:12px;display:inline-block;font-size:15px;">Finaliser mon compte Stripe →</a>
</div>
<p style="color:#94a3b8;font-size:13px;text-align:center;">Cela prend moins de 5 minutes. Vos informations sont sécurisées par Stripe.</p>
</td></tr>
<tr><td style="padding:12px 28px 20px;color:#94a3b8;font-size:12px;border-top:1px solid #f1f5f9;">
EduKaraib · <a href="mailto:contact@edukaraib.com" style="color:#00804B;">contact@edukaraib.com</a>
</td></tr>
</table>
</div>`,
    });
  } catch (e) {
    console.warn('[trigger-payout] stripe connect reminder email failed:', e?.message);
  }
}