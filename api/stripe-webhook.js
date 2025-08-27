import { stripe } from './_stripe';
import { firestore } from './_firebaseAdmin';

export const config = { api: { bodyParser: false } }; // Stripe nécessite le raw body

function buffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
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
      // On cherche l’utilisateur qui possède ce compte (par champ stripeAccountId)
      const q = await firestore.collection('users')
        .where('stripeAccountId', '==', acc.id)
        .limit(1)
        .get();
      if (!q.empty) {
        const ref = q.docs[0].ref;
        await ref.update({
          stripePayoutsEnabled: acc.payouts_enabled,
          stripeChargesEnabled: acc.charges_enabled,
          stripeDetailsSubmitted: acc.details_submitted,
        });
      }
    }
    // (plus tard) tu peux gérer payment_intent.succeeded pour journaliser les revenus
    res.status(200).json({ received: true });
  } catch (e) {
    console.error(e);
    res.status(500).end();
  }
}