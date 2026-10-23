// Les cours GRATUITS se vérifient côté serveur (23/10/2026).
//
// Avant, le navigateur décidait seul qu'un cours était offert :
//   - essai gratuit : rien n'empêchait d'en réserver un par semaine avec le
//     même prof (« déjà utilisé » n'était qu'un drapeau côté navigateur) ;
//   - heures offertes d'un pack : rien ne limitait leur nombre ;
//   - code « premier avis » (+1 h sur un pack 5 h) : vérifié dans le
//     navigateur, jamais marqué comme utilisé → réutilisable à l'infini.
// La Cloud Function onLessonWrittenSync appelle `verdictGratuite` à la
// création d'un cours et retire ce qui n'est pas justifié. Testé par
// frontend/test/gratuites.test.js.

const BONUS_PACK = {5: 1, 10: 2};

/** Les participants qui bénéficient d'une gratuité dans ce cours. */
function participantsGratuits(l) {
  return Object.entries(l.participantsMap || {})
      .filter(([, p]) => p && (p.is_free_hour === true || p.is_paid === true && p.paid_by === "trial"))
      .map(([sid]) => sid);
}

/**
 * Champs à écrire pour retirer la gratuité d'un cours (au tarif du prof).
 * @param {object} l le cours
 * @param {number} tarif tarif horaire du prof
 * @param {object} effacer FieldValue.delete() (ou équivalent)
 * @return {object}
 */
function retirerGratuite(l, tarif, effacer) {
  const champs = {
    is_free_hour: false,
    free_reason: null,
    is_trial: effacer,
    price_per_hour: tarif,
    gratuite_refusee: true,
  };
  for (const sid of Object.keys(l.participantsMap || {})) {
    champs[`participantsMap.${sid}.is_free_hour`] = false;
    champs[`participantsMap.${sid}.free_reason`] = null;
    if (l.participantsMap[sid] && l.participantsMap[sid].paid_by === "trial") {
      champs[`participantsMap.${sid}.is_paid`] = false;
      champs[`participantsMap.${sid}.paid_by`] = null;
      champs[`participantsMap.${sid}.paid_at`] = null;
    }
  }
  return champs;
}

/**
 * Le cours a-t-il droit à sa gratuité ?
 * @param {string} id identifiant du cours
 * @param {object} l le cours tel que créé
 * @param {{
 *   prof: object|null,
 *   autresEssais: Array<{id: string, created_ms: number}>,
 *   coursDuPack: Array<{id: string, created_ms: number, l: object}>,
 *   promoValide: boolean,
 * }} ctx ce que le serveur a lu
 * @return {{ok: boolean, raison?: string, utiliserPromo?: boolean}}
 */
function verdictGratuite(id, l, ctx) {
  const gratuit = l.is_free_hour === true || l.is_trial === true || participantsGratuits(l).length > 0;
  if (!gratuit) return {ok: true};

  if (l.is_trial === true) {
    if (!ctx.prof || ctx.prof.trial_enabled !== true) return {ok: false, raison: "essai_non_propose"};
    const moi = Number(l._created_ms || 0);
    const plusAncien = (ctx.autresEssais || []).some((e) => e.id !== id &&
      (e.created_ms < moi || (e.created_ms === moi && e.id < id)));
    if (plusAncien) return {ok: false, raison: "essai_deja_utilise"};
    return {ok: true};
  }

  // Heure offerte : seulement dans un pack, dans la limite du bonus
  const heures = Number(l.pack_hours || 0);
  if (l.pack !== true || !BONUS_PACK[heures]) return {ok: false, raison: "gratuit_hors_pack"};
  const promo = l.free_reason === "first_review_promo";
  if (promo && (heures !== 5 || !ctx.promoValide)) return {ok: false, raison: "code_avis_invalide"};
  const max = BONUS_PACK[heures] + (heures === 5 && ctx.promoValide ? 1 : 0);
  const gratuitsAvant = (ctx.coursDuPack || [])
      .filter((c) => c.id !== id && (c.l.is_free_hour === true) &&
        (c.created_ms < Number(l._created_ms || 0) ||
         (c.created_ms === Number(l._created_ms || 0) && c.id < id)))
      .length;
  if (gratuitsAvant >= max) return {ok: false, raison: "trop_d_heures_offertes"};
  return {ok: true, utiliserPromo: promo};
}

module.exports = {verdictGratuite, retirerGratuite, participantsGratuits, BONUS_PACK};
