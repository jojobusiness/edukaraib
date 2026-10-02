// Dernière venue sur le site, par utilisateur (plan docs/plans/PLAN_SAVOIR_QUI_REVIENT_02-10-2026.md).
//
// Pourquoi : le 02/10, le bandeau d'état prof n'avait rien changé en 7 jours —
// et impossible de dire si les profs l'avaient vu ou s'ils ne reviennent jamais.
// Deux diagnostics opposés, deux corrections opposées. Il manquait une date.
//
// ⚠️ `presence/{uid}.lastSeen` ne répond pas à la question : il n'est écrit que
// par le serveur du chat, donc seulement si la personne ouvre la messagerie.
//
// Règles : au plus une écriture par jour et par utilisateur (une date au jour
// près suffit), et un échec ne doit JAMAIS gêner la session — c'est une
// statistique, pas une fonctionnalité.

export const PREFIXE_CLE = 'ek:lastSeenPing:';
export const DELAI_MS = 24 * 60 * 60 * 1000;

const cle = (uid) => `${PREFIXE_CLE}${uid}`;

/**
 * Horodatage du dernier ping, ou null si on n'en sait rien.
 * ⚠️ null et 0 ne sont pas la même chose : 0 est un horodatage valide (et le
 * cas des tests), alors que null veut dire « aucune trace, il faut pinguer ».
 */
function dernierPing(uid) {
  try {
    const brut = localStorage.getItem(cle(uid));
    if (brut === null) return null;
    const t = Number(brut);
    return Number.isFinite(t) ? t : null;
  } catch {
    // Navigation privée ou stockage bloqué : on pingue. Au pire une écriture
    // par chargement pour ces visiteurs-là, qui sont rares.
    return null;
  }
}

function noterPing(uid, maintenant) {
  try {
    localStorage.setItem(cle(uid), String(maintenant));
  } catch {
    // sans conséquence : le garde-fou saute, la donnée reste juste
  }
}

/**
 * Marque la venue du jour. Ne lève jamais, ne rend jamais la main en erreur.
 * @param {{ uid: string }|null} utilisateur
 * @param {(uid: string) => Promise<unknown>} ecrire  écriture Firestore, injectée pour les tests
 * @param {{ maintenant?: number, delaiMs?: number }} options
 * @returns {Promise<boolean>} true si une écriture a été tentée
 */
export async function marquerVenue(utilisateur, ecrire, { maintenant = Date.now(), delaiMs = DELAI_MS } = {}) {
  const uid = utilisateur?.uid;
  if (!uid || typeof ecrire !== 'function') return false;
  const dernier = dernierPing(uid);
  if (dernier !== null && maintenant - dernier < delaiMs) return false;

  try {
    await ecrire(uid);
  } catch {
    // Firestore indisponible, règle refusée, hors ligne : on n'en parle pas.
    return false;
  }
  noterPing(uid, maintenant);
  return true;
}
