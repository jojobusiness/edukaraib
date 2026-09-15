// Le partenaire enregistre l'IBAN qui reçoit ses reversements.
// Passe par l'API : les règles Firestore interdisent l'écriture client sur les
// fiches partenaires (collection d'argent).
import { adminDb, verifyAuth } from './_firebaseAdmin.mjs';
import { PARTNERS_COLLECTION, normalizeIban, isValidIban } from './_partners.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });

  const auth = await verifyAuth(req, res);
  if (!auth) return;

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const iban = normalizeIban(body.iban);
  if (!isValidIban(iban)) return res.status(400).json({ error: 'INVALID_IBAN' });

  const ref = adminDb.collection(PARTNERS_COLLECTION).doc(auth.uid);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: 'PARTNER_NOT_FOUND' });

  await ref.update({ rib: iban, rib_updated_at: new Date() });
  return res.json({ ok: true, rib: iban });
}
