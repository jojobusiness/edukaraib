import { stripe } from './_stripe.mjs';
import { adminDb, verifyAuth } from './_firebaseAdmin.mjs';
import { captureError } from './_sentry.mjs';

function readBody(req) {
  try {
    if (!req.body) return {};
    if (typeof req.body === 'string') return JSON.parse(req.body);
    return req.body;
  } catch { return {}; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });

  const auth = await verifyAuth(req, res);
  if (!auth) return;
  const payerUid = auth.uid;

  const { teacherId, slotDay, slotHour, mode, forStudent } = readBody(req);
  if (!teacherId || !slotDay || slotHour == null) {
    return res.status(400).json({ error: 'MISSING_PARAMS' });
  }

  const teacherSnap = await adminDb.collection('users').doc(String(teacherId)).get();
  if (!teacherSnap.exists) return res.status(404).json({ error: 'TEACHER_NOT_FOUND' });
  const teacher = teacherSnap.data();

  if (!teacher.subscription_enabled) {
    return res.status(400).json({ error: 'SUBSCRIPTION_NOT_ENABLED' });
  }

  const subscriptionRate = Number(teacher.subscription_rate || 0);
  if (subscriptionRate <= 0) {
    return res.status(400).json({ error: 'INVALID_SUBSCRIPTION_RATE' });
  }

  // 10 EUR frais plateforme par cours — inchangeable
  const perLessonCents = Math.round((subscriptionRate + 10) * 100);
  const monthlyAmountCents = perLessonCents * 4; // 4 cours / mois

  const studentId = String(forStudent || payerUid);
  const teacherName = [teacher.firstName, teacher.lastName].filter(Boolean).join(' ') || 'Professeur';

  const origin =
    req.headers?.origin ||
    `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;

  // Prix Stripe cree dynamiquement (1 Price par souscription)
  let price;
  try {
    price = await stripe.prices.create({
      currency: 'eur',
      unit_amount: monthlyAmountCents,
      recurring: { interval: 'month' },
      product_data: {
        name: `Abonnement cours avec ${teacherName}`,
        metadata: { teacher_id: teacherId },
      },
    });
  } catch (e) {
    captureError(e, { teacher_id: teacherId });
    return res.status(500).json({ error: 'STRIPE_PRICE_FAILED', detail: String(e?.message || e) });
  }

  const metadata = {
    type: 'subscription',
    teacher_id: String(teacherId),
    student_id: studentId,
    payer_uid: String(payerUid),
    slot_day: String(slotDay),
    slot_hour: String(slotHour),
    mode: mode || 'presentiel',
    subscription_rate: String(subscriptionRate),
    per_lesson_cents: String(perLessonCents),
  };

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      locale: 'fr',
      billing_address_collection: 'required',
      line_items: [{ price: price.id, quantity: 1 }],
      metadata,
      subscription_data: { metadata },
      success_url: `${origin}/pay/success?session_id={CHECKOUT_SESSION_ID}&type=subscription`,
      cancel_url: `${origin}/pay/cancel`,
    });
  } catch (e) {
    captureError(e, { teacher_id: teacherId, payer_uid: payerUid });
    return res.status(500).json({ error: 'STRIPE_SESSION_FAILED', detail: String(e?.message || e) });
  }

  return res.json({ url: session.url });
}
