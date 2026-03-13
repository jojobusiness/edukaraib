// api/apply-referral.js
// ─────────────────────────────────────────────────────────────────────────────
// Appelé à l'inscription d'un nouveau prof qui a saisi un code parrain.
// Vérifie que le code existe, qu'il appartient à un prof actif, et enregistre
// le lien parrain ↔ filleul dans Firestore.
// ─────────────────────────────────────────────────────────────────────────────

import { adminDb } from './_firebaseAdmin.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const { referralCode, newTeacherUid, newTeacherEmail, newTeacherName } = req.body || {};

  if (!referralCode || !newTeacherUid) {
    return res.status(400).json({ ok: false, error: 'MISSING_FIELDS' });
  }

  const code = String(referralCode).trim().toUpperCase();

  try {
    // 1) Trouver le parrain via son code dans users
    const parrainsSnap = await adminDb
      .collection('users')
      .where('referralCode', '==', code)
      .where('role', '==', 'teacher')
      .limit(1)
      .get();

    if (parrainsSnap.empty) {
      return res.status(404).json({ ok: false, error: 'CODE_NOT_FOUND' });
    }

    const parrainDoc = parrainsSnap.docs[0];
    const parrainUid = parrainDoc.id;
    const parrainData = parrainDoc.data();

    // 2) Empêcher l'auto-parrainage
    if (parrainUid === newTeacherUid) {
      return res.status(400).json({ ok: false, error: 'SELF_REFERRAL' });
    }

    // 3) Vérifier que le filleul n'a pas déjà un parrain
    const filleulRef = adminDb.collection('users').doc(newTeacherUid);
    const filleulSnap = await filleulRef.get();
    if (filleulSnap.exists && filleulSnap.data()?.referredBy) {
      return res.status(400).json({ ok: false, error: 'ALREADY_REFERRED' });
    }

    // 4) Enregistrer le lien sur le filleul
    await filleulRef.set({
      referredBy: parrainUid,
      referredByCode: code,
      referredAt: new Date(),
    }, { merge: true });

    // 5) Ajouter le filleul dans la liste du parrain
    const parrainRef = adminDb.collection('users').doc(parrainUid);
    const filleuls = parrainData.referralFilleuls || [];
    filleuls.push({
      uid: newTeacherUid,
      email: newTeacherEmail || '',
      name: newTeacherName || '',
      joinedAt: new Date(),
      firstCoursePaid: false,
      firstPackPaid: false,
    });
    await parrainRef.set({ referralFilleuls: filleuls }, { merge: true });

    return res.status(200).json({ ok: true, parrainName: parrainData.firstName || parrainData.fullName || '' });

  } catch (e) {
    console.error('[apply-referral] error:', e);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
}
