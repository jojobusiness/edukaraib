// api/trigger-referral-bonus.js
// ─────────────────────────────────────────────────────────────────────────────
// Appelé depuis le webhook Stripe après un paiement confirmé pour un prof filleul.
// Déclenche :
//   - Prime 10 € au parrain lors du 1er cours payé du filleul
//   - Prime 20 € au filleul  lors de son 1er pack 5h payé
// Les primes s'accumulent dans users/{uid}.referralEarnings.pending
// et sont affichées dans TeacherEarnings.
// ─────────────────────────────────────────────────────────────────────────────

import { adminDb } from './_firebaseAdmin.mjs';
import { Resend } from 'resend';

const APP_BASE_URL = process.env.APP_BASE_URL || 'https://edukaraib.com';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const { teacherUid, paymentType, lessonId, amount } = req.body || {};
  // paymentType : 'course' | 'pack5' | 'pack10'

  if (!teacherUid || !paymentType) {
    return res.status(400).json({ ok: false, error: 'MISSING_FIELDS' });
  }

  try {
    const filleulRef = adminDb.collection('users').doc(teacherUid);
    const filleulSnap = await filleulRef.get();
    if (!filleulSnap.exists) {
      return res.status(404).json({ ok: false, error: 'USER_NOT_FOUND' });
    }

    const filleulData = filleulSnap.data();
    const parrainUid = filleulData?.referredBy;

    // Pas de parrain → rien à faire
    if (!parrainUid) {
      return res.status(200).json({ ok: true, action: 'NO_REFERRAL' });
    }

    const parrainRef = adminDb.collection('users').doc(parrainUid);
    const parrainSnap = await parrainRef.get();
    if (!parrainSnap.exists) {
      return res.status(200).json({ ok: true, action: 'PARRAIN_NOT_FOUND' });
    }
    const parrainData = parrainSnap.data();

    const now = new Date();
    const bonusLog = adminDb.collection('referral_bonuses');
    const resendClient = new Resend(process.env.RESEND_API_KEY);

    // ── Prime parrain : 10 € sur le 1er cours du filleul ──────────────────────
    if (paymentType === 'course' && !filleulData.referral_firstCoursePaid) {
      const PRIME_PARRAIN = 10;

      // Marquer le filleul
      await filleulRef.set({ referral_firstCoursePaid: true }, { merge: true });

      // Créditer le parrain
      const parrainPending = Number(parrainData?.referralEarnings?.pending || 0);
      const parrainTotal   = Number(parrainData?.referralEarnings?.total   || 0);
      await parrainRef.set({
        referralEarnings: {
          pending: parrainPending + PRIME_PARRAIN,
          total:   parrainTotal   + PRIME_PARRAIN,
        },
        // Mettre à jour firstCoursePaid dans la liste filleuls
        referralFilleuls: (parrainData.referralFilleuls || []).map(f =>
          f.uid === teacherUid ? { ...f, firstCoursePaid: true } : f
        ),
      }, { merge: true });

      // Log
      await bonusLog.add({
        type: 'parrain_first_course',
        parrainUid,
        filleulUid: teacherUid,
        amount: PRIME_PARRAIN,
        lessonId: lessonId || null,
        createdAt: now,
      });

      // Email au parrain
      const parrainEmail = parrainData.email;
      const parrainFirstName = parrainData.firstName || parrainData.fullName?.split(' ')[0] || '';
      const filleulName = filleulData.firstName || filleulData.fullName || 'Votre filleul';

      if (parrainEmail) {
        await resendClient.emails.send({
          from: 'EduKaraib <notifications@edukaraib.com>',
          to: [parrainEmail],
          subject: `🎉 Votre filleul vient de donner son 1er cours — +${PRIME_PARRAIN} € !`,
          html: `
            <div style="font-family:Inter,system-ui,sans-serif;background:#f5f7fb;padding:24px;">
              <table width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:auto;background:#fff;border-radius:18px;overflow:hidden;border:1px solid #eef0f4;">
                <tr><td style="background:#0ea5e9;padding:18px 20px;">
                  <span style="color:#fff;font-weight:700;font-size:16px;">EduKaraib</span>
                </td></tr>
                <tr><td style="padding:26px;">
                  <h1 style="margin:0 0 10px;font-size:20px;color:#0f172a;">Bonne nouvelle${parrainFirstName ? `, ${parrainFirstName}` : ''} ! 🎉</h1>
                  <p style="color:#334155;font-size:15px;line-height:1.65;">
                    <strong>${filleulName}</strong>, votre filleul, vient de donner son premier cours sur EduKaraib.<br><br>
                    Conformément au programme de parrainage, vous recevez :
                  </p>
                  <div style="background:#f0fdf4;border:2px solid #22c55e;border-radius:12px;padding:16px;margin:16px 0;text-align:center;">
                    <div style="font-size:28px;font-weight:800;color:#15803d;">+${PRIME_PARRAIN} €</div>
                    <div style="color:#166534;font-size:14px;margin-top:4px;">Prime de parrainage — 1er cours filleul</div>
                  </div>
                  <p style="color:#334155;font-size:14px;">Ce montant sera visible dans votre tableau de bord Gains → section Parrainage.</p>
                  <div style="margin-top:18px;">
                    <a href="${APP_BASE_URL}/prof/earnings" style="background:#facc15;color:#111827;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:12px;display:inline-block;">Voir mes gains</a>
                  </div>
                </td></tr>
                <tr><td style="padding:12px 26px 24px;color:#64748b;font-size:12px;">
                  EduKaraib · <a href="mailto:contact@edukaraib.com" style="color:#0ea5e9;">contact@edukaraib.com</a>
                </td></tr>
              </table>
            </div>
          `,
        }).catch(e => console.warn('[trigger-referral-bonus] email parrain failed:', e?.message));
      }
    }

    // ── Prime filleul : 20 € sur son 1er pack 5h ──────────────────────────────
    if (paymentType === 'pack5' && !filleulData.referral_firstPackPaid) {
      const PRIME_FILLEUL = 20;

      // Marquer
      await filleulRef.set({ referral_firstPackPaid: true }, { merge: true });

      // Créditer le filleul
      const filleulPending = Number(filleulData?.referralEarnings?.pending || 0);
      const filleulTotal   = Number(filleulData?.referralEarnings?.total   || 0);
      await filleulRef.set({
        referralEarnings: {
          pending: filleulPending + PRIME_FILLEUL,
          total:   filleulTotal   + PRIME_FILLEUL,
        },
      }, { merge: true });

      // Mettre à jour dans la liste du parrain
      await parrainRef.set({
        referralFilleuls: (parrainData.referralFilleuls || []).map(f =>
          f.uid === teacherUid ? { ...f, firstPackPaid: true } : f
        ),
      }, { merge: true });

      // Log
      await bonusLog.add({
        type: 'filleul_first_pack',
        parrainUid,
        filleulUid: teacherUid,
        amount: PRIME_FILLEUL,
        createdAt: now,
      });

      // Email au filleul
      const filleulEmail = filleulData.email;
      const filleulFirstName = filleulData.firstName || filleulData.fullName?.split(' ')[0] || '';

      if (filleulEmail) {
        await resendClient.emails.send({
          from: 'EduKaraib <notifications@edukaraib.com>',
          to: [filleulEmail],
          subject: `🎁 Votre prime de bienvenue parrainage — +${PRIME_FILLEUL} € !`,
          html: `
            <div style="font-family:Inter,system-ui,sans-serif;background:#f5f7fb;padding:24px;">
              <table width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:auto;background:#fff;border-radius:18px;overflow:hidden;border:1px solid #eef0f4;">
                <tr><td style="background:#0ea5e9;padding:18px 20px;">
                  <span style="color:#fff;font-weight:700;font-size:16px;">EduKaraib</span>
                </td></tr>
                <tr><td style="padding:26px;">
                  <h1 style="margin:0 0 10px;font-size:20px;color:#0f172a;">Félicitations${filleulFirstName ? `, ${filleulFirstName}` : ''} ! 🎁</h1>
                  <p style="color:#334155;font-size:15px;line-height:1.65;">
                    Vous venez de vendre votre premier pack 5h sur EduKaraib.<br><br>
                    Grâce au programme de parrainage, vous recevez :
                  </p>
                  <div style="background:#f0fdf4;border:2px solid #22c55e;border-radius:12px;padding:16px;margin:16px 0;text-align:center;">
                    <div style="font-size:28px;font-weight:800;color:#15803d;">+${PRIME_FILLEUL} €</div>
                    <div style="color:#166534;font-size:14px;margin-top:4px;">Prime filleul — 1er pack 5h vendu</div>
                  </div>
                  <p style="color:#334155;font-size:14px;">Ce montant est visible dans votre tableau de bord Gains → section Parrainage.</p>
                  <div style="margin-top:18px;">
                    <a href="${APP_BASE_URL}/prof/earnings" style="background:#facc15;color:#111827;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:12px;display:inline-block;">Voir mes gains</a>
                  </div>
                </td></tr>
                <tr><td style="padding:12px 26px 24px;color:#64748b;font-size:12px;">
                  EduKaraib · <a href="mailto:contact@edukaraib.com" style="color:#0ea5e9;">contact@edukaraib.com</a>
                </td></tr>
              </table>
            </div>
          `,
        }).catch(e => console.warn('[trigger-referral-bonus] email filleul failed:', e?.message));
      }
    }

    return res.status(200).json({ ok: true });

  } catch (e) {
    console.error('[trigger-referral-bonus] error:', e);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
}
