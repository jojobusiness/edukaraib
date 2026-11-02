// GET /api/partner-stats — clics, inscrits, cours payés par code (02/11/2026).
// Le partenaire voit les siens, l'admin ceux de tout le monde. Des NOMBRES
// seulement : jamais l'identité d'une famille ou d'un enfant.
import { adminDb, verifyAuth } from './_firebaseAdmin.mjs';
import { PARTNERS_COLLECTION, resumePartenaire } from './_partners.mjs';

async function inscritsDe(code, partnerId) {
  if (!code) return 0;
  const [a, b] = await Promise.all([
    adminDb.collection('users').where('acquisition.code', '==', code).get(),
    adminDb.collection('users').where('code_campagne', '==', code).get(),
  ]);
  const ids = new Set([...a.docs, ...b.docs].map((d) => d.id));
  ids.delete(partnerId);
  return ids.size;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  const auth = await verifyAuth(req, res);
  if (!auth) return;
  res.setHeader('Cache-Control', 'no-store');
  try {
    const moi = await adminDb.collection('users').doc(auth.uid).get();
    const docs = moi.data()?.role === 'admin'
      ? (await adminDb.collection(PARTNERS_COLLECTION).get()).docs
      : [await adminDb.collection(PARTNERS_COLLECTION).doc(auth.uid).get()].filter((d) => d.exists);
    const stats = {};
    await Promise.all(docs.map(async (d) => {
      const p = d.data();
      stats[d.id] = resumePartenaire(p, await inscritsDe(p.code, d.id));
    }));
    return res.status(200).json({ stats });
  } catch (e) {
    console.error('[partner-stats]', e?.message || e);
    return res.status(500).json({ error: 'INTERNAL' });
  }
}
