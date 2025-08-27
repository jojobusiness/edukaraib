const { stripe } = require('./_stripe');
const { firestore, authAdmin } = require('./_firebaseAdmin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  // Pré-checks ENV explicites (lisibles dans la réponse)
  if (!process.env.STRIPE_SECRET_KEY)
    return res.status(500).json({ error: 'ENV_MISSING', message: 'STRIPE_SECRET_KEY missing' });
  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY)
    return res.status(500).json({ error: 'ENV_MISSING', message: 'Firebase Admin envs missing' });

  try {
    const idToken = (req.headers.authorization || '').split('Bearer ')[1];
    if (!idToken) return res.status(401).json({ error: 'NO_TOKEN' });

    const decoded = await authAdmin.verifyIdToken(idToken).catch(() => null);
    if (!decoded) return res.status(401).json({ error: 'INVALID_TOKEN' });
    const uid = decoded.uid;

    const userRef = firestore.collection('users').doc(uid);
    const snap = await userRef.get();
    if (!snap.exists) return res.status(404).json({ error: 'USER_NOT_FOUND' });
    const user = snap.data();
    if (user.role !== 'teacher') return res.status(403).json({ error: 'ONLY_TEACHER' });

    // Récupère ou crée le compte Connect
    let accountId = user.stripeAccountId;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'FR',
        email: user.email || undefined,
        capabilities: { transfers: { requested: true }, card_payments: { requested: true } },
        business_type: 'individual',
      });
      accountId = account.id;
      await userRef.update({ stripeAccountId: accountId });
    }

    const mode = req.query.mode === 'update' ? 'account_update' : 'account_onboarding';
    const base = process.env.APP_BASE_URL || 'http://localhost:3000';
    const link = await stripe.accountLinks.create({
      account: accountId,
      type: mode,
      return_url: `${base}/prof/dashboard`,
      refresh_url: `${base}/prof/dashboard`,
    });

    return res.status(200).json({ url: link.url, accountId });
  } catch (err) {
    console.error('connect-link error:', err);
    const code = err?.code || err?.type || 'SERVER_ERROR';
    return res.status(500).json({ error: code, message: err?.message || 'server_error' });
  }
};