// api/apply-referral.js
// ─────────────────────────────────────────────────────────────────────────────
// Appelé à l'inscription d'un nouveau prof qui a saisi un code parrain.
// Vérifie que le code existe, qu'il appartient à un prof actif, et enregistre
// le lien parrain ↔ filleul dans Firestore.
// Envoie aussi un email de bienvenue spécifique filleul avec ses avantages.
// ─────────────────────────────────────────────────────────────────────────────

import { adminDb } from './_firebaseAdmin.mjs';
import { Resend } from 'resend';

const APP_BASE_URL = process.env.APP_BASE_URL || 'https://edukaraib.com';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const { referralCode, newTeacherUid, newTeacherEmail, newTeacherName } = req.body || {};

  if (!referralCode || !newTeacherUid) {
    return res.status(400).json({ ok: false, error: 'MISSING_FIELDS' });
  }

  const code = String(referralCode).trim().toUpperCase();

  try {
    // 1) Trouver le parrain via son code dans users
    const parrainsSnap = await adminDb
      .collection('users')
      .where('referralCode', '==', code)
      .where('role', '==', 'teacher')
      .limit(1)
      .get();

    if (parrainsSnap.empty) {
      return res.status(404).json({ ok: false, error: 'CODE_NOT_FOUND' });
    }

    const parrainDoc = parrainsSnap.docs[0];
    const parrainUid = parrainDoc.id;
    const parrainData = parrainDoc.data();

    // 2) Empêcher l'auto-parrainage
    if (parrainUid === newTeacherUid) {
      return res.status(400).json({ ok: false, error: 'SELF_REFERRAL' });
    }

    // 3) Vérifier que le filleul n'a pas déjà un parrain
    const filleulRef = adminDb.collection('users').doc(newTeacherUid);
    const filleulSnap = await filleulRef.get();
    if (filleulSnap.exists && filleulSnap.data()?.referredBy) {
      return res.status(400).json({ ok: false, error: 'ALREADY_REFERRED' });
    }

    // 4) Enregistrer le lien sur le filleul
    await filleulRef.set({
      referredBy: parrainUid,
      referredByCode: code,
      referredAt: new Date(),
    }, { merge: true });

    // 5) Ajouter le filleul dans la liste du parrain
    const parrainRef = adminDb.collection('users').doc(parrainUid);
    const filleuls = parrainData.referralFilleuls || [];
    filleuls.push({
      uid: newTeacherUid,
      email: newTeacherEmail || '',
      name: newTeacherName || '',
      joinedAt: new Date(),
      firstCoursePaid: false,
      firstPackPaid: false,
    });
    await parrainRef.set({ referralFilleuls: filleuls }, { merge: true });

    // 6) Récupérer le code parrain du filleul (généré juste avant dans Register.jsx)
    const filleulData = (await filleulRef.get()).data();
    const filleulReferralCode = filleulData?.referralCode || null;
    const parrainName = parrainData.firstName || parrainData.fullName || 'un professeur';
    const firstName = newTeacherName?.split(' ')[0] || '';
    const prenom = firstName ? `, ${firstName}` : '';

    // 7) Email de bienvenue spécifique filleul
    if (newTeacherEmail) {
      const resendClient = new Resend(process.env.RESEND_API_KEY);

      await resendClient.emails.send({
        from: 'EduKaraib <notifications@edukaraib.com>',
        to: [newTeacherEmail],
        subject: '🎁 Bienvenue sur EduKaraib — vos avantages filleul vous attendent !',
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
                  Bienvenue${prenom} ! 🎁
                </h1>
                <p style="color:#334155;font-size:15px;line-height:1.7;margin:0 0 20px;">
                  Vous avez rejoint EduKaraib grâce à <strong>${parrainName}</strong> — bonne initiative !
                  En tant que filleul, vous bénéficiez d'avantages exclusifs 👇
                </p>

                <!-- Avantage filleul mis en avant -->
                <div style="background:#f0fdf4;border:2px solid #22c55e;border-radius:14px;padding:20px;margin-bottom:24px;text-align:center;">
                  <div style="font-size:13px;color:#166534;font-weight:600;margin-bottom:6px;">🎉 Votre prime filleul</div>
                  <div style="font-size:32px;font-weight:900;color:#15803d;">+20 €</div>
                  <div style="font-size:14px;color:#166534;margin-top:8px;line-height:1.6;">
                    Vous recevez <strong>20 € de bonus</strong> dès que vous vendez<br>votre <strong>premier pack 5h</strong> sur la plateforme.
                  </div>
                </div>

                ${filleulReferralCode ? `
                <!-- Son propre code parrain -->
                <div style="background:#fefce8;border:2px dashed #facc15;border-radius:14px;padding:18px 20px;margin-bottom:28px;text-align:center;">
                  <div style="font-size:13px;color:#92400e;font-weight:600;margin-bottom:6px;">🤝 Votre propre code de parrainage</div>
                  <div style="font-size:28px;font-weight:900;letter-spacing:5px;color:#78350f;">${filleulReferralCode}</div>
                  <div style="font-size:13px;color:#92400e;margin-top:8px;">
                    Partagez-le à votre tour : vous recevez <strong>10 €</strong> dès le 1er cours de chaque filleul !
                  </div>
                </div>
                ` : ''}

                <!-- Checklist étapes -->
                <p style="color:#0f172a;font-weight:700;font-size:15px;margin:0 0 14px;">
                  📋 Pour bien démarrer :
                </p>

                <table width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:10px;">
                  <tr>
                    <td style="padding:14px 16px;background:#f0f9ff;border-radius:12px;border-left:4px solid #0ea5e9;">
                      <div style="font-weight:700;color:#0369a1;font-size:14px;margin-bottom:4px;">💳 Finaliser votre compte Stripe</div>
                      <div style="color:#475569;font-size:13px;line-height:1.6;">
                        Sans ça, vous ne pourrez pas recevoir vos virements ni votre prime de 20 €.
                        Allez dans votre <a href="${APP_BASE_URL}/prof/profile" style="color:#0ea5e9;font-weight:600;">profil</a> et complétez la configuration de paiement.
                      </div>
                    </td>
                  </tr>
                </table>

                <table width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:10px;">
                  <tr>
                    <td style="padding:14px 16px;background:#f5f3ff;border-radius:12px;border-left:4px solid #8b5cf6;">
                      <div style="font-weight:700;color:#6d28d9;font-size:14px;margin-bottom:4px;">📅 Renseigner vos disponibilités</div>
                      <div style="color:#475569;font-size:13px;line-height:1.6;">
                        Allez dans votre profil → cliquez sur <strong>Modifier</strong> dans la section
                        <strong>Disponibilité hebdomadaire</strong>. Sans ça, les élèves ne peuvent pas vous réserver !
                      </div>
                    </td>
                  </tr>
                </table>

                <table width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:10px;">
                  <tr>
                    <td style="padding:14px 16px;background:#f0fdf4;border-radius:12px;border-left:4px solid #22c55e;">
                      <div style="font-weight:700;color:#15803d;font-size:14px;margin-bottom:4px;">👥 Cours groupés (optionnel)</div>
                      <div style="color:#475569;font-size:13px;line-height:1.6;">
                        Vous pouvez accueillir plusieurs élèves en même temps. Activez cette option depuis votre profil si vous souhaitez l'utiliser.
                      </div>
                    </td>
                  </tr>
                </table>

                <table width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:24px;">
                  <tr>
                    <td style="padding:14px 16px;background:#fffbeb;border-radius:12px;border-left:4px solid #f59e0b;">
                      <div style="font-weight:700;color:#b45309;font-size:14px;margin-bottom:4px;">📣 Parlez de nous autour de vous !</div>
                      <div style="color:#475569;font-size:13px;line-height:1.6;">
                        Vous avez déjà des élèves ? Invitez-les à vous retrouver sur EduKaraib.
                        ${filleulReferralCode ? `Et partagez votre code <strong>${filleulReferralCode}</strong> pour cumuler des primes.` : ''}
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
      }).catch(e => console.warn('[apply-referral] email filleul failed:', e?.message));
    }

    return res.status(200).json({ ok: true, parrainName: parrainData.firstName || parrainData.fullName || '' });

  } catch (e) {
    console.error('[apply-referral] error:', e);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
}
