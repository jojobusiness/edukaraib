import { stripe } from '../_stripe.mjs';
import { adminDb, verifyAuth } from '../_firebaseAdmin.mjs';
import { calcFeeCents } from '../_fees.mjs';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { uid } = await verifyAuth(req, res);
    const { lessonId } = req.body || {};
    if (!lessonId) return res.status(400).json({ error: 'lessonId required' });

    const lessonSnap = await adminDb.collection('lessons').doc(lessonId).get();
    if (!lessonSnap.exists) return res.status(404).json({ error: 'Lesson not found' });
    const lesson = lessonSnap.data();

    const teacherSnap = await adminDb.collection('users').doc(lesson.teacher_id).get();
    if (!teacherSnap.exists) return res.status(400).json({ error: 'Teacher not found' });
    const teacher = teacherSnap.data();
    if (!teacher.stripeAccountId) return res.status(400).json({ error: 'Teacher has no Stripe account' });

    const pricePerHour = Number(String(lesson.price_per_hour || 0).replace(',', '.')) || 0;
    const hours = Number(lesson.duration_hours || 1) || 1;
    const grossCents = Math.round(pricePerHour * hours * 100);
    if (grossCents <= 0) return res.status(400).json({ error: 'Invalid amount' });

    const feeCents = calcFeeCents(grossCents);

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
        transfer_data: { destination: teacher.stripeAccountId },
        metadata: {
          lesson_id: lessonId,
          teacher_id: lesson.teacher_id,
          student_id: lesson.student_id || '',
          booked_by: lesson.booked_by || '',
          parent_id: lesson.parent_id || '',
          created_by: uid,
          model: 'checkout',
        },
      },
      metadata: { lesson_id: lessonId }, // redondant mais pratique
    });

    return res.status(200).json({ url: session.url, id: session.id });
  } catch (e) {
    console.error('create-checkout-session error:', e);
    const status = e.statusCode || 500;
    res.status(status).json({ error: e.message || 'server_error' });
  }
}