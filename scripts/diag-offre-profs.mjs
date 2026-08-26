/* ————————————————————————————————————————————————————————————
   Diagnostic de l'OFFRE (côté profs) — à relancer avant chaque envoi de trafic.

     node scripts/diag-offre-profs.mjs

   Pourquoi : sur une marketplace, la landing ne peut pas rattraper une étagère
   vide. L'ordre qui marche est profs → landing → trafic. Ce script répond aux
   trois questions qui décident si on peut ouvrir le robinet :

     1. Combien de profs passent le filtre qualité des landings
        (photo OU ≥1 avis) ? En dessous de 3, la section « profs dispo »
        disparaît de /bac et /rentree et il ne reste qu'un mur de prix.
     2. Combien ont réellement coché des créneaux ? C'est ce qui les rend
        réservables — un prof sans créneau est un prof décoratif.
     3. Quels libellés de matières sont réellement saisis ? Les boutons de
        matière des landings doivent correspondre à ce catalogue, sinon ils
        envoient l'utilisateur sur une liste sans rapport.

   Lecture seule, config Firebase publique (les profils sont en lecture publique
   dans firestore.rules — c'est ce que consomme déjà la page /search).
   ———————————————————————————————————————————————————————————— */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where } from 'firebase/firestore';

const app = initializeApp({
  apiKey: 'AIzaSyDoPTDEtgcROB-PkLehddqr3Lpy_nM5P4A',
  authDomain: 'edukaraib.firebaseapp.com',
  projectId: 'edukaraib',
  storageBucket: 'edukaraib.firebasestorage.app',
  messagingSenderId: '827164038836',
  appId: '1:827164038836:web:8f0ce9776e18d1b03da9e1',
});
const db = getFirestore(app);

/** Nombre de créneaux cochés, tous formats d'`availability` confondus.
    Le champ mélange l'ancien et le nouveau format dans la même base. */
function nbCreneaux(availability) {
  if (!availability) return 0;
  if (Array.isArray(availability)) return availability.length;
  if (typeof availability === 'object') {
    return Object.values(availability).reduce(
      (n, v) => n + (Array.isArray(v) ? v.length : (v ? 1 : 0)),
      0,
    );
  }
  return 0;
}

const snap = await getDocs(query(collection(db, 'users'), where('role', '==', 'teacher')));
const profs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

// Notes : mêmes chunks de 10 que les landings (limite du `in` Firestore).
const stats = {};
const ids = profs.map((t) => t.id).filter(Boolean);
for (let i = 0; i < ids.length; i += 10) {
  const chunk = ids.slice(i, i + 10);
  try {
    const rs = await getDocs(query(collection(db, 'reviews'), where('teacher_id', 'in', chunk)));
    rs.docs.forEach((d) => {
      const r = d.data();
      const note = Number(r.rating || 0);
      if (!r.teacher_id || note <= 0) return;
      stats[r.teacher_id] = stats[r.teacher_id] || { somme: 0, n: 0 };
      stats[r.teacher_id].somme += note;
      stats[r.teacher_id].n += 1;
    });
  } catch (e) {
    console.warn('lecture des avis impossible pour un lot :', e.message);
  }
}

const matieres = {};
let passentFiltre = 0;
let avecCreneaux = 0;
let reservables = 0;

console.log(`\n=== OFFRE PROFS — ${new Date().toLocaleDateString('fr-FR')} — ${profs.length} inscrits ===\n`);

