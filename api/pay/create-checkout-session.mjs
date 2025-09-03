import { stripe } from '../_stripe.mjs';
import { adminDb, verifyAuth } from '../_firebaseAdmin.mjs';
import { calcFeeCents } from '../_fees.mjs';

// Body parser
function readBody(req) {
  try {
    if (req.body == null) return {};
    if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
    return req.body;
  } catch {
    return {};
  }
}

const toNum = (v) => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export default async function handler(req, res) {
  const t0 = Date.now();
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }

    // 1) Auth Firebase
    const auth = await verifyAuth(req, res);
    if (!auth) return;
    const uid = auth.uid;

    // 2) Body
    const body = readBody(req);
    const lessonId = body?.lessonId;
    const requestedForStudent = body?.forStudent || null;

    if (!lessonId) return res.status(400).json({ error: 'MISSING_LESSON_ID' });
    if (!process.env.APP_BASE_URL) return res.status(500).json({ error: 'APP_BASE_URL_NOT_SET' });

    // 3) Récupère lesson + teacher + (payer)
    const lessonRef = adminDb.collection('lessons').doc(lessonId);
    const lessonSnap = await lessonRef.get();
    if (!lessonSnap.exists) return res.status(404).json({ error: 'LESSON_NOT_FOUND' });
    const lesson = lessonSnap.data();

    // statut confirmé only
    if (lesson.status !== 'confirmed') {
      return res.status(400).json({ error: 'LESSON_NOT_CONFIRMED' });
    }

    const teacherSnap = await adminDb.collection('users').doc(lesson.teacher_id).get();
    if (!teacherSnap.exists) return res.status(400).json({ error: 'TEACHER_NOT_FOUND' });
    const teacher = teacherSnap.data();

    const destination = teacher.stripeAccountId;
    if (!destination) {
      return res.status(400).json({ error: 'TEACHER_NO_STRIPE', message: 'Le professeur doit d’abord configurer Stripe (RIB).' });
    }

    // 4) Déterminer le participant ciblé
    let targetStudent = requestedForStudent || lesson.student_id || null;

    if (Array.isArray(lesson.participant_ids) && lesson.participant_ids.length) {
      if (!targetStudent) {
        if (lesson.participant_ids.includes(uid)) {
          targetStudent = uid;
        } else {
          return res.status(400).json({ error: 'FOR_STUDENT_REQUIRED' });
        }
      }
      if (!lesson.participant_ids.includes(targetStudent)) {
        return res.status(403).json({ error: 'STUDENT_NOT_IN_LESSON' });
      }
    }

    if (!targetStudent) {
      return res.status(400).json({ error: 'STUDENT_NOT_RESOLVED' });
    }

    // 5) Contrôle d’accès payeur (élève ou parent autorisé)
    const payerIsStudent = uid === targetStudent;
    const payerIsParent =
      (lesson.participantsMap?.[targetStudent]?.parent_id && lesson.participantsMap[targetStudent].parent_id === uid) ||
      (lesson.parent_id && lesson.parent_id === uid);

    if (!payerIsStudent && !payerIsParent) {
      return res.status(403).json({ error: 'NOT_ALLOWED' });
    }

    // 6) Déjà payé pour ce participant ?
    const alreadyPaid =
      lesson.participantsMap?.[targetStudent]?.is_paid ??
      (lesson.student_id === targetStudent ? lesson.is_paid : false);

    if (alreadyPaid) {
      return res.status(400).json({ error: 'ALREADY_PAID' });
    }

    // 7) Montant
    const pricePerHour = toNum(lesson.price_per_hour);
    const hours = toNum(lesson.duration_hours) || 1;
    const grossCents = Math.round(pricePerHour * hours * 100);
    if (!(grossCents > 0)) {
      return res.status(400).json({ error: 'INVALID_AMOUNT', debug: { pricePerHour, hours } });
    }
    const feeCents = calcFeeCents(grossCents); // e.g. 5%

    // 8) Récupérer email du payeur (si dispo)
    let customerEmail = null;
    try {
      const payerSnap = await adminDb.collection('users').doc(uid).get();
      if (payerSnap.exists) {
        const u = payerSnap.data();
        customerEmail = u.email || null;
      }
    } catch {}

    // 9) Créer la session Checkout (Stripe Connect Destination + application_fee)
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: customerEmail || undefined,
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: lesson.subject_id || 'Cours',
            description: Array.isArray(lesson.participant_ids) ? `Leçon groupe • ${lessonId}` : `Leçon • ${lessonId}`,
          },
          unit_amount: grossCents,
        },
        quantity: 1,
      }],
      client_reference_id: `${lessonId}:${targetStudent}`,
      success_url: `${process.env.APP_BASE_URL}/pay/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_BASE_URL}/pay/cancel?lesson=${encodeURIComponent(lessonId)}&student=${encodeURIComponent(targetStudent)}`,
      payment_intent_data: {
        application_fee_amount: feeCents,
        transfer_data: { destination },
        metadata: {
          lesson_id: lessonId,
          teacher_id: lesson.teacher_id || '',
          for_student: targetStudent,
          paid_by: uid,
          platform_fee_cents: String(feeCents),
          model: 'checkout',
        },
      },
      metadata: {
        lesson_id: lessonId,
        for_student: targetStudent,
      },
    });

    return res.status(200).json({ url: session.url, id: session.id, elapsed_ms: Date.now() - t0 });
  } catch (e) {
    const requestId = e?.requestId || e?.raw?.requestId || e?.raw?.headers?.['request-id'];
    console.error('create-checkout-session error:', {
      type: e?.type, code: e?.code, statusCode: e?.statusCode, message: e?.message, requestId,
    });
    const status = e.statusCode || 500;
    return res.status(status).json({
      error: 'STRIPE_ERROR',
      message: e.message,
      requestId,
      statusCode: status,
    });
  }
}