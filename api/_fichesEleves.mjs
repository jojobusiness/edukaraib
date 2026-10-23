// Qui peut voir la fiche d'un enfant (23/10/2026). Module pur.
//
// Jusqu'au 23/10, `students` était `read, write: if signedIn()` : tout compte
// lisait, modifiait et supprimait le nom et la date de naissance des enfants.
// Désormais seul le parent (et l'admin) lit la fiche complète, par les
// règles. Le prof et les autres participants d'un cours où figure l'enfant
// en ont besoin pour afficher son nom : ils passent par /api/fiches-eleves,
// qui vérifie ce lien et ne renvoie JAMAIS la date de naissance.

/** Les champs qu'un prof ou un participant peut voir. */
export const CHAMPS_FICHE_TIERS = ['full_name', 'name', 'first_name', 'last_name', 'school_level', 'parent_id'];

/** true si `uid` figure dans le cours (prof, élève, parent ou réservant). */
export function participeAuCours(uid, lecon) {
  if (!uid || !lecon) return false;
  if (lecon.teacher_id === uid || lecon.student_id === uid) return true;
  if (Array.isArray(lecon.participant_ids) && lecon.participant_ids.includes(uid)) return true;
  return Object.values(lecon.participantsMap || {})
    .some((p) => p?.parent_id === uid || p?.booked_by === uid);
}

/**
 * @param {string} uid celui qui demande
 * @param {object} eleve la fiche `students`
 * @param {object[]} lecons les cours où figure l'enfant
 * @param {boolean} estAdmin
 */
export function peutVoirEleve(uid, eleve, lecons, estAdmin = false) {
  if (!uid || !eleve) return false;
  if (estAdmin || eleve.parent_id === uid) return true;
  return (lecons || []).some((l) => participeAuCours(uid, l));
}

/** La fiche réduite, sans date de naissance. */
export function ficheTiers(id, eleve) {
  const out = { id };
  for (const k of CHAMPS_FICHE_TIERS) if (eleve?.[k] !== undefined) out[k] = eleve[k];
  return out;
}
