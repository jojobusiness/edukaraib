// CommonJS
const admin = require('firebase-admin');

let initialized = false;

function ensureInit() {
  if (initialized) return;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKeyRaw) {
    const miss = [
      !projectId && 'FIREBASE_PROJECT_ID',
      !clientEmail && 'FIREBASE_CLIENT_EMAIL',
      !privateKeyRaw && 'FIREBASE_PRIVATE_KEY',
    ].filter(Boolean).join(', ');
    throw new Error(`FIREBASE_ADMIN_ENV_MISSING: ${miss}`);
  }

  const privateKey = privateKeyRaw.replace(/\\n/g, '\n'); // gère le collage Vercel

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    });
  }
  initialized = true;
}

function getFirestore() {
  ensureInit();
  return admin.firestore();
}
function getAuthAdmin() {
  ensureInit();
  return admin.auth();
}

module.exports = { getFirestore, getAuthAdmin };
