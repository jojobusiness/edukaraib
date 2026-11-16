// Disponibilités des profs : horaires habituels + semaines particulières
// (PLAN_DISPOS_PROFS, 16/11/2026).
//
// Pourquoi. Jusqu'au 16/11, les dispos n'existaient que semaine par semaine :
// un prof devait revenir chaque semaine cocher ses heures, et aucun ne le
// faisait. Mesure du 16/11 : 13 profs sur 23 avaient rempli des dispos, 0 avait
// un créneau dans la semaine en cours.
//
// Format de users/{uid}.availability (tout cohabite) :
//   modele        : { Lun: [9,10], Mar: [...] }  ← chaque semaine, sans fin
//   'YYYY-MM-DD'  : { Lun: [...], ... }          ← lundi d'une semaine particulière,
//                                                  REMPLACE le modèle (vide = pas dispo)
//   fuseau        : 'America/Cayenne'            ← fuseau des heures saisies
//   modele_depuis : 'YYYY-MM-DD'                 ← trace de la migration du 16/11
//   ancien format : { Lun: [9,10] } sans clé datée ← lu comme un modèle
//
// ⛔ Une seule implémentation : le front, l'API et les scripts importent ce module.

import { JOURS, ajouterJours, lundiDe, partiesLocales, fuseauValide } from './_fuseaux.mjs';

export { JOURS };
export const CLE_SEMAINE = /^\d{4}-\d{2}-\d{2}$/;
export const HORIZON_SEMAINES = 4;

const estGrille = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const compte = (v) => (Array.isArray(v) ? v.length : (v ? 1 : 0));

/** Heures d'une grille, nettoyées et triées (0 → 23). */
export function heuresDuJour(grille, jour) {
  const v = grille?.[jour];
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map(Number).filter((h) => Number.isInteger(h) && h >= 0 && h <= 23))].sort((a, b) => a - b);
}

/** Nombre d'heures d'une grille { Lun: [...], ... }. */
export function nbHeures(grille) {
  if (!estGrille(grille)) return 0;
  return JOURS.reduce((n, j) => n + heuresDuJour(grille, j).length, 0);
}

/** Les horaires habituels, ou null. L'ancien format sans semaine datée en tient lieu. */
export function modeleDe(avail) {
  if (!estGrille(avail)) return null;
  if (estGrille(avail.modele)) return avail.modele;
  const cles = Object.keys(avail);
  if (cles.some((k) => CLE_SEMAINE.test(k))) return null;
  if (!cles.some((k) => JOURS.includes(k))) return null;
  return Object.fromEntries(JOURS.filter((j) => Array.isArray(avail[j])).map((j) => [j, avail[j]]));
}

/** La semaine particulière (exception) qui commence ce lundi, ou null. */
export function exceptionDe(avail, lundi) {
  return estGrille(avail) && estGrille(avail[lundi]) ? avail[lundi] : null;
}

/** Les heures d'une semaine : la semaine particulière si elle existe, sinon le modèle. */
export function grilleSemaine(avail, lundi) {
  return exceptionDe(avail, lundi) || modeleDe(avail) || {};
}

/** Heures du prof un jour donné ("YYYY-MM-DD", dans SON fuseau). */
export function heuresLe(avail, date) {
  const lundi = lundiDe(date);
  const [y, m, j] = date.split('-').map(Number);
  const jour = JOURS[(new Date(Date.UTC(y, m - 1, j)).getUTCDay() + 6) % 7];
  return heuresDuJour(grilleSemaine(avail, lundi), jour);
}

/** Fuseau dans lequel le prof a saisi ses heures, ou null (vieux comptes). */
export function fuseauDispos(avail) {
  return fuseauValide(avail?.fuseau) ? avail.fuseau : null;
}

/** "YYYY-MM-DD" d'aujourd'hui, dans le fuseau donné, sinon celui de la machine. */
export function aujourdhui(maintenant = Date.now(), tz = null) {
  const d = new Date(maintenant);
  if (tz) return partiesLocales(d, tz).date;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Semaines à regarder : les HORIZON_SEMAINES à venir + toute semaine particulière future. */
export function semainesAVenir(avail, maintenant = Date.now()) {
  const lundi = lundiDe(aujourdhui(maintenant, fuseauDispos(avail)));
  const s = new Set(Array.from({ length: HORIZON_SEMAINES }, (_, i) => ajouterJours(lundi, 7 * i)));
  if (estGrille(avail)) Object.keys(avail).filter((k) => CLE_SEMAINE.test(k) && k >= lundi).forEach((k) => s.add(k));
  return [...s].sort();
}

/**
 * Nombre de créneaux RÉELLEMENT réservables, tous formats d'`availability`.
 * 02/11/2026 : les semaines passées ne comptent plus.
 * 16/11/2026 : les horaires habituels comptent sur les 4 semaines à venir.
 */
export function nbCreneaux(avail, maintenant = Date.now()) {
  if (!avail) return 0;
  if (Array.isArray(avail)) return avail.length;
  if (typeof avail !== 'object') return 0;
  const cles = Object.keys(avail);
  // Très vieux formats ({ lundi: ['09:00'] }) : on compte ce qui est là.
  if (!estGrille(avail.modele) && !cles.some((k) => CLE_SEMAINE.test(k)) && !cles.some((k) => JOURS.includes(k))) {
    return cles.filter((k) => !['fuseau', 'modele_depuis'].includes(k)).reduce((n, k) => n + compte(avail[k]), 0);
  }
  return semainesAVenir(avail, maintenant).reduce((n, lundi) => n + nbHeures(grilleSemaine(avail, lundi)), 0);
}

/** Créneaux distincts (jour + heure) proposés à l'avenir — formulaire d'abonnement. */
export function creneauxRecurrents(avail, maintenant = Date.now()) {
  const vus = new Map();
  for (const lundi of semainesAVenir(avail, maintenant)) {
    const g = grilleSemaine(avail, lundi);
    JOURS.forEach((jour, i) => heuresDuJour(g, jour).forEach((h) => vus.set(`${i}:${h}`, { day: jour, hour: h })));
  }
  return [...vus.entries()].sort(([a], [b]) => {
    const [ja, ha] = a.split(':').map(Number);
    const [jb, hb] = b.split(':').map(Number);
    return ja - jb || ha - hb;
  }).map(([, v]) => v);
}

/**
 * Migration du 16/11 : la dernière semaine remplie devient le modèle.
 * Rend null si rien à faire (modèle déjà là, ou aucune semaine remplie).
 */
export function modeleDepuisDerniereSemaine(avail) {
  if (!estGrille(avail) || estGrille(avail.modele)) return null;
  const remplies = Object.keys(avail).filter((k) => CLE_SEMAINE.test(k) && nbHeures(avail[k]) > 0).sort();
  if (!remplies.length) return null;
  const derniere = remplies[remplies.length - 1];
  const g = avail[derniere];
  return { semaine: derniere, modele: Object.fromEntries(JOURS.map((j) => [j, heuresDuJour(g, j)])) };
}
