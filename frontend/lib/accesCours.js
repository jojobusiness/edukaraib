// Qui a accès aux fichiers d'un cours (23/10/2026).
//
// Jusqu'au 23/10, `documents` était `read, write: if signedIn()` : tout compte
// lisait (et supprimait) les fichiers de cours de tout le monde. Chaque
// document porte désormais `acces` : la liste des comptes qui le voient. La
// règle Firestore n'a qu'à vérifier `request.auth.uid in resource.data.acces`
// (elle ne sait pas parcourir les parents rangés dans participantsMap).
// Module pur — testé par frontend/test/acces-cours.test.js, et réutilisé par
// scripts/migrer-acces-documents.mjs pour les documents déjà envoyés.

/**
 * @param {object|null} lecon le cours (teacher_id, student_id, participant_ids, participantsMap)
 * @param {string|null} moi celui qui envoie le fichier
 * @returns {string[]} prof, élèves, parents et réservants, sans doublon
 */
export function accesDuCours(lecon, moi = null) {
  const ids = new Set();
  const ajouter = (x) => { if (x) ids.add(String(x)); };
  ajouter(moi);
  if (lecon) {
    ajouter(lecon.teacher_id);
    ajouter(lecon.student_id);
    (Array.isArray(lecon.participant_ids) ? lecon.participant_ids : []).forEach(ajouter);
    Object.values(lecon.participantsMap || {}).forEach((p) => {
      ajouter(p?.parent_id);
      ajouter(p?.booked_by);
    });
  }
  return [...ids];
}
