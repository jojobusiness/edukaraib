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
      if (d.user_id) out.add(String(d.user_id));
      if (d.uid) out.add(String(d.uid));
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

// ----------------------------------------------------------------------------

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const auth = await verifyAuth(req, res);
  if (!auth) return;
  const uid = auth.uid;

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
  const payerIsStudent = aliases.some((a) => String(a) === String(uid));
  const payerIsParent =
    (lesson.participantsMap?.[participantId]?.parent_id &&
      String(lesson.participantsMap[participantId].parent_id) === String(uid)) ||
    (lesson.parent_id && String(lesson.parent_id) === String(uid));
  if (!payerIsStudent && !payerIsParent) {
    return res.status(403).json({ error: 'NOT_ALLOWED' });
  }

  // Déjà payé ?
  if (isAlreadyPaid(lesson, participantId)) {
    return res.status(400).json({ error: 'ALREADY_PAID' });
  }

  // Éligible ?
  const isGroup = Array.isArray(lesson?.participant_ids) && lesson.participant_ids.length > 0;
  if (isGroup) {
    const st = participantStatus(lesson, participantId);
    if (!(st === 'accepted' || st === 'confirmed')) {
      return res.status(400).json({ error: 'PARTICIPANT_NOT_CONFIRMED' });
    }
  } else {
    if (lesson.status !== 'confirmed') {
      return res.status(400).json({ error: 'LESSON_NOT_CONFIRMED' });
    }
  }

  // Montant = prof + 10€
  const pricePerHour = toNum(lesson.price_per_hour);
  const hours = toNum(lesson.duration_hours) || 1;
  const teacherAmountCents = Math.max(0, Math.round(pricePerHour * hours * 100));
  const siteFeeCents = 1000; // +10€
  const totalCents = teacherAmountCents + siteFeeCents;
  if (!(totalCents > 0)) return res.status(400).json({ error: 'INVALID_AMOUNT' });

  // Transfert vers le compte du prof (si connecté)
  let transferData = undefined;
  try {
    if (lesson.teacher_id && teacherAmountCents > 0) {
      const u = await adminDb.collection('users').doc(String(lesson.teacher_id)).get();
      if (u.exists) {
        const d = u.data();
        if (d?.stripeAccountId) {
          transferData = { destination: d.stripeAccountId, amount: teacherAmountCents };
        }
      }
    }
  } catch {}

  // URLs
  const origin =
    req.headers?.origin ||
    `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;

  // Session Checkout
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'eur',
          product_data: {
            name: lesson.subject_id ? `Cours de ${lesson.subject_id}` : 'Cours particulier',
            description: 'Montant professeur + 10€ de frais plateforme',
          },
          unit_amount: totalCents,
        },
        quantity: 1,
      },
    ],
    metadata: {
      lesson_id: String(lessonId),
      for_student: String(participantId), // identifiant normalisé qui MATCHE la leçon
      teacher_amount_cents: String(teacherAmountCents),
      site_fee_cents: String(siteFeeCents),
      is_group: String(!!isGroup),
    },
    ...(transferData ? { payment_intent_data: { transfer_data: transferData } } : {}),
    success_url: `${origin}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/payment-cancel`,
  });

  return res.json({ url: session.url });
}