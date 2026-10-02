/* ————————————————————————————————————————————————————————————
   Qui revient sur le site — et qui ne revient jamais.

     node scripts/diag-retours.mjs
     node scripts/diag-retours.mjs --role=teacher

   Pourquoi (plan docs/plans/PLAN_SAVOIR_QUI_REVIENT_02-10-2026.md) : le bandeau
   d'état prof n'a rien changé en 7 jours, et on ne pouvait pas dire s'il était
   vu et inopérant, ou jamais vu. Deux corrections opposées. `users.lastSeenAt`
   est écrit au plus une fois par jour depuis le 02/10/2026.

   ⚠️ UNE DATE ABSENTE NE VEUT PAS DIRE « JAMAIS VENU ».
   Le champ n'existe pas sur les comptes créés avant le 02/10/2026 : il
   n'apparaîtra qu'à leur PROCHAINE visite. Avant une à deux semaines, ce relevé
   ne prouve rien. Lire « pas revenu depuis la mise en service », rien de plus.

   Lecture seule, config Firebase publique (`users` est en lecture publique dans
   firestore.rules, comme pour diag-offre-profs.mjs).
   ———————————————————————————————————————————————————————————— */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

const app = initializeApp({
  apiKey: 'AIzaSyDoPTDEtgcROB-PkLehddqr3Lpy_nM5P4A',
  authDomain: 'edukaraib.firebaseapp.com',
  projectId: 'edukaraib',
  storageBucket: 'edukaraib.firebasestorage.app',
  messagingSenderId: '827164038836',
  appId: '1:827164038836:web:8f0ce9776e18d1b03da9e1',
});
const db = getFirestore(app);

const MISE_EN_SERVICE = '02/10/2026';
const arg = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));

const toDate = (v) => (v?.toDate ? v.toDate() : v ? new Date(v) : null);
// Année comprise : sans elle, un compte de 2025 se lit comme un inscrit du jour
const jjmm = (d) => (d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}` : '—');
const jours = (d) => (d ? Math.floor((Date.now() - d.getTime()) / 86400000) : null);

const snap = await getDocs(collection(db, 'users'));
let gens = snap.docs
  .map((d) => ({ id: d.id, ...d.data() }))
  .filter((u) => u.role !== 'admin')
  .map((u) => ({ ...u, cree: toDate(u.createdAt), vu: toDate(u.lastSeenAt) }));
if (arg.role) gens = gens.filter((u) => u.role === arg.role);
gens.sort((a, b) => (b.vu?.getTime() || 0) - (a.vu?.getTime() || 0));

const aujourdhui = new Date();
console.log(`\n=== QUI REVIENT — ${jjmm(aujourdhui)} — ${gens.length} compte(s) ===`);
console.log(`⚠️  Suivi démarré le ${MISE_EN_SERVICE} : une date absente = pas revenu DEPUIS cette date,`);
console.log('    pas « jamais venu ». Avant deux semaines, ce relevé ne tranche rien.\n');

console.log('rôle        nom                            inscrit    dern. venue   depuis');
for (const u of gens) {
  const d = jours(u.vu);
  console.log(
    `${(u.role || '?').padEnd(11)} ${(u.fullName || u.id).slice(0, 29).padEnd(30)} ${jjmm(u.cree).padEnd(10)} `
    + `${jjmm(u.vu).padEnd(13)} ${d === null ? '—' : `${d} j`}`,
  );
}

const jamais = gens.filter((u) => !u.vu);
const recents = gens.filter((u) => jours(u.vu) !== null && jours(u.vu) <= 7);
console.log(`\n--- Pas revenus depuis le ${MISE_EN_SERVICE} : ${jamais.length}/${gens.length}`);
console.log(`--- Revenus dans les 7 derniers jours   : ${recents.length}/${gens.length}`);
if (recents.length) console.log(`    ${recents.map((u) => u.fullName || u.id).join(' · ')}`);
console.log('');
process.exit(0);
