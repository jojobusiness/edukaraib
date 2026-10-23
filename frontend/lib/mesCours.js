// Lire « mes » cours depuis le 23/10/2026.
//
// `lessons` ne se lit plus que par les comptes du cours (`acces`, tenu par la
// Cloud Function onLessonWrittenSync). Une requête « student_id in [mes
// enfants] » est REFUSÉE : la règle ne sait pas qu'un enfant est le mien.
// On lit donc les cours où je figure, puis on garde ceux qui concernent les
// identifiants voulus (mes enfants, mes alias élève…).
// Plan : docs/plans/PLAN_VERROU_COURS_23-10-2026.md.
import { collection, query, where } from 'firebase/firestore';

/** Requête des cours où `uid` figure (seule forme autorisée pour un parent). */
export function requeteMesCours(db, uid) {
  return query(collection(db, 'lessons'), where('acces', 'array-contains', String(uid)));
}

/** true si le cours concerne l'un des identifiants (élève principal ou participant). */
export function concerneUnDe(lecon, ids) {
  const set = new Set((ids || []).map(String));
  if (lecon?.student_id && set.has(String(lecon.student_id))) return true;
  return (Array.isArray(lecon?.participant_ids) ? lecon.participant_ids : []).some((x) => set.has(String(x)));
}
