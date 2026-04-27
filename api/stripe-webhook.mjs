import { stripe } from './_stripe.mjs';
import { adminDb, rawBody } from './_firebaseAdmin.mjs';
import { Resend } from 'resend';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    const buf = await rawBody(req);
    event = stripe.webhooks.constructEvent(
      buf,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        await markPaymentHeldAndUpdateLesson({ sessionId: session.id, paymentIntentId: session.payment_intent }, session.metadata);
        // Email de confirmation — non-bloquant, n'affecte pas le webhook si ça échoue
        sendPaymentConfirmationEmail(session.metadata, session.amount_total).catch(e =>
          console.warn('[webhook] confirmation email error:', e?.message)
        );
        break;
      }
      case 'payment_intent.succeeded': {
        const pi = event.data.object;
        await markPaymentHeldAndUpdateLesson({ sessionId: null, paymentIntentId: pi.id }, pi.metadata);
        break;
      }
      default:
        break;
    }
    res.json({ received: true });
  } catch (e) {
    console.error('webhook handler error:', e);
    res.status(500).json({ error: 'webhook_error' });
  }
}

async function markPaymentHeldAndUpdateLesson(refs, metadata) {
  // Récup métadonnées robustes
  const md = metadata || {};
  const lessonId  = md.lesson_id || md.lessonId;

  // ⚠️ DÉFINIR AVANT TOUT USAGE
  const forStudent = md.for_student || md.student_id || md.studentId || null;
  const payerUid   = md.payer_uid || md.payerUid || null;
  const teacherUid = md.teacher_uid || md.teacher_id || null;

  // ✅ Support des packs : plusieurs leçons dans metadata.lesson_ids
  const lessonIds = (md.lesson_ids || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

  if (lessonIds.length > 1) {
    console.log(`Webhook: paiement pack détecté (${lessonIds.length} leçons)`);

    for (const id of lessonIds) {
      const ref  = adminDb.collection('lessons').doc(String(id));
      const snap = await ref.get();
      if (!snap.exists) continue;

      if (forStudent) {
        await ref.set({
          participantsMap: {
            [String(forStudent)]: {
              ...(snap.data()?.participantsMap?.[String(forStudent)] || {}),
              is_paid: true,
              paid_at: new Date(),
              paid_by: payerUid || null,
            },
          },
        }, { merge: true });
      } else {
        await ref.set({
          is_paid: true,
          paid_at: new Date(),
          paid_by: payerUid || null,
        }, { merge: true });
      }
    }
  }

  const teacherAmountCents = Number(md.teacher_amount_cents || 0);
  const siteFeeCents = Number(md.site_fee_cents || 0);
  const isGroup = String(md.is_group || '') === 'true';

  if (!lessonId) return; // rien à faire sans leçon

  // Récupérer le PaymentIntent complet (pour charge / montants exacts)
  let pi = null;
  if (refs.paymentIntentId) {
    pi = await stripe.paymentIntents.retrieve(refs.paymentIntentId, { expand: ['latest_charge.balance_transaction'] });
  }
  const charge = pi?.charges?.data?.[0] || null;
  const grossCents = pi?.amount_received ?? pi?.amount ?? 0;

  // 1) Mettre à jour la leçon : payé POUR L'ÉLÈVE ciblé, afin d'éviter un double paiement
  const lessonRef = adminDb.collection('lessons').doc(String(lessonId));
  const lessonSnap = await lessonRef.get();
  if (lessonSnap.exists) {
    if (isGroup && forStudent) {
      await lessonRef.set({
        participantsMap: {
          [String(forStudent)]: {
            is_paid: true,
            paid_at: new Date(),
            paid_by: payerUid || null,
            ...(lessonSnap.data()?.participantsMap?.[String(forStudent)] || {}),
          }
        }
      }, { merge: true });
    } else {
      await lessonRef.set({
        is_paid: true,
        paid_at: new Date(),
        paid_by: payerUid || null,
        total_amount: (grossCents || 0) / 100,
        payment_intent_id: pi?.id || null,
        stripe_charge_id: charge?.id || null,
      }, { merge: true });
    }
  }

  // 2) Marquer le paiement “held” côté payments (en attente de versement prof)
  const paymentDocId = refs.sessionId || refs.paymentIntentId;
  if (paymentDocId) {
    await adminDb.collection('payments').doc(paymentDocId).set({
      status: 'held',                  // ✅ argent encaissé par la plateforme, pas encore versé au prof
      updated_at: new Date(),
      lesson_id: String(lessonId),
      for_student: forStudent ? String(forStudent) : null,
      teacher_uid: teacherUid || null,
      gross_eur: (grossCents || 0) / 100,
      fee_eur: (siteFeeCents || 0) / 100,
      net_to_teacher_eur: Math.max(0, teacherAmountCents) / 100,
      payment_intent_id: pi?.id || refs.paymentIntentId || null,
      stripe_charge_id: charge?.id || null,
      // Tu pourras plus tard compléter lors du “release” avec transfer_id, released_at, etc.
    }, { merge: true });
  }

  // 3) Marquer le coupon comme utilisé si présent (ancien système)
  const couponDocId = md.coupon_doc_id;
  if (couponDocId && !md.influencer_uid) {
    try {
      await adminDb.collection('coupons').doc(couponDocId).update({
        used: true,
        used_at: new Date(),
        used_for_lesson: String(lessonId),
        used_by: payerUid || null,
      });
    } catch (e) {
      console.warn('[webhook] coupon update failed:', e?.message);
    }
  }

  // 4) Créditer la commission influenceur si un code influ était appliqué
  const influencerUid = md.influencer_uid;
  const influencerCommissionCents = Number(md.influencer_commission_cents || 0);
  const isPack = String(md.is_pack) === '1';
  const billedHoursWh = Number(md.billed_hours || 1);

  if (influencerUid && influencerCommissionCents > 0) {
    const influRef = adminDb.collection('influencers').doc(influencerUid);
    try {
      await adminDb.runTransaction(async (tx) => {
        const influSnap = await tx.get(influRef);
        if (!influSnap.exists) return;
        const data = influSnap.data() || {};
        const newPending = (data.pendingPayout || 0) + influencerCommissionCents / 100;
        const newTotal   = (data.totalEarned  || 0) + influencerCommissionCents / 100;
        const newCount   = (data.usageCount   || 0) + 1;

        const conversionEntry = {
          lesson_id:    lessonId || null,
          payer_uid:    payerUid || null,
          amount_eur:   influencerCommissionCents / 100,
          type:         !isPack ? 'unitaire' : billedHoursWh === 10 ? 'pack10' : 'pack5',
          paid_at:      new Date(),
          session_id:   refs.sessionId || null,
        };

        tx.update(influRef, {
          pendingPayout: newPending,
          totalEarned:   newTotal,
          usageCount:    newCount,
          conversions:   [...(data.conversions || []), conversionEntry],
        });
      });

      // Enregistre l'usage dans influencer_usages (pour limites IP + compte)
      const clientIp = md.client_ip || '';
      await adminDb.collection('influencer_usages').add({
        influencer_uid:  influencerUid,
        payer_uid:       payerUid || null,
        client_ip:       clientIp,
        is_pack:         isPack,
        lesson_id:       lessonId || null,
        commission_eur:  influencerCommissionCents / 100,
        created_at:      new Date(),
      });

    } catch (e) {
      console.warn('[webhook] influencer commission credit failed:', e?.message);
    }
  }

  // 4) Déclencher les primes de parrainage si le prof est un filleul
  if (teacherUid) {
    try {
      const source = md.lesson_source || '';
      // paymentType : 'course' pour cours unitaire, 'pack5' ou 'pack10' pour packs
      const paymentType =
        source === 'pack5'  ? 'pack5'  :
        source === 'pack10' ? 'pack10' :
        'course';

      const BASE_URL = process.env.APP_BASE_URL || 'https://www.edukaraib.com';
      await fetch(`${BASE_URL}/api/trigger-referral-bonus`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teacherUid,
          paymentType,
          lessonId: lessonId || null,
          amount: (Number(md.teacher_amount_cents || 0) / 100),
        }),
      }).catch(e => console.warn('[webhook] trigger-referral-bonus failed:', e?.message));
    } catch (e) {
      console.warn('[webhook] referral bonus error:', e?.message);
    }
  }
}

