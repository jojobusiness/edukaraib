/* ————————————————————————————————————————————————————————————
   Diagnostic d'ACQUISITION — d'où viennent les inscrits.

     node scripts/diag-acquisition.mjs            → 8 dernières semaines
     node scripts/diag-acquisition.mjs --semaines=4

   Pourquoi (plan docs/plans/PLAN_ATTRIBUTION_20-09-2026.md) : Vercel Analytics
   dit qu'un visiteur vient de Facebook, mais pas QUEL compte. Depuis le 21/09,
   chaque inscription écrit `users/{uid}.acquisition` (source technique : utm,
   fbclid, référent) + `declared` (« Comment avez-vous connu EduKaraib ? »).
   Ce script en fait le relevé du dimanche en 10 secondes.

   Lecture seule, config Firebase publique (les profils `users` sont en lecture
   publique dans firestore.rules — même accès que diag-offre-profs.mjs).
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

const arg = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const SEMAINES = Number(arg.semaines || 8);

const toDate = (v) => (v?.toDate ? v.toDate() : v ? new Date(v) : null);
/** Lundi de la semaine, au format JJ/MM. */
function semaine(d) {
  const l = new Date(d);
  l.setHours(0, 0, 0, 0);
  l.setDate(l.getDate() - ((l.getDay() + 6) % 7));
  return l;
}
const jjmm = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;

const snap = await getDocs(collection(db, 'users'));
const users = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((u) => u.role !== 'admin');

const debut = semaine(new Date(Date.now() - (SEMAINES - 1) * 7 * 24 * 3600 * 1000));
const recents = users
  .map((u) => ({ ...u, cree: toDate(u.createdAt) }))
  .filter((u) => u.cree && u.cree >= debut)
  .sort((a, b) => a.cree - b.cree);

// Source retenue : la réponse déclarée départage quand la technique n'a rien vu
const sourceDe = (u) => {
  const a = u.acquisition;
  if (!a) return 'non mesuré (avant le 21/09)';
  if (a.source && a.source !== 'inconnu' && a.source !== 'direct') return a.source;
  if (a.declared) return `${a.declared} (déclaré)`;
  return a.source || 'inconnu';
};

console.log(`\n📊 ACQUISITION — inscrits depuis le lundi ${jjmm(debut)} (${SEMAINES} semaines) : ${recents.length}\n`);

const compte = (liste, cle) => liste.reduce((m, u) => ((m[cle(u)] = (m[cle(u)] || 0) + 1), m), {});
const afficher = (titre, m) => {
  console.log(titre);
  Object.entries(m).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`   ${String(n).padStart(3)}  ${k}`));
  console.log('');
};

afficher('Par source :', compte(recents, sourceDe));
afficher('Par rôle :', compte(recents, (u) => u.role || '?'));

console.log('Par semaine (lundi) :');
const parSemaine = {};
for (const u of recents) (parSemaine[jjmm(semaine(u.cree))] ||= []).push(u);
for (const [s, liste] of Object.entries(parSemaine)) {
  const sources = Object.entries(compte(liste, sourceDe)).map(([k, n]) => `${k} ×${n}`).join(' · ');
  console.log(`   ${s}  ${String(liste.length).padStart(3)} inscrit(s)  —  ${sources}`);
}

const mesures = recents.filter((u) => u.acquisition);
if (mesures.length) {
  const aveugles = mesures.filter((u) => ['inconnu', 'direct'].includes(u.acquisition.source) && !u.acquisition.declared);
  const pct = Math.round((100 * aveugles.length) / mesures.length);
  console.log(`\n🎯 Inscrits sans source (ni technique ni déclarée) : ${aveugles.length}/${mesures.length} = ${pct} %`
    + (pct < 30 ? '  ✅ attribution fiable (< 30 %)' : '  ⚠️ au-dessus de 30 % : attribution encore floue'));
  const desaccords = mesures.filter((u) => {
    const a = u.acquisition;
    return a.declared && !['inconnu', 'direct'].includes(a.source) && !a.source.startsWith(a.declared);
  });
  if (desaccords.length) {
    console.log(`   ${desaccords.length} inscrit(s) déclarent une autre source que celle mesurée (ex. vu sur TikTok, cliqué sur Google) :`);
    desaccords.forEach((u) => console.log(`     • ${u.fullName || u.id} — mesuré ${u.acquisition.source}, déclaré ${u.acquisition.declared}`));
  }
} else {
  console.log('\nℹ️  Aucun inscrit mesuré pour l\'instant : le suivi a démarré le 21/09/2026.');
}

console.log('\nDétail des 10 derniers :');
recents.slice(-10).forEach((u) => {
  const a = u.acquisition || {};
  const bits = [a.medium, a.campaign, a.landing && `page ${a.landing}`, a.code && `code ${a.code}`].filter(Boolean).join(' · ');
  console.log(`   ${jjmm(u.cree)}  ${(u.role || '?').padEnd(10)} ${(u.fullName || u.id).slice(0, 28).padEnd(28)} ${sourceDe(u)}${bits ? `  (${bits})` : ''}`);
});
console.log('');
process.exit(0);
