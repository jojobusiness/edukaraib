import { stripe } from '../_stripe.mjs';
import { adminDb, verifyAuth } from '../_firebaseAdmin.mjs';
import { captureError } from '../_sentry.mjs';

// -- helpers lecture corps & num
function readBody(req) {
  try {
    if (!req.body) return {};
    if (typeof req.body === 'string') return JSON.parse(req.body);
    return req.body;
  } catch { return {}; }
}
const toNum = (v) => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

// ---- helpers ID équivalents (élève / enfant) ----
async function resolveEquivalentStudentIds(targetId) {
  const out = new Set([String(targetId)]);
  try {
    const st = await adminDb.collection('students').doc(String(targetId)).get();
    if (st.exists) {
      const d = st.data() || {};
      if (d.user_id) out.add(String(d.user_id));
      if (d.uid) out.add(String(d.uid));
    }
  } catch {}
  try {
    const q1 = await adminDb.collection('students').where('user_id', '==', String(targetId)).limit(1).get();
    if (!q1.empty) {
      const d = q1.docs[0].data() || {};
      out.add(String(q1.docs[0].id));
      if (d.uid) out.add(String(d.uid));
      if (d.user_id) out.add(String(d.user_id));
    }
  } catch {}
  try {
    const q2 = await adminDb.collection('students').where('uid', '==', String(targetId)).limit(1).get();
    if (!q2.empty) {
      const d = q2.docs[0].data() || {};
      out.add(String(q2.docs[0].id));
      if (d.uid) out.add(String(d.uid));
      if (d.user_id) out.add(String(d.user_id));
    }
  } catch {}
  return Array.from(out);
}
function anyAliasInArray(aliases, arr = []) {
  const s = new Set((arr || []).map(String));
  return aliases.find((a) => s.has(String(a))) || null;
}
function anyAliasInObjectKeys(aliases, obj = {}) {
  const keys = new Set(Object.keys(obj || {}).map(String));
  return aliases.find((a) => keys.has(String(a))) || null;
}
function resolveParticipantInLesson(lesson, aliases) {
  const pm = lesson?.participantsMap || {};
  const isGroup = Array.isArray(lesson?.participant_ids) && lesson.participant_ids.length > 0;

  if (isGroup) {
    const hitArray = anyAliasInArray(aliases, lesson.participant_ids);
    if (hitArray) return String(hitArray);
    const hitMap = anyAliasInObjectKeys(aliases, pm);
    if (hitMap) return String(hitMap);
    return null;
  }
  if (lesson.student_id && aliases.some((a) => String(a) === String(lesson.student_id))) {
    return String(lesson.student_id);
  }
  const hitMap = anyAliasInObjectKeys(aliases, pm);
  if (hitMap) return String(hitMap);
  return null;
}
function participantStatus(lesson, participantId) {
  return lesson?.participantsMap?.[participantId]?.status || null;
}
function isAlreadyPaid(lesson, participantId) {
  const pm = lesson?.participantsMap || {};
  const isGroup = Array.isArray(lesson?.participant_ids) && lesson.participant_ids.length > 0;
  if (isGroup) return !!pm?.[participantId]?.is_paid;
  if (String(lesson.student_id) === String(participantId)) return !!lesson.is_paid;
  return !!pm?.[participantId]?.is_paid;
}
function participantPackInfo(lesson, participantId) {
  const p = lesson?.participantsMap?.[participantId] || {};
  const packHours =
    Number(p.pack_hours) ||
    (String(p.pack_type || '').toLowerCase() === 'pack5' ? 5 :
     String(p.pack_type || '').toLowerCase() === 'pack10' ? 10 : 0);
  return { packHours };
}
function isPackFor(lesson, participantId) {
  return participantPackInfo(lesson, participantId).packHours > 0;
}
function isEligibleToPay(lesson, participantId) {
  const isGroup = Array.isArray(lesson?.participant_ids) && lesson.participant_ids.length > 0;
  if (isGroup) {
    const st = participantStatus(lesson, participantId);
    return st === 'accepted' || st === 'confirmed';
  }
  return lesson.status === 'confirmed' || lesson.status === 'completed';
}
function detectSourceFor(lesson, participantId) {
  const { packHours } = participantPackInfo(lesson, participantId);
  if (packHours === 5) return 'pack5';
  if (packHours === 10) return 'pack10';
  const isVisio = String(lesson.mode) === 'visio' || lesson.is_visio === true;
  return isVisio ? 'visio' : 'presentiel';
}
// Plafond de sécurité : une leçon individuelle ne peut jamais facturer plus de
// MAX_SINGLE_LESSON_HOURS heures. Empêche qu'un prof modifie `duration_hours`
// dans Firestore pour gonfler le total facturé au client (et sa propre part).
const MAX_SINGLE_LESSON_HOURS = 8;
function getBilledHoursFor(lesson, participantId) {
  const { packHours } = participantPackInfo(lesson, participantId);
  if (packHours) return packHours;
  const h = Number(lesson.duration_hours);
  if (!Number.isFinite(h) || h <= 0) return 1;
  return Math.min(Math.floor(h), MAX_SINGLE_LESSON_HOURS);
}
function computeBaseRateEuroFor(lesson, participantId) {
  const isVisio = String(lesson.mode) === 'visio' || lesson.is_visio === true;
  const visioSame = lesson.visio_same_rate;
  const visioRate = toNum(lesson.visio_price_per_hour);
  const baseRate  = toNum(lesson.price_per_hour);
  if (isVisio && visioSame === false && visioRate > 0) return visioRate;
  return baseRate;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const auth = await verifyAuth(req, res);
  if (!auth) return;
  const payerUid = auth.uid;

  const body = readBody(req);
  const { lessonId, forStudent, packKey } = body;
  const rawCouponCodes = body.couponCodes || (body.couponCode ? [body.couponCode] : []);
  if (!lessonId) return res.status(400).json({ error: 'MISSING_LESSON_ID' });
  // Borne le nombre de codes pour éviter une avalanche de requêtes Firestore
  if (Array.isArray(rawCouponCodes) && rawCouponCodes.length > 5) {
    return res.status(400).json({ error: 'TOO_MANY_COUPONS' });
  }

  // Leçon pivot
  const snap = await adminDb.collection('lessons').doc(String(lessonId)).get();
  if (!snap.exists) return res.status(404).json({ error: 'LESSON_NOT_FOUND' });
  const lesson = { id: snap.id, ...snap.data() };

  // Participant visé (élève ou enfant)
  const rawTarget = forStudent || lesson.student_id || null;
  if (!rawTarget) return res.status(400).json({ error: 'STUDENT_NOT_RESOLVED' });
  const aliases = await resolveEquivalentStudentIds(String(rawTarget));
  const participantId = resolveParticipantInLesson(lesson, aliases);
  if (!participantId) return res.status(403).json({ error: 'NOT_PARTICIPANT' });

  // Autorisation payeur (élève lui-même ou parent lié)
  const isGroupLesson = Array.isArray(lesson?.participant_ids) && lesson.participant_ids.length > 0;
  const payerIsStudent = aliases.some((a) => String(a) === String(payerUid));
  const payerIsParent =
    (lesson.participantsMap?.[participantId]?.parent_id &&
      String(lesson.participantsMap[participantId].parent_id) === String(payerUid)) ||
    // Le fallback parent au niveau leçon ne vaut QUE pour les cours individuels.
    // Sur une leçon de groupe, l'autorisation doit être liée au participant précis,
    // sinon un parent inscrit pourrait régler pour n'importe quel élève du groupe.
    (!isGroupLesson && lesson.parent_id && String(lesson.parent_id) === String(payerUid));
  if (!payerIsStudent && !payerIsParent) {
    return res.status(403).json({ error: 'NOT_ALLOWED' });
  }

  // Regroupement PACK (si packKey envoyé ou si leçon pack)
  let lessonsToBill = [ lesson ];
  let packMode = false;
  let billedHours = 1;

  if (packKey || isPackFor(lesson, participantId)) {
    packMode = true;

    // Candidats : toutes les leçons du prof où ce participant apparaît
    const q = await adminDb.collection('lessons')
      .where('teacher_id', '==', String(lesson.teacher_id))
      .where('participant_ids', 'array-contains', String(participantId))
      .get();
    const candidates = q.docs.map(d => ({ id: d.id, ...d.data() }));

    // même clé pack (participantsMap[participantId].pack_id en priorité)
    const samePack = candidates.filter(L => {
      const pm = (L.participantsMap || {})[String(participantId)];
      const hours = Number(pm?.pack_hours || L.pack_hours || 1);
      const mode = (String(L.mode) === 'visio' || L.is_visio) ? 'visio' : 'presentiel';
      const candidateKey = String(
        pm?.pack_id || L.pack_id || `AUTO:${L.teacher_id}|${mode}|${hours}|${participantId}`
      );
      return packKey
        ? String(candidateKey) === String(packKey)
        : String(candidateKey) === String(
            pm?.pack_id || L.pack_id || `AUTO:${L.teacher_id}|${mode}|${hours}|${participantId}`
          );
    });

    // éligibles & non payées pour CE participant
    lessonsToBill = (samePack.length ? samePack : lessonsToBill)
      .filter(L => isEligibleToPay(L, participantId) && !isAlreadyPaid(L, participantId));

    // heures facturées = pack_hours du participant si dispo, sinon longueur
    const any = lessonsToBill[0] || lesson;
    const pmAny = (any.participantsMap || {})[String(participantId)] || {};
    const h = Number(pmAny.pack_hours || any.pack_hours || lessonsToBill.length || 1);
    // Plafond pack à 10h : empêche un total facturé incohérent si beaucoup de
    // leçons sont regroupées sous une même clé pack.
    billedHours = (h === 5 || h === 10) ? h : Math.min(lessonsToBill.length || 1, 10);
  } else {
    // 1 leçon
    if (!isEligibleToPay(lesson, participantId)) return res.status(400).json({ error: 'NOT_CONFIRMED' });
    if (isAlreadyPaid(lesson, participantId)) return res.status(400).json({ error: 'ALREADY_PAID' });
    billedHours = getBilledHoursFor(lesson, participantId);
  }

  // Calcul montant total
  const rateEuro = computeBaseRateEuroFor(lesson, participantId);
  let teacherAmountCents;
  
  if (packMode) {
    // Utilise le pack_price défini par le prof si disponible
    const packPriceField = billedHours === 10
      ? (lesson.visio_pack10_price ?? lesson.pack10_price)
      : (lesson.visio_pack5_price  ?? lesson.pack5_price);
    const packPriceEuro = toNum(packPriceField);
    
    // Détermine si c'est visio pour choisir le bon champ
    const isVisio = String(lesson.mode) === 'visio' || lesson.is_visio === true;
    const packPrice = isVisio
      ? toNum(billedHours === 10 ? lesson.visio_pack10_price : lesson.visio_pack5_price)
      : toNum(billedHours === 10 ? lesson.pack10_price : lesson.pack5_price);

    teacherAmountCents = packPrice > 0
      ? Math.round(packPrice * 100)                        // prix pack défini par le prof
      : Math.round(rateEuro * billedHours * 0.9 * 100);    // fallback -10% si non renseigné
  } else {
    teacherAmountCents = Math.round(rateEuro * billedHours * 100);
  }

  const siteFeeCents = billedHours * 1000; // 10€ / h
  // Le coupon réduit uniquement la commission plateforme, pas le tarif du prof
  let effectiveSiteFeeCents = siteFeeCents;
  let totalCents = teacherAmountCents + siteFeeCents;
  if (!(totalCents > 0)) return res.status(400).json({ error: 'INVALID_AMOUNT' });

  // ── Coupons (cumul possible) ──────────────────────────────────────────
  let couponDiscountCents = 0;
  let couponDocIds = [];
  let appliedCouponCodes = [];
  let influencerUid = null;
  let influencerCommissionCents = 0;
  let clientIp =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    '';

  if (rawCouponCodes.length > 0) {
    const maxDiscountCents = siteFeeCents; // cours=1000, pack5=5000, pack10=10000

    for (const rawCode of rawCouponCodes) {
      if (!rawCode || typeof rawCode !== 'string') continue;
      const code = rawCode.trim().toUpperCase();
      if (appliedCouponCodes.includes(code)) continue;

      // 1) Chercher dans influencers (max 1 code influenceur par checkout)
      if (!influencerUid) {
        const influSnap = await adminDb
          .collection('influencers')
          .where('code', '==', code)
          .where('active', '==', true)
          .limit(1)
          .get();

        if (!influSnap.empty) {
          const influDoc = influSnap.docs[0];
          const influ = influDoc.data();

          const createdAt = influ.created_at?.toDate?.() || new Date(influ.created_at);
          const expiresAt = new Date(createdAt.getTime() + 6 * 30 * 24 * 60 * 60 * 1000);
          if (expiresAt < new Date()) {
            return res.status(400).json({ error: 'COUPON_EXPIRED', code });
          }

          const usageSelf = await adminDb
            .collection('influencer_usages')
            .where('influencer_uid', '==', influDoc.id)
            .where('payer_uid', '==', payerUid)
            .get();
          if (usageSelf.size >= 2) {
            return res.status(400).json({ error: 'COUPON_MAX_USAGE_REACHED', code });
          }

          if (clientIp) {
            const usageIp = await adminDb
              .collection('influencer_usages')
              .where('influencer_uid', '==', influDoc.id)
              .where('client_ip', '==', clientIp)
              .limit(1)
              .get();
            if (!usageIp.empty) {
              return res.status(400).json({ error: 'COUPON_IP_LIMIT_REACHED', code });
            }
          }

          const isPack = packMode;
          // Pas de contrainte d'ordre cours/pack : la campagne /bac vend des packs
          // directement avec code influenceur. Anti-abus conserve : 2 usages/payeur, 1/IP.

          let discountEur = 0;
          let commissionEur = 0;
          if (!isPack) { discountEur = 5; commissionEur = 5; }
          else if (billedHours === 5) { discountEur = 10; commissionEur = 10; }
          else if (billedHours === 10) { discountEur = 30; commissionEur = 20; }

          influencerUid = influDoc.id;
          influencerCommissionCents = commissionEur * 100;
          couponDiscountCents += discountEur * 100;
          couponDocIds.push(influDoc.id);
          appliedCouponCodes.push(code);
          continue;
        }
      }

      // 2) Chercher dans coupons classiques
      const couponSnap = await adminDb
        .collection('coupons')
        .where('code', '==', code)
        .where('user_uid', '==', payerUid)
        .where('used', '==', false)
        .limit(1)
        .get();

      if (couponSnap.empty) {
        return res.status(400).json({ error: 'COUPON_INVALID_OR_USED', code });
      }

      const couponDoc = couponSnap.docs[0];
      const coupon = couponDoc.data();
      const expiresAt = coupon.expires_at?.toDate?.() || new Date(coupon.expires_at);
      if (expiresAt && expiresAt < new Date()) {
        return res.status(400).json({ error: 'COUPON_EXPIRED', code });
      }

      couponDiscountCents += Math.round((coupon.discount_eur || 0) * 100);
      couponDocIds.push(couponDoc.id);
      appliedCouponCodes.push(code);
    }

    // Plafond : la remise totale ne peut JAMAIS depasser la commission plateforme
    if (couponDiscountCents > maxDiscountCents) {
      couponDiscountCents = maxDiscountCents;
    }

    effectiveSiteFeeCents = Math.max(0, siteFeeCents - couponDiscountCents);
    totalCents = teacherAmountCents + effectiveSiteFeeCents;
    if (totalCents < 50) totalCents = 50;
  }
  // ────────────────────────────────────────────────────────────────────

  const source = packMode ? (billedHours === 10 ? 'pack10' : 'pack5') : detectSourceFor(lesson, participantId);
  const lessonIds = lessonsToBill.map(L => String(L.id));

  const origin =
    req.headers?.origin ||
    `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;

  const productName = lesson.subject_id ? `Cours de ${lesson.subject_id}` : 'Cours particulier';
  const couponSuffix = couponDiscountCents > 0 ? ` · Code(s) promo -${couponDiscountCents / 100}€` : '';
  const productDesc =
    (source === 'pack5' ? 'Pack 5h · (prof 90% du total horaire) + 10€ / h site'
    : source === 'pack10' ? 'Pack 10h · (prof 90% du total horaire) + 10€ / h site'
    : source === 'visio' ? 'Visio · (prof 100% horaire) + 10€ site'
    : 'Présentiel · (prof 100% horaire) + 10€ site') + couponSuffix;

  const metadata = {
    lesson_id: String(lesson.id),
    lesson_ids: lessonIds.join(','),
    for_student: String(participantId),
    teacher_uid: String(lesson.teacher_id || ''),
    teacher_amount_cents: String(teacherAmountCents),
    site_fee_cents: String(effectiveSiteFeeCents),
    is_group: String(!!(Array.isArray(lesson?.participant_ids) && lesson.participant_ids.length > 0)),
    payer_uid: String(payerUid || ''),
    lesson_source: source,
    billed_hours: String(billedHours),
    per_hour_site_fee_cents: '1000',
    is_pack: String(packMode ? 1 : 0),
    pack_hours: String(packMode ? billedHours : ''),
    coupon_code: appliedCouponCodes.join(','),
    coupon_doc_id: couponDocIds.join(','),
    coupon_discount_cents: String(couponDiscountCents),
    influencer_uid: influencerUid || '',
    influencer_commission_cents: String(influencerCommissionCents),
    client_ip: clientIp,
  };

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card', 'klarna'],
      locale: 'fr',
      billing_address_collection: 'required',
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: packMode ? `${productName} — ${billedHours}h` : productName,
              description: productDesc
            },
            unit_amount: totalCents,
          },
          quantity: 1,
        },
      ],
      // ⬇️ pas de `currency` ici
      metadata,
      payment_intent_data: { metadata },
      success_url: `${origin}/pay/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/pay/cancel`,
    });
  } catch (e) {
    console.error('stripe.sessions.create error:', e?.message || e);
    captureError(e, { lesson_id: lessonId, payer_uid: payerUid });
    return res.status(400).json({ error: 'STRIPE_CREATE_SESSION_FAILED', detail: String(e?.message || e) });
  }

  // trace “pending”
  await adminDb.collection('payments').doc(session.id).set({
    session_id: session.id,
    lesson_id: String(lesson.id),
    lesson_ids: lessonIds,
    for_student: String(participantId),
    payer_uid: String(payerUid),
    teacher_uid: String(lesson.teacher_id || ''),
    lesson_source: source,
    gross_eur: totalCents / 100,
    fee_eur: effectiveSiteFeeCents / 100,
    net_to_teacher_eur: teacherAmountCents / 100,
    status: 'pending',
    created_at: new Date(),
    billed_hours: String(billedHours),
    is_pack: !!packMode,
  }, { merge: true });

  return res.json({ url: session.url });
}