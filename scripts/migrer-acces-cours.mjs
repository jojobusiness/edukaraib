/* ————————————————————————————————————————————————————————————
   Pose `acces` sur les cours existants et remplit `creneaux` (23/10/2026).

     node --env-file=.env.local scripts/migrer-acces-cours.mjs

   Depuis le 23/10, un cours n'est lisible que par les comptes de `acces`, et
   la page publique d'un prof lit `creneaux`. La Cloud Function
   onLessonWrittenSync tient les deux à jour à chaque écriture ; ce script
   s'occupe des cours écrits AVANT. Mêmes règles : functions/coursAcces.js.
   Relançable sans risque.
   ———————————————————————————————————————————————————————————— */
import { createRequire } from 'node:module';
import { adminDb } from '../api/_firebaseAdmin.mjs';

const { accesDuCours, creneauPublic, memeListe } = createRequire(import.meta.url)('../functions/coursAcces.js');

const lireEleve = async (id) => {
  const s = await adminDb.collection('students').doc(id).get();
  return s.exists ? s.data() : null;
};

const [cours, creneaux] = await Promise.all([
  adminDb.collection('lessons').get(),
  adminDb.collection('creneaux').get(),
]);
const existants = new Set(cours.docs.map((d) => d.id));
let acces = 0;
for (const d of cours.docs) {
  const l = d.data();
  const a = await accesDuCours(l, lireEleve);
  if (!memeListe(l.acces, a)) { await d.ref.update({ acces: a }); acces += 1; }
  await adminDb.collection('creneaux').doc(d.id).set(creneauPublic(l));
}
let orphelins = 0;
for (const c of creneaux.docs) {
  if (!existants.has(c.id)) { await c.ref.delete(); orphelins += 1; }
}
console.log(`✅ ${cours.size} cours : ${acces} accès posés, ${cours.size} créneaux publics écrits, ${orphelins} orphelin(s) effacé(s).`);
process.exit(0);
