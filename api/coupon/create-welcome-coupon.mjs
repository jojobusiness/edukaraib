import { adminDb } from '../_firebaseAdmin.mjs';

const APP_BASE_URL = process.env.APP_BASE_URL || 'https://edukaraib.com';

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans I,O,0,1 (confusions)
  let code = 'BIENVENUE-';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function readBody(req) {
  try {
    if (!req.body) return {};
    if (typeof req.body === 'string') return JSON.parse(req.body);
    return req.body;
  } catch { return {}; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const { uid, email, fullName } = readBody(req);

  if (!uid || !email) {
    return res.status(400).json({ ok: false, error: 'MISSING_UID_OR_EMAIL' });
  }

  try {
    // 1) Vérifie qu'un coupon de bienvenue n'existe pas déjà pour cet utilisateur
    const existing = await adminDb
      .collection('coupons')
      .where('user_uid', '==', uid)
      .where('type', '==', 'welcome')
      .limit(1)
      .get();

    if (!existing.empty) {
      return res.json({ ok: true, skipped: 'already_has_welcome_coupon' });
    }

    // Sécurité côté serveur : récupère le rôle depuis Firestore
    const userSnap = await adminDb.collection('users').doc(uid).get();
    const role = userSnap.exists ? userSnap.data()?.role : null;
    if (role === 'teacher') {
      return res.json({ ok: true, skipped: 'teachers_not_eligible' });
    }
    
    // 2) Génère un code unique
    let code = generateCode();
    // Vérifie que le code n'est pas déjà pris (très rare mais sécurisé)
    const codeCheck = await adminDb.collection('coupons').where('code', '==', code).limit(1).get();
    if (!codeCheck.empty) code = generateCode(); // 2e tentative suffit

    // 3) Expire dans 60 jours
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 60);

    // 4) Écrit dans Firestore
    await adminDb.collection('coupons').add({
      code,
      type: 'welcome',
      discount_eur: 5,
      used: false,
      used_at: null,
      user_uid: uid,
      user_email: email,
      created_at: new Date(),
      expires_at: expiresAt,
    });

    // 5) Envoie le mail de bienvenue via /api/notify-email
    const origin =
      req.headers?.origin ||
      `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;

    const firstName = (fullName || '').split(' ')[0] || 'là';

    await fetch(`${origin}/api/notify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: email,
        title: `Bienvenue sur EduKaraib, ${firstName} ! 🎉`,
        message:
          `Merci de nous avoir rejoints !\n\n` +
          `Pour fêter ça, voici ton bon de bienvenue :\n\n` +
          `🎟️ Code : ${code}\n` +
          `💶 Valeur : -5 € sur ton premier cours\n` +
          `📅 Valable 60 jours\n\n` +
          `Saisis ce code au moment du paiement de ton premier cours pour en bénéficier.`,
        ctaText: 'Trouver un professeur',
        ctaUrl: `${APP_BASE_URL}/search`,
      }),
    });

    return res.json({ ok: true, code });
  } catch (e) {
    console.error('[create-welcome-coupon] error:', e?.message || e);
    return res.status(500).json({ ok: false, error: e?.message || 'INTERNAL_ERROR' });
  }
}