// ── Email de confirmation de paiement ────────────────────────────────────────
async function sendPaymentConfirmationEmail(md, amountTotalCents) {
  if (!process.env.RESEND_API_KEY) return;

  const payerUid   = md.payer_uid  || md.payerUid  || null;
  const teacherUid = md.teacher_uid || md.teacher_id || null;
  const lessonId   = md.lesson_id  || md.lessonId  || null;
  if (!payerUid) return;

  // Lookup en parallèle : payeur, prof, leçon
  const [payerSnap, teacherSnap, lessonSnap] = await Promise.all([
    adminDb.collection('users').doc(payerUid).get(),
    teacherUid ? adminDb.collection('users').doc(teacherUid).get() : Promise.resolve(null),
    lessonId   ? adminDb.collection('lessons').doc(lessonId).get() : Promise.resolve(null),
  ]);

  if (!payerSnap.exists) return;
  const payer = payerSnap.data();
  const email = payer.email;
  if (!email) return;

  const payerFirstName = payer.firstName || payer.displayName?.split(' ')[0] || 'là';

  let teacherName = 'votre professeur';
  if (teacherSnap?.exists) {
    const t = teacherSnap.data();
    teacherName = [t.firstName, t.lastName].filter(Boolean).join(' ') || t.displayName || teacherName;
  }

  let subjectLabel = 'Cours particulier';
  let lessonDateStr = '';
  if (lessonSnap?.exists) {
    const l = lessonSnap.data();
    if (l.subject_id) subjectLabel = `Cours de ${l.subject_id}`;
    const raw = l.scheduled_at || l.date || l.start_time || null;
    if (raw) {
      const d = raw?.toDate ? raw.toDate() : new Date(raw);
      lessonDateStr = d.toLocaleDateString('fr-FR', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      });
    }
  }

  const isPack        = String(md.is_pack) === '1';
  const packHours     = Number(md.pack_hours || 0);
  const totalEur      = (amountTotalCents || 0) / 100;
  const discountEur   = Number(md.coupon_discount_cents || 0) / 100;
  const typeLabel     = isPack ? `Pack ${packHours}h` : subjectLabel;
  const modeLabel     = String(md.lesson_source || '').includes('visio') ? 'Visio' : 'Présentiel';

  const APP_BASE_URL = process.env.APP_BASE_URL || 'https://edukaraib.com';

  const html = `
<div style="font-family:Inter,system-ui,Arial,sans-serif;background:#f5f7fb;padding:24px;">
<table width="100%" cellspacing="0" cellpadding="0" style="max-width:660px;margin:auto;background:#fff;border-radius:18px;overflow:hidden;border:1px solid #e2e8f0;">
  <!-- Header -->
  <tr>
    <td style="background:#00804B;padding:20px 24px;">
      <table width="100%" cellspacing="0" cellpadding="0"><tr>
        <td style="vertical-align:middle;">
          <span style="display:inline-flex;align-items:center;gap:10px;">
            <img src="https://edukaraib.com/edukaraib_logo.png" alt="EduKaraib" style="width:40px;height:40px;border-radius:8px;background:#fff;display:block;" />
            <span style="color:#fff;font-weight:700;font-size:17px;">EduKaraib</span>
          </span>
        </td>
        <td align="right" style="color:#bbf7d0;font-size:13px;font-weight:600;">Confirmation de paiement</td>
      </tr></table>
    </td>
  </tr>

  <!-- Body -->
  <tr><td style="padding:28px 28px 0;">
    <p style="margin:0 0 6px;font-size:22px;font-weight:700;color:#0f172a;">✅ Paiement confirmé !</p>
    <p style="margin:0 0 20px;color:#475569;font-size:15px;">Bonjour ${esc(payerFirstName)}, votre réservation est enregistrée.</p>

    <!-- Récapitulatif -->
    <table width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;margin-bottom:20px;">
      <tr><td style="padding:16px 18px;">
        <p style="margin:0 0 12px;font-weight:700;color:#0f172a;font-size:14px;">Récapitulatif de votre commande</p>
        ${row('Type',        typeLabel)}
        ${row('Matière',     subjectLabel)}
        ${row('Professeur',  teacherName)}
        ${lessonDateStr ? row('Date',  lessonDateStr) : ''}
        ${!isPack && modeLabel ? row('Mode', modeLabel) : ''}
        ${discountEur > 0 ? row('Remise appliquée', `<span style="color:#16a34a;font-weight:600;">-${fmt(discountEur)} €</span>`) : ''}
        <tr><td colspan="2" style="padding:8px 0 0;border-top:1px solid #e2e8f0;"></td></tr>
        ${row('Total payé', `<span style="font-weight:700;font-size:16px;color:#0f172a;">${fmt(totalEur)} €</span>`)}
      </td></tr>
    </table>

    <!-- Crédit d'impôt -->
    <table width="100%" cellspacing="0" cellpadding="0" style="background:#fffbeb;border-radius:10px;border:1px solid #fde68a;margin-bottom:24px;">
      <tr><td style="padding:14px 16px;">
        <p style="margin:0;font-size:13px;color:#92400e;line-height:1.6;">
          💡 <strong>Crédit d'impôt :</strong> En France, les cours particuliers ouvrent droit à un crédit d'impôt de <strong>50 %</strong> des sommes versées (service à la personne — art. 199 sexdecies CGI). Conservez cet email comme justificatif.
        </p>
      </td></tr>
    </table>

    <!-- CTA -->
    <div style="text-align:center;margin-bottom:28px;">
      <a href="${APP_BASE_URL}/smart-dashboard" style="display:inline-block;background:#facc15;color:#111827;text-decoration:none;font-weight:700;padding:13px 28px;border-radius:12px;font-size:15px;">Voir mes cours →</a>
    </div>
  </td></tr>

  <!-- Footer -->
  <tr><td style="padding:0 28px 24px;color:#94a3b8;font-size:12px;border-top:1px solid #f1f5f9;">
    <p style="margin:12px 0 4px;font-weight:600;color:#64748b;">L'équipe EduKaraib</p>
    <p style="margin:0;"><a href="mailto:contact@edukaraib.com" style="color:#00804B;text-decoration:none;">contact@edukaraib.com</a> · <a href="${APP_BASE_URL}" style="color:#00804B;text-decoration:none;">edukaraib.com</a></p>
  </td></tr>
</table>
</div>`;

  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from: 'EduKaraib <notifications@edukaraib.com>',
    to: [email],
    subject: `✅ Paiement confirmé — ${typeLabel} avec ${teacherName}`,
    html,
  });
}

function esc(s) { return String(s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmt(n) { return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function row(label, value) {
  return `<tr>
    <td style="padding:5px 0;color:#64748b;font-size:13px;width:45%;">${esc(label)}</td>
    <td style="padding:5px 0;color:#0f172a;font-size:13px;font-weight:500;">${value}</td>
  </tr>`;
}