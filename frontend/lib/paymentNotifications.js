import { auth, db } from './firebase';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
} from 'firebase/firestore';

/**
 * Créé des notifications "payment_due" pour TOUS les participants non-payés d'une leçon confirmée.
 * - Pour un cours individuel:
 *    - notifie le parent si parent_id est présent (avec for_student_id = student_id)
 *    - sinon notifie l'élève (si c’est un user)
 * - Pour un cours groupé:
 *    - notifie chaque participant (user) ET le parent trouvé dans participantsMap[pid].parent_id (si présent)
 *    - chaque notif est spécifique à un élève via "for_student_id"
 *
 * Champs de la notif:
 *   {
 *     type: 'payment_due',
 *     user_id: <destinataire>,
 *     for_student_id: <id élève concerné>,
 *     lesson_id, message, created_at, read:false
 *   }
 */
export async function createPaymentDueNotificationsForLesson(lesson) {
  if (!lesson) return;
  const {
    id: lesson_id,
    is_group,
    participant_ids = [],
    participantsMap = {},
    student_id,
    parent_id,
    subject_id,
    price_per_hour,
    status,
  } = lesson;

  if (status !== 'confirmed') return; // on ne notifie qu'une fois confirmé

  const created_at = serverTimestamp();
  const subject = subject_id || 'Cours';
  const price = Number(price_per_hour || 0) || 0;

  const writes = [];

  if (is_group) {
    // Pour chaque participant
    const uniq = Array.from(new Set(participant_ids.filter(Boolean)));
    for (const sid of uniq) {
      const entry = participantsMap?.[sid] || {};
      const isPaid = !!(entry.is_paid || entry.paid_at);
      if (isPaid) continue;

      const pParent = entry.parent_id || null;

      // Notif au parent (si présent)
      if (pParent) {
        writes.push(
          addDoc(collection(db, 'notifications'), {
            type: 'payment_due',
            user_id: pParent,
            for_student_id: sid,
            lesson_id,
            message: `Paiement en attente pour ${subject} (élève).`,
            price,
            read: false,
            created_at,
          })
        );
      }
      // Notif au participant lui-même (si c'est un user id)
      writes.push(
        addDoc(collection(db, 'notifications'), {
          type: 'payment_due',
          user_id: sid,
          for_student_id: sid,
          lesson_id,
          message: `Paiement en attente pour ${subject}.`,
          price,
          read: false,
          created_at,
        })
      );
    }
  } else {
    // Cours individuel
    const isPaid = !!(lesson.is_paid || lesson.paid_at);
    if (!isPaid && student_id) {
      if (parent_id) {
        // parent
        writes.push(
          addDoc(collection(db, 'notifications'), {
            type: 'payment_due',
            user_id: parent_id,
            for_student_id: student_id,
            lesson_id,
            message: `Paiement en attente pour ${subject} (élève).`,
            price,
            read: false,
            created_at,
          })
        );
      } else {
        // élève (si c'est un user)
        writes.push(
          addDoc(collection(db, 'notifications'), {
            type: 'payment_due',
            user_id: student_id,
            for_student_id: student_id,
            lesson_id,
            message: `Paiement en attente pour ${subject}.`,
            price,
            read: false,
            created_at,
          })
        );
      }
    }
  }

  await Promise.all(writes);
}

/**
 * Nettoie (supprime) les notifications "payment_due" devenues obsolètes
 * pour un utilisateur donné, en vérifiant l'état de paiement réel.
 *
 * Règle:
 *  - si notif.for_student_id est payé (individuel ou participantsMap[for_student_id] pour un groupe),
 *    la notif est supprimée.
 */
export async function autoClearPaymentDueNotifications(userId) {
  if (!userId) return;

  const qNotifs = query(
    collection(db, 'notifications'),
    where('user_id', '==', userId),
    where('type', '==', 'payment_due')
  );
  const snap = await getDocs(qNotifs);

  const deletes = [];

  for (const n of snap.docs) {
    const notif = n.data();
    const lessonId = notif.lesson_id;
    const forStudent = notif.for_student_id;

    if (!lessonId) continue;

    const lSnap = await getDoc(doc(db, 'lessons', lessonId)).catch(() => null);
    if (!lSnap || !lSnap.exists()) {
      // la leçon n'existe plus -> supprimer la notif
      deletes.push(deleteDoc(n.ref));
      continue;
    }
    const l = lSnap.data();

    let paid = false;
    if (l.is_group) {
      const entry = (l.participantsMap || {})[forStudent];
      paid = !!(entry && (entry.is_paid || entry.paid_at));
    } else {
      paid = !!(l.is_paid || l.paid_at);
    }

    if (paid) {
      deletes.push(deleteDoc(n.ref));
    }
  }

  if (deletes.length) {
    await Promise.allSettled(deletes);
  }
}