import { stripe } from './_stripe.mjs';
import { getFirestore } from './_firebaseAdmin.mjs';

// obligatoire : désactiver le bodyParser
export const config = { api: { bodyParser: false } };

async function buffer(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  const buf = await buffer(req);

  let evt;
  try {
    evt = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error('Webhook signature failed', e.message);
    return res.status(400).send('Bad signature');
  }

  try {
    if (evt.type === 'account.updated') {
      const acc = evt.data.object;
      const db = getFirestore();
      const q = await db.collection('users').where('stripeAccountId', '==', acc.id).limit(1).get();
      if (!q.empty) {
        await q.docs[0].ref.update({
          stripePayoutsEnabled: acc.payouts_enabled,
          stripeChargesEnabled: acc.charges_enabled,
          stripeDetailsSubmitted: acc.details_submitted,
        });
      }
    }
    return res.status(200).json({ received: true });
  } catch (e) {
    console.error('webhook error:', e);
    return res.status(500).end();
  }
}