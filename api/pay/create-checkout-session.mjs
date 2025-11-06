import { stripe } from '../_stripe.mjs';
import { adminDb, verifyAuth } from '../_firebaseAdmin.mjs';

function readBody(req) {
  try {
    if (!req.body) return {};
    if (typeof req.body === 'string') return JSON.parse(req.body);
    return req.body;
  } catch {
    return {};
  }
}
const toNum = (v) => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

// ---- mêmes helpers de résolution d'ID que dans diag ------------------------
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
    const q = await adminDb.collection('students').where('user_id', '==', String(targetId)).limit(1).get();
    if (!q.empty) {
      const doc = q.docs[0];
      out.add(String(doc.id));
      const d = doc.data() || {};
      if (d.uid) out.add(String(d.uid));
      if (d.user_id) out.add(String(d.user_id));
    }
  } catch {}
  try {
    const q = await adminDb.collection('students').where('uid', '==', String(targetId)).limit(1).get();
    if (!q.empty) {
      const doc = q.docs[0];
      out.add(String(doc.id));
      const d = doc.data() || {};
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
function isAlreadyPaid(lesson, participantId) {
  const pm = lesson?.participantsMap || {};
  const isGroup = Array.isArray(lesson?.participant_ids) && lesson.participant_ids.length > 0;
  if (isGroup) return !!pm?.[participantId]?.is_paid;
  if (String(lesson.student_id) === String(participantId)) return !!lesson.is_paid;
  return !!pm?.[participantId]?.is_paid;
}
function participantStatus(lesson, participantId) {
  return lesson?.participantsMap?.[participantId]?.status || null;
}

// ---- Détection source & montant -------------------------------------------------
function detectSource(lesson) {
  const packType = String(lesson.pack_type || lesson.booking_kind || lesson.type || '').toLowerCase();
  if (packType === 'pack5' || String(lesson.pack_hours) === '5' || lesson.is_pack5 === true) return 'pack5';
  if (packType === 'pack10' || String(lesson.pack_hours) === '10' || lesson.is_pack10 === true) return 'pack10';
  const isVisio = String(lesson.mode) === 'visio' || lesson.is_visio === true;
  return isVisio ? 'visio' : 'presentiel';
}

function computeBaseRateEuro(lesson) {
  const isVisio = String(lesson.mode) === 'visio' || lesson.is_visio === true;
  const visioSame = lesson.visio_same_rate;
  const visioRate = toNum(lesson.visio_price_per_hour);
  const baseRate = toNum(lesson.price_per_hour);
  if (isVisio && visioSame === false && visioRate > 0) return visioRate;
  return baseRate;
}

/** Calcule le montant *professeur* en CENTIMES pour 1 leçon (hors pack). */
function computeTeacherAmountCents(lesson) {
  const source = detectSource(lesson);
  const hours = toNum(lesson.duration_hours) || 1;

  if (source === 'pack5' || source === 'pack10') {
    const storedTotal =
      toNum(lesson.total_amount) || toNum(lesson.total_price) || toNum(lesson.amount);
    if (storedTotal > 0) return Math.round(storedTotal * 100);
    const baseRate = toNum(lesson.price_per_hour);
    const packHours = source === 'pack5' ? 5 : 10;
    return Math.max(0, Math.round(baseRate * packHours * 100));
  }

  const rate = computeBaseRateEuro(lesson);
  return Math.max(0, Math.round(rate * hours * 100));
}

function getBilledHours(lesson) {
  const packType = String(lesson.pack_type || lesson.booking_kind || lesson.type || '').toLowerCase();
  if (packType === 'pack5' || String(lesson.pack_hours) === '5' || lesson.is_pack5 === true) return 5;
  if (packType === 'pack10' || String(lesson.pack_hours) === '10' || lesson.is_pack10 === true) return 10;
  const h = Number(lesson.duration_hours);
  return Number.isFinite(h) && h > 0 ? Math.floor(h) : 1; // défaut 1h
}

function isPack(lesson) {
  const s = detectSource(lesson);
  return s === 'pack5' || s === 'pack10' || String(lesson.pack_hours) === '5' || String(lesson.pack_hours) === '10' || lesson.is_pack5 === true || lesson.is_pack10 === true;
}
function packHoursOf(lesson) {
  if (String(lesson.pack_hours) === '5' || lesson.is_pack5 === true) return 5;
  if (String(lesson.pack_hours) === '10' || lesson.is_pack10 === true) return 10;
  const pt = String(lesson.pack_type || lesson.booking_kind || lesson.type || '').toLowerCase();
  if (pt === 'pack5') return 5;
  if (pt === 'pack10') return 10;
  return 0;
}

function isEligibleToPay(lesson, participantId) {
  const isGroup = Array.isArray(lesson?.participant_ids) && lesson.participant_ids.length > 0;
  if (isGroup) {
    const st = participantStatus(lesson, participantId);
    return st === 'accepted' || st === 'confirmed';
  }
  return lesson.status === 'confirmed' || lesson.status === 'completed';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const auth = await verifyAuth(req, res);
  if (!auth) return;
  const payerUid = auth.uid;

  const { lessonId, forStudent, packKey } = readBody(req);
  if (!lessonId) return res.status(400).json({ error: 'MISSING_LESSON_ID' });

  // Leçon "pivot"
  const snap = await adminDb.collection('lessons').doc(String(lessonId)).get();
  if (!snap.exists) return res.status(404).json({ error: 'LESSON_NOT_FOUND' });
  const lesson = snap.data();

  // Participant visé
  const rawTarget = forStudent || lesson.student_id || null;
  if (!rawTarget) return res.status(400).json({ error: 'STUDENT_NOT_RESOLVED' });
  const aliases = await resolveEquivalentStudentIds(String(rawTarget));

  const participantId = resolveParticipantInLesson(lesson, aliases);
  if (!participantId) {
    return res.status(403).json({ error: 'NOT_PARTICIPANT' });
  }

  // Accès payeur : élève lui-même ou parent lié
  const payerIsStudent = aliases.some((a) => String(a) === String(payerUid));
  const payerIsParent =
    (lesson.participantsMap?.[participantId]?.parent_id &&
      String(lesson.participantsMap[participantId].parent_id) === String(payerUid)) ||
    (lesson.parent_id && String(lesson.parent_id) === String(payerUid));
  if (!payerIsStudent && !payerIsParent) {
    return res.status(403).json({ error: 'NOT_ALLOWED' });
  }

  // Cas simple : si pas de packKey et pas un pack → paiement à l’unité comme avant
  const origin =
    req.headers?.origin ||
    `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;

  // --------- MODE PACK (paiement groupé) ------------------------------------
  let lessonsToBill = [ { id: String(lessonId), ...lesson } ];
  let packMode = false;
  let effectivePackHours = 0;

  if (packKey || isPack(lesson)) {
    packMode = true;

    // 1) chercher toutes les leçons du même pack/critères
    let candidates = [];
    if (lesson.pack_id) {
      const q = await adminDb
        .collection('lessons')
        .where('teacher_id', '==', String(lesson.teacher_id))
        .where('pack_id', '==', String(lesson.pack_id))
        .get();
      candidates = q.docs.map(d => ({ id: d.id, ...d.data() }));
    } else {
      // fallback : mêmes critères "logiques"
      const q = await adminDb
        .collection('lessons')
        .where('teacher_id', '==', String(lesson.teacher_id))
        .where('subject_id', '==', String(lesson.subject_id || ''))
        .where('mode', '==', String(lesson.mode || 'presentiel'))
        .where('pack_hours', '==', packHoursOf(lesson) || 0)
        .get();
      candidates = q.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    // 2) filtrer pour l’élève/parent ciblé & non payées & éligibles
    const sameStudent = (l) => {
      if (String(l.student_id) === String(participantId)) return true;
      if (Array.isArray(l.participant_ids) && l.participant_ids.map(String).includes(String(participantId))) return true;
      if (l.participantsMap && l.participantsMap[participantId]) return true;
      return false;
    };

    const eligible = candidates.filter(l =>
      isPack(l) &&
      sameStudent(l) &&
      !isAlreadyPaid(l, participantId) &&
      isEligibleToPay(l, participantId)
    );

    // fallback si rien → on reste sur la leçon courante
    lessonsToBill = eligible.length ? eligible : lessonsToBill;
    effectivePackHours = packHoursOf(lessonsToBill[0]) || lessonsToBill.length || 1;
  }

  // Déjà payé ? (si pack → on vérifie s’il reste au moins 1 leçon à payer)
  if (!packMode) {
    if (isAlreadyPaid(lesson, participantId)) {
      return res.status(400).json({ error: 'ALREADY_PAID' });
    }
  } else {
    const anyToPay = lessonsToBill.some(l => !isAlreadyPaid(l, participantId));
    if (!anyToPay) {
      return res.status(400).json({ error: 'ALREADY_PAID' });
    }
  }

  // Eligibilité finale
  if (!packMode) {
    if (!isEligibleToPay(lesson, participantId)) {
      return res.status(400).json({ error: 'NOT_CONFIRMED' });
    }
  } else {
    const allEligible = lessonsToBill.every(l => isEligibleToPay(l, participantId));
    if (!allEligible) {
      return res.status(400).json({ error: 'NOT_CONFIRMED_SOME' });
    }
  }

  // Montant selon source
  let source = detectSource(lesson); // 'presentiel' | 'visio' | 'pack5' | 'pack10'
  let teacherAmountCents;
  let billedHours;
  let isPackPayment = false;
  let lessonIds = [ String(lessonId) ];

  if (!packMode) {
    teacherAmountCents = computeTeacherAmountCents(lesson);
    billedHours = getBilledHours(lesson);
  } else {
    // Paiement PACK (1 seul lien)
    isPackPayment = true;
    lessonIds = lessonsToBill.map(l => String(l.id));

    // base rate à partir de la leçon pivot (les packs doivent être homogènes)
    const baseRateEuro = computeBaseRateEuro(lesson);
    const hours = effectivePackHours > 0 ? effectivePackHours : lessonsToBill.length;
    // Remise pack : 10% => 0.9
    teacherAmountCents = Math.round(baseRateEuro * hours * 0.9 * 100);
    billedHours = hours;

    // ajuster source pack
    const ph = packHoursOf(lesson);
    source = ph === 10 ? 'pack10' : 'pack5';
  }

  const siteFeeCents = billedHours * 1000; // 10€ / heure
  const totalCents = teacherAmountCents + siteFeeCents;
  if (!(totalCents > 0)) return res.status(400).json({ error: 'INVALID_AMOUNT' });

  const productName = lesson.subject_id ? `Cours de ${lesson.subject_id}` : 'Cours particulier';
  const productDesc =
    source === 'pack5' ? 'Pack 5h · Montant professeur + 10€ de frais plateforme'
    : source === 'pack10' ? 'Pack 10h · Montant professeur + 10€ de frais plateforme'
    : source === 'visio' ? 'Visio · Montant professeur + 10€ de frais plateforme'
    : 'Présentiel · Montant professeur + 10€ de frais plateforme';

  // Métadonnées (sur la Session ET sur le PaymentIntent)
  const commonMetadata = {
    lesson_id: String(lessonId),                 // id pivot (utilisé avant)
    lesson_ids: lessonIds.join(','),             // <- NOUVEAU : toutes les leçons ciblées quand pack
    for_student: String(participantId),
    teacher_uid: String(lesson.teacher_id || ''),
    teacher_amount_cents: String(teacherAmountCents),
    site_fee_cents: String(siteFeeCents),
    is_group: String(!!(Array.isArray(lesson?.participant_ids) && lesson.participant_ids.length > 0)),
    payer_uid: String(payerUid || ''),
    lesson_source: source,
    billed_hours: String(billedHours),
    per_hour_site_fee_cents: "1000",
    is_pack: String(isPackPayment ? 1 : 0),      // <- NOUVEAU
    pack_hours: String(isPackPayment ? billedHours : '') // <- NOUVEAU
  };

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'eur',
          product_data: {
            name: isPackPayment ? `${productName} — ${billedHours}h` : productName,
            description: productDesc,
          },
          unit_amount: totalCents,
        },
        quantity: 1,
      },
    ],
    currency: 'eur',
    metadata: commonMetadata,               // lisible depuis checkout.session.completed
    payment_intent_data: { metadata: commonMetadata }, // lisible depuis payment_intent.succeeded
    success_url: `${origin}/pay/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/pay/cancel`,
  });

  // Pré-écrire un suivi "payments" => status 'pending' (passera à 'held' au webhook)
  await adminDb.collection('payments').doc(session.id).set({
    session_id: session.id,
    lesson_id: String(lessonId),
    lesson_ids: lessonIds,                             // <- NOUVEAU
    for_student: String(participantId),
    teacher_uid: String(lesson.teacher_id || ''),
    lesson_source: source,
    gross_eur: totalCents / 100,
    fee_eur: siteFeeCents / 100,
    net_to_teacher_eur: teacherAmountCents / 100,
    status: 'pending',
    created_at: new Date(),
    billed_hours: billedHours,
    is_pack: isPackPayment,
  }, { merge: true });

  return res.json({ url: session.url });
}
