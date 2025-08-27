import { getFirestore } from './_firebaseAdmin.mjs';

export default async function handler(req, res) {
  try {
    const env = {
      STRIPE_SECRET_KEY: !!process.env.STRIPE_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET: !!process.env.STRIPE_WEBHOOK_SECRET,
      APP_BASE_URL: !!process.env.APP_BASE_URL,
      FIREBASE_PROJECT_ID: !!process.env.FIREBASE_PROJECT_ID,
      FIREBASE_CLIENT_EMAIL: !!process.env.FIREBASE_CLIENT_EMAIL,
      FIREBASE_PRIVATE_KEY: !!process.env.FIREBASE_PRIVATE_KEY,
    };

    if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
      return res.status(500).json({ ok: false, error: 'FIREBASE_ADMIN_ENV_MISSING', env });
    }

    const db = getFirestore();
    await db.listCollections(); // test d’accès

    const stripeKeyOk = /^sk_(test|live)_/.test(process.env.STRIPE_SECRET_KEY || '');
    return res.status(200).json({ ok: true, env, stripeKeyOk });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}