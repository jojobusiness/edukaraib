/* ————————————————————————————————————————————————————————————
   Les règles des paiements tiennent-elles vraiment ?

     node --env-file=.env.local scripts/diag-regles-paiements.mjs

   Jusqu'au 19/10/2026, `firestore.rules` disait
   `match /payments/{id} { allow read: if signedIn(); }` : N'IMPORTE QUEL
   compte connecté pouvait lire TOUS les paiements du site — montants, qui a
   payé quel prof, pour quel enfant. Même chose pour `subscriptions`.

   Ce script vérifie depuis l'extérieur, comme un vrai navigateur :
   1. un compte jetable qui n'a rien payé est REFUSÉ partout ;
   2. les vrais écrans marchent encore — la famille, le prof et l'élève d'un
      paiement existant relancent EXACTEMENT les requêtes de leurs pages.
   C'est le serveur de Google qui répond, pas une relecture des règles.
   Lecture seule. Le compte jetable est supprimé à la fin.

   ⚠️ À relancer après toute modification de firestore.rules touchant
   `payments`, `subscriptions` ou `payouts`.
   ———————————————————————————————————————————————————————————— */

import admin from 'firebase-admin';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithCustomToken } from 'firebase/auth';
import {
  getFirestore, collection, getDocs, query, where, limit, orderBy, doc, getDoc,
} from 'firebase/firestore';
import { adminDb } from '../api/_firebaseAdmin.mjs';

const CONFIG = {
  apiKey: 'AIzaSyDoPTDEtgcROB-PkLehddqr3Lpy_nM5P4A',
  authDomain: 'edukaraib.firebaseapp.com',
  projectId: 'edukaraib',
  storageBucket: 'edukaraib.firebasestorage.app',
  messagingSenderId: '827164038836',
  appId: '1:827164038836:web:8f0ce9776e18d1b03da9e1',
};
const UID_INTRUS = 'test-regles-intrus-paiements';

let failles = 0;
let n = 0;
/** Ouvre une session cliente au nom de `uid` (jeton personnalisé, lecture seule). */
async function sessionDe(uid) {
  n += 1;
  const app = initializeApp(CONFIG, `essai-${n}`);
  await signInWithCustomToken(getAuth(app), await admin.auth().createCustomToken(uid));
  return { app, db: getFirestore(app) };
}
const essai = async (libelle, fn, attendu) => {
  try {
    const nb = await fn();
    if (attendu === 'refus') { failles += 1; console.log(`❌ FAILLE  ${libelle} → AUTORISÉ (${nb} doc)`); }
    else console.log(`✅         ${libelle} → autorisé (${nb} doc)`);
  } catch (e) {
    const refus = String(e?.code || '').includes('permission-denied');
    if (attendu === 'refus' && refus) console.log(`✅         ${libelle} → refusé`);
    else { failles += 1; console.log(`❌ CASSÉ   ${libelle} → ${e?.code || e?.message}`); }
  }
};

// Un paiement réel complet, pour rejouer les écrans de ses trois concernés.
const tous = (await adminDb.collection('payments').get()).docs;
const ref = tous.find((d) => {
  const p = d.data();
  return p.payer_uid && p.teacher_uid && p.for_student && p.lesson_id && ['held', 'released'].includes(p.status);
}) || tous.find((d) => d.data().payer_uid && d.data().teacher_uid);
const unAbonnement = (await adminDb.collection('subscriptions').limit(1).get()).docs[0];
console.log(`\n${tous.length} paiement(s) en base. Paiement de référence : ${ref ? ref.id : 'aucun'}\n`);

