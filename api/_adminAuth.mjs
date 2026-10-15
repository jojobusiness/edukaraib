// Garde admin partagée par les endpoints réservés à Joseph (15/10/2026).
// Le rôle se lit dans Firestore, jamais dans le jeton : un client peut mentir
// sur ce qu'il envoie, pas sur ce qui est écrit en base.
import { adminDb, verifyAuth } from './_firebaseAdmin.mjs';

/**
 * @returns {Promise<{uid: string}|null>} null si refusé — la réponse HTTP est
 *          déjà envoyée dans ce cas, l'appelant n'a plus qu'à s'arrêter.
 */
export async function requireAdmin(req, res) {
  const decoded = await verifyAuth(req, res);
  if (!decoded) return null; // verifyAuth a déjà répondu 401
  const snap = await adminDb.collection('users').doc(decoded.uid).get();
  if (!snap.exists || snap.data()?.role !== 'admin') {
    res.status(403).json({ error: 'FORBIDDEN' });
    return null;
  }
  return { uid: decoded.uid };
}
