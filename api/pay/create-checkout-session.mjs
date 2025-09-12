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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const auth = await verifyAuth(req, res);
  if (!auth) return;
  const uid = auth.uid;

  const { lessonId, forStudent } = readBody(req);
  if (!lessonId) return res.status(400).json({ error: 'MISSING_LESSON_ID' });

  // Charge la leçon
  const snap = await adminDb.collection('lessons').doc(lessonId).get();
  if (!snap.exists) return res.status(404).json({ error: 'LESSON_NOT_FOUND' });
  const lesson = snap.data();

  // Déterminer le participant ciblé
  let targetStudent = forStudent || lesson.student_id || null;
  const isGroup = Array.isArray(lesson.participant_ids) && lesson.participant_ids.length > 0;

  if (isGroup && !targetStudent) {
    // si payeur est l’élève, on peut l’inférer
    if (lesson.participant_ids.includes(uid)) {
      targetStudent = uid;
    } else {
      return res.status(400).json({ error: 'FOR_STUDENT_REQUIRED' });
    }
  }
  if (!targetStudent) {
    return res.status(400).json({ error: 'STUDENT_NOT_RESOLVED' });
  }

  // Vérifie qu'il est bien participant
  const isParticipant = isGroup
    ? lesson.participant_ids.includes(targetStudent)
    : (lesson.student_id === targetStudent);

  if (!isParticipant) {
    return res.status(403).json({ error: 'NOT_PARTICIPANT' });
  }

  // Éligibilité au paiement
  // - Individuel : leçon confirmée
  // - Groupe     : participant accepted/confirmed (même si la leçon entière n'est pas "confirmed")
  const participantStatus = lesson?.participantsMap?.[targetStudent]?.status;
  const participantPaid =
    lesson?.participantsMap?.[targetStudent]?.is_paid ??
    (lesson.student_id === targetStudent ? lesson.is_paid : false);

  if (participantPaid) {
    return res.status(400).json({ error: 'ALREADY_PAID' });
  }

  if (isGroup) {
    const ok = participantStatus === 'accepted' || participantStatus === 'confirmed';
    if (!ok) {
      return res.status(400).json({ error: 'PARTICIPANT_NOT_CONFIRMED' });
    }
  } else {
    if (lesson.status !== 'confirmed') {
      return res.status(400).json({ error: 'LESSON_NOT_CONFIRMED' });
    }
  }

  // Montants
  const pricePerHour = toNum(lesson.price_per_hour);
  const hours = toNum(lesson.duration_hours) || 1;
  const teacherAmountCents = Math.max(0, Math.round(pricePerHour * hours * 100)); // ce que le prof doit toucher
  const siteFeeCents = 1000; // +10€ fixes
  const totalCents = teacherAmountCents + siteFeeCents;

  if (!(totalCents > 0)) {
    return res.status(400).json({ error: 'INVALID_AMOUNT' });
  }

  // Récupère (si dispo) le compte Stripe du prof pour transfert
  let transferData = undefined;
  try {
    if (lesson.teacher_id && teacherAmountCents > 0) {
      const u = await adminDb.collection('users').doc(lesson.teacher_id).get();
      if (u.exists) {
        const d = u.data();
        if (d?.stripeAccountId) {
          // destination charge : on transfère exactement le montant prof au compte connecté
          transferData = {
            destination: d.stripeAccountId,
            amount: teacherAmountCents,
          };
        }
      }
    }
  } catch {
    // silencieux
  }

  // URLs
  const origin =
    req.headers?.origin ||
    `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;

  // Crée la session Checkout
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
      lesson_id: lessonId,
      for_student: String(targetStudent),
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