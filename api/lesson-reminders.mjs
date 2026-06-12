import { adminDb } from './_firebaseAdmin.mjs';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const APP_BASE_URL = process.env.APP_BASE_URL || 'https://edukaraib.com';

export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(500).json({ error: 'SERVER_MISCONFIGURED' });

  const authHeader = req.headers.authorization || '';
  const key = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : req.headers['x-cron-secret'];
  if (!key || key !== secret) return res.status(403).json({ error: 'FORBIDDEN' });

  const db = adminDb;
  const now = Date.now();
  // Fenetre : cours qui commencent entre 20min et 40min à partir de maintenant
  const from = new Date(now + 20 * 60 * 1000);
  const to   = new Date(now + 40 * 60 * 1000);

  // On récupère toutes les leçons dont startAt est dans la fenêtre, puis on
  // filtre `reminder_sent` en mémoire (ligne plus bas). Une requête sur le seul
  // range `startAt` n'exige qu'un index simple (auto-créé) ; ajouter
  // `where('reminder_sent','==',false)` imposerait un index composite inexistant
  // → FAILED_PRECONDITION. On évite donc ce 2ᵉ filtre côté Firestore.
  const snap2 = await db.collection('lessons')
    .where('startAt', '>=', from)
    .where('startAt', '<=', to)
    .get();

  const docs = new Map();
  snap2.docs.forEach(d => docs.set(d.id, d));

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

  // ─────────────────────── CYCLE DE VIE DES COURS (serveur) ───────────────────────
  // Avant : cette logique n'existait QUE cote client (TeacherLessons.jsx) et ne
  // s'executait que si le prof avait la page ouverte. Ici : fiable, toutes les 30 min.
  // A) rappel de paiement (cours confirme non paye, avant le debut) — 1 seul envoi
  // B) refus automatique si non paye a l'heure du cours + email
  // C) passage en "completed" (paye, fin + 60 min) — le payout reste declenche
  //    par le prof (bouton) ou par sa page ouverte, comme avant.
  const stats = { payment_reminders: 0, rejected_unpaid: 0, completed: 0 };
  const lcErrors = [];
  try {
    const nowMs = now;
    const lcFrom = new Date(nowMs - 36 * 3600 * 1000);
    const lcTo = new Date(nowMs + 24 * 3600 * 1000);
    const lcSnap = await db.collection('lessons')
      .where('status', '==', 'confirmed')
      .where('startAt', '>=', lcFrom)
      .where('startAt', '<=', lcTo)
      .get();

    const isGroup = (l) =>
      l.is_group === true || (Array.isArray(l.participant_ids) && l.participant_ids.length > 1);
    const ownerOf = (l) => l.student_id || (l.participant_ids || [])[0] || null;
    const entOf = (l, sid) => (l.participantsMap || {})[String(sid)] || {};
    // Heures gratuites (bonus pack, essai) = considerees payees : jamais annulees
    const entPaid = (l, sid) => entOf(l, sid).is_paid === true || entOf(l, sid).is_free_hour === true;
    const indivPaid = (l) =>
      l.is_paid === true || l.is_free_hour === true || (ownerOf(l) && entPaid(l, ownerOf(l)));
    const isAcceptedSt = (st) => st === 'accepted' || st === 'confirmed';

    const emailOf = async (uid) => {
      if (!uid) return null;
      try {
        const s = await db.collection('users').doc(String(uid)).get();
        return s.exists ? (s.data().email || null) : null;
      } catch { return null; }
    };
    // email du participant, sinon de son parent (enfants geres par un parent)
    const recipientEmail = async (l, sid) => {
      const direct = await emailOf(sid);
      if (direct) return direct;
      return emailOf(entOf(l, sid).parent_id);
    };
    const lessonLabel = (l) => {
      const subject = Array.isArray(l.subject_id) ? l.subject_id.join(', ') : (l.subject_id || 'votre cours');
      const d = l.startAt?.toDate ? l.startAt.toDate() : new Date(l.startAt);
      const dateStr = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
      const timeStr = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      return { subject, dateStr, timeStr };
    };
    const sendTpl = async (to, subjectLine, title, message, ctaUrl, ctaText) => {
      await resend.emails.send({
        from: 'EduKaraib <notifications@edukaraib.com>',
        to,
        subject: subjectLine,
        html: `<div style="font-family:Inter,system-ui,Arial,sans-serif;max-width:560px;margin:auto;padding:24px;">
<h2 style="color:#0f172a;font-size:20px;">${title}</h2>
<p style="color:#475569;font-size:15px;line-height:1.7;">${message}</p>
<p style="margin-top:18px;"><a href="${ctaUrl}" style="background:#facc15;color:#111827;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:bold;">${ctaText}</a></p>
<p style="margin-top:24px;color:#94a3b8;font-size:12px;">EduKaraib — la plateforme de soutien scolaire des Caraibes</p>
</div>`,
      });
    };

    for (const d of lcSnap.docs) {
      const l = d.data();
      const startD = l.startAt?.toDate ? l.startAt.toDate() : new Date(l.startAt);
      const startMs = startD?.getTime?.();
      if (!startMs || isNaN(startMs)) continue;
      const durMs = (Number(l.duration_minutes) > 0 ? Number(l.duration_minutes) : 60) * 60 * 1000;
      const completeAtMs = startMs + durMs + 60 * 60 * 1000;
      const group = isGroup(l);
      const pm = l.participantsMap || {};
      const ids = Array.isArray(l.participant_ids) && l.participant_ids.length
        ? l.participant_ids : Object.keys(pm);
      const { subject, dateStr, timeStr } = lessonLabel(l);

      try {
        // C) Fin + 60 min, paye -> completed
        if (nowMs >= completeAtMs) {
          const paid = group
            ? ids.some((sid) => isAcceptedSt(String(entOf(l, sid).status || ''))) &&
              ids.every((sid) => !isAcceptedSt(String(entOf(l, sid).status || '')) || entPaid(l, sid))
            : indivPaid(l);
          if (paid) {
            await d.ref.update({ status: 'completed', completed_at: new Date() });
            stats.completed++;
          }
          continue;
        }

        // B) Cours commence et non paye -> rejete + email
        if (nowMs >= startMs) {
          if (!group) {
            if (!indivPaid(l)) {
              const owner = ownerOf(l);
              const upd = { status: 'rejected' };
              if (owner) upd[`participantsMap.${owner}.status`] = 'rejected';
              await d.ref.update(upd);
              stats.rejected_unpaid++;
              const to = await recipientEmail(l, owner);
              if (to) {
                await sendTpl(to,
                  'Cours annulé — paiement non reçu',
                  'Cours annulé ❌',
                  `Votre cours de <strong>${subject}</strong> du ${dateStr} à ${timeStr} a été automatiquement annulé car le paiement n'a pas été reçu à temps. Vous pouvez refaire une demande ou choisir un autre professeur.`,
                  `${APP_BASE_URL}/smart-dashboard`, 'Voir mes cours');
              }
            }
          } else {
            const rejected = [];
            const newPm = { ...pm };
            for (const sid of ids) {
              const st = String(entOf(l, sid).status || '').toLowerCase();
              if (isAcceptedSt(st) && !entPaid(l, sid)) {
                newPm[sid] = { ...(newPm[sid] || {}), status: 'rejected' };
                rejected.push(sid);
              }
            }
            if (rejected.length) {
              await d.ref.update({ participantsMap: newPm });
              stats.rejected_unpaid += rejected.length;
              for (const sid of rejected) {
                const to = await recipientEmail(l, sid);
                if (to) {
                  await sendTpl(to,
                    'Participation annulée — paiement non reçu',
                    'Participation annulée ❌',
                    `Votre participation au cours de <strong>${subject}</strong> du ${dateStr} à ${timeStr} a été automatiquement annulée car le paiement n'a pas été reçu à temps.`,
                    `${APP_BASE_URL}/smart-dashboard`, 'Voir mes cours');
                }
              }
            }
          }
          continue;
        }

        // A) Cours a venir, non paye, pas encore rappele -> email de rappel paiement
        if (!l.payment_reminder_sent) {
          const unpaidIds = group
            ? ids.filter((sid) => isAcceptedSt(String(entOf(l, sid).status || '')) && !entPaid(l, sid))
            : (indivPaid(l) ? [] : [ownerOf(l)].filter(Boolean));
          if (unpaidIds.length) {
            await d.ref.update({ payment_reminder_sent: true });
            for (const sid of unpaidIds) {
              const to = await recipientEmail(l, sid);
              if (to) {
                await sendTpl(to,
                  `⏳ Pensez à régler votre cours de ${subject}`,
                  'Votre cours n’est pas encore payé ⏳',
                  `Votre cours de <strong>${subject}</strong> est prévu le <strong>${dateStr} à ${timeStr}</strong> mais n'a pas encore été réglé.<br/><br/><strong>Important :</strong> sans paiement avant le début du cours, il sera automatiquement annulé et le créneau libéré.`,
                  `${APP_BASE_URL}/smart-dashboard`, 'Payer mon cours');
                stats.payment_reminders++;
              }
            }
          }
        }
      } catch (e) {
        lcErrors.push({ lessonId: d.id, error: e.message });
      }
    }
  } catch (e) {
    lcErrors.push({ global: e.message });
  }

  return res.status(200).json({ processed: docs.size, sent, errors, lifecycle: stats, lifecycle_errors: lcErrors });
}
