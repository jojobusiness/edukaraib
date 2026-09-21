// Acquisition : d'où vient chaque inscrit (plan docs/plans/PLAN_ATTRIBUTION_20-09-2026.md).
//
// Vercel Analytics montre qu'un visiteur vient de Facebook, mais rien n'était
// écrit sur le compte : on ne savait jamais QUEL compte venait de Facebook.
// La source est capturée à l'arrivée (frontend/lib/acquisition.js), puis écrite
// dans `users/{uid}.acquisition` à l'inscription.
//
// Module pur, sans `window` : importé par le front ET par l'API (partner-signup),
// pour que le serveur nettoie ce que le client envoie avec les mêmes règles.

export const ACQUISITION_UNKNOWN = 'inconnu';

// « Comment avez-vous connu EduKaraib ? » — le filet quand la technique échoue
// (navigateurs in-app Facebook/Instagram, qui perdent les paramètres).
export const HEARD_FROM_OPTIONS = [
  { value: 'facebook', label: 'Facebook' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'google', label: 'Recherche Google' },
  { value: 'professeur', label: 'Un professeur' },
  { value: 'etablissement', label: 'Mon établissement ou une association' },
  { value: 'proche', label: 'Un proche' },
  { value: 'autre', label: 'Autre' },
];
const HEARD_FROM_VALUES = new Set(HEARD_FROM_OPTIONS.map((o) => o.value));

// Domaine du référent → source lisible. L'ordre compte : le premier qui matche gagne.
const REFERRER_SOURCES = [
  [/(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$/, 'facebook'],
  [/(^|\.)instagram\.com$/, 'instagram'],
  [/(^|\.)tiktok\.com$/, 'tiktok'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube'],
  [/(^|\.)(whatsapp\.com|wa\.me)$/, 'whatsapp'],
  [/(^|\.)(t\.co|twitter\.com|x\.com)$/, 'x'],
  [/(^|\.)linkedin\.com$|(^|\.)lnkd\.in$/, 'linkedin'],
  [/(^|\.)snapchat\.com$/, 'snapchat'],
  [/(^|\.)google\.[a-z.]+$/, 'google'],
  [/(^|\.)bing\.com$/, 'bing'],
  [/(^|\.)(duckduckgo\.com|qwant\.com|ecosia\.org)$/, 'recherche'],
  [/(^|\.)(mail\.zoho\.[a-z]+|mail\.google\.com|outlook\.[a-z.]+|mail\.yahoo\.com)$/, 'mail'],
];

// Identifiants de clic ajoutés par les régies : présents même quand le référent est perdu.
const CLICK_IDS = [['fbclid', 'facebook'], ['ttclid', 'tiktok'], ['gclid', 'google'], ['igshid', 'instagram']];

const OWN_HOST = /(^|\.)edukaraib\.(com|vercel\.app)$|^localhost$|^127\.0\.0\.1$/;

const clip = (v, n = 120) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const token = (v, n = 60) => clip(v, n).toLowerCase();

/** Hôte du référent s'il est EXTERNE au site, sinon ''. */
export function externalHost(referrer) {
  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, '');
    return OWN_HOST.test(host) ? '' : host;
  } catch {
    return '';
  }
}

/** Source lisible pour un hôte référent (« facebook », « google »… ou l'hôte lui-même). */
export function sourceFromHost(host) {
  if (!host) return '';
  const hit = REFERRER_SOURCES.find(([re]) => re.test(host));
  return hit ? hit[1] : host;
}

/**
 * Premier contact tiré d'une arrivée sur le site.
 * @param {{ search?: string, referrer?: string, pathname?: string, now?: number }} arrivee
 * @returns {object} toujours un objet ; `source: 'direct'` si rien ne trahit l'origine
 */
export function touchFromArrival({ search = '', referrer = '', pathname = '/', now = Date.now() } = {}) {
  const p = new URLSearchParams(search);
  const host = externalHost(referrer);
  const clickSource = (CLICK_IDS.find(([k]) => p.get(k)) || [])[1] || '';
  const source = token(p.get('utm_source')) || clickSource || sourceFromHost(host) || 'direct';
  return {
    source,
    medium: token(p.get('utm_medium')) || (host ? 'referral' : ''),
    campaign: token(p.get('utm_campaign')),
    content: token(p.get('utm_content')),
    // Origine + chemin seulement : `users` est en lecture publique, on ne garde
    // pas la query string du référent (jetons de suivi, recherches…).
    referrer: host ? clip(safeOriginPath(referrer), 200) : '',
    landing: clip(pathname, 120) || '/',
    // Code partenaire ou de campagne transporté dans l'URL (/bac?code=LHATIEN81)
    code: clip(p.get('code') || p.get('ref') || '', 40).toUpperCase(),
    date: now,
  };
}

function safeOriginPath(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return '';
  }
}

/**
 * Faut-il remplacer le contact mémorisé par la nouvelle arrivée ?
 * La PREMIÈRE source gagne (on veut savoir qui a fait découvrir EduKaraib),
 * sauf si la première était « direct » : c'est presque toujours une visite dont
 * l'origine a été perdue, une vraie source trouvée ensuite vaut mieux.
 */
export function shouldReplaceTouch(stored, incoming, { now = Date.now(), maxAgeMs } = {}) {
  if (!stored || !stored.date) return true;
  if (maxAgeMs && now - stored.date > maxAgeMs) return true;
  return stored.source === 'direct' && incoming.source !== 'direct';
}

/**
 * Objet écrit dans `users/{uid}.acquisition`. Ne lève jamais : une valeur
 * absente devient 'inconnu', l'inscription ne doit pas échouer pour ça.
 * Accepte un contact capturé (`date`) ou un enregistrement déjà construit
 * (`premierContact`, `declared`) : l'API re-nettoie ce que le client envoie.
 */
export function acquisitionRecord(touch, heardFrom = '') {
  const t = touch && typeof touch === 'object' ? touch : {};
  const declared = token(heardFrom || t.declared, 30);
  const date = Number(t.date) || Date.parse(t.premierContact || '');
  return {
    source: token(t.source) || ACQUISITION_UNKNOWN,
    medium: token(t.medium),
    campaign: token(t.campaign),
    content: token(t.content),
    referrer: clip(t.referrer, 200),
    landing: clip(t.landing, 120),
    code: clip(t.code, 40).toUpperCase(),
    // Borne haute : au-delà, toISOString() lève (valeur trafiquée par un client)
    premierContact: Number.isFinite(date) && date > 0 && date < 8.64e15 ? new Date(date).toISOString() : null,
    declared: HEARD_FROM_VALUES.has(declared) ? declared : '',
  };
}
