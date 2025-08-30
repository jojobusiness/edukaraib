import { adminDb, verifyAuth } from '../_firebaseAdmin.mjs';

function readBody(req) {
  try {
    if (req.body == null) return {};
    if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
    return req.body;
  } catch {
    return {};
  }
}

function toNum(v) {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });

    const { uid } = await verifyAuth(req, res);
    if (!uid) return;

    const body = readBody(req);
    const { lessonId } = body;
    if (!lessonId) return res.status(400).json({ ok:false, error: 'MISSING_LESSON_ID' });

    const lessonSnap = await adminDb.collection('lessons').doc(lessonId).get();
    if (!lessonSnap.exists) return res.status(404).json({ ok:false, error: 'LESSON_NOT_FOUND' });
    const lesson = lessonSnap.data();

    const teacherSnap = await adminDb.collection('users').doc(lesson.teacher_id).get();
    if (!teacherSnap.exists) return res.status(400).json({ ok:false, error: 'TEACHER_NOT_FOUND' });
    const teacher = teacherSnap.data();

    const pricePerHour = toNum(lesson.price_per_hour);
    const hours = toNum(lesson.duration_hours) || 1;
    const grossCents = Math.round(pricePerHour * hours * 100);

    res.json({
      ok: true,
      env: {
        APP_BASE_URL: !!process.env.APP_BASE_URL,
        STRIPE_KEY_SET: !!process.env.STRIPE_SECRET_KEY,
      },
      authUid: uid,
      teacherHasStripe: !!teacher.stripeAccountId,
      amount: { pricePerHour, hours, grossCents },
      lesson: {
        id: lessonId,
        teacher_id: lesson.teacher_id || null,
        student_id: lesson.student_id || null,
        subject_id: lesson.subject_id || null,
      }
    });
  } catch (e) {
    console.error('diag error:', e);
    res.status(500).json({ ok:false, error: e.message });
  }
}