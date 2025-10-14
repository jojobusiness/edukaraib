// release-payouts-cron.mjs
// -----------------------------------------------------------------------------
// Cloud Function / Cron job : libère l'argent au prof quand l'heure du cours
// est atteinte (Option A - payouts différés).
// -----------------------------------------------------------------------------

import { stripe } from './api/_stripe.mjs';
import { adminDb } from './api/_firebaseAdmin.mjs';

/**
 * Récupère un Date js à partir d'un champ Firestore qui peut être:
 * - Timestamp (avec toDate)
 * - { seconds: number }
 * - directement un Date
 */
function coerceToDate(tsLike) {
  if (!tsLike) return null;
  if (typeof tsLike.toDate === 'function') {
    try { return tsLike.toDate(); } catch {}
  }
  if (typeof tsLike.seconds === 'number') {
    return new Date(tsLike.seconds * 1000);
  }
  if (tsLike instanceof Date) return tsLike;
  return null;
}

/**
 * Retourne true si le cours a démarré (start_datetime <= now)
 */
function lessonHasStarted(lessonDoc) {
  const start = coerceToDate(lessonDoc?.start_datetime);
  if (!start) return false;
  const now = new Date();
  return start.getTime() <= now.getTime();
}

/**
 * Libère les paiements "held" si la leçon a commencé
 * À appeler depuis une Cloud Function planifiée (ex: toutes les 10 minutes).
 */
export async function releaseDuePayouts(req, res) {
  // Si tu l'exposes aussi en HTTP, tu peux protéger par clé secrète ici :
  // if (req && process.env.CRON_SECRET && req.headers['x-cron-key'] !== process.env.CRON_SECRET) {
  //   return res.status(403).json({ error: 'FORBIDDEN' });
  // }

  const batchSize = 50; // traite par lot
  let processed = 0;
  let released = 0;
  let skipped = 0;
  let errors = 0;

  try {
    // 1) Récupérer les paiements "held"
    const snap = await adminDb.collection('payments')
      .where('status', '==', 'held')
      .limit(batchSize)
      .get();

    if (snap.empty) {
      if (res) return res.json({ processed, released, skipped, errors });
      return;
    }

    for (const doc of snap.docs) {
      processed += 1;
      const pay = { id: doc.id, ...doc.data() };

      try {
        // Déjà libéré ?
        if (pay.transfer_id || pay.status === 'released') { skipped += 1; continue; }

        // Charger la leçon
        const lessonRef = adminDb.collection('lessons').doc(String(pay.lesson_id));
        const lessonSnap = await lessonRef.get();
        if (!lessonSnap.exists) { skipped += 1; continue; }
        const lesson = { id: lessonSnap.id, ...lessonSnap.data() };

        // Si la leçon n'a pas encore commencé -> on attend
        if (!lessonHasStarted(lesson)) { skipped += 1; continue; }

        // Compte Stripe Connect du prof (doit être stocké côté "users")
        let teacherAccount = pay.teacher_account || null;
        if (!teacherAccount && pay.teacher_uid) {
          const teacherUser = await adminDb.collection('users').doc(String(pay.teacher_uid)).get();
          if (teacherUser.exists) {
            const d = teacherUser.data() || {};
            teacherAccount = d.stripeAccountId || d.stripe_account_id || null;
          }
        }
        if (!teacherAccount) {
          // Pas de compte connect — on ne peut pas transférer; on note l'erreur et on continue
          await doc.ref.set({ last_release_error: 'MISSING_TEACHER_ACCOUNT' }, { merge: true });
          errors += 1;
          continue;
        }

        // Montant net à transférer au prof
        const netEur = Number(pay.net_to_teacher_eur || 0);
        const amountCents = Math.round(netEur * 100);
        if (!(amountCents > 0)) {
          // Rien à verser — marquer quand même "released"
          await doc.ref.set({
            status: 'released',
            released_at: new Date(),
            transfer_id: null,
            transfer_amount_eur: 0,
          }, { merge: true });
          released += 1;
          continue;
        }

        // 2) Transfer vers le compte connect du prof
        const transfer = await stripe.transfers.create({
          amount: amountCents,
          currency: 'eur',
          destination: teacherAccount,
          transfer_group: `lesson_${pay.lesson_id}`,
          metadata: {
            lesson_id: String(pay.lesson_id || ''),
            payment_id: String(pay.id || ''),
            for_student: String(pay.for_student || ''),
            teacher_uid: String(pay.teacher_uid || ''),
          },
        });

        // 3) Marquer payment -> released
        await doc.ref.set({
          status: 'released',
          released_at: new Date(),
          transfer_id: transfer.id,
          transfer_amount_eur: amountCents / 100,
        }, { merge: true });

        released += 1;

      } catch (e) {
        console.error('release error for payment', pay.id, e);
        await doc.ref.set({ last_release_error: String(e) }, { merge: true });
        errors += 1;
      }
    }

    if (res) return res.json({ processed, released, skipped, errors });
  } catch (e) {
    console.error('releaseDuePayouts fatal:', e);
    if (res) return res.status(500).json({ error: 'release_failed', processed, released, skipped, errors });
  }
}