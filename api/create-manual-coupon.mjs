import { adminDb } from './_firebaseAdmin.mjs';
import { Resend } from 'resend';

const APP_BASE_URL = process.env.APP_BASE_URL || 'https://edukaraib.com';
const ADMIN_SECRET  = process.env.ADMIN_COUPON_SECRET ;

function readBody(req) {
  try {
    if (!req.body) return {};
    if (typeof req.body === 'string') return JSON.parse(req.body);
    return req.body;
  } catch { return {}; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });

  const { adminSecret, userEmail } = readBody(req);

  // ✅ Si la variable d'env n'est pas configurée, on bloque tout
  // (évite le cas où undefined !== undefined = false → accès ouvert)
  if (!ADMIN_SECRET) {
    console.error('[create-manual-coupon] ADMIN_COUPON_SECRET env var not set');
    return res.status(500).json({ ok: false, error: 'SERVER_MISCONFIGURED' });
  }

  if (!adminSecret || adminSecret !== ADMIN_SECRET) {
    return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
  }
  if (!userEmail) return res.status(400).json({ ok: false, error: 'MISSING_EMAIL' });

  try {
    // 1) Trouve l'utilisateur dans Firestore
    const userSnap = await adminDb
      .collection('users')
      .where('email', '==', userEmail.trim().toLowerCase())
      .limit(1)
      .get();

    if (userSnap.empty) {
      return res.status(404).json({ ok: false, error: 'USER_NOT_FOUND' });
    }

    const userDoc = userSnap.docs[0];
    const uid  = userDoc.id;
    const user = userDoc.data();

    // 2) Vérifie qu'il n'a pas déjà un coupon de bienvenue
    const existing = await adminDb
      .collection('coupons')
      .where('user_uid', '==', uid)
      .where('type', '==', 'welcome')
      .limit(1)
      .get();

    if (!existing.empty) {
      const code = existing.docs[0].data().code;
      return res.json({ ok: true, skipped: 'already_exists', code });
    }

    // 3) Génère le code
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let suffix = '';
    for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
    const code = `BIENVENUE-${suffix}`;

    // 4) Expire dans 60 jours
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 60);

    // 5) Écrit dans Firestore
    await adminDb.collection('coupons').add({
      code,
      type: 'welcome',
      discount_eur: 5,
      used: false,
      used_at: null,
      user_uid: uid,
      user_email: userEmail.trim().toLowerCase(),
      created_at: new Date(),
      expires_at: expiresAt,
      created_manually: true,
    });

    // 6) Envoie le mail
    const firstName = (user.firstName || user.fullName || '').split(' ')[0] || 'là';
    const resendClient = new Resend(process.env.RESEND_API_KEY);
    const mailResult = await resendClient.emails.send({
      from: 'EduKaraib <notifications@edukaraib.com>',
      to: [userEmail.trim()],
      subject: `Bienvenue sur EduKaraib, ${firstName} ! 🎉 Voici ton code -5€`,
      html: `
        <div style="font-family:Inter,system-ui,sans-serif;background:#f5f7fb;padding:24px;">
          <table width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;margin:auto;background:#fff;border-radius:18px;overflow:hidden;border:1px solid #eef0f4;">
            <tr><td style="background:#0ea5e9;padding:18px 20px;">
              <span style="color:#fff;font-weight:700;font-size:16px;">EduKaraib</span>
            </td></tr>
            <tr><td style="padding:26px;">
              <h1 style="margin:0 0 10px;font-size:20px;color:#0f172a;">Bienvenue sur EduKaraib, ${firstName} ! 🎉</h1>
              <p style="color:#334155;font-size:15px;line-height:1.65;">
                Merci de nous avoir rejoints !<br><br>
                Pour fêter ça, voici ton bon de bienvenue :
              </p>
              <div style="background:#f0fdf4;border:2px dashed #22c55e;border-radius:12px;padding:16px;margin:16px 0;text-align:center;">
                <div style="font-size:24px;font-weight:800;letter-spacing:3px;color:#15803d;">${code}</div>
                <div style="color:#166534;font-size:14px;margin-top:6px;">💶 -5 € sur ton premier cours · 📅 Valable 60 jours</div>
              </div>
              <p style="color:#334155;font-size:14px;">Saisis ce code au moment du paiement de ton premier cours pour en bénéficier.</p>
              <div style="margin-top:18px;">
                <a href="${APP_BASE_URL}/search" style="background:#facc15;color:#111827;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:12px;display:inline-block;">Trouver un professeur</a>
              </div>
            </td></tr>
            <tr><td style="padding:12px 26px 24px;color:#64748b;font-size:12px;">
              L'équipe EduKaraib · <a href="mailto:contact@edukaraib.com" style="color:#0ea5e9;">contact@edukaraib.com</a>
            </td></tr>
          </table>
        </div>
      `,
    });

    return res.json({
      ok: true,
      code,
      mailSent: !!mailResult?.id,
      uid,
    });

  } catch (e) {
    console.error('[create-manual-coupon] error:', e?.message || e);
    return res.status(500).json({ ok: false, error: e?.message || 'INTERNAL_ERROR' });
  }
}
