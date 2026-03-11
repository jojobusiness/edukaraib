// api/analytics-drain.js
// ─────────────────────────────────────────────────────
// Reçoit les Web Analytics de Vercel (Log Drain)
// et les stocke dans Firestore via l'API REST.
//
// Variables d'environnement requises (Vercel → Settings → Environment Variables) :
//   FIREBASE_PROJECT_ID   → ex: "edukaraib-12345"
//   FIREBASE_CLIENT_EMAIL → ex: "firebase-adminsdk-xxx@..."
//   FIREBASE_PRIVATE_KEY  → la clé privée complète (avec \n)
// ─────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let accessToken;
  try {
    accessToken = await getGoogleAccessToken();
  } catch (e) {
    console.error('[drain] auth error:', e.message);
    return res.status(500).json({ error: 'Auth failed', detail: e.message });
  }

  let events = req.body;
  if (!Array.isArray(events)) events = [events];

  const projectId = process.env.FIREBASE_PROJECT_ID;

  const dayMap      = {};
  const monthMap    = {};
  const pageMap     = {};
  const countryMap  = {};
  const deviceMap   = {};
  const browserMap  = {};
  const referrerMap = {};

  for (const evt of events) {
    if (evt.eventType !== 'pageview') continue;

    const ts  = evt.timestamp || Date.now();
    const d   = new Date(ts);
    const day = fmtDate(d);
    const mon = fmtMonth(d);
    const sessionId = String(evt.sessionId || '');

    if (!dayMap[day]) dayMap[day] = { pageviews: 0, sessions: new Set() };
    dayMap[day].pageviews++;
    if (sessionId) dayMap[day].sessions.add(sessionId);

    if (!monthMap[mon]) monthMap[mon] = { pageviews: 0, sessions: new Set() };
    monthMap[mon].pageviews++;
    if (sessionId) monthMap[mon].sessions.add(sessionId);

    const path = evt.path || '/';
    pageMap[path] = (pageMap[path] || 0) + 1;

    const country = evt.country || 'unknown';
    countryMap[country] = (countryMap[country] || 0) + 1;

    const device = evt.device || 'desktop';
    deviceMap[device] = (deviceMap[device] || 0) + 1;

    const browser = evt.browser || 'unknown';
    browserMap[browser] = (browserMap[browser] || 0) + 1;

    const ref = (evt.referrer || 'direct').replace(/^https?:\/\//, '').split('/')[0] || 'direct';
    referrerMap[ref] = (referrerMap[ref] || 0) + 1;
  }

  const writes = [];

  for (const [day, data] of Object.entries(dayMap)) {
    writes.push(buildIncrement(projectId, `analytics_daily/${day}`, {
      pageviews: data.pageviews,
      visitors:  data.sessions.size,
    }));
  }

  for (const [month, data] of Object.entries(monthMap)) {
    writes.push(buildIncrement(projectId, `analytics_monthly/${month}`, {
      pageviews: data.pageviews,
      visitors:  data.sessions.size,
    }));
  }

  if (Object.keys(pageMap).length) {
    const fields = {};
    for (const [path, count] of Object.entries(pageMap)) {
      const key = path.replace(/\//g, '__SLASH__').replace(/\./g, '__DOT__') || '__root__';
      fields[key] = count;
    }
    writes.push(buildIncrement(projectId, 'analytics_top/pages', fields));
  }

  if (Object.keys(countryMap).length)  writes.push(buildIncrement(projectId, 'analytics_top/countries', countryMap));
  if (Object.keys(deviceMap).length)   writes.push(buildIncrement(projectId, 'analytics_top/devices',   deviceMap));
  if (Object.keys(browserMap).length)  writes.push(buildIncrement(projectId, 'analytics_top/browsers',  browserMap));
  if (Object.keys(referrerMap).length) writes.push(buildIncrement(projectId, 'analytics_top/referrers', referrerMap));

  if (writes.length === 0) {
    return res.status(200).json({ ok: true, processed: 0 });
  }

  try {
    const batchRes = await fetch(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default):batchWrite`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ writes }),
      }
    );

    if (!batchRes.ok) {
      const err = await batchRes.text();
      console.error('[drain] Firestore error:', err);
      return res.status(500).json({ error: 'Firestore write failed' });
    }

    return res.status(200).json({ ok: true, processed: events.length });
  } catch (e) {
    console.error('[drain] fetch error:', e);
    return res.status(500).json({ error: e.message });
  }
}

// ── Helpers ──────────────────────────────────────────

function fmtDate(d) {
  return d.getFullYear() + '-'
    + String(d.getMonth() + 1).padStart(2, '0') + '-'
    + String(d.getDate()).padStart(2, '0');
}

function fmtMonth(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function buildIncrement(projectId, docPath, fields) {
  const name = `projects/${projectId}/databases/(default)/documents/${docPath}`;
  const fieldTransforms = Object.entries(fields).map(([field, value]) => ({
    fieldPath: field,
    increment: { integerValue: String(value) },
  }));
  return { transform: { document: name, fieldTransforms } };
}

// ── JWT → Google Access Token (sans dépendances) ─────
async function getGoogleAccessToken() {
  const email  = process.env.FIREBASE_CLIENT_EMAIL;
  const rawKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!email || !rawKey) {
    throw new Error('Missing FIREBASE_CLIENT_EMAIL or FIREBASE_PRIVATE_KEY env vars');
  }

  const now = Math.floor(Date.now() / 1000);
  const header  = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss: email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }));

  const unsigned  = header + '.' + payload;
  const signature = await rsaSign(unsigned, rawKey);
  const jwt       = unsigned + '.' + signature;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt,
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error('Token fetch failed: ' + JSON.stringify(data));
  }
  return data.access_token;
}

function b64url(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function rsaSign(data, pem) {
  const keyBody = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');

  const keyBuffer = Uint8Array.from(atob(keyBody), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const encoded   = new TextEncoder().encode(data);
  const sigBuffer = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, encoded);

  return btoa(String.fromCharCode(...new Uint8Array(sigBuffer)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}