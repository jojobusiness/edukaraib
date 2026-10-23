// POST /api/rejoindre-groupe — rejoindre le cours collectif existant d'un prof
// sur un créneau (23/10/2026). Raison et champs : api/_rejoindreGroupe.mjs.
// Réponse : { status: 'joined_group' | 'duplicate' | 'none', lessonId? }
//   'none' = pas de groupe sur ce créneau → la page crée le cours elle-même.
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, verifyAuth } from './_firebaseAdmin.mjs';
import { ajoutParticipant, demandeInvalide, VALEURS_ADMIN } from './_rejoindreGroupe.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  const auth = await verifyAuth(req, res);
  if (!auth) return;

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = null; } }
  const invalide = demandeInvalide(b);
  if (invalide) return res.status(400).json({ error: invalide });

  const moi = auth.uid;
  const cible = String(b.targetStudentId);
  try {
    // On n'inscrit que soi-même ou son propre enfant
    let pourEnfant = false;
    if (cible !== moi) {
      const fiche = await adminDb.collection('students').doc(cible).get();
      if (!fiche.exists || fiche.data()?.parent_id !== moi) return res.status(403).json({ error: 'PAS_TON_ENFANT' });
      pourEnfant = true;
    }

    const snap = await adminDb.collection('lessons')
      .where('teacher_id', '==', String(b.teacherId))
      .where('slot_day', '==', b.slot.day)
      .where('slot_hour', '==', b.slot.hour)
      .where('date', '==', b.slot.date)
      .where('is_group', '==', true)
      .get();
    const groupe = snap.docs[0];
    if (!groupe) return res.status(200).json({ status: 'none' });

    const ids = groupe.data().participant_ids || [];
    if (ids.includes(cible)) return res.status(200).json({ status: 'duplicate' });

    const packHours = Number(b.packHours || 0);
    // ⚠️ Admin SDK : FieldValue.delete() — `deleteField` n'existe que côté
    // navigateur (500 en prod le 23/10 avant ce correctif).
    await groupe.ref.update(ajoutParticipant(cible, {
      moi, pourEnfant, packHours, mode: b.mode || 'presentiel', packId: b.packId || null,
    }, VALEURS_ADMIN));
    await adminDb.collection('notifications').add({
      user_id: String(b.teacherId),
      read: false,
      created_at: FieldValue.serverTimestamp(),
      type: 'lesson_request',
      lesson_id: groupe.id,
      requester_id: cible,
      message: `Demande d'ajout au groupe (${b.slot.day} ${b.slot.hour}h).`,
    });
    return res.status(200).json({ status: 'joined_group', lessonId: groupe.id });
  } catch (e) {
    console.error('[rejoindre-groupe]', e?.message || e);
    return res.status(500).json({ error: 'INTERNAL' });
  }
}
