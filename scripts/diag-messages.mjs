/* ————————————————————————————————————————————————————————————
   Les demandes de mise en relation : qui a demandé quel prof, qui a répondu.

     node --env-file=.env.local scripts/diag-messages.mjs
     node --env-file=.env.local scripts/diag-messages.mjs --jours=90

   (les identifiants Admin viennent de `npx vercel env pull .env.local`)

   ⚖️ 15/10/2026 — ce relevé ne lit PLUS la collection `messages`. Compter les
   messages d'une conversation est une statistique SUR la correspondance :
   interdit sans consentement exprès annuel (CPCE art. L32-3 IV), impossible à
   recueillir proprement auprès d'un mineur de moins de 15 ans. On suit
   l'événement « demande de mise en relation », jamais l'échange.

   Même calcul que l'onglet « 🔥 Leads » de l'admin : frontend/lib/statsMessages.js.
   ———————————————————————————————————————————————————————————— */

import { adminDb } from '../api/_firebaseAdmin.mjs';
import { statsDemandes, dureeLisible, COLLECTION_DEMANDES } from '../frontend/lib/statsMessages.js';

const arg = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const JOURS = Number(arg.jours || 30);

const jjmm = (d) => (d
  ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`
  : '—');

const [demandesSnap, usersSnap, lessonsSnap] = await Promise.all([
  adminDb.collection(COLLECTION_DEMANDES).get(),
  adminDb.collection('users').get(),
  adminDb.collection('lessons').get(),
]);

const { lignes, totaux, parProf } = statsDemandes({
  demandes: demandesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  users: usersSnap.docs.map((d) => ({ uid: d.id, ...d.data() })),
  lessons: lessonsSnap.docs.map((d) => d.data()),
  jours: JOURS,
});

console.log(`\n=== DEMANDES DE MISE EN RELATION — ${JOURS} derniers jours — ${lignes.length} ===`);
console.log('(aucun contenu de message : secret des correspondances)\n');
console.log('date      élève / parent             professeur                 1re réponse        statut        source');
for (const l of lignes) {
  const reponse = l.delai === null ? `attend ${dureeLisible(l.attendDepuis)}` : dureeLisible(l.delai);
  console.log(
    `${jjmm(l.creee).padEnd(9)} ${l.eleve.slice(0, 25).padEnd(26)} ${l.prof.slice(0, 25).padEnd(26)} `
    + `${reponse.padEnd(18)} ${l.statut.padEnd(13)} ${l.source}`,
  );
}

console.log(`\n--- Demandes                  : ${totaux.demandes}`);
console.log(`--- Répondues par le prof     : ${totaux.repondues}${totaux.tauxReponse === null ? '' : ` (${totaux.tauxReponse} %)`}`);
console.log(`--- Sans réponse              : ${totaux.sansReponse}`);
console.log(`--- Délai médian de réponse   : ${dureeLisible(totaux.delaiMedian)}`);
console.log(`--- Ont donné une réservation : ${totaux.reservees}${totaux.tauxReservation === null ? '' : ` (${totaux.tauxReservation} %)`}`);

if (parProf.length) {
  console.log('\n--- Par professeur (qui mettre en avant, et qui relancer)');
  parProf.forEach((p) => {
    console.log(`    ${p.prof.slice(0, 28).padEnd(29)} ${p.recues} demande(s) · ${p.repondues} répondue(s)`
      + (p.repondues ? ` · médiane ${dureeLisible(p.delaiMedian)}` : ' · jamais répondu'));
  });
}
console.log('');
process.exit(0);
