import { stripe } from './_stripe';
import { firestore, authAdmin } from './_firebaseAdmin';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  try {
    const idToken = req.headers.authorization?.split('Bearer ')[1];
    if (!idToken) return res.status(401).json({ error: 'No token' });
    const decoded = await authAdmin.verifyIdToken(idToken);
    const uid = decoded.uid;

    const userRef = firestore.collection('users').doc(uid);
    const snap = await userRef.get();
    if (!snap.exists) return res.status(404).json({ error: 'User not found' });
    const user = snap.data();
    if (user.role !== 'teacher') return res.status(403).json({ error: 'Only teachers' });

    const accountId = user.stripeAccountId;
    if (!accountId) return res.status(200).json({ exists: false });

    const acc = await stripe.accounts.retrieve(accountId);
    const status = {
      exists: true,
      payouts_enabled: acc.payouts_enabled,
      charges_enabled: acc.charges_enabled,
      details_submitted: acc.details_submitted,
      requirements_due: acc.requirements?.currently_due || [],
    };

    // Sync vers Firestore
    await userRef.update({
      stripePayoutsEnabled: status.payouts_enabled,
      stripeChargesEnabled: status.charges_enabled,
      stripeDetailsSubmitted: status.details_submitted,
    });

    return res.status(200).json(status);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server_error' });
  }
}