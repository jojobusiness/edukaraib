// api/send-welcome-teacher.js
// ─────────────────────────────────────────────────────────────────────────────
// Appelé à la fin de l'inscription d'un nouveau prof (avec ou sans parrain).
// Envoie un email de bienvenue avec son code de parrainage et les étapes clés.
// ─────────────────────────────────────────────────────────────────────────────

import { Resend } from 'resend';

const APP_BASE_URL = process.env.APP_BASE_URL || 'https://edukaraib.com';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const { email, firstName, referralCode } = req.body || {};

  if (!email || !referralCode) {
    return res.status(400).json({ ok: false, error: 'MISSING_FIELDS' });
  }

  try {
    const resendClient = new Resend(process.env.RESEND_API_KEY);
    const prenom = firstName ? `, ${firstName}` : '';

    await resendClient.emails.send({
      from: 'EduKaraib <notifications@edukaraib.com>',
      to: [email],
      subject: '🎉 Bienvenue sur EduKaraib — votre code de parrainage vous attend !',
      html: `
        <div style="font-family:Inter,system-ui,sans-serif;background:#f5f7fb;padding:24px;">
          <table width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:auto;background:#fff;border-radius:18px;overflow:hidden;border:1px solid #eef0f4;">

            <!-- Header -->
            <tr><td style="background:#0ea5e9;padding:18px 24px;">
              <span style="color:#fff;font-weight:800;font-size:18px;">EduKaraib</span>
            </td></tr>

            <!-- Body -->
            <tr><td style="padding:30px 28px 10px;">
              <h1 style="margin:0 0 12px;font-size:22px;color:#0f172a;">
                Bienvenue${prenom} ! 🎉
              </h1>
              <p style="color:#334155;font-size:15px;line-height:1.7;margin:0 0 24px;">
                Votre compte professeur est créé. On est ravis de vous compter parmi nos enseignants sur EduKaraib !
              </p>

              <!-- Code de parrainage -->
              <div style="background:#fefce8;border:2px dashed #facc15;border-radius:14px;padding:18px 20px;margin-bottom:28px;text-align:center;">
                <div style="font-size:13px;color:#92400e;font-weight:600;margin-bottom:6px;">🎁 Votre code de parrainage personnel</div>
                <div style="font-size:30px;font-weight:900;letter-spacing:6px;color:#78350f;">${referralCode}</div>
                <div style="font-size:13px;color:#92400e;margin-top:8px;">
                  Partagez-le à d'autres profs : vous recevez <strong>10 €</strong> dès le 1er cours de chaque filleul !
                </div>
              </div>

              <!-- Checklist étapes -->
              <p style="color:#0f172a;font-weight:700;font-size:15px;margin:0 0 14px;">
                📋 Pour bien démarrer, voici les étapes importantes :
              </p>

              <!-- Stripe -->
              <table width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:10px;">
                <tr>
                  <td style="padding:14px 16px;background:#f0f9ff;border-radius:12px;border-left:4px solid #0ea5e9;">
                    <div style="font-weight:700;color:#0369a1;font-size:14px;margin-bottom:4px;">💳 Finaliser votre compte Stripe</div>
                    <div style="color:#475569;font-size:13px;line-height:1.6;">
                      Sans ça, vous ne pourrez pas recevoir vos virements. Rendez-vous dans votre 
                      <a href="${APP_BASE_URL}/prof/profile" style="color:#0ea5e9;font-weight:600;">profil</a> 
                      et complétez la configuration de paiement.
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Disponibilités -->
              <table width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:10px;">
                <tr>
                  <td style="padding:14px 16px;background:#f5f3ff;border-radius:12px;border-left:4px solid #8b5cf6;">
                    <div style="font-weight:700;color:#6d28d9;font-size:14px;margin-bottom:4px;">📅 Renseigner vos disponibilités</div>
                    <div style="color:#475569;font-size:13px;line-height:1.6;">
                      Allez dans votre profil → cliquez sur <strong>Modifier</strong> dans la section 
                      <strong>Disponibilité hebdomadaire</strong> pour indiquer vos créneaux. 
                      Sans ça, les élèves ne peuvent pas vous réserver !
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Cours groupés -->
              <table width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:10px;">
                <tr>
                  <td style="padding:14px 16px;background:#f0fdf4;border-radius:12px;border-left:4px solid #22c55e;">
                    <div style="font-weight:700;color:#15803d;font-size:14px;margin-bottom:4px;">👥 Cours groupés (optionnel)</div>
                    <div style="color:#475569;font-size:13px;line-height:1.6;">
                      Vous pouvez accueillir plusieurs élèves en même temps dans un même cours. 
                      Activez cette option directement depuis votre profil si vous souhaitez l'utiliser.
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Parler du site -->
              <table width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:24px;">
                <tr>
                  <td style="padding:14px 16px;background:#fffbeb;border-radius:12px;border-left:4px solid #f59e0b;">
                    <div style="font-weight:700;color:#b45309;font-size:14px;margin-bottom:4px;">📣 Parlez de nous autour de vous !</div>
                    <div style="color:#475569;font-size:13px;line-height:1.6;">
                      Vous avez déjà des élèves ? Invitez-les à vous retrouver sur EduKaraib. 
                      Et partagez votre code <strong>${referralCode}</strong> à d'autres profs pour 
                      cumuler des primes de parrainage.
                    </div>
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <div style="text-align:center;margin-bottom:10px;">
                <a href="${APP_BASE_URL}/prof/profile"
                  style="background:#0ea5e9;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;border-radius:14px;display:inline-block;">
                  Accéder à mon profil →
                </a>
              </div>
            </td></tr>

            <!-- Footer -->
            <tr><td style="padding:14px 28px 24px;color:#94a3b8;font-size:12px;border-top:1px solid #f1f5f9;">
              EduKaraib · <a href="mailto:contact@edukaraib.com" style="color:#0ea5e9;">contact@edukaraib.com</a>
            </td></tr>

          </table>
        </div>
      `,
    });

    return res.status(200).json({ ok: true });

  } catch (e) {
    console.error('[send-welcome-teacher] error:', e);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
}
