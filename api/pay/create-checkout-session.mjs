import { stripe } from '../_stripe.mjs';
import { adminDb, verifyAuth } from '../_firebaseAdmin.mjs';
import { calcFeeCents } from '../_fees.mjs';

// Helpers body parser tolérant
function readBody(req) {
  try {
    if (req.body == null) return {};
    if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
    return req.body; // déjà parsé par Vercel si header OK
  } catch {
    return {};
  }
}

function toNum(v) {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default async function handler(req, res) {
  const t0 = Date.now();
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }

    // ---- 1) Auth Firebase ----
    let uid = null;
    try {
      const auth = await verifyAuth(req, res);
      uid = auth?.uid || null;
      if (!uid) return; // verifyAuth a déjà répondu 401 si pas de token
    } catch (e) {
      // verifyAuth a déjà renvoyé la bonne erreur
      return;
    }

    // ---- 2) Body + validations ----
    const body = readBody(req);
    const lessonId = body?.lessonId;
    if (!lessonId) {
      return res.status(400).json({ error: 'MISSING_LESSON_ID' });
    }

    if (!process.env.APP_BASE_URL) {
      return res.status(500).json({ error: 'APP_BASE_URL_NOT_SET' });
    }

    // ---- 3) Récupérer lesson + teacher ----
    const lessonSnap = await adminDb.collection('lessons').doc(lessonId).get();
    if (!lessonSnap.exists) {
      return res.status(404).json({ error: 'LESSON_NOT_FOUND' });
    }
    const lesson = lessonSnap.data();

    const teacherSnap = await adminDb.collection('users').doc(lesson.teacher_id).get();
    if (!teacherSnap.exists) {
      return res.status(400).json({ error: 'TEACHER_NOT_FOUND' });
    }
    const teacher = teacherSnap.data();

    const destination = teacher.stripeAccountId;
    if (!destination) {
      return res.status(400).json({ error: 'TEACHER_NO_STRIPE', message: 'Le professeur doit d’abord configurer Stripe (RIB).' });
    }

    // ---- 4) Montant ----
    const pricePerHour = toNum(lesson.price_per_hour);
    const hours = toNum(lesson.duration_hours) || 1;
    const grossCents = Math.round(pricePerHour * hours * 100);
    if (!(grossCents > 0)) {
      return res.status(400).json({ error: 'INVALID_AMOUNT', debug: { pricePerHour, hours } });
    }

    const feeCents = calcFeeCents(grossCents); // 5%

    // ---- 5) Créer la session Checkout ----
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: lesson.subject_id || 'Cours',
            description: `Leçon #${lessonId}`,
          },
          unit_amount: grossCents,
        },
        quantity: 1,
      }],
      success_url: `${process.env.APP_BASE_URL}/pay/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_BASE_URL}/pay/cancel`,
      payment_intent_data: {
        application_fee_amount: feeCents,
        transfer_data: { destination },
        metadata: {
          lesson_id: lessonId,
          teacher_id: lesson.teacher_id || '',
          student_id: lesson.student_id || '',
          booked_by: lesson.booked_by || '',
          parent_id: lesson.parent_id || '',
          created_by: uid,
          model: 'checkout',
          platform_fee_cents: String(feeCents),
        },
      },
      metadata: { lesson_id: lessonId },
    });

    return res.status(200).json({ url: session.url, id: session.id, elapsed_ms: Date.now() - t0 });
  } catch (e) {
    // Stripe errors lisibles
    const requestId = e?.requestId || e?.raw?.requestId || e?.raw?.headers?.['request-id'];
    console.error('create-checkout-session error:', {
      type: e?.type,
      code: e?.code,
      statusCode: e?.statusCode,
      message: e?.message,
      requestId,
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