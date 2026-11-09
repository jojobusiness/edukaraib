/* Remet le bon indicatif sur les téléphones déjà enregistrés (09/11/2026).
     node --env-file=.env.local scripts/corriger-indicatifs.mjs          → aperçu
     node --env-file=.env.local scripts/corriger-indicatifs.mjs --ecrire → corrige
   Règle : api/_telephone.mjs (+33 6 94 … → +594 6 94 …, etc.). Pose aussi
   pays_inscription (déduit du téléphone) quand il manque. */
import { adminDb } from '../api/_firebaseAdmin.mjs';
import { corrigerIndicatif, paysDepuisTelephone } from '../api/_telephone.mjs';

const ecrire = process.argv.includes('--ecrire');
const snap = await adminDb.collection('users').get();
let n = 0;
for (const d of snap.docs) {
  const u = d.data();
  const maj = {};
  if (u.phone) {
    const bon = corrigerIndicatif(u.phone);
    if (bon !== u.phone) maj.phone = bon;
  }
  if (!u.pays_inscription && u.phone) {
    const pays = paysDepuisTelephone(u.phone);
    if (pays) maj.pays_inscription = pays;
  }
  if (!Object.keys(maj).length) continue;
  n += 1;
  console.log(`${u.fullName || d.id} (${u.role}) : ${u.phone} → ${maj.phone || '(inchangé)'}  pays ${maj.pays_inscription || u.pays_inscription || '?'}`);
  if (ecrire) await d.ref.update(maj);
}
console.log(`\n${n} compte(s) ${ecrire ? 'corrigé(s)' : 'à corriger (aperçu, ajouter --ecrire)'}`);
process.exit(0);
