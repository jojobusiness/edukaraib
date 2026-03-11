/**
 * /api/analytics-drain.js
 *
 * Endpoint qui reçoit les events Web Analytics de Vercel (Log Drain)
 * et les stocke dans Firestore pour affichage dans le dashboard admin.
 *
 * ─────────────────────────────────────────────
 * CONFIGURATION VERCEL (à faire une seule fois)
 * ─────────────────────────────────────────────
 * 1. Va sur https://vercel.com/dashboard → Settings → Log Drains
 * 2. Clique "Add Drain"
 * 3. Remplis :
 *    - Delivery URL  : https://TON-DOMAINE.vercel.app/api/analytics-drain
 *    - Sources       : coche "Web Analytics"
 *    - Format        : JSON
 *    - Secret (optionnel) : génère une chaîne aléatoire, mets-la dans
 *      la variable d'env VERCEL_DRAIN_SECRET
 * 4. Save → Vercel enverra chaque pageview ici en temps réel.
 * ─────────────────────────────────────────────
 */

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// ── Init Firebase Admin (une seule fois) ──────────────────────────────
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}
const db = getFirestore();

// ── Helpers ───────────────────────────────────────────────────────────
function toDateKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toMonthKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ── Handler principal ─────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Vérification du secret (optionnel mais recommandé)
  const secret = process.env.VERCEL_DRAIN_SECRET;
  if (secret) {
    const header = req.headers['x-vercel-signature'] || req.headers['x-drain-secret'];
    if (header !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  // Le body est soit un tableau, soit un objet unique
  let events = req.body;
  if (!Array.isArray(events)) events = [events];

  const batch = db.batch();
  const dayCounters = {};   // { 'YYYY-MM-DD': { pageviews, visitors: Set } }
  const monthCounters = {}; // { 'YYYY-MM': { pageviews, visitors: Set } }
  const pathCounters = {};  // { '/path': count }
  const countryCounters = {};
  const deviceCounters = {};
  const browserCounters = {};
  const referrerCounters = {};

  for (const evt of events) {
    if (evt.schema !== 'vercel.analytics.v1') continue;
    if (evt.eventType !== 'pageview') continue;

    const ts  = evt.timestamp || Date.now();
    const day = toDateKey(ts);
    const mon = toMonthKey(ts);
    const path      = evt.path || '/';
    const country   = evt.country || 'unknown';
    const device    = evt.device || 'desktop';
    const browser   = evt.browser || 'unknown';
    const referrer  = evt.referrer || 'direct';
    const sessionId = String(evt.sessionId || '');

    // ── Stocker l'event brut (optionnel, pour drill-down) ──
    const evtRef = db.collection('analytics_events').doc();
    batch.set(evtRef, {
      timestamp: ts,
      day, month: mon,
      path, country, device, browser, referrer,
      sessionId,
      createdAt: FieldValue.serverTimestamp(),
    });

    // ── Agréger par jour ──
    if (!dayCounters[day]) dayCounters[day] = { pageviews: 0, sessions: new Set() };
    dayCounters[day].pageviews++;
    if (sessionId) dayCounters[day].sessions.add(sessionId);

    // ── Agréger par mois ──
    if (!monthCounters[mon]) monthCounters[mon] = { pageviews: 0, sessions: new Set() };
    monthCounters[mon].pageviews++;
    if (sessionId) monthCounters[mon].sessions.add(sessionId);

    // ── Top pages ──
    pathCounters[path] = (pathCounters[path] || 0) + 1;

    // ── Pays ──
    countryCounters[country] = (countryCounters[country] || 0) + 1;

    // ── Devices ──
    deviceCounters[device] = (deviceCounters[device] || 0) + 1;

    // ── Browsers ──
    browserCounters[browser] = (browserCounters[browser] || 0) + 1;

    // ── Referrers ──
    const ref = referrer.replace(/^https?:\/\//, '').split('/')[0] || 'direct';
    referrerCounters[ref] = (referrerCounters[ref] || 0) + 1;
  }

  // ── Écrire les compteurs agrégés par jour ──
  for (const [day, data] of Object.entries(dayCounters)) {
    const ref = db.collection('analytics_daily').doc(day);
    batch.set(ref, {
      pageviews: FieldValue.increment(data.pageviews),
      visitors:  FieldValue.increment(data.sessions.size),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  // ── Écrire les compteurs agrégés par mois ──
  for (const [month, data] of Object.entries(monthCounters)) {
    const ref = db.collection('analytics_monthly').doc(month);
    batch.set(ref, {
      pageviews: FieldValue.increment(data.pageviews),
      visitors:  FieldValue.increment(data.sessions.size),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  // ── Top pages (doc unique "top_pages", merge des counts) ──
  for (const [path, count] of Object.entries(pathCounters)) {
    const safe = path.replace(/\//g, '__SLASH__').replace(/\./g, '__DOT__') || '__root__';
    const ref = db.collection('analytics_top').doc('pages');
    batch.set(ref, { [safe]: FieldValue.increment(count) }, { merge: true });
  }

  // ── Pays ──
  if (Object.keys(countryCounters).length) {
    batch.set(
      db.collection('analytics_top').doc('countries'),
      Object.fromEntries(Object.entries(countryCounters).map(([k, v]) => [k, FieldValue.increment(v)])),
      { merge: true }
    );
  }

  // ── Devices ──
  if (Object.keys(deviceCounters).length) {
    batch.set(
      db.collection('analytics_top').doc('devices'),
      Object.fromEntries(Object.entries(deviceCounters).map(([k, v]) => [k, FieldValue.increment(v)])),
      { merge: true }
    );
  }

  // ── Browsers ──
  if (Object.keys(browserCounters).length) {
    batch.set(
      db.collection('analytics_top').doc('browsers'),
      Object.fromEntries(Object.entries(browserCounters).map(([k, v]) => [k, FieldValue.increment(v)])),
      { merge: true }
    );
  }

  // ── Referrers ──
  if (Object.keys(referrerCounters).length) {
    batch.set(
      db.collection('analytics_top').doc('referrers'),
      Object.fromEntries(Object.entries(referrerCounters).map(([k, v]) => [k, FieldValue.increment(v)])),
      { merge: true }
    );
  }

  try {
    await batch.commit();
    return res.status(200).json({ ok: true, processed: events.length });
  } catch (e) {
    console.error('[analytics-drain] Firestore error:', e);
    return res.status(500).json({ error: 'Firestore write failed' });
  }
}
