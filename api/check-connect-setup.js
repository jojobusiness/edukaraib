const { getFirestore } = require('./_firebaseAdmin');

module.exports = async (req, res) => {
  try {
    const env = {
      STRIPE_SECRET_KEY: !!process.env.STRIPE_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET: !!process.env.STRIPE_WEBHOOK_SECRET,
      APP_BASE_URL: !!process.env.APP_BASE_URL,
      FIREBASE_PROJECT_ID: !!process.env.FIREBASE_PROJECT_ID,
      FIREBASE_CLIENT_EMAIL: !!process.env.FIREBASE_CLIENT_EMAIL,
      FIREBASE_PRIVATE_KEY: !!process.env.FIREBASE_PRIVATE_KEY,
    };

    // Si une ENV Firebase manque, retour clair sans tenter l'init
    if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
      return res.status(500).json({
        ok: false,
        error: 'FIREBASE_ADMIN_ENV_MISSING',
        details: env,
      });
    }

    // Teste l'init et l’accès Firestore
    const firestore = getFirestore();
    await firestore.listCollections();

    const stripeKey = process.env.STRIPE_SECRET_KEY || '';
    const stripeKeyOk = /^sk_(test|live)_/.test(stripeKey);

    return res.status(200).json({ ok: true, env, stripeKeyOk });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message,
    });
  }
};