/* ————————————————————————————————————————————————————————————
   Les données personnelles sont-elles vraiment fermées ? (23/10/2026)

     node --env-file=.env.local scripts/diag-regles-donnees.mjs

   Le 23/10, un visiteur SANS COMPTE listait les 36 comptes (e-mails,
   téléphones, dates de naissance) et tout compte connecté lisait, modifiait
   ou supprimait les fiches d'enfants et les documents de cours.
   Ce script interroge la PRODUCTION comme un navigateur :
   1. sans compte, puis avec un compte jetable : tout doit être refusé ;
   2. les vrais écrans (recherche, parent, élève, prof, admin) doivent passer.
   Lecture seule. Le compte jetable est supprimé à la fin.
   Complète frontend/test-regles/ (émulateur) et diag-regles-paiements.mjs.
   ———————————————————————————————————————————————————————————— */
import admin from 'firebase-admin';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, collection, getDocs, query, where, limit, doc, getDoc, updateDoc } from 'firebase/firestore';
import { getStorage, ref, listAll, getBytes } from 'firebase/storage';
import { addDoc, setDoc } from 'firebase/firestore';
import { adminDb, bucket } from '../api/_firebaseAdmin.mjs';

const CONFIG = {
  apiKey: 'AIzaSyDoPTDEtgcROB-PkLehddqr3Lpy_nM5P4A',
  authDomain: 'edukaraib.firebaseapp.com',
  projectId: 'edukaraib',
  storageBucket: 'edukaraib.firebasestorage.app',
};
const UID_INTRUS = 'test-regles-intrus-donnees';

let problemes = 0;
let n = 0;
async function session(uid) {
  n += 1;
  const app = initializeApp(CONFIG, `essai-${n}`);
  if (uid) await signInWithCustomToken(getAuth(app), await admin.auth().createCustomToken(uid));
  return { app, db: getFirestore(app) };
}
const essai = async (libelle, fn, attendu) => {
  try {
    const nb = await fn();
    if (attendu === 'refus') { problemes += 1; console.log(`❌ FAILLE  ${libelle} → AUTORISÉ (${nb})`); }
    else console.log(`✅         ${libelle} → autorisé (${nb})`);
  } catch (e) {
    // Firestore : permission-denied ; Storage : storage/unauthorized
    const code = String(e?.code || '');
    const refus = code.includes('permission-denied') || code.includes('storage/unauthorized');
    if (attendu === 'refus' && refus) console.log(`✅         ${libelle} → refusé`);
    else { problemes += 1; console.log(`❌ CASSÉ   ${libelle} → ${e?.code || e?.message}`); }
  }
};
const nb = async (q) => (await getDocs(q)).size;
const existe = async (r) => ((await getDoc(r)).exists() ? 1 : 0);

const prof = (await adminDb.collection('users').where('role', '==', 'teacher').limit(1).get()).docs[0];
const enfant = (await adminDb.collection('students').limit(1).get()).docs[0];
const document = (await adminDb.collection('documents').limit(1).get()).docs[0];
const unAdmin = (await adminDb.collection('users').where('role', '==', 'admin').limit(1).get()).docs[0];
const unCours = (await adminDb.collection('lessons').limit(1).get()).docs[0];
const [fichiersChat] = await bucket.getFiles({ prefix: 'chat/', maxResults: 1 });
const unFichierChat = fichiersChat[0]?.name || null;

