import { getAdminDb } from './_firebaseAdmin.mjs';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const APP_BASE_URL = process.env.APP_BASE_URL || 'https://edukaraib.com';

export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(500).json({ error: 'SERVER_MISCONFIGURED' });

  const key = req.headers['x-cron-key'] || req.query?.key;
  if (key !== secret) return res.status(403).json({ error: 'FORBIDDEN' });

  const db = getAdminDb();
  const now = Date.now();
  // Fenetre : cours qui commencent entre 20min et 40min à partir de maintenant
  const from = new Date(now + 20 * 60 * 1000);
  const to   = new Date(now + 40 * 60 * 1000);

  // On cherche les leçons avec startAt dans cette fenêtre, pas encore rappelées
  const snap = await db.collection('lessons')
    .where('startAt', '>=', from)
    .where('startAt', '<=', to)
    .where('reminder_sent', '==', false)
    .get();

  // Leçons sans le champ reminder_sent (créées avant cette feature)
  const snap2 = await db.collection('lessons')
    .where('startAt', '>=', from)
    .where('startAt', '<=', to)
    .get();

  const docs = new Map();
  snap.docs.forEach(d => docs.set(d.id, d));
  snap2.docs.forEach(d => {
    if (d.data().reminder_sent === undefined) docs.set(d.id, d);
  });

  let sent = 0;
  const errors = [];

  for (const [lessonId, doc] of docs) {
    const lesson = doc.data();
    if (lesson.reminder_sent) continue;

    const status = String(lesson.status || '').toLowerCase();
    if (['rejected', 'removed', 'deleted', 'cancelled'].includes(status)) continue;

    // Marquer immédiatement pour éviter les doublons si le cron tourne en parallèle
    await doc.ref.update({ reminder_sent: true });

    const participantIds = Array.isArray(lesson.participant_ids)
      ? lesson.participant_ids
      : lesson.student_id ? [lesson.student_id] : [];

    for (const uid of participantIds) {
      try {
        const userSnap = await db.collection('users').doc(uid).get();
        const email = userSnap.exists ? userSnap.data()?.email : null;
        const name = userSnap.exists
          ? (userSnap.data()?.fullName || userSnap.data()?.firstName || 'Élève')
          : 'Élève';

        if (!email) continue;

        const startAt = lesson.startAt?.toDate ? lesson.startAt.toDate() : new Date(lesson.startAt);
        const timeStr = startAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        const dateStr = startAt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

        const subject = Array.isArray(lesson.subject_id) ? lesson.subject_id.join(', ') : (lesson.subject_id || 'votre cours');
        const mode = lesson.mode === 'visio' ? 'en visio' : 'en présentiel';

        await resend.emails.send({
          from: 'EduKaraib <noreply@edukaraib.com>',
          to: email,
          subject: `Rappel : votre cours commence dans 30 minutes`,
          html: `
            <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px">
              <h2 style="color:#4f46e5">Rappel de cours ⏰</h2>
              <p>Bonjour ${name},</p>
              <p>Votre cours de <strong>${subject}</strong> ${mode} commence à <strong>${timeStr}</strong> (${dateStr}).</p>
              ${lesson.mode === 'visio' ? `
                <p style="margin-top:16px">
                  <a href="${APP_BASE_URL}/visio/${lessonId}"
                     style="background:#4f46e5;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">
                    Rejoindre la visio
                  </a>
                </p>
              ` : '<p>Préparez-vous pour votre cours en présentiel.</p>'}
              <p style="margin-top:24px;color:#888;font-size:12px">EduKaraib — la plateforme de soutien scolaire des Caraïbes</p>
            </div>
          `,
        });
        sent++;
      } catch (e) {
        errors.push({ lessonId, uid, error: e.message });
      }
    }
  }

  return res.status(200).json({ processed: docs.size, sent, errors });
}
