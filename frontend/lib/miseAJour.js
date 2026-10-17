// Mise à jour automatique des onglets déjà ouverts (17/10/2026).
//
// Une SPA chargée reste sur son ancien bundle jusqu'à ce que le visiteur
// recharge. Jusqu'ici, le seul moyen de voir un correctif était « fais
// Ctrl + F5 » — une consigne qu'on ne peut pas donner à une famille, et
// qu'elle n'a aucune raison de connaître.
//
// Même mécanique que Factur'Peyi (10/10/2026) et Belmyre (14/10/2026), adaptée
// à EduKaraib. Le contrat est le même : on recharge SEULEMENT quand c'est sans
// conséquence. Sinon on prévient, et la personne choisit son moment.
//
// ⚠️ À ne pas confondre avec le rechargement de `main.jsx` sur
// `vite:preloadError` : celui-là rattrape un morceau de code disparu après un
// déploiement (page blanche). Ici, on évite d'en arriver là.

export const VERSION_LOCALE = import.meta.env.VITE_APP_VERSION || 'local';

/** Veille de fond toutes les 5 min, plus à chaque navigation et retour d'onglet. */
export const INTERVALLE_MS = 5 * 60 * 1000;
/** Deux vérifications ne se suivent jamais de moins de 30 s. */
export const DELAI_MINIMAL_MS = 30 * 1000;

/**
 * Pages où un rechargement casse quelque chose d'irrattrapable, même si
 * personne n'est en train de taper. Propre à EduKaraib :
 * - `/visio` : recharger coupe le cours en cours. Le pire cas du site.
 * - `/chat`, `/messages` : un message en cours d'écriture ou un envoi de
 *   pièce jointe en vol.
 * - `/pay` : le retour de Stripe, pendant que le paiement se confirme.
 * - `/register`, `/profile`, `/prof/profile` : des formulaires longs.
 * Sur ces pages on ne recharge jamais tout seul : on affiche le bandeau.
 */
export const PAGES_PROTEGEES = ['/visio', '/chat', '/messages', '/pay', '/register', '/profile', '/prof/profile'];

const CLE_TENTATIVE = 'edukaraib.maj-tentee';

/** En local et dans les tests, la version vaut « local » : rien à surveiller. */
export function doitSurveiller(version = VERSION_LOCALE) {
  return typeof version === 'string' && version !== '' && version !== 'local';
}

export const estPageProtegee = (chemin = '') => PAGES_PROTEGEES.some((p) => String(chemin).startsWith(p));

/**
 * Version actuellement déployée, lue sur /version.json (émis au build).
 * Renvoie null si la réponse est inexploitable : hors ligne, 404, ou le HTML
 * que renvoie la réécriture SPA. Aucun de ces cas ne doit rien déclencher.
 */
export async function versionDeployee(fetchImpl = fetch) {
  try {
    const reponse = await fetchImpl(`/version.json?_=${Date.now()}`, { cache: 'no-store' });
    if (!reponse?.ok) return null;
    const donnees = await reponse.json();
    const version = donnees?.version;
    return typeof version === 'string' && version ? version : null;
  } catch {
    return null; // hors ligne : on retentera au prochain passage
  }
}

/**
 * Que faire : « recharger » · « prevenir » · « rien ».
 *
 * `momentSur` : les deux seuls instants où l'on sait que rien n'est en vol —
 * un changement de page, et le retour sur l'onglet. Au milieu d'une session,
 * un paiement ou un envoi peut être en cours sans que personne n'ait rien
 * tapé : là, on prévient seulement.
 * `saisieEnCours` : quelqu'un a tapé sur cette page. Recharger effacerait sa
 * saisie, donc jamais sans son accord.
 * `pageProtegee` : voir PAGES_PROTEGEES.
 * `dejaTentee` : garde anti-boucle. Si on a déjà rechargé pour atteindre cette
 * version et qu'on tourne encore sur l'ancienne (CDN pas propagé, HTML en
 * cache), recharger encore mettrait l'onglet en boucle.
 */
export function decision({ versionLocale, versionDistante, saisieEnCours, dejaTentee, momentSur, pageProtegee }) {
  if (!doitSurveiller(versionLocale)) return 'rien';
  if (!versionDistante || versionDistante === versionLocale) return 'rien';
  if (saisieEnCours) return 'prevenir';
  if (pageProtegee) return 'prevenir';
  if (!momentSur) return 'prevenir';
  if (dejaTentee === versionDistante) return 'prevenir';
  return 'recharger';
}

// ── Mémoire de l'onglet ────────────────────────────────────────────────────
// sessionStorage peut lever (navigation privée, stockage bloqué) : jamais
// d'exception qui remonterait dans un effet React.

export function tentativeEnregistree(store = globalThis.sessionStorage) {
  try {
    return store?.getItem(CLE_TENTATIVE) || null;
  } catch {
    return null;
  }
}

export function enregistrerTentative(version, store = globalThis.sessionStorage) {
  try {
    store?.setItem(CLE_TENTATIVE, version);
  } catch {
    /* sans mémoire, le garde anti-boucle ne protège que l'instant présent */
  }
}

export function oublierTentative(store = globalThis.sessionStorage) {
  try {
    store?.removeItem(CLE_TENTATIVE);
  } catch {
    /* rien à faire */
  }
}
