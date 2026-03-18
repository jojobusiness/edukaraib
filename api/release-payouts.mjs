import { releaseDuePayouts } from '../release-payouts-cron.mjs';

export default async function handler(req, res) {
  // ✅ CRON_SECRET obligatoire — si non configuré on bloque tout
  // (évite le cas où secret=undefined → condition entière = false → accès ouvert)
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[release-payouts] CRON_SECRET env var not set');
    return res.status(500).json({ error: 'SERVER_MISCONFIGURED' });
  }

  const headerKey = req.headers['x-cron-key'];
  const qsKey = req.query?.key || req.query?.cron_key;

  if (headerKey !== secret && qsKey !== secret) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }

  try {
    await releaseDuePayouts(req, res); // renvoie un JSON { processed, released, ... }
  } catch (e) {
    console.error('release-payouts error:', e);
    res.status(500).json({ error: 'INTERNAL_ERROR', details: e.message });
  }
}