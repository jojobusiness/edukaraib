/* ————————————————————————————————————————————————————————————
   Les règles de la messagerie tiennent-elles vraiment ?

     node --env-file=.env.local scripts/diag-regles-messagerie.mjs

   Le 15/10/2026, `firestore.rules` disait encore
   `match /messages/{id} { allow read, write: if signedIn(); }` :
   N'IMPORTE QUEL compte connecté pouvait lire TOUTES les conversations du
   site. Ce script le vérifie depuis l'extérieur, comme un vrai client.

   Il se connecte avec un compte jetable qui ne participe à AUCUNE
   conversation, tente six accès, et dit lesquels passent. Lecture seule : il
   n'écrit rien, et supprime son compte de test à la fin.

   ⚠️ À relancer après toute modification de firestore.rules touchant
   `messages` ou `conversations`. Un test vert ici vaut mieux qu'une relecture
   des règles : c'est le serveur de Google qui répond, pas une intuition.
   ———————————————————————————————————————————————————————————— */

import admin from 'firebase-admin';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, collection, getDocs, query, where, limit, doc, getDoc } from 'firebase/firestore';
import { adminDb } from '../api/_firebaseAdmin.mjs';

const UID_INTRUS = 'test-regles-intrus';

const app = initializeApp({
  apiKey: 'AIzaSyDoPTDEtgcROB-PkLehddqr3Lpy_nM5P4A',
  authDomain: 'edukaraib.firebaseapp.com',
  projectId: 'edukaraib',
  storageBucket: 'edukaraib.firebasestorage.app',
  messagingSenderId: '827164038836',
  appId: '1:827164038836:web:8f0ce9776e18d1b03da9e1',
});
const db = getFirestore(app);

const token = await admin.auth().createCustomToken(UID_INTRUS);
await signInWithCustomToken(getAuth(app), token);
console.log(`\n=== RÈGLES DE LA MESSAGERIE — connecté en « ${UID_INTRUS} », qui ne participe à rien ===\n`);

const uneConv = (await adminDb.collection('conversations').limit(1).get()).docs[0];
const unMsg = (await adminDb.collection('messages').limit(1).get()).docs[0];

let failles = 0;
const essai = async (libelle, fn, attendu) => {
  try {
    const n = await fn();
    if (attendu === 'refus') { failles += 1; console.log(`❌ FAILLE  ${libelle} → AUTORISÉ (${n} doc)`); }
    else console.log(`✅         ${libelle} → autorisé (${n} doc), c'est voulu`);
  } catch (e) {
    const refus = String(e?.code || '').includes('permission-denied');
    if (attendu === 'refus' && refus) console.log(`✅         ${libelle} → refusé`);
    else { failles += 1; console.log(`❌         ${libelle} → ${e?.code || e?.message}`); }
  }
};

await essai('lire toute la collection messages', async () => (await getDocs(query(collection(db, 'messages'), limit(5)))).size, 'refus');
await essai('lire toutes les conversations', async () => (await getDocs(query(collection(db, 'conversations'), limit(5)))).size, 'refus');
if (uneConv) await essai("ouvrir LA conversation d'autrui par son identifiant", async () => ((await getDoc(doc(db, 'conversations', uneConv.id))).exists() ? 1 : 0), 'refus');
if (unMsg) {
  await essai("ouvrir UN message d'autrui par son identifiant", async () => ((await getDoc(doc(db, 'messages', unMsg.id))).exists() ? 1 : 0), 'refus');
  await essai("lister les messages d'une conversation d'autrui", async () => (await getDocs(query(collection(db, 'messages'), where('conversationId', '==', unMsg.data().conversationId)))).size, 'refus');
}
await essai('lister MES conversations (array-contains)', async () => (await getDocs(query(collection(db, 'conversations'), where('participants', 'array-contains', UID_INTRUS)))).size, 'autorisé');

await admin.auth().deleteUser(UID_INTRUS).catch(() => {});
console.log(failles === 0
  ? '\n✅ Aucune faille : la messagerie n\'est lisible que par ses participants.\n'
  : `\n🔴 ${failles} problème(s) — NE PAS EN RESTER LÀ.\n`);
process.exit(failles === 0 ? 0 : 1);
