// POST /api/visite { chemin, nouveau, referent } — une page vue (03/11/2026).
// Alimente analytics_daily / analytics_monthly / analytics_top, lus par l'écran
// « Visites » de l'admin (api/analytics.js). Public, anonyme : voir api/_visites.mjs.
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './_firebaseAdmin.mjs';
import { cheminAnonyme, cleChemin, appareil, navigateur, sourceVisite, jourUTC } from './_visites.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  const ua = String(req.headers['user-agent'] || '');
  if (/bot|crawl|spider|slurp|headless|lighthouse/i.test(ua)) return res.status(204).end();

  const plus = FieldValue.increment(1);
  const nouveau = b?.nouveau === true;
  const jour = jourUTC();
  const top = (doc, cle) => adminDb.collection('analytics_top').doc(doc).set({ [cle]: plus }, { merge: true });
  try {
    const ecritures = [
      adminDb.collection('analytics_daily').doc(jour).set({ pageviews: plus, ...(nouveau ? { visitors: plus } : {}) }, { merge: true }),
      adminDb.collection('analytics_monthly').doc(jour.slice(0, 7)).set({ pageviews: plus, ...(nouveau ? { visitors: plus } : {}) }, { merge: true }),
      top('pages', cleChemin(cheminAnonyme(b?.chemin))),
    ];
    if (nouveau) {
      ecritures.push(top('devices', appareil(ua)), top('browsers', navigateur(ua)));
      const pays = String(req.headers['x-vercel-ip-country'] || '').replace(/[^A-Z]/g, '').slice(0, 2);
      if (pays) ecritures.push(top('countries', pays));
      const source = sourceVisite(b?.referent);
      if (source) ecritures.push(top('referrers', source));
    }
    await Promise.all(ecritures);
  } catch (e) {
    console.warn('[visite]', e?.message);
  }
  return res.status(204).end();
}
