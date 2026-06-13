// Meta Conversions API (CAPI) — envoi des événements côté serveur (fiable iOS + bloqueurs).
// PLUG-AND-PLAY : actif uniquement quand META_CAPI_TOKEN est défini sur Vercel.
// Le dataset ID = le Pixel ID (Meta unifie les deux). META_PIXEL_ID a déjà une valeur
// par défaut → il ne reste qu'à coller le token demain, aucun code à modifier.
import crypto from 'crypto';

const PIXEL_ID = process.env.META_PIXEL_ID || '902547262470626';
const TOKEN = process.env.META_CAPI_TOKEN || '';
const TEST_CODE = process.env.META_TEST_EVENT_CODE || ''; // optionnel — pour « Test events » dans Events Manager
const API_VERSION = 'v19.0';

const sha256 = (v) =>
  v ? crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex') : undefined;

export function capiEnabled() {
  return Boolean(TOKEN && PIXEL_ID);
}

/**
 * Envoie un événement serveur à Meta. No-op silencieux si non configuré.
 * @param {object} p
 * @param {string}  p.eventName       ex. 'Purchase'
 * @param {string}  p.eventId         identique au pixel navigateur → déduplication
 * @param {number} [p.value]          montant
 * @param {string} [p.currency='EUR']
 * @param {string} [p.email]          email en clair (hashé avant envoi)
 * @param {string} [p.clientIp]
 * @param {string} [p.userAgent]
 * @param {string} [p.eventSourceUrl]
 */
export async function sendCapiEvent({
  eventName, eventId, value, currency = 'EUR',
  email, clientIp, userAgent, eventSourceUrl,
}) {
  if (!capiEnabled()) return { skipped: true };

  const userData = {};
  if (email) userData.em = [sha256(email)];
  if (clientIp) userData.client_ip_address = clientIp;
  if (userAgent) userData.client_user_agent = userAgent;

  const payload = {
    data: [{
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'website',
      ...(eventId ? { event_id: eventId } : {}),
      ...(eventSourceUrl ? { event_source_url: eventSourceUrl } : {}),
      user_data: userData,
      custom_data: {
        currency,
        ...(value != null ? { value: Number(value) } : {}),
      },
    }],
    ...(TEST_CODE ? { test_event_code: TEST_CODE } : {}),
  };

  const url = `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(TOKEN)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Meta CAPI ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}
