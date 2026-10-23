// Lire la fiche de QUELQU'UN D'AUTRE (23/10/2026).
//
// Depuis le 23/10, `users` n'est plus lisible que par soi-même et l'admin :
// avant, n'importe quel visiteur SANS COMPTE listait les e-mails, téléphones
// et dates de naissance de tous les inscrits. Les autres écrans passent par :
//   - `profils/{uid}` : copie publique (vitrine d'un prof, nom et avatar des
//     autres), tenue à jour par la Cloud Function onUserWrittenSyncProfil ;
//   - /api/fiches-eleves : le nom d'un enfant, pour qui partage un cours avec lui ;
//   - /api/notify-email { toUids } : écrire à quelqu'un sans connaître son adresse.
// ⛔ Ne jamais relire `doc(db, 'users', autreUid)` : c'est refusé.
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { fetchWithAuth } from '../utils/fetchWithAuth';

const cacheProfils = new Map();
const cacheEleves = new Map();

/** La fiche d'un compte : la sienne en entier, celle d'un autre en version publique. */
export function lireProfil(uid) {
  if (!uid) return Promise.resolve(null);
  const id = String(uid);
  const col = id === auth.currentUser?.uid ? 'users' : 'profils';
  const cle = `${col}/${id}`;
  if (!cacheProfils.has(cle)) {
    cacheProfils.set(cle, getDoc(doc(db, col, id))
      .then((s) => (s.exists() ? { id, ...s.data() } : null))
      .catch(() => null));
  }
  return cacheProfils.get(cle);
}

/**
 * La fiche d'un enfant (`students`). Le parent la lit directement ; un prof
 * ou un participant du même cours reçoit une version réduite par l'API.
 */
export function lireEleve(id) {
  if (!id) return Promise.resolve(null);
  const cle = String(id);
  if (!cacheEleves.has(cle)) {
    cacheEleves.set(cle, (async () => {
      try {
        const s = await getDoc(doc(db, 'students', cle));
        return s.exists() ? { id: cle, ...s.data() } : null;
      } catch { /* pas le parent : on demande au serveur */ }
      if (!auth.currentUser) return null;
      try {
        const r = await fetchWithAuth('/api/fiches-eleves', { method: 'POST', body: JSON.stringify({ ids: [cle] }) });
        return r?.fiches?.[cle] || null;
      } catch {
        return null;
      }
    })());
  }
  return cacheEleves.get(cle);
}

/**
 * Même forme qu'un `getDoc` (exists() / data()), pour remplacer
 * `getDoc(doc(db, 'students', id))` sans toucher au code autour.
 */
export async function instantaneEleve(id) {
  const fiche = await lireEleve(id);
  return { id: String(id || ''), exists: () => !!fiche, data: () => fiche || undefined };
}

/** Un nom lisible, que l'identifiant soit un compte ou une fiche enfant. */
export function nomDe(p) {
  if (!p) return '';
  return p.fullName || p.full_name || p.name || p.displayName
    || [p.firstName || p.first_name, p.lastName || p.last_name].filter(Boolean).join(' ') || '';
}

/** Le nom d'un compte ou d'un enfant, '' si introuvable. */
export async function nomDeQuelquun(id) {
  return nomDe(await lireProfil(id)) || nomDe(await lireEleve(id));
}

/**
 * Envoie un mail EduKaraib à des comptes ou à des enfants (le serveur prévient
 * alors le parent). On ne manipule jamais l'adresse de quelqu'un d'autre.
 */
export async function envoyerMail(uids, { title, message, ctaUrl, ctaText = 'Ouvrir' }) {
  const toUids = [...new Set((uids || []).filter(Boolean).map(String))];
  if (!toUids.length) return;
  await fetchWithAuth('/api/notify-email', {
    method: 'POST',
    body: JSON.stringify({ toUids, title, message, ctaUrl, ctaText }),
  }).catch(() => {});
}

/** Pour les tests. */
export function viderCachesProfils() {
  cacheProfils.clear();
  cacheEleves.clear();
}
