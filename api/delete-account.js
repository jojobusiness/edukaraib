// ✅ Migration : import depuis _firebaseAdmin.mjs (singleton unifié)
// _admin.js était un doublon — toute la logique est maintenant dans _firebaseAdmin.mjs
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb as db, authAdmin, bucket, stripe } from './_firebaseAdmin.mjs';

// 23/10/2026 — Ce que fait la suppression d'un compte, et ce qu'elle ne fait plus :
// - elle REFUSE tant qu'un paiement est en cours (prof pas encore payé, ou
//   famille en remboursement) : avant, un prof supprimait son compte Stripe
//   avec de l'argent en attente, et la famille perdait la trace de son paiement ;
// - elle RETIRE le compte des cours collectifs au lieu de supprimer le cours
//   (avant, la réservation des autres élèves disparaissait avec lui) ;
// - elle MASQUE les conversations au lieu de les effacer : la politique de
//   confidentialité garantit 12 mois de conservation (litige, harcèlement),
//   et l'autre personne garde sa copie. La purge des 12 mois s'en charge ;
// - elle supprime aussi les fiches des enfants d'un parent (nom, date de
//   naissance), ses favoris, sa présence, ses diplômes et sa vidéo.
const PAIEMENTS_EN_COURS = ['held', 'processing', 'payout_pending_rib', 'refunding'];

async function deleteQueryBatch(q, batchSize = 400) {
  const snap = await q.limit(batchSize).get();
  if (snap.empty) return;
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  if (snap.size >= batchSize) {
    return deleteQueryBatch(q, batchSize);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return res.status(401).json({ ok: false, error: 'Missing Authorization header' });

  let uid;
  try {
    const decoded = await authAdmin.verifyIdToken(token);
    uid = decoded.uid;
  } catch {
    return res.status(401).json({ ok: false, error: 'Invalid token' });
  }

  try {
    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    const userData = userSnap.exists ? userSnap.data() : {};
    const role = userData?.role || 'student';
    const stripeAccountId = userData?.stripeAccountId || '';

    // Paiement en cours → on ne supprime rien (voir en-tête)
    const [enCoursProf, enCoursFamille] = await Promise.all([
      db.collection('payments').where('teacher_uid', '==', uid).where('status', 'in', PAIEMENTS_EN_COURS).limit(1).get(),
      db.collection('payments').where('payer_uid', '==', uid).where('status', 'in', PAIEMENTS_EN_COURS).limit(1).get(),
    ]);
    if (!enCoursProf.empty || !enCoursFamille.empty) {
      return res.status(409).json({
        ok: false,
        error: 'PAIEMENTS_EN_COURS',
        message: 'Un paiement est encore en cours sur votre compte. Écrivez-nous à contact@edukaraib.com : nous le réglons, puis nous supprimons votre compte.',
      });
    }

    // Stripe
    let stripeDeleted = true;
    if (role === 'teacher' && stripeAccountId) {
      try {
        await stripe.accounts.del(stripeAccountId);
      } catch (e) {
        console.error('Stripe deletion error:', e.message);
        stripeDeleted = false;
      }
    }

    // Storage
    try {
      await bucket.file(`avatars/${uid}`).delete({ ignoreNotFound: true });
    } catch {}
    for (const prefix of [`uploads/${uid}/`, `certificates/${uid}/`, `intro-videos/${uid}.`]) {
      try {
        const [files] = await bucket.getFiles({ prefix });
        await Promise.all(files.map((f) => f.delete().catch(() => {})));
      } catch {}
    }

    // Firestore
    try {
      const subs = await userRef.listCollections();
      for (const col of subs) {
        await deleteQueryBatch(col, 400);
      }
    } catch {}

    // ✅ Collections corrigées selon le schéma réel de l'app
    // Lessons où l'utilisateur est élève (student_id)
    await deleteQueryBatch(db.collection('lessons').where('student_id', '==', uid));
    // Lessons où l'utilisateur est prof (teacher_id)
    await deleteQueryBatch(db.collection('lessons').where('teacher_id', '==', uid));
    // Cours collectifs : on retire le compte, le cours des autres reste
    const groupes = await db.collection('lessons').where('participant_ids', 'array-contains', uid).get();
    for (const g of groupes.docs) {
      const autres = (g.data().participant_ids || []).filter((x) => x !== uid);
      if (!autres.length) { await g.ref.delete(); continue; }
      await g.ref.update({
        participant_ids: FieldValue.arrayRemove(uid),
        acces: FieldValue.arrayRemove(uid),
        [`participantsMap.${uid}`]: FieldValue.delete(),
      });
    }
    // Conversations : masquées, pas effacées (conservation 12 mois, copie de l'autre)
    const convs = await db.collection('conversations').where('participants', 'array-contains', uid).get();
    for (const c of convs.docs) await c.ref.update({ hiddenFor: FieldValue.arrayUnion(uid), compte_supprime: FieldValue.arrayUnion(uid) });
    // Fiches des enfants d'un parent (nom, date de naissance)
    await deleteQueryBatch(db.collection('students').where('parent_id', '==', uid));
    await deleteQueryBatch(db.collection('favorites').where('user_id', '==', uid));
    await db.collection('presence').doc(uid).delete().catch(() => {});
    // Notifications
    await deleteQueryBatch(db.collection('notifications').where('user_id', '==', uid));

    if (userSnap.exists) await userRef.delete();

    await authAdmin.deleteUser(uid);

    return res.status(200).json({ ok: true, stripeDeleted });
  } catch (e) {
    console.error('Deletion error:', e);
    return res.status(500).json({ ok: false, error: 'Server error during deletion' });
  }
}