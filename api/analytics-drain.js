// api/analytics-drain.js
// ─────────────────────────────────────────────────────
// Reçoit les Web Analytics de Vercel (Log Drain)
// et les stocke dans Firestore via l'API REST.
//
// Variables d'environnement requises :
//   FIREBASE_PROJECT_ID       → ex: "edukaraib-12345"
//   FIREBASE_CLIENT_EMAIL     → ex: "firebase-adminsdk-xxx@..."
//   FIREBASE_PRIVATE_KEY      → clé privée complète (avec \n)
//   VERCEL_DRAIN_SECRET       → secret configuré dans Vercel Log Drain (pour vérifier la signature)
// ─────────────────────────────────────────────────────

// ✅ CRITIQUE : désactiver le bodyParser de Next.js pour lire le NDJSON brut
// Sans ça, Next.js essaie de parser le body comme JSON et plante
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ✅ Lire le body brut (Vercel envoie du NDJSON, pas du JSON)
  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (e) {
    return res.status(400).json({ error: 'Failed to read body' });
  }

  // ✅ Vérifier la signature Vercel (HMAC-SHA256)
  // Configurer le secret dans : Vercel Dashboard → Project → Settings → Log Drains
  const secret = process.env.VERCEL_DRAIN_SECRET;
  if (secret) {
    const sig = req.headers['x-vercel-signature'] || req.headers['x-vercel-log-drain-signature'];
    const valid = await verifySignature(rawBody, sig, secret);
    if (!valid) {
      console.warn('[drain] Invalid signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  // ✅ Parser le NDJSON : chaque ligne est un objet JSON indépendant
  let events = [];
  for (const line of rawBody.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // ligne non-JSON ignorée silencieusement
    }
  }

  if (events.length === 0) {
    return res.status(200).json({ ok: true, processed: 0 });
  }

  let accessToken;
  try {
    accessToken = await getGoogleAccessToken();
  } catch (e) {
    console.error('[drain] auth error:', e.message);
    return res.status(500).json({ error: 'Auth failed', detail: e.message });
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;

  const dayMap      = {};
  const monthMap    = {};
  const pageMap     = {};
  const countryMap  = {};
  const deviceMap   = {};
  const browserMap  = {};
  const referrerMap = {};

  for (const evt of events) {
    // ✅ Vercel Web Analytics envoie type='webAnalytics', pas eventType='pageview'
    // Les deux formats sont acceptés pour rétrocompatibilité
    const evtType = evt.type || evt.eventType || '';
    if (evtType !== 'webAnalytics' && evtType !== 'pageview') continue;

    const ts  = evt.timestamp || Date.now();
    const d   = new Date(ts);
    const day = fmtDate(d);
    const mon = fmtMonth(d);

    // ✅ Vercel envoie 'id' ou 'visitorId', pas 'sessionId'
    const sessionId = String(evt.id || evt.visitorId || evt.sessionId || '');

    if (!dayMap[day]) dayMap[day] = { pageviews: 0, sessions: new Set() };
    dayMap[day].pageviews++;
    if (sessionId) dayMap[day].sessions.add(sessionId);

    if (!monthMap[mon]) monthMap[mon] = { pageviews: 0, sessions: new Set() };
    monthMap[mon].pageviews++;
    if (sessionId) monthMap[mon].sessions.add(sessionId);

    // ✅ Vercel envoie 'url' (ou 'href'), pas 'path'
    const rawUrl = evt.url || evt.href || evt.path || '/';
    const path = rawUrl.startsWith('http') ? new URL(rawUrl).pathname : rawUrl;
    pageMap[path] = (pageMap[path] || 0) + 1;

    // ✅ Vercel envoie geo.country (objet imbriqué), pas country directement
    const country = evt.geo?.country || evt.country || 'unknown';
    countryMap[country] = (countryMap[country] || 0) + 1;

    // ✅ Vercel envoie 'ua' (user-agent string), pas device/browser directement
    // On détecte le type d'appareil et le navigateur depuis le UA
    const ua = evt.ua || '';
    const device = detectDevice(ua) || evt.device || 'desktop';
    deviceMap[device] = (deviceMap[device] || 0) + 1;

    const browser = detectBrowser(ua) || evt.browser || 'unknown';
    browserMap[browser] = (browserMap[browser] || 0) + 1;

    const ref = (evt.referrer || evt.referer || 'direct')
      .replace(/^https?:\/\//, '').split('/')[0] || 'direct';
    referrerMap[ref] = (referrerMap[ref] || 0) + 1;
  }

  const writes = [];

  for (const [day, data] of Object.entries(dayMap)) {
    writes.push(buildIncrement(projectId, `analytics_daily/${day}`, {
      pageviews: data.pageviews,
      // ✅ visitors : on incrémente le count de sessions UNIQUES de CE batch.
      // Note : si plusieurs batches arrivent le même jour avec des sessions qui se chevauchent,
      // le total Firestore sera légèrement surestimé. C'est un compromis inhérent
      // à l'architecture sans état (pas de déduplication cross-batch possible sans Redis).
      visitors: data.sessions.size,
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

// ── Lecture du body brut ──────────────────────────────
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk.toString('utf8'); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// ── Vérification signature Vercel (HMAC-SHA256) ───────
async function verifySignature(rawBody, signature, secret) {
  if (!signature) return false;
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['sign']
    );
    const sigBuffer = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
    const expected = Array.from(new Uint8Array(sigBuffer))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    // Comparaison en temps constant pour éviter les timing attacks
    const sig = signature.replace(/^sha256=/, '');
    if (sig.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
  } catch {
    return false;
  }
}

// ── Détection device / browser depuis UA ─────────────
function detectDevice(ua) {
  if (!ua) return 'desktop';
  const u = ua.toLowerCase();
  if (/mobile|android|iphone|ipod/.test(u)) return 'mobile';
  if (/tablet|ipad/.test(u)) return 'tablet';
  return 'desktop';
}

function detectBrowser(ua) {
  if (!ua) return 'unknown';
  const u = ua.toLowerCase();
  if (u.includes('edg/'))     return 'Edge';
  if (u.includes('opr/') || u.includes('opera')) return 'Opera';
  if (u.includes('chrome'))   return 'Chrome';
  if (u.includes('firefox'))  return 'Firefox';
  if (u.includes('safari'))   return 'Safari';
  return 'other';
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

// ✅ Remplace btoa(unescape(...)) déprécié par TextEncoder
function b64url(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
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