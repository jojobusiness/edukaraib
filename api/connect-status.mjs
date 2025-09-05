export const config = { runtime: 'nodejs' };

import { stripe } from './_stripe.mjs';
import { getFirestore, getAuthAdmin } from './_firebaseAdmin.mjs';

export default async function handler(req, res) {
  try {
    // (Optionnel) limiter aux méthodes supportées
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }

    // Evite le cache côté CDN/navigateur
    res.setHeader('Cache-Control', 'no-store');

    // Récup token (insensible à la casse + trimming)
    const authHeader =
      req.headers.authorization ||
      req.headers.Authorization ||
      '';
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    const idToken = match?.[1]?.trim();
    if (!idToken) return res.status(401).json({ error: 'NO_TOKEN' });

    // Auth Admin
    const authAdmin = getAuthAdmin();
    const decoded = await authAdmin.verifyIdToken(idToken).catch(() => null);
    if (!decoded) return res.status(401).json({ error: 'INVALID_TOKEN' });
    const uid = decoded.uid;

    // Firestore Admin
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
        details_submitted: false,
        requirements_disabled_reason: null,
        id: null,
      });
    }

    const acc = await stripe.accounts.retrieve(accountId);

    return res.status(200).json({
      // On considère “onboarded” quand les infos sont soumises ET charges activées
      onboarded: !!acc.details_submitted && !!acc.charges_enabled,
      charges_enabled: !!acc.charges_enabled,
      payouts_enabled: !!acc.payouts_enabled,
      details_submitted: !!acc.details_submitted,
      requirements_disabled_reason: acc.requirements?.disabled_reason || null,
      id: acc.id,
    });
  } catch (e) {
    console.error('connect-status error:', e);
    return res
      .status(500)
      .json({ error: e.code || e.type || 'SERVER_ERROR', message: e.message || 'server_error' });
  }
}