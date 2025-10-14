import { releaseDuePayouts } from './release-payouts-cron.mjs';

// ✅ Endpoint HTTP pour libérer les paiements
export default async function handler(req, res) {
  // (Optionnel) protège par une clé secrète
  const secret = process.env.CRON_SECRET;
  const headerKey = req.headers['x-cron-key'];

  if (secret && headerKey !== secret) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }

  // Exécution
  try {
    await releaseDuePayouts(req, res);
  } catch (e) {
    console.error('release-payouts error:', e);
    res.status(500).json({ error: 'INTERNAL_ERROR', details: e.message });
  }
}