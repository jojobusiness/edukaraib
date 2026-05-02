import { stripe } from './_stripe.mjs';
import { adminDb, verifyAuth } from './_firebaseAdmin.mjs';

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
  const uid = auth.uid;

  const { subscriptionId } = readBody(req);
  if (!subscriptionId) return res.status(400).json({ error: 'MISSING_SUBSCRIPTION_ID' });

  const subSnap = await adminDb.collection('subscriptions').doc(String(subscriptionId)).get();
  if (!subSnap.exists) return res.status(404).json({ error: 'NOT_FOUND' });

  const sub = subSnap.data();
  if (String(sub.payer_uid) !== String(uid)) return res.status(403).json({ error: 'FORBIDDEN' });
  if (sub.status === 'cancelled') return res.status(400).json({ error: 'ALREADY_CANCELLED' });

  try {
    // Annulation en fin de periode en cours (les cours du mois restent reserves)
    await stripe.subscriptions.update(sub.stripe_subscription_id, {
      cancel_at_period_end: true,
    });
  } catch (e) {
    return res.status(500).json({ error: 'STRIPE_CANCEL_FAILED', detail: String(e?.message || e) });
  }

  await adminDb.collection('subscriptions').doc(String(subscriptionId)).update({
    status: 'cancelling',
    cancel_requested_at: new Date(),
  });

  return res.json({ ok: true });
}
