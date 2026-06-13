import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
} from 'firebase/auth';
import { auth } from './firebase';

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

// Codes d'erreur signifiant « la popup n'a pas pu s'ouvrir » → on bascule en
// redirect (même onglet). On NE bascule PAS sur popup-closed-by-user : si
// l'utilisateur ferme volontairement la popup, déclencher un redirect plein
// écran serait agressif.
const POPUP_FALLBACK_CODES = new Set([
  'auth/popup-blocked',
  'auth/operation-not-supported-in-this-environment',
  'auth/web-storage-unsupported',
]);

/**
 * Connexion Google : popup d'abord (fiable sur iOS moderne, ne quitte pas le
 * site), redirect en secours seulement si la popup est bloquée.
 * @returns {Promise<import('firebase/auth').User|null>} l'utilisateur, ou null
 *   si un redirect a été déclenché (la page va naviguer — récupéré ensuite par
 *   consumeGoogleRedirect au remontage).
 */
export async function signInWithGoogle() {
  try {
    const cred = await signInWithPopup(auth, provider);
    return cred.user;
  } catch (e) {
    if (POPUP_FALLBACK_CODES.has(e?.code)) {
      await signInWithRedirect(auth, provider); // redirige, ne retourne pas
      return null;
    }
    throw e; // popup-closed-by-user / cancelled-popup-request remontent à l'appelant
  }
}

/**
 * À appeler au montage de Login/Register pour récupérer l'utilisateur après un
 * fallback redirect. Retourne null s'il n'y a pas de redirect en attente.
 */
export async function consumeGoogleRedirect() {
  try {
    const res = await getRedirectResult(auth);
    return res?.user || null;
  } catch {
    return null;
  }
}
