// Capture de la source d'arrivée, côté navigateur. Règles dans api/_acquisition.mjs.
//
// Porté du module parrainage.js de Factur'Peyi (11/09/2026) : un paramètre qui
// ne vit que dans l'URL ne survit ni au F5, ni à un retour le lendemain, ni à la
// redirection Google sur mobile. On le capte donc au chargement de N'IMPORTE
// QUELLE page et on le garde 90 jours dans le navigateur.
//
// Différence voulue avec le parrainage : ici la PREMIÈRE source gagne.
import { touchFromArrival, shouldReplaceTouch, acquisitionRecord } from '../../api/_acquisition.mjs';

const KEY = 'ek_acquisition';
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

function readStored() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const t = JSON.parse(raw);
    if (!t?.date || Date.now() - t.date > MAX_AGE_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return t;
  } catch {
    return null;
  }
}

/** À appeler une fois au démarrage de l'app (main.jsx). Ne lève jamais. */
export function captureAcquisition() {
  if (typeof window === 'undefined') return;
  try {
    const incoming = touchFromArrival({
      search: window.location.search,
      referrer: document.referrer,
      pathname: window.location.pathname,
    });
    if (shouldReplaceTouch(readStored(), incoming, { maxAgeMs: MAX_AGE_MS })) {
      localStorage.setItem(KEY, JSON.stringify(incoming));
    }
  } catch {
    // localStorage bloqué (navigation privée, navigateur in-app) : sans gravité,
    // la question « Comment avez-vous connu EduKaraib ? » sert de filet.
  }
}

/** Objet à écrire dans `users/{uid}.acquisition` au moment de l'inscription. */
export function getAcquisitionRecord(heardFrom = '') {
  if (typeof window === 'undefined') return acquisitionRecord(null, heardFrom);
  return acquisitionRecord(readStored(), heardFrom);
}
