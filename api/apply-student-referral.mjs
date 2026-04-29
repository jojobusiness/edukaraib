// apply-student-referral.mjs
// Appelé à l'inscription d'un nouvel élève/parent avec un code parrainage student.
// Ne requiert PAS d'authentification (appelé juste après inscription, token non encore prêt).

import { adminDb } from './_firebaseAdmin.mjs';
import { FieldValue } from 'firebase-admin/firestore';

function readBody(req) {
  try {
    if (!req.body) return {};
    if (typeof req.body === 'string') return JSON.parse(req.body);
    return req.body;
  } catch { return {}; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });

  const { referralCode, newUserUid, newUserEmail, newUserName } = readBody(req);
  if (!referralCode || !newUserUid) {
    return res.status(400).json({ ok: false, error: 'MISSING_FIELDS' });
  }

  const code = String(referralCode).trim().toUpperCase();

  try {
    // 1) Trouver le parrain via son code student (format REF-XXXXXX)
    const snap = await adminDb
      .collection('users')
      .where('studentReferralCode', '==', code)
      .limit(1)
      .get();

    if (snap.empty) {
      return res.status(404).json({ ok: false, error: 'CODE_NOT_FOUND' });
    }

    const parrainDoc = snap.docs[0];
    const parrainUid = parrainDoc.id;

    if (parrainUid === newUserUid) {
      return res.status(400).json({ ok: false, error: 'SELF_REFERRAL' });
    }

    // 2) Vérifier que le filleul n'a pas déjà un parrain student
    const filleulRef = adminDb.collection('users').doc(newUserUid);
    const filleulSnap = await filleulRef.get();
    if (filleulSnap.exists && filleulSnap.data()?.studentReferredBy) {
      return res.status(400).json({ ok: false, error: 'ALREADY_REFERRED' });
    }

    // 3) Enregistrer le lien parrain → filleul
    await filleulRef.set({
      studentReferredBy: parrainUid,
      studentReferredByCode: code,
      studentReferredAt: new Date(),
    }, { merge: true });

    // 4) Ajouter dans la liste du parrain via arrayUnion
    await adminDb.collection('users').doc(parrainUid).update({
      studentReferralFilleuls: FieldValue.arrayUnion({
        uid: newUserUid,
        email: newUserEmail || '',
        name: newUserName || '',
        joinedAt: new Date().toISOString(),
      }),
    });

    return res.json({ ok: true });

  } catch (e) {
    console.error('[apply-student-referral] error:', e);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
}
