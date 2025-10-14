import { releaseDuePayouts } from '../release-payouts-cron.mjs';

export default async function handler(req, res) {
  // protection (optionnelle) par clé secrète
  const secret = process.env.CRON_SECRET;
  const headerKey = req.headers['x-cron-key'];
  const qsKey = req.query?.key || req.query?.cron_key; // fallback pour test navigateur

  if (secret && headerKey !== secret && qsKey !== secret) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }

  try {
    await releaseDuePayouts(req, res); // renvoie un JSON { processed, released, ... }
  } catch (e) {
    console.error('release-payouts error:', e);
    res.status(500).json({ error: 'INTERNAL_ERROR', details: e.message });
  }
}