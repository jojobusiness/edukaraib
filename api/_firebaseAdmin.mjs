import { initializeApp, getApps, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth as _getAuth } from 'firebase-admin/auth';
import { getFirestore as _getFirestore } from 'firebase-admin/firestore';

// ---- Lecture variables d'environnement (Vercel) ----
const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
// IMPORTANT : transformer les "\n" littéraux en vrais retours à la ligne
const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY || '';
const privateKey = privateKeyRaw.replace(/\\n/g, '\n');

let app;

/** Initialise (ou récupère) l'app Admin en singleton. */
function getAdminApp() {
  if (app) return app;

  if (getApps().length) {
    app = getApps()[0];
    return app;
  }

  // Préfère l'initialisation via compte de service (env Vercel)
  if (projectId && clientEmail && privateKey) {
    app = initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  } else {
    // Fallback (si ADC disponible, ex. local avec gcloud auth application-default login)
    console.warn('[firebase-admin] Missing service account env vars — using applicationDefault() if available.');
    app = initializeApp({
      credential: applicationDefault(),
    });
  }

  return app;
}

// ---- Exports "attendus" par tes routes (nommage explicite) ----
export function getAuthAdmin() {
  return _getAuth(getAdminApp());
}

export function getFirestore() {
  return _getFirestore(getAdminApp());
}

// Confort / rétro-compat : accès direct à Firestore Admin
export const adminDb = _getFirestore(getAdminApp());

/**
 * Vérifie le token Firebase envoyé par le front dans l'en-tête:
 * Authorization: Bearer <idToken>
 * Retourne le token décodé { uid, ... } ou `null` après avoir répondu 401.
 */
export async function verifyAuth(req, res) {
  try {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'NO_TOKEN' });
      return null;
    }
    const idToken = authHeader.split(' ')[1];

    const decoded = await getAuthAdmin().verifyIdToken(idToken);
    return decoded; // { uid, ... }
  } catch (e) {
    console.error('[verifyAuth] error:', e?.message || e);
    res.status(401).json({ error: 'INVALID_TOKEN' });
    return null;
  }
}

/**
 * Lit le corps brut de la requête (utile pour Stripe webhooks).
 * N'oublie pas de désactiver le bodyParser pour cette route si besoin.
 */
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