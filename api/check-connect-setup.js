const { firestore } = require('./_firebaseAdmin'); // force l'init Firebase Admin
const { stripe } = require('./_stripe');

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

    // Test Firebase Admin (throws si mauvaise clé)
    await firestore.listCollections();

    // Test "look" de la clé Stripe (ne l'envoie pas)
    const stripeKey = process.env.STRIPE_SECRET_KEY || '';
    const stripeKeyOk = /^sk_(test|live)_/.test(stripeKey);

    return res.status(200).json({ ok: true, env, stripeKeyOk });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message,
      hint:
        e.message.includes('private key') || e.message.includes('credential')
          ? 'Vérifie FIREBASE_PRIVATE_KEY/FIREBASE_CLIENT_EMAIL/FIREBASE_PROJECT_ID'
          : undefined,
      stack: (e.stack || '').split('\n').slice(0, 3),
    });
  }
};