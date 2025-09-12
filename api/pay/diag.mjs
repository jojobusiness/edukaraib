import { adminDb, verifyAuth } from '../_firebaseAdmin.mjs';

// ---- utils lecture body -----------------------------------------------------
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

// ---- helpers d'équivalence d'identifiants ----------------------------------
// On accepte qu'un "élève" soit identifié par :
// - id du document "students" (ex: abc123)
// - son user_id / uid (dans le doc student)
// - un uid de user directement
async function resolveEquivalentStudentIds(targetId) {
  const out = new Set([String(targetId)]);

  // 1) Si targetId est un id de doc students
  try {
    const st = await adminDb.collection('students').doc(String(targetId)).get();
    if (st.exists) {
      const d = st.data() || {};
      if (d.user_id) out.add(String(d.user_id));
      if (d.uid) out.add(String(d.uid));
    }
  } catch {}

  // 2) Si targetId est potentiellement un user_id -> retrouver le doc student
  try {
    const q = await adminDb
      .collection('students')
      .where('user_id', '==', String(targetId))
      .limit(1)
      .get();
    if (!q.empty) {
      const doc = q.docs[0];
      out.add(String(doc.id));
      const d = doc.data() || {};
      if (d.uid) out.add(String(d.uid));
      if (d.user_id) out.add(String(d.user_id));
    }
  } catch {}

  // 3) Si targetId correspond à un uid stocké dans students.uid
  try {
    const q = await adminDb
      .collection('students')
      .where('uid', '==', String(targetId))
      .limit(1)
      .get();
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

/** Retourne:
 *  - participantIdNormalisé si l'élève est bien lié à la leçon
 *  - null sinon
 */
function resolveParticipantInLesson(lesson, aliases) {
  const pm = lesson?.participantsMap || {};
  const isGroup = Array.isArray(lesson?.participant_ids) && lesson.participant_ids.length > 0;

  if (isGroup) {
    // 1) via participant_ids
    const hitArray = anyAliasInArray(aliases, lesson.participant_ids);
    if (hitArray) return String(hitArray);
    // 2) via participantsMap keys
    const hitMap = anyAliasInObjectKeys(aliases, pm);
    if (hitMap) return String(hitMap);
    return null;
  }

  // Cours individuel :
  // même si participant_ids existe (souvent vide), on compare avec student_id
  if (lesson.student_id && aliases.some((a) => String(a) === String(lesson.student_id))) {
    return String(lesson.student_id);
  }

  // quelques cours individuels peuvent stocker le participant dans participantsMap
  const hitMap = anyAliasInObjectKeys(aliases, pm);
  if (hitMap) return String(hitMap);

  return null;
}

function isAlreadyPaid(lesson, participantId) {
  const pm = lesson?.participantsMap || {};
  const isGroup = Array.isArray(lesson?.participant_ids) && lesson.participant_ids.length > 0;

  if (isGroup) {
    return !!pm?.[participantId]?.is_paid;
  }
  // individuel
  if (String(lesson.student_id) === String(participantId)) {
    return !!lesson.is_paid;
  }
  // fallback (rare)
  return !!pm?.[participantId]?.is_paid;
}

function participantStatus(lesson, participantId) {
  return lesson?.participantsMap?.[participantId]?.status || null;
}

// -----------------------------------------------------------------------------

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  // 1) Auth Firebase
  const auth = await verifyAuth(req, res);
  if (!auth) return; // 401 déjà renvoyé si besoin
  const uid = auth.uid;

  // 2) Body
  const { lessonId, forStudent } = readBody(req);
  if (!lessonId) return res.status(400).json({ ok: false, error: 'MISSING_LESSON_ID' });

  // 3) Récupération de la leçon
  const snap = await adminDb.collection('lessons').doc(String(lessonId)).get();
  if (!snap.exists) return res.status(404).json({ ok: false, error: 'LESSON_NOT_FOUND' });
  const lesson = snap.data();

  // 4) Déterminer le participant ciblé (aliases)
  const rawTarget = forStudent || lesson.student_id || null;
  if (!rawTarget) return res.json({ ok: false, error: 'STUDENT_NOT_RESOLVED' });
  const aliases = await resolveEquivalentStudentIds(String(rawTarget));

  // 5) Vérifier que cet élève est bien rattaché à la leçon (tolérant)
  const participantId = resolveParticipantInLesson(lesson, aliases);
  if (!participantId) {
    return res.json({ ok: false, error: 'Élève non inscrit à ce cours' });
  }

  // 6) Contrôle d’accès payeur :
  //    - l’élève lui-même
  //    - ou le parent associé au participant (participantsMap[participantId].parent_id)
  //    - ou (legacy) lesson.parent_id (si réservé pour enfant)
  const payerIsStudent = aliases.some((a) => String(a) === String(uid));
  const payerIsParent =
    (lesson.participantsMap?.[participantId]?.parent_id &&
      String(lesson.participantsMap[participantId].parent_id) === String(uid)) ||
    (lesson.parent_id && String(lesson.parent_id) === String(uid));

  if (!payerIsStudent && !payerIsParent) {
    return res.status(403).json({ ok: false, error: 'NOT_ALLOWED' });
  }

  // 7) Déjà payé ?
  if (isAlreadyPaid(lesson, participantId)) {
    return res.json({ ok: false, error: 'Déjà payé' });
  }

  // 8) Éligible au paiement ?
  const isGroup = Array.isArray(lesson?.participant_ids) && lesson.participant_ids.length > 0;
  if (isGroup) {
    const st = participantStatus(lesson, participantId);
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

  // Tout est bon
  return res.json({ ok: true, participantId });
}