for (const [qui, uid] of [['SANS COMPTE', null], [`INTRUS « ${UID_INTRUS} »`, UID_INTRUS]]) {
  console.log(`\n=== ${qui} — ne doit rien voir ===`);
  const { app, db } = await session(uid);
  await essai('lister tous les comptes', () => nb(collection(db, 'users')), 'refus');
  await essai('lister les comptes des profs', () => nb(query(collection(db, 'users'), where('role', '==', 'teacher'))), 'refus');
  await essai("ouvrir le compte d'un prof (e-mail, téléphone)", () => existe(doc(db, 'users', prof.id)), 'refus');
  await essai('lister les profils de tous les élèves', () => nb(query(collection(db, 'profils'), where('role', '==', 'student'))), 'refus');
  await essai('lister les fiches enfants', () => nb(collection(db, 'students')), 'refus');
  if (enfant) await essai("ouvrir la fiche d'un enfant", () => existe(doc(db, 'students', enfant.id)), 'refus');
  if (enfant && uid) await essai("modifier la fiche d'un enfant", () => updateDoc(doc(db, 'students', enfant.id), { full_name: 'x' }).then(() => 1), 'refus');
  if (document) await essai("ouvrir un document de cours d'autrui", () => existe(doc(db, 'documents', document.id)), 'refus');
  await essai('lister les favoris', () => nb(collection(db, 'favorites')), 'refus');
  // Cours (verrou du 23/10/2026, PLAN_VERROU_COURS)
  await essai('lister tous les cours', () => nb(collection(db, 'lessons')), 'refus');
  await essai("lister les cours d'un prof", () => nb(query(collection(db, 'lessons'), where('teacher_id', '==', prof.id))), 'refus');
  if (unCours) await essai("ouvrir un cours d'autrui", () => existe(doc(db, 'lessons', unCours.id)), 'refus');
  if (unCours && uid) await essai("modifier un cours d'autrui", () => updateDoc(doc(db, 'lessons', unCours.id), { status: unCours.data().status ?? null }).then(() => 1), 'refus');
  await essai('page prof : créneaux publics (creneaux)', () => nb(query(collection(db, 'creneaux'), where('teacher_id', '==', prof.id))), 'autorisé');
  // Storage, avis, notifications, codes promo (phase 5, 23/10/2026)
  const st = getStorage(app);
  await essai('Storage : lister les justificatifs de remboursement', async () => (await listAll(ref(st, 'refund-proofs'))).items.length, 'refus');
  await essai('Storage : lister les pièces jointes du chat', async () => (await listAll(ref(st, 'chat'))).prefixes.length, 'refus');
  if (unFichierChat) await essai("Storage : lire une pièce jointe d'une conversation d'autrui", async () => (await getBytes(ref(st, unFichierChat))).byteLength, 'refus');
  await essai('Storage : lister les documents de cours', async () => (await listAll(ref(st, 'lessons'))).prefixes.length, 'refus');
  await essai('lister les codes promo', () => nb(collection(db, 'promo_codes')), 'refus');
  if (uid) {
    await essai('poster un faux avis sur un prof', () => setDoc(doc(db, 'reviews', `faux_${uid}`), { lesson_id: 'x', teacher_id: prof.id, rating: 1, left_by_parent_id: uid }).then(() => 1), 'refus');
    await essai('notification piège envoyée par e-mail', () => addDoc(collection(db, 'notifications'), { user_id: prof.id, type: 'securite', title: 'Votre compte', message: 'https://pirate.example' }).then(() => 1), 'refus');
  }
  // Ce qui doit rester public : la vitrine des profs
  await essai('recherche : la liste des profs (profils)', () => nb(query(collection(db, 'profils'), where('role', '==', 'teacher'))), 'autorisé');
  await essai("page d'un prof (profils)", () => existe(doc(db, 'profils', prof.id)), 'autorisé');
  await deleteApp(app);
}

// La vitrine publique ne contient aucun champ privé
{
  const { app, db } = await session(null);
  const profs = await getDocs(query(collection(db, 'profils'), where('role', '==', 'teacher')));
  const fuites = profs.docs.filter((d) => ['email', 'phone', 'birth', 'stripeAccountId'].some((k) => k in d.data()));
  if (fuites.length) { problemes += 1; console.log(`❌ FAILLE  ${fuites.length} profil(s) public(s) avec un champ privé`); }
  else console.log(`✅         ${profs.size} profils publics, aucun e-mail / téléphone / date de naissance / compte Stripe`);
  await deleteApp(app);
}

console.log('\n=== LES VRAIS ÉCRANS — doivent marcher ===');
if (enfant?.data().parent_id) {
  const pid = enfant.data().parent_id;
  const f = await session(pid);
  await essai('Parent · ses enfants (ParentChildren)', () => nb(query(collection(f.db, 'students'), where('parent_id', '==', pid))), 'autorisé');
  await essai('Parent · son compte', () => existe(doc(f.db, 'users', pid)), 'autorisé');
  await essai('Parent · ses documents', () => nb(query(collection(f.db, 'documents'), where('acces', 'array-contains', pid))), 'autorisé');
  await essai('Parent · ses favoris', () => nb(query(collection(f.db, 'favorites'), where('user_id', '==', pid))), 'autorisé');
  await deleteApp(f.app);
}
{
  const p = await session(prof.id);
  await essai('Prof · son compte (Navbar, par requête uid)', () => nb(query(collection(p.db, 'users'), where('uid', '==', prof.id), limit(1))), 'autorisé');
  await essai('Prof · ses documents', () => nb(query(collection(p.db, 'documents'), where('acces', 'array-contains', prof.id))), 'autorisé');
  await essai('Prof · bouton support (admin dans profils)', () => nb(query(collection(p.db, 'profils'), where('role', '==', 'admin'), limit(1))), 'autorisé');
  await deleteApp(p.app);
}
if (unAdmin) {
  const a = await session(unAdmin.id);
  await essai('Admin · onglet Comptes (tous les comptes)', () => nb(collection(a.db, 'users')), 'autorisé');
  await essai('Admin · fiches enfants', () => nb(collection(a.db, 'students')), 'autorisé');
  await deleteApp(a.app);
}

await admin.auth().deleteUser(UID_INTRUS).catch(() => {});
console.log(problemes === 0
  ? '\n✅ Aucune faille et aucun écran cassé.\n'
  : `\n🔴 ${problemes} problème(s) — NE PAS EN RESTER LÀ.\n`);
process.exit(problemes === 0 ? 0 : 1);
