/* ————————————————————————————————————————————————————————————
   Pose `acces` sur les documents de cours déjà envoyés (23/10/2026).

     node --env-file=.env.local scripts/migrer-acces-documents.mjs

   Depuis le 23/10, un document n'est lisible que par les comptes listés
   dans `acces` (règle Firestore). Les documents envoyés avant n'ont pas ce
   champ : sans ce script, plus personne ne les verrait. Relançable.
   ———————————————————————————————————————————————————————————— */
import { adminDb } from '../api/_firebaseAdmin.mjs';
import { accesDuCours } from '../frontend/lib/accesCours.js';

const docs = await adminDb.collection('documents').get();
let maj = 0;
for (const d of docs.docs) {
  const data = d.data();
  const lecon = data.lesson_id
    ? await adminDb.collection('lessons').doc(String(data.lesson_id)).get()
    : null;
  const acces = accesDuCours(lecon?.exists ? lecon.data() : null, data.sender_id);
  const deja = new Set(data.acces || []);
  if (acces.every((id) => deja.has(id)) && data.acces) continue;
  await d.ref.update({ acces: [...new Set([...(data.acces || []), ...acces])] });
  maj += 1;
  console.log(`  ${d.id} → ${acces.length} accès${lecon?.exists ? '' : ' (cours supprimé : l’auteur seul)'}`);
}
console.log(`✅ ${maj}/${docs.size} document(s) mis à jour.`);
process.exit(0);
