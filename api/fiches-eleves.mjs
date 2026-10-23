// POST /api/fiches-eleves { ids: [...] } → { fiches: { [id]: {...} } }
// Le nom d'un enfant pour ceux qui partagent un cours avec lui (23/10/2026).
// Règles et raison : api/_fichesEleves.mjs. Une fiche qu'on n'a pas le droit
// de voir est simplement absente de la réponse.
import { adminDb, verifyAuth } from './_firebaseAdmin.mjs';
import { peutVoirEleve, ficheTiers } from './_fichesEleves.mjs';

const MAX_IDS = 50;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  const auth = await verifyAuth(req, res);
  if (!auth) return;

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const ids = [...new Set((body?.ids || []).map(String).filter(Boolean))];
  if (ids.length > MAX_IDS) return res.status(400).json({ error: 'TOO_MANY_IDS' });

  try {
    const moi = await adminDb.collection('users').doc(auth.uid).get();
    const estAdmin = moi.exists && moi.data()?.role === 'admin';
    const fiches = {};
    await Promise.all(ids.map(async (id) => {
      const snap = await adminDb.collection('students').doc(id).get();
      if (!snap.exists) return;
      const eleve = snap.data();
      let lecons = [];
      if (!estAdmin && eleve.parent_id !== auth.uid) {
        const [a, b] = await Promise.all([
          adminDb.collection('lessons').where('student_id', '==', id).get(),
          adminDb.collection('lessons').where('participant_ids', 'array-contains', id).get(),
        ]);
        lecons = [...a.docs, ...b.docs].map((d) => d.data());
      }
      if (peutVoirEleve(auth.uid, eleve, lecons, estAdmin)) fiches[id] = ficheTiers(id, eleve);
    }));
    return res.status(200).json({ fiches });
  } catch (e) {
    console.error('[fiches-eleves]', e?.message || e);
    return res.status(500).json({ error: 'INTERNAL' });
  }
}