for (const t of profs) {
  const s = stats[t.id];
  const nbAvis = s ? s.n : Number(t.reviewsCount ?? 0);
  const moyenne = s ? s.somme / s.n : Number(t.avgRating ?? 0);
  const photo = !!t.avatarUrl;
  const visible = t.offer_enabled !== false && (photo || nbAvis >= 1);
  const creneaux = nbCreneaux(t.availability);

  if (visible) passentFiltre += 1;
  if (creneaux > 0) avecCreneaux += 1;
  if (visible && creneaux > 0) reservables += 1;

  const subs = Array.isArray(t.subjects)
    ? t.subjects
    : [t.subjects || t.subject || t.matiere].filter(Boolean);
  subs.forEach((m) => { if (m) matieres[m] = (matieres[m] || 0) + 1; });

  console.log(
    `${visible ? '✅' : '❌'} ${(t.fullName || '(sans nom)').padEnd(28)}`
    + ` | photo:${photo ? 'oui' : 'NON'}`
    + ` | avis:${nbAvis}${moyenne ? ` (${moyenne.toFixed(1)})` : ''}`
    + ` | créneaux:${creneaux}`
    + ` | ${t.city || t.location || '?'}`
    + ` | ${subs.join(', ') || '(aucune matière)'}`,
  );
}

console.log(`\n--- Passent le filtre qualité (photo OU ≥1 avis) : ${passentFiltre}/${profs.length}`
  + `  ${passentFiltre >= 3 ? '→ section « profs dispo » AFFICHÉE' : '→ ⚠️ SECTION MASQUÉE sur /bac et /rentree'}`);
console.log(`--- Ont au moins un créneau coché               : ${avecCreneaux}/${profs.length}`);
console.log(`--- RÉELLEMENT RÉSERVABLES (filtre + créneaux)  : ${reservables}`
  + `  ${reservables >= 8 ? '' : '→ ⚠️ relancer les profs AVANT de payer du trafic'}`);

console.log('\n=== MATIÈRES DÉCLARÉES (libellés exacts saisis par les profs) ===\n');
Object.entries(matieres)
  .sort((a, b) => b[1] - a[1])
  .forEach(([m, n]) => console.log(`  ${n}× "${m}"`));

/* ——— Garde-fou : chaque bouton de matière mène-t-il à un prof RÉSERVABLE ? ———
   C'est le contrôle qui manquait. Le 26/08, deux boutons de `/rentree`
   affichaient des profs que personne ne pouvait réserver : « Informatique »
   (un prof, aucun créneau) et « Économie-Droit » (idem). Vu de la page, rien ne
   le signalait. Ici, c'est mesuré et affiché. */
const { BAC_CAMPAIGN, RENTREE_CAMPAIGN } = await import('../frontend/config/campaigns.js');
const { subjectMatches } = await import('../frontend/lib/subjectMatch.js');

const texteMatieres = (t) => {
  const s = Array.isArray(t.subjects) ? t.subjects : [t.subjects || t.subject || t.matiere || ''];
  return s.join(' ');
};

let orphelines = 0;
for (const campagne of [RENTREE_CAMPAIGN, BAC_CAMPAIGN]) {
  console.log(`\n=== BOUTONS DE MATIÈRE — campagne « ${campagne.id} » ===`);
  console.log('    Affichés = passent le filtre qualité · Réservables = + au moins un créneau\n');
  for (const matiere of campagne.subjects) {
    const correspond = profs.filter((t) => subjectMatches(matiere, texteMatieres(t)));
    const s = (t) => stats[t.id];
    const affiches = correspond.filter((t) => {
      const nb = s(t) ? s(t).n : Number(t.reviewsCount ?? 0);
      return t.offer_enabled !== false && (!!t.avatarUrl || nb >= 1);
    });
    const reservables = affiches.filter((t) => nbCreneaux(t.availability) > 0);
    const alerte = reservables.length === 0 ? '  🔴 ORPHELIN — à retirer de campaigns.js' : '';
    if (reservables.length === 0) orphelines += 1;
    console.log(
      `  ${matiere.padEnd(18)} affichés:${String(affiches.length).padStart(2)}`
      + `  réservables:${String(reservables.length).padStart(2)}`
      + `  ${reservables.map((t) => (t.fullName || '?').split(' ')[0]).join(', ')}${alerte}`,
    );
  }
}

console.log(
  orphelines === 0
    ? '\n✅ Aucun bouton de matière orphelin.'
    : `\n🔴 ${orphelines} bouton(s) orphelin(s) : le parent clique et ne peut rien réserver.`,
);

process.exit(0);
