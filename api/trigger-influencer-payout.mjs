import { adminDb, verifyAuth } from '../_firebaseAdmin.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  // Admin only
  const auth = await verifyAuth(req, res);
  if (!auth) return;

  const adminSnap = await adminDb.collection('users').doc(auth.uid).get();
  if (!adminSnap.exists || adminSnap.data()?.role !== 'admin') {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const { influencerUid } = body;

  if (!influencerUid) {
    return res.status(400).json({ error: 'MISSING_INFLUENCER_UID' });
  }

  const influRef = adminDb.collection('influencers').doc(influencerUid);
  const influSnap = await influRef.get();

  if (!influSnap.exists) {
    return res.status(404).json({ error: 'INFLUENCER_NOT_FOUND' });
  }

  const influ = influSnap.data() || {};
  const pendingEur = Number(influ.pendingPayout || 0);

  if (pendingEur <= 0) {
    return res.status(400).json({ error: 'NOTHING_TO_PAY' });
  }

  if (!influ.rib) {
    return res.status(400).json({ error: 'NO_IBAN_ON_FILE' });
  }

  // Enregistre le virement dans l'historique et remet pendingPayout à 0
  const payoutEntry = {
    amount_eur:   pendingEur,
    iban:         influ.rib,
    triggered_by: auth.uid,
    triggered_at: new Date(),
    status:       'processing', // à mettre à 'done' manuellement après confirmation bancaire
  };

  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(influRef);
    if (!snap.exists) throw new Error('not_found');
    const data = snap.data() || {};
    const history = data.payoutHistory || [];
    tx.update(influRef, {
      pendingPayout: 0,
      payoutHistory: [...history, payoutEntry],
    });
  });

  // TODO : brancher ici un virement SEPA réel (ex: API GoCardless, Stripe Payouts, etc.)
  // Pour l'instant : log admin + confirmation manuelle

  console.log(`[payout] Virement déclenché pour ${influ.name} (${influ.email}) — ${pendingEur} € → IBAN ${influ.rib}`);

  return res.json({
    success: true,
    amount_eur: pendingEur,
    iban: influ.rib,
    name: influ.name,
    email: influ.email,
  });
}