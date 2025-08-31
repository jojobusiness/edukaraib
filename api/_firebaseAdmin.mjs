import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
// ⚠️ très important : remplacer les "\n" par des retours à la ligne
const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

if (!admin.apps.length) {
  if (!projectId || !clientEmail || !privateKey) {
    // On log quand même pour les fonctions Vercel (utile au debug)
    console.warn('[firebase-admin] Missing service account env vars');
  }
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
}

// Firestore (Admin)
export const adminDb = getFirestore();

// Vérifie le token Firebase envoyé par le front (Authorization: Bearer <idToken>)
export async function verifyAuth(req, res) {
  try {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'NO_TOKEN' });
      return null;
    }
    const idToken = authHeader.split(' ')[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    return decoded; // { uid, ... }
  } catch (e) {
    console.error('[verifyAuth] error:', e?.message || e);
    res.status(401).json({ error: 'INVALID_TOKEN' });
    return null;
  }
}

// Lit le corps brut de la requête (utile pour Stripe webhooks)
export function rawBody(req) {
  return new Promise((resolve, reject) => {
    try {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    } catch (e) {
      reject(e);
    }
  });
}