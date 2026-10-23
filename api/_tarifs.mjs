// Ce que touche le prof pour un paiement — à partir de SON profil (23/10/2026).
//
// Avant, create-checkout-session lisait le tarif dans le COURS
// (lesson.price_per_hour, lesson.pack5_price…). Or c'est la famille qui crée
// le cours : elle pouvait y écrire 1 € de l'heure, et le prof touchait 1 €.
// Le tarif vient désormais de users/{teacher_id}, que seul le prof modifie.
// Même calcul que l'affichage de sa page (TeacherProfile.jsx :
// effectiveVisioPrice, pack5Display). Module pur, testé par
// frontend/test/tarifs.test.js.

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const defini = (v) => v !== undefined && v !== null && v !== '';

/** Tarifs effectifs du prof pour un mode (visio ou présentiel). */
export function tarifsDuProf(prof, visio) {
  const base = num(prof?.price_per_hour);
  const heure = visio && prof?.visio_enabled
    ? (prof.visio_same_rate ? base : num(prof.visio_price_per_hour) || base)
    : base;
  const pack = (n) => {
    const champ = visio && prof?.visio_enabled
      ? (prof.visio_same_rate ? prof[`pack${n}_price`] : prof[`visio_pack${n}_price`])
      : prof?.[`pack${n}_price`];
    // Sans prix de pack renseigné : -10 % sur le tarif horaire (comme la page du prof)
    return defini(champ) && num(champ) > 0 ? num(champ) : Number((n * heure * 0.9).toFixed(2));
  };
  return { heure, pack5: pack(5), pack10: pack(10) };
}

/** Part du prof, en centimes. */
export function montantProfCents(tarifs, { packMode, billedHours }) {
  if (packMode && (billedHours === 5 || billedHours === 10)) {
    return Math.round((billedHours === 10 ? tarifs.pack10 : tarifs.pack5) * 100);
  }
  return Math.round(tarifs.heure * (Number(billedHours) || 1) * 100);
}

/**
 * Nombre maximum de cours qu'un paiement de pack peut couvrir :
 * heures payées + heures offertes (pack 5 h : 1 offerte + 1 avec le code
 * « premier avis » ; pack 10 h : 2 offertes).
 */
export function maxCoursDuPack(heures) {
  if (heures === 5) return 7;
  if (heures === 10) return 12;
  return Math.max(1, Number(heures) || 1);
}
