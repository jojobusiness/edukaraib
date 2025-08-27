import admin from 'firebase-admin';

let initialized = false;

function ensureInit() {
  if (initialized) return;
  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const rawKey      = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !rawKey) {
    const miss = [
      !projectId && 'FIREBASE_PROJECT_ID',
      !clientEmail && 'FIREBASE_CLIENT_EMAIL',
      !rawKey && 'FIREBASE_PRIVATE_KEY',
    ].filter(Boolean).join(', ');
    throw new Error(`FIREBASE_ADMIN_ENV_MISSING: ${miss}`);
  }

  const privateKey = rawKey.replace(/\\n/g, '\n');

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    });
  }
  initialized = true;
}

export function getFirestore() { ensureInit(); return admin.firestore(); }
export function getAuthAdmin() { ensureInit(); return admin.auth(); }