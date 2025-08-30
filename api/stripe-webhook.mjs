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
        // On peut lire session -> payment_intent puis récupérer tous les metadata
        const session = event.data.object;
        const piId = session.payment_intent;
        const pi = await stripe.paymentIntents.retrieve(piId);
        await handlePaid(pi);
        break;
      }
      case 'payment_intent.succeeded': {
        const pi = event.data.object;
        await handlePaid(pi);
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

async function handlePaid(pi) {
  const md = pi.metadata || {};
  const lessonId = md.lesson_id;
  if (!lessonId) return;

  const grossCents = pi.amount_received || pi.amount || 0;
  const feeCents = Number(md.platform_fee_cents || 0); // pas obligatoire ici
  const payerUserId = md.booked_by || md.parent_id || md.student_id || md.created_by || '';

  // Mise à jour de la leçon
  const ref = adminDb.collection('lessons').doc(lessonId);
  await ref.set({
    is_paid: true,
    paid_at: new Date(),
    paid_by: payerUserId || null,
    total_amount: grossCents / 100,
    payment_intent_id: pi.id,
    stripe_charge_id: (pi.charges?.data?.[0]?.id) || null,
  }, { merge: true });

  // Optionnel : écrire un enregistrement “payments”
  await adminDb.collection('payments').add({
    created_at: new Date(),
    lesson_id: lessonId,
    teacher_id: md.teacher_id || null,
    student_id: md.student_id || null,
    payer_id: payerUserId || null,
    model: md.model || 'unknown',
    amount_cents: grossCents,
    // La commission exacte de Stripe se trouve dans balance_transaction -> fees ; si besoin, retrieve charge.balance_transaction.
  });
}