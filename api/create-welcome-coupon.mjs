import { adminDb } from './_firebaseAdmin.mjs';

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
    // Sur Vercel, req.headers.origin est absent pour les appels serveur→serveur
    // On utilise Resend directement avec APP_BASE_URL plutôt que de re-fetcher /api/notify-email
    const { Resend } = await import('resend');
    const resendClient = new Resend(process.env.RESEND_API_KEY);
    const firstName = (fullName || '').split(' ')[0] || 'là';

    const mailResult = await resendClient.emails.send({
      from: 'EduKaraib <notifications@edukaraib.com>',
      to: [email],
      subject: `Bienvenue sur EduKaraib, ${firstName} ! 🎉`,
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

    if (!mailResult?.id) {
      console.error('[create-welcome-coupon] mail non envoyé:', mailResult);
    }


    return res.json({ ok: true, code });
  } catch (e) {
    console.error('[create-welcome-coupon] error:', e?.message || e);
    return res.status(500).json({ ok: false, error: e?.message || 'INTERNAL_ERROR' });
  }
}