// Qui a le droit d'écrire à qui, et avec quels liens (23/10/2026).
//
// Avant : /api/notify-email prenait une adresse e-mail en clair, n'importe
// laquelle, et un lien libre. Tout compte connecté pouvait donc envoyer un
// mail « EduKaraib » depuis notifications@edukaraib.com vers n'importe qui,
// avec un lien de son choix : un relais de hameçonnage avec notre domaine.
// Et pour s'en servir, le navigateur devait lire l'e-mail des autres
// utilisateurs — raison pour laquelle `users` était resté ouvert à tous.
//
// Désormais on écrit à un IDENTIFIANT ; le serveur trouve l'adresse. Pour un
// enfant (fiche `students`, sans compte), c'est l'adresse de son parent.
// Module pur, testé par frontend/test/destinataires.test.js.

const NOS_DOMAINES = ['edukaraib.com', 'www.edukaraib.com', 'edukaraib.vercel.app'];

/** true si l'URL pointe vers le site (https uniquement). */
export function lienDuSite(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:' && NOS_DOMAINES.includes(u.hostname);
  } catch {
    return false;
  }
}

/** Le lien du bouton, ou le lien par défaut s'il sort du site. */
export function ctaSur(url, defaut) {
  return url && lienDuSite(url) ? String(url) : defaut;
}

/** Combien d'identifiants on accepte dans un seul envoi. */
export const MAX_DESTINATAIRES = 50;

/**
 * Les adresses e-mail des destinataires, sans doublon (un parent de deux
 * enfants inscrits au même cours ne reçoit qu'un mail).
 * @param {string[]} uids identifiants de comptes `users` ou de fiches `students`
 * @param {(col: string, id: string) => Promise<object|null>} lire lit un document
 * @returns {Promise<string[]>}
 */
export async function adressesDe(uids, lire) {
  const ids = [...new Set((uids || []).map(String).filter(Boolean))].slice(0, MAX_DESTINATAIRES);
  const adresses = new Set();
  for (const id of ids) {
    const u = await lire('users', id);
    if (u?.email) { adresses.add(String(u.email).trim().toLowerCase()); continue; }
    const enfant = await lire('students', id);
    if (enfant?.parent_id) {
      const parent = await lire('users', String(enfant.parent_id));
      if (parent?.email) adresses.add(String(parent.email).trim().toLowerCase());
    }
  }
  return [...adresses];
}
