// api/analytics.js
// Returns analytics summary for the admin dashboard SiteVisitsSection.
// Reads from Firestore collections written by analytics-drain.js.
// Query param: period = 7d | 30d | 90d (default 30d)

import { getFirestore, verifyAuth } from './_firebaseAdmin.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const decoded = await verifyAuth(req, res);
  if (!decoded) return;

  const db = getFirestore();
  const userDoc = await db.collection('users').doc(decoded.uid).get();
  if (!userDoc.exists || userDoc.data().role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const period = req.query.period || '30d';
  const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;

  // Compute date range
  const dates = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(fmtDate(d));
  }

  // Fetch daily docs in range
  const snap = await db.collection('analytics_daily').get();
  const dailyMap = {};
  snap.docs.forEach(doc => { dailyMap[doc.id] = doc.data(); });

  const timeseries = dates.map(day => ({
    day,
    pageviews: dailyMap[day]?.pageviews || 0,
    visitors:  dailyMap[day]?.visitors  || 0,
  }));

  const totalPageviews = timeseries.reduce((s, d) => s + d.pageviews, 0);
  const totalVisitors  = timeseries.reduce((s, d) => s + d.visitors,  0);

  // Top pages, countries etc. from analytics_top
  const [pagesDoc, countriesDoc, devicesDoc, browsersDoc, referrersDoc] = await Promise.all([
    db.collection('analytics_top').doc('pages').get(),
    db.collection('analytics_top').doc('countries').get(),
    db.collection('analytics_top').doc('devices').get(),
    db.collection('analytics_top').doc('browsers').get(),
    db.collection('analytics_top').doc('referrers').get(),
  ]);

  const topEntries = (doc, decodeSlash = false) => {
    if (!doc.exists) return [];
    return Object.entries(doc.data())
      .map(([k, v]) => ({
        page: decodeSlash ? k.replace(/__SLASH__/g, '/').replace(/__DOT__/g, '.') : k,
        country: k,
        label: k,
        pageviews: Number(v),
        visitors: Number(v),
      }))
      .sort((a, b) => b.pageviews - a.pageviews)
      .slice(0, 8);
  };

  return res.status(200).json({
    summary: {
      pageviews: totalPageviews,
      visitors:  totalVisitors,
      sessions:  totalVisitors,
      bounceRate: null,
    },
    timeseries,
    topPages:   topEntries(pagesDoc, true),
    countries:  topEntries(countriesDoc).map(e => ({ country: e.country, visitors: e.visitors })),
    devices:    topEntries(devicesDoc).map(e => ({ device: e.label, visitors: e.visitors })),
    browsers:   topEntries(browsersDoc).map(e => ({ browser: e.label, visitors: e.visitors })),
    referrers:  topEntries(referrersDoc).map(e => ({ referrer: e.label, visitors: e.visitors })),
  });
}

function fmtDate(d) {
  return d.getFullYear() + '-'
    + String(d.getMonth() + 1).padStart(2, '0') + '-'
    + String(d.getDate()).padStart(2, '0');
}