// ── 1. L'intrus : connecté, mais concerné par rien
console.log(`=== INTRUS « ${UID_INTRUS} » — ne doit rien voir ===`);
{
  const { app, db } = await sessionDe(UID_INTRUS);
  await essai('lister tous les paiements', async () => (await getDocs(query(collection(db, 'payments'), limit(5)))).size, 'refus');
  await essai('lister tous les abonnements', async () => (await getDocs(query(collection(db, 'subscriptions'), limit(5)))).size, 'refus');
  await essai('lister la collection payouts', async () => (await getDocs(query(collection(db, 'payouts'), limit(5)))).size, 'refus');
  if (ref) {
    const p = ref.data();
    await essai("ouvrir LE paiement d'autrui par son identifiant (page facture)", async () => ((await getDoc(doc(db, 'payments', ref.id))).exists() ? 1 : 0), 'refus');
    await essai("lister les paiements d'un prof qui n'est pas moi", async () => (await getDocs(query(collection(db, 'payments'), where('teacher_uid', '==', p.teacher_uid)))).size, 'refus');
    await essai("lister les paiements d'une famille qui n'est pas moi", async () => (await getDocs(query(collection(db, 'payments'), where('payer_uid', '==', p.payer_uid)))).size, 'refus');
  }
  if (unAbonnement) {
    await essai("ouvrir L'abonnement d'autrui", async () => ((await getDoc(doc(db, 'subscriptions', unAbonnement.id))).exists() ? 1 : 0), 'refus');
  }
  await essai('lister MES paiements (payer_uid == moi)', async () => (await getDocs(query(collection(db, 'payments'), where('payer_uid', '==', UID_INTRUS)))).size, 'autorisé');
  await essai('lister MES abonnements (payer_uid == moi)', async () => (await getDocs(query(collection(db, 'subscriptions'), where('payer_uid', '==', UID_INTRUS)))).size, 'autorisé');
  await deleteApp(app);
}

// ── 2. Les vrais concernés : leurs écrans doivent marcher comme avant
if (ref) {
  const p = ref.data();
  console.log('\n=== LES CONCERNÉS — leurs écrans doivent marcher ===');

  const famille = await sessionDe(p.payer_uid);
  await essai('Famille · ParentPayments (payer_uid + lesson_id)', async () => (await getDocs(query(collection(famille.db, 'payments'),
    where('payer_uid', '==', p.payer_uid), where('lesson_id', '==', String(p.lesson_id))))).size, 'autorisé');
  await essai('Famille · page facture /facture/:id', async () => ((await getDoc(doc(famille.db, 'payments', ref.id))).exists() ? 1 : 0), 'autorisé');
  await essai('Famille · ParentDashboard abonnements', async () => (await getDocs(query(collection(famille.db, 'subscriptions'), where('payer_uid', '==', p.payer_uid)))).size, 'autorisé');
  await deleteApp(famille.app);

  const prof = await sessionDe(p.teacher_uid);
  await essai('Prof · TeacherEarnings / TeacherDashboard (teacher_uid)', async () => (await getDocs(query(collection(prof.db, 'payments'), where('teacher_uid', '==', p.teacher_uid)))).size, 'autorisé');
  await essai('Prof · page facture /facture/:id', async () => ((await getDoc(doc(prof.db, 'payments', ref.id))).exists() ? 1 : 0), 'autorisé');
  await deleteApp(prof.app);

  if (p.for_student && p.lesson_id) {
    const eleve = await sessionDe(String(p.for_student));
    await essai('Élève · StudentPayments (for_student + lesson_id + status + tri)', async () => (await getDocs(query(collection(eleve.db, 'payments'),
      where('lesson_id', '==', String(p.lesson_id)), where('for_student', '==', String(p.for_student)),
      where('status', 'in', ['held', 'released']), orderBy('created_at', 'desc'), limit(1)))).size, 'autorisé');
    await essai('Élève · StudentDashboard abonnements', async () => (await getDocs(query(collection(eleve.db, 'subscriptions'), where('student_id', '==', String(p.for_student))))).size, 'autorisé');
    await deleteApp(eleve.app);
  }
} else {
  console.log('\n⚠️ Aucun paiement complet en base : les écrans des concernés ne sont pas rejoués.');
}

// ── 3. L'admin : l'onglet « Paiements & Revenus » lit tout
const unAdmin = (await adminDb.collection('users').where('role', '==', 'admin').limit(1).get()).docs[0];
if (unAdmin) {
  console.log('\n=== ADMIN — doit tout voir ===');
  const a = await sessionDe(unAdmin.id);
  await essai('Admin · onglet Paiements (tous, triés par date)', async () => (await getDocs(query(collection(a.db, 'payments'), orderBy('created_at', 'desc'), limit(500)))).size, 'autorisé');
  await essai('Admin · tous les abonnements', async () => (await getDocs(query(collection(a.db, 'subscriptions'), limit(50)))).size, 'autorisé');
  await deleteApp(a.app);
}

await admin.auth().deleteUser(UID_INTRUS).catch(() => {});
console.log(failles === 0
  ? '\n✅ Aucune faille et aucun écran cassé : les paiements ne sont lisibles que par les personnes concernées.\n'
  : `\n🔴 ${failles} problème(s) — NE PAS EN RESTER LÀ.\n`);
process.exit(failles === 0 ? 0 : 1);
