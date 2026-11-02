// Ouvre une session cliente au nom de l'admin, pour les scripts de diagnostic
// (02/11/2026). Le verrou du 23/10 a fermé `users` en lecture publique.
// À lancer avec : node --env-file=.env.local scripts/diag-….mjs
import admin from 'firebase-admin';
import { getAuth, signInWithCustomToken } from 'firebase/auth';
import { adminDb } from '../api/_firebaseAdmin.mjs';

export async function connecterAdmin(app) {
  const compte = (await adminDb.collection('users').where('role', '==', 'admin').limit(1).get()).docs[0];
  await signInWithCustomToken(getAuth(app), await admin.auth().createCustomToken(compte.id));
}
