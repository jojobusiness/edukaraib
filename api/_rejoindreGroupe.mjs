// Rejoindre le cours collectif d'un autre élève (23/10/2026). Module pur.
//
// Avant, la page du prof le faisait depuis le navigateur : elle LISAIT le
// cours des autres élèves (identifiants, parents, paiements) et l'ÉCRIVAIT.
// C'est ce qui obligeait `lessons` à rester ouvert. Désormais le serveur fait
// l'ajout (api/rejoindre-groupe.mjs) et ne renvoie rien des autres élèves.
// Mêmes champs qu'avant (TeacherProfile.jsx, étape « rejoindre un groupe »).
import { FieldValue } from 'firebase-admin/firestore';

/** Valeurs spéciales de l'Admin SDK. ⚠️ FieldValue.delete() : `deleteField`
 * n'existe que côté navigateur (500 en prod le 23/10 avant ce correctif). */
export const VALEURS_ADMIN = {
  arrayUnion: (...x) => FieldValue.arrayUnion(...x),
  serverTimestamp: () => FieldValue.serverTimestamp(),
  deleteField: () => FieldValue.delete(),
};

/** Champs « pack » d'un participant, posés ou effacés. */
export function champsPack(sid, { packHours, mode, packId }, effacer) {
  const k = (c) => `participantsMap.${sid}.${c}`;
  if (packHours === 5 || packHours === 10) {
    return {
      [k('pack')]: true,
      [k('pack_id')]: packId,
      [k('pack_type')]: packHours === 5 ? 'pack5' : 'pack10',
      [k('pack_mode')]: mode,
      [k('pack_hours')]: packHours,
      [k('require_accept_all')]: true,
    };
  }
  const out = {};
  for (const c of ['pack', 'is_pack', 'pack_id', 'pack_type', 'pack_mode', 'pack_hours',
    'pack_hours_total', 'pack_hours_remaining', 'require_accept_all']) out[k(c)] = effacer;
  return out;
}

/**
 * La mise à jour d'un cours collectif pour y ajouter `sid`.
 * @param {string} sid l'élève (compte ou fiche enfant)
 * @param {{ moi: string, pourEnfant: boolean, packHours: number, mode: string, packId: string|null }} o
 * @param {{ arrayUnion: Function, serverTimestamp: Function, deleteField: Function }} fv FieldValue
 */
export function ajoutParticipant(sid, o, fv) {
  const k = (c) => `participantsMap.${sid}.${c}`;
  return {
    participant_ids: fv.arrayUnion(sid),
    acces: fv.arrayUnion(...new Set([sid, o.moi])),
    [k('parent_id')]: o.pourEnfant ? o.moi : null,
    [k('booked_by')]: o.moi,
    [k('is_paid')]: false,
    [k('paid_by')]: null,
    [k('paid_at')]: null,
    [k('status')]: 'pending_teacher',
    [k('added_at')]: fv.serverTimestamp(),
    ...champsPack(sid, o, fv.deleteField()),
  };
}

/** Validation de la demande. @returns {string|null} code d'erreur */
export function demandeInvalide(b) {
  if (!b || typeof b !== 'object') return 'BODY';
  if (!b.teacherId || !b.targetStudentId) return 'IDS';
  const s = b.slot || {};
  if (!s.day || typeof s.hour !== 'number' || !s.date) return 'SLOT';
  if (![0, 5, 10].includes(Number(b.packHours || 0))) return 'PACK';
  return null;
}
