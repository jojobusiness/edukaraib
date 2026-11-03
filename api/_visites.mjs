// Compteur de visites maison (03/11/2026), à la place du log drain Vercel, qui
// ne transporte pas les visites : l'écran « visites » de l'admin est resté vide.
// Sans cookie ni identifiant : le navigateur dit seulement « 1re page vue
// aujourd'hui » (vrai/faux). Ordre de grandeur, pas une mesure exacte. Module pur.

const ID_DANS_CHEMIN = [
  [/^\/profils\/[^/]+/, '/profils/*'],
  [/^\/p\/[^/]+/, '/p/*'],
  [/^\/chat\/[^/]+/, '/chat/*'],
  [/^\/facture\/[^/]+/, '/facture/*'],
  [/^\/visio\/[^/]+/, '/visio/*'],
  [/^\/enfants?\/[^/]+/, '/enfant/*'],
];

/** Chemin sans identifiant (jamais un uid ou un code dans les stats). */
export function cheminAnonyme(chemin) {
  let c = String(chemin || '/').split('?')[0].split('#')[0].slice(0, 80) || '/';
  for (const [re, remplace] of ID_DANS_CHEMIN) if (re.test(c)) return remplace;
  c = c.replace(/[^A-Za-z0-9/_-]/g, '');
  return c.length > 1 ? c.replace(/\/$/, '') : '/';
}

/** Clé Firestore d'un chemin (même encodage que l'écran admin). */
export const cleChemin = (c) => c.replace(/\//g, '__SLASH__').replace(/\./g, '__DOT__') || '__root__';

export function appareil(ua = '') {
  return /Mobi|Android|iPhone|iPad/i.test(ua) ? 'mobile' : 'ordinateur';
}

export function navigateur(ua = '') {
  if (/musical_ly|BytedanceWebview|TikTok/i.test(ua)) return 'TikTok';
  if (/Instagram/i.test(ua)) return 'Instagram';
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return 'Facebook';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  if (/Firefox\//.test(ua)) return 'Firefox';
  return 'autre';
}

/** Source lisible : hôte du référent externe, sans chemin ni paramètres. */
export function sourceVisite(referent = '') {
  try {
    const h = new URL(referent).hostname.replace(/^www\./, '').toLowerCase();
    return /(^|\.)edukaraib\.(com|vercel\.app)$/.test(h) ? '' : h.replace(/\./g, '_').slice(0, 60);
  } catch {
    return '';
  }
}

export const jourUTC = (d = new Date()) => d.toISOString().slice(0, 10);
