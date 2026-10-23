/* ————————————————————————————————————————————————————————————
   Remplit `profils/{uid}` pour tous les comptes existants (23/10/2026).

     node --env-file=.env.local scripts/sync-profils-publics.mjs

   Ensuite, la Cloud Function `onUserWrittenSyncProfil` tient la copie à
   jour toute seule. Relançable sans risque : chaque profil est réécrit
   depuis `users`, sur la liste blanche de functions/profilPublic.js, et les
   profils orphelins (compte supprimé) sont effacés.
   ———————————————————————————————————————————————————————————— */
import { createRequire } from 'node:module';
import { adminDb } from '../api/_firebaseAdmin.mjs';

const { profilPublic } = createRequire(import.meta.url)('../functions/profilPublic.js');

const [users, profils] = await Promise.all([
  adminDb.collection('users').get(),
  adminDb.collection('profils').get(),
]);
const existants = new Set(users.docs.map((d) => d.id));

let ecrits = 0;
let effaces = 0;
const lot = adminDb.batch();
for (const d of users.docs) {
  const p = profilPublic(d.id, d.data());
  if (p) { lot.set(adminDb.collection('profils').doc(d.id), p); ecrits += 1; }
}
for (const d of profils.docs) {
  if (!existants.has(d.id)) { lot.delete(d.ref); effaces += 1; }
}
await lot.commit();
console.log(`✅ ${ecrits} profil(s) publics écrits, ${effaces} orphelin(s) effacé(s).`);
process.exit(0);
