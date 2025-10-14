import { db, authAdmin, bucket, stripe } from './_admin.js';

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
    try {
      const [files] = await bucket.getFiles({ prefix: `uploads/${uid}/` });
      await Promise.all(files.map((f) => f.delete().catch(() => {})));
    } catch {}

    // Firestore
    try {
      const subs = await userRef.listCollections();
      for (const col of subs) {
        await deleteQueryBatch(col, 400);
      }
    } catch {}

    // Collections liées — adapte à ton schéma
    await deleteQueryBatch(db.collection('reservations').where('userId', '==', uid));
    await deleteQueryBatch(db.collection('courses').where('teacherId', '==', uid));
    await deleteQueryBatch(db.collection('threads').where('participants', 'array-contains', uid));

    if (userSnap.exists) await userRef.delete();

    await authAdmin.deleteUser(uid);

    return res.status(200).json({ ok: true, stripeDeleted });
  } catch (e) {
    console.error('Deletion error:', e);
    return res.status(500).json({ ok: false, error: 'Server error during deletion' });
  }
}