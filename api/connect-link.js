import { stripe } from './_stripe';
import { firestore, authAdmin } from './_firebaseAdmin';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    // Vérifier l'ID token Firebase envoyé par le client
    const idToken = req.headers.authorization?.split('Bearer ')[1];
    if (!idToken) return res.status(401).json({ error: 'No token' });
    const decoded = await authAdmin.verifyIdToken(idToken);
    const uid = decoded.uid;

    // Charger utilisateur Firestore
    const userRef = firestore.collection('users').doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });
    const user = userSnap.data();
    if (user.role !== 'teacher') return res.status(403).json({ error: 'Only teachers' });

    // Récupérer ou créer le compte Stripe
    let accountId = user.stripeAccountId;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'FR',
        email: user.email || undefined,
        capabilities: {
          transfers: { requested: true },
          card_payments: { requested: true },
        },
        business_type: 'individual',
      });
      accountId = account.id;
      await userRef.update({ stripeAccountId: accountId });
    }

    // Account Link (onboarding ou update)
    const mode = req.query.mode === 'update' ? 'account_update' : 'account_onboarding';
    const returnUrl = `${process.env.APP_BASE_URL}/prof/dashboard`;
    const refreshUrl = `${process.env.APP_BASE_URL}/prof/dashboard`;

    const link = await stripe.accountLinks.create({
      account: accountId,
      type: mode,
      return_url: returnUrl,
      refresh_url: refreshUrl,
    });

    return res.status(200).json({ url: link.url, accountId });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server_error' });
  }
}