import { stripe } from './_stripe.mjs';
import { getFirestore, getAuthAdmin } from './_firebaseAdmin.mjs';

export default async function handler(req, res) {
  try {
    const idToken = (req.headers.authorization || '').split('Bearer ')[1];
    if (!idToken) return res.status(401).json({ error: 'NO_TOKEN' });

    const authAdmin = getAuthAdmin();
    const decoded = await authAdmin.verifyIdToken(idToken).catch(() => null);
    if (!decoded) return res.status(401).json({ error: 'INVALID_TOKEN' });
    const uid = decoded.uid;

    const db = getFirestore();
    const userRef = db.collection('users').doc(uid);
    const snap = await userRef.get();
    if (!snap.exists) return res.status(404).json({ error: 'USER_NOT_FOUND' });
    const user = snap.data();

    if (user.role !== 'teacher') {
      return res.status(403).json({ error: 'ONLY_TEACHER' });
    }

    const accountId = user.stripeAccountId || null;
    if (!accountId) {
      return res.status(200).json({
        onboarded: false,
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false
      });
    }

    const acc = await stripe.accounts.retrieve(accountId);

    return res.status(200).json({
      onboarded: !!acc.details_submitted && !!acc.charges_enabled,
      charges_enabled: acc.charges_enabled,
      payouts_enabled: acc.payouts_enabled,
      details_submitted: acc.details_submitted,
      requirements_disabled_reason: acc.requirements?.disabled_reason || null,
      id: acc.id
    });
  } catch (e) {
    console.error('connect-status error:', e);
    return res.status(500).json({ error: e.code || e.type || 'SERVER_ERROR', message: e.message || 'server_error' });
  }
}