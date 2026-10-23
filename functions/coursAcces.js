// Qui a accès à un cours, et ce qu'on en montre au public (23/10/2026).
//
// Jusqu'au 23/10, `lessons` était lisible SANS COMPTE : prof, élève, parent,
// créneau, prix, paiement. Désormais :
//   - `lessons.acces` = les comptes du cours. La règle Firestore n'a qu'à
//     vérifier `request.auth.uid in resource.data.acces` (elle ne sait pas
//     relier un enfant à son parent, ni parcourir participantsMap) ;
//   - `creneaux/{id}` = la copie publique, SANS aucun identifiant d'élève,
//     pour griser les créneaux pris sur la page d'un prof.
// Les deux sont recalculés par la Cloud Function onLessonWrittenSync.
// Plan : docs/plans/PLAN_VERROU_COURS_23-10-2026.md. Testé par
// frontend/test/cours-acces.test.js.

const INACTIFS = ["rejected", "removed", "deleted"];

/**
 * Les identifiants cités par le cours (prof, élèves, parents, réservants).
 * @param {object} lecon
 * @return {string[]}
 */
function idsDuCours(lecon) {
  const ids = new Set();
  const ajouter = (x) => {
    if (x) ids.add(String(x));
  };
  ajouter(lecon.teacher_id);
  ajouter(lecon.student_id);
  (Array.isArray(lecon.participant_ids) ? lecon.participant_ids : []).forEach(ajouter);
  Object.entries(lecon.participantsMap || {}).forEach(([sid, p]) => {
    ajouter(sid);
    ajouter(p && p.parent_id);
    ajouter(p && p.booked_by);
  });
  return [...ids];
}

/**
 * `acces` complet : les ids du cours + pour chaque fiche enfant (`students`)
 * son parent et le compte élève lié.
 * @param {object} lecon
 * @param {(id: string) => Promise<object|null>} lireEleve lit students/{id}
 * @return {Promise<string[]>} trié, pour comparer sans faux changement
 */
async function accesDuCours(lecon, lireEleve) {
  const ids = new Set(idsDuCours(lecon));
  for (const id of [...ids]) {
    const fiche = await lireEleve(id);
    if (!fiche) continue;
    [fiche.parent_id, fiche.user_id, fiche.uid].forEach((x) => {
      if (x) ids.add(String(x));
    });
  }
  return [...ids].sort();
}

/**
 * Places prises dans un cours (même calcul que la page du prof avant le 23/10).
 * @param {object} lecon
 * @return {number}
 */
function placesPrises(lecon) {
  const ids = new Set(Array.isArray(lecon.participant_ids) ? lecon.participant_ids : []);
  if (!ids.size && lecon.student_id) ids.add(lecon.student_id);
  const pm = lecon.participantsMap || {};
  let n = 0;
  ids.forEach((sid) => {
    const st = String((pm[sid] && pm[sid].status) || lecon.status || "pending").toLowerCase();
    if (!INACTIFS.includes(st)) n += 1;
  });
  return n;
}

/**
 * La copie publique d'un cours : jamais d'élève, de parent, de prix ni de paiement.
 * @param {object} lecon
 * @return {object}
 */
function creneauPublic(lecon) {
  const out = {
    teacher_id: lecon.teacher_id || null,
    slot_day: lecon.slot_day || null,
    slot_hour: typeof lecon.slot_hour === "number" ? lecon.slot_hour : null,
    date: lecon.date || null,
    week: lecon.week || null,
    startAt: lecon.startAt || null,
    status: lecon.status || null,
    is_group: !!lecon.is_group,
    capacity: Number(lecon.capacity || 0) || null,
    places_prises: placesPrises(lecon),
  };
  return out;
}

const memeListe = (a, b) =>
  Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
  [...a].sort().every((x, i) => x === [...b].sort()[i]);

module.exports = {idsDuCours, accesDuCours, placesPrises, creneauPublic, memeListe};
