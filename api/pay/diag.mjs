import { adminDb, verifyAuth } from '../_firebaseAdmin.mjs';

// body parser tolérant (Vercel peut déjà parser selon headers)
function readBody(req) {
  try {
    if (req.body == null) return {};
    if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
    return req.body;
  } catch {
    return {};
  }
}

const toNum = (v) => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  // 1) Auth Firebase
  const auth = await verifyAuth(req, res);
  if (!auth) return; // verifyAuth a déjà renvoyé 401 si besoin
  const uid = auth.uid;

  // 2) Body
  const { lessonId, forStudent } = readBody(req);
  if (!lessonId) return res.status(400).json({ ok: false, error: 'MISSING_LESSON_ID' });

  // 3) Récupération de la leçon
  const snap = await adminDb.collection('lessons').doc(lessonId).get();
  if (!snap.exists) return res.status(404).json({ ok: false, error: 'LESSON_NOT_FOUND' });
  const lesson = snap.data();

  // 4) Déterminer le participant ciblé
  let targetStudent = forStudent || lesson.student_id || null;
  const isGroup = Array.isArray(lesson.participant_ids) && lesson.participant_ids.length > 0;

  if (isGroup && !targetStudent) {
    // si l'utilisateur est lui-même élève et présent dans le groupe, on peut l’inférer
    if (lesson.participant_ids.includes(uid)) {
      targetStudent = uid;
    } else {
      return res.json({ ok: false, error: 'FOR_STUDENT_REQUIRED' });
    }
  }
  if (!targetStudent) {
    return res.json({ ok: false, error: 'STUDENT_NOT_RESOLVED' });
  }

  // 5) Vérifier que cet élève est bien inscrit à la leçon
  const isParticipant = isGroup
    ? lesson.participant_ids.includes(targetStudent)
    : (!lesson.participant_ids && lesson.student_id === targetStudent);

  if (!isParticipant) {
    return res.json({ ok: false, error: 'Élève non inscrit à ce cours' });
  }

  // 6) Contrôle d’accès payeur :
  //    - l’élève lui-même
  //    - ou le parent associé au participant (participantsMap[target].parent_id)
  //    - ou (legacy) lesson.parent_id (si réservé pour enfant)
  const payerIsStudent = uid === targetStudent;
  const payerIsParent =
    (lesson.participantsMap?.[targetStudent]?.parent_id && lesson.participantsMap[targetStudent].parent_id === uid) ||
    (lesson.parent_id && lesson.parent_id === uid);

  if (!payerIsStudent && !payerIsParent) {
    return res.status(403).json({ ok: false, error: 'NOT_ALLOWED' });
  }

  // 7) Déjà payé ?
  const alreadyPaid =
    lesson.participantsMap?.[targetStudent]?.is_paid ??
    (lesson.student_id === targetStudent ? lesson.is_paid : false);

  if (alreadyPaid) {
    return res.json({ ok: false, error: 'Déjà payé' });
  }

  // 8) Éligible au paiement ?
  if (isGroup) {
    const st = lesson?.participantsMap?.[targetStudent]?.status;
    const ok = st === 'accepted' || st === 'confirmed';
    if (!ok) return res.json({ ok: false, error: 'Participant non confirmé' });
  } else {
    if (lesson.status !== 'confirmed') {
      return res.json({ ok: false, error: 'Leçon non confirmée' });
    }
  }

  // 9) Montant OK ?
  const pricePerHour = toNum(lesson.price_per_hour);
  const hours = toNum(lesson.duration_hours) || 1;
  const grossCents = Math.round(pricePerHour * hours * 100);
  if (!(grossCents > 0)) {
    return res.json({ ok: false, error: 'Montant invalide' });
  }

  return res.json({ ok: true });
}