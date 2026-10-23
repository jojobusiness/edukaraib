// Dernière venue sur le site, par utilisateur (plan docs/plans/PLAN_SAVOIR_QUI_REVIENT_02-10-2026.md).
//
// Pourquoi : le 02/10, le bandeau d'état prof n'avait rien changé en 7 jours —
// et impossible de dire si les profs l'avaient vu ou s'ils ne reviennent jamais.
// Deux diagnostics opposés, deux corrections opposées. Il manquait une date.
//
// ⚠️ `presence/{uid}.lastSeen` ne répond pas à la question : il n'est écrit que
// par le serveur du chat, donc seulement si la personne ouvre la messagerie.
//
// Règles : au plus une écriture par HEURE et par utilisateur (23/10/2026 :
// c'était 24 h, la date affichée dans l'admin pouvait avoir un jour de
// retard ; plan docs/plans/PLAN_DERNIERE_CONNEXION_23-10-2026.md), et un
// échec ne doit JAMAIS gêner la session — c'est une statistique, pas une
// fonctionnalité.

export const PREFIXE_CLE = 'ek:lastSeenPing:';
export const DELAI_MS = 60 * 60 * 1000;

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

// ── Affichage dans l'admin, onglet Comptes (23/10/2026) ─────────────────────

const HEURE = 60 * 60 * 1000;
const JOUR = 24 * HEURE;

/** Firestore Timestamp, Date, nombre ou chaîne → millisecondes, ou null. */
export function enMs(v) {
  if (v == null) return null;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  const t = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

const jourParis = (ms) => new Date(ms).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });
const dateComplete = (ms) => new Date(ms).toLocaleString('fr-FR', {
  timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

/** true si la dernière trace date de l'inscription (moins d'1 h après). */
export function pasRevenuDepuisInscription(createdAt, lastSeenAt) {
  const c = enMs(createdAt);
  const v = enMs(lastSeenAt);
  return c != null && v != null && v - c < HEURE;
}

/**
 * Ce qu'affiche la colonne « Dernière venue ».
 * @returns {{ texte: string, ton: 'gris'|'orange'|'normal', titre: string }}
 */
export function libelleDerniereVenue(createdAt, lastSeenAt, maintenant = Date.now()) {
  const v = enMs(lastSeenAt);
  if (v == null) {
    return { texte: 'jamais tracé', ton: 'gris', titre: "Compte antérieur au 02/10/2026, pas revenu depuis (ou trace jamais écrite)" };
  }
  const titre = dateComplete(v);
  if (pasRevenuDepuisInscription(createdAt, lastSeenAt)) {
    return { texte: "pas revenu depuis l'inscription", ton: 'orange', titre };
  }
  const ecart = maintenant - v;
  if (ecart < JOUR) {
    return { texte: jourParis(v) === jourParis(maintenant) ? "aujourd'hui" : 'hier', ton: 'normal', titre };
  }
  return { texte: `il y a ${Math.floor(ecart / JOUR)} j`, ton: 'normal', titre };
}

/** Tri « Dernière venue » : la plus récente d'abord, les « jamais tracé » à la fin. */
export function trierParVenue(comptes) {
  return [...comptes].sort((a, b) => (enMs(b.lastSeenAt) ?? -Infinity) - (enMs(a.lastSeenAt) ?? -Infinity));
}

/**
 * Filtre de l'onglet Comptes.
 * @param {'tous'|'revenus7j'|'pasRevenus'} filtre
 */
export function filtrerParVenue(comptes, filtre, maintenant = Date.now()) {
  if (filtre === 'pasRevenus') return comptes.filter((u) => pasRevenuDepuisInscription(u.createdAt, u.lastSeenAt));
  if (filtre === 'revenus7j') {
    return comptes.filter((u) => {
      const v = enMs(u.lastSeenAt);
      return v != null && maintenant - v <= 7 * JOUR && !pasRevenuDepuisInscription(u.createdAt, u.lastSeenAt);
    });
  }
  return comptes;
}
