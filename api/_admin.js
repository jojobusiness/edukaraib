import admin from 'firebase-admin';
import Stripe from 'stripe';

function initAdmin() {
  if (admin.apps.length) return;

  // ✅ Recommandé sur Vercel: service account JSON en variable d'env
  const svc = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (!svc) {
    // fallback: essaie ADC si dispo (rare sur Vercel)
    admin.initializeApp({
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });
    return;
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(svc);
  } catch (e) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON');
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET, // ex: edukaraib.appspot.com
  });
}

initAdmin();

export const db = admin.firestore();
export const authAdmin = admin.auth();
export const bucket = admin.storage().bucket();

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});