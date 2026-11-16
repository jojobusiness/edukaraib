/* Migration des disponibilités vers les « horaires habituels » (PLAN_DISPOS_PROFS, 16/11/2026).
     node --env-file=.env.local scripts/dispos-modele.mjs                        → aperçu
     node --env-file=.env.local scripts/dispos-modele.mjs --ecrire               → écrit
     node --env-file=.env.local scripts/dispos-modele.mjs --depuis=2026-09-01    → seuil (défaut)

   Pour chaque prof SANS horaires habituels : sa dernière semaine remplie devient
   son modèle (availability.modele), si cette semaine date d'après le seuil.
   Avant le seuil, le prof est probablement inactif : on ne prolonge pas ses
   heures, on le liste seulement. Rien n'est effacé : les semaines datées restent.
   Chaque prof migré reçoit une notification (et donc un mail, Cloud Function
   onNotificationCreated) qui le lui dit. Règles : api/_dispos.mjs. */
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../api/_firebaseAdmin.mjs';
import { modeleDepuisDerniereSemaine, nbHeures, nbCreneaux } from '../api/_dispos.mjs';

const ecrire = process.argv.includes('--ecrire');
const depuis = (process.argv.find((a) => a.startsWith('--depuis=')) || '--depuis=2026-09-01').split('=')[1];
const jjmm = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

const snap = await adminDb.collection('users').where('role', '==', 'teacher').get();
const migres = [];
const anciens = [];
let dejaModele = 0;
let sansDispo = 0;

for (const d of snap.docs) {
  const u = d.data();
  if (u.compteTest) continue;
  const avail = u.availability && typeof u.availability === 'object' ? u.availability : {};
  if (avail.modele) { dejaModele += 1; continue; }
  const m = modeleDepuisDerniereSemaine(avail);
  if (!m) { sansDispo += 1; continue; }
  const ligne = `${(u.fullName || d.id).padEnd(28)} semaine du ${jjmm(m.semaine)}/${m.semaine.slice(0, 4)} · ${nbHeures(m.modele)} h/semaine`;
  if (m.semaine < depuis) { anciens.push(ligne); continue; }
  migres.push(ligne);
  if (!ecrire) continue;

  const suivant = { ...avail, modele: m.modele, modele_depuis: m.semaine };
  await d.ref.update({ availability: suivant });
  await adminDb.collection('notifications').add({
    user_id: d.id,
    read: false,
    created_at: FieldValue.serverTimestamp(),
    type: 'dispos_modele',
    title: 'Vos horaires habituels sont en place',
    message: `On a gardé vos horaires du ${jjmm(m.semaine)} comme horaires habituels : ils valent désormais chaque semaine, vous n'avez plus à revenir les cocher. Modifiez-les si besoin dans votre profil, rubrique « Disponibilités ».`,
  });
  console.log(`  ✔ ${u.fullName || d.id} : ${nbCreneaux(suivant)} créneaux sur 4 semaines`);
}

console.log(`\n=== ${migres.length} prof(s) ${ecrire ? 'MIGRÉ(S)' : 'à migrer'} (dernière semaine remplie ≥ ${jjmm(depuis)}/${depuis.slice(0, 4)}) ===`);
migres.forEach((l) => console.log(`  ${l}`));
console.log(`\n=== ${anciens.length} prof(s) NON prolongé(s) (dernière semaine avant le seuil) ===`);
anciens.forEach((l) => console.log(`  ${l}`));
console.log(`\nDéjà des horaires habituels : ${dejaModele} · aucune dispo jamais cochée : ${sansDispo}`);
if (!ecrire) console.log('\nAperçu seulement. Ajouter --ecrire pour appliquer.');
process.exit(0);
