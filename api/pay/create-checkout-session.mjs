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

/** Calcule le montant *professeur* en CENTIMES selon la source.
 *  - pack5/pack10 : on prend le total du pack (total_amount/total_price/amount) s'il est déjà stocké.
 *    sinon fallback = prix/h × heures (heures=5 ou 10 si pack_hours présent).
 *  - visio : si visio_price_per_hour est présent et visio_same_rate == false -> utiliser ce tarif.
 *    sinon -> price_per_hour.
 *  - présentiel : price_per_hour.
 */
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

  // visio / présentiel
  let rate = toNum(lesson.price_per_hour);
  if (source === 'visio') {
    const visioSame = lesson.visio_same_rate;
    const visioRate = toNum(lesson.visio_price_per_hour);
    if (visioSame === false && visioRate > 0) rate = visioRate;
  }
  return Math.max(0, Math.round(rate * hours * 100));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const auth = await verifyAuth(req, res);
  if (!auth) return;
  const payerUid = auth.uid;

  const { lessonId, forStudent } = readBody(req);
  if (!lessonId) return res.status(400).json({ error: 'MISSING_LESSON_ID' });

  // Leçon
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

  // Déjà payé ?
  if (isAlreadyPaid(lesson, participantId)) {
    return res.status(400).json({ error: 'ALREADY_PAID' });
  }

  // Éligible à payer ?
  const isGroup = Array.isArray(lesson?.participant_ids) && lesson.participant_ids.length > 0;
  if (isGroup) {
    const st = participantStatus(lesson, participantId);
    if (!(st === 'accepted' || st === 'confirmed')) {
      return res.status(400).json({ error: 'PARTICIPANT_NOT_CONFIRMED' });
    }
  } else {
    if (!(lesson.status === 'confirmed' || lesson.status === 'completed')) {
      return res.status(400).json({ error: 'LESSON_NOT_CONFIRMED' });
    }
  }

  // Montant selon source
  const source = detectSource(lesson);              // 'presentiel' | 'visio' | 'pack5' | 'pack10'
  const teacherAmountCents = computeTeacherAmountCents(lesson);
  const siteFeeCents = 1000; // +10€
  const totalCents = teacherAmountCents + siteFeeCents;
  if (!(totalCents > 0)) return res.status(400).json({ error: 'INVALID_AMOUNT' });

  // URLs
  const origin =
    req.headers?.origin ||
    `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;

  const productName = lesson.subject_id ? `Cours de ${lesson.subject_id}` : 'Cours particulier';
  const productDesc =
    source === 'pack5' ? 'Pack 5h · Montant professeur + 10€ de frais plateforme'
    : source === 'pack10' ? 'Pack 10h · Montant professeur + 10€ de frais plateforme'
    : source === 'visio' ? 'Visio · Montant professeur + 10€ de frais plateforme'
    : 'Présentiel · Montant professeur + 10€ de frais plateforme';

  // Métadonnées (sur la Session ET sur le PaymentIntent)
  const commonMetadata = {
    lesson_id: String(lessonId),
    for_student: String(participantId),           // élève ciblé (clé pour maj participantsMap)
    teacher_uid: String(lesson.teacher_id || ''), // prof
    teacher_amount_cents: String(teacherAmountCents),
    site_fee_cents: String(siteFeeCents),
    is_group: String(!!isGroup),
    payer_uid: String(payerUid || ''),
    lesson_source: source,                         // <- NOUVEAU
  };

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'eur',
          product_data: {
            name: productName,
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
    for_student: String(participantId),
    teacher_uid: String(lesson.teacher_id || ''),
    lesson_source: source,                             // <- NOUVEAU
    gross_eur: totalCents / 100,
    fee_eur: siteFeeCents / 100,
    net_to_teacher_eur: teacherAmountCents / 100,
    status: 'pending',
    created_at: new Date(),
  }, { merge: true });

  return res.json({ url: session.url });
}