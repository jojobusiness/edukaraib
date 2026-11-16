// Fuseaux horaires — chacun voit l'heure de chez lui (PLAN_DISPOS_PROFS, 16/11/2026).
//
// Un créneau est un INSTANT précis. Le prof le saisit dans son fuseau
// (availability.fuseau) ; la famille le voit dans le sien, avec l'heure du prof
// en petit. Un prof de Guyane qui coche 18 h = 17 h en Martinique, 1 h le
// lendemain à La Réunion.
//
// ⛔ Aucun décalage fixe stocké : l'Hexagone change d'heure (29/03/2027,
// 31/10/2027), les DOM non. Chaque conversion passe par Intl à la date réelle.
// Module pur, sans dépendance : importé par le front ET l'API (comme _partners).

export const FUSEAUX = [
  { id: 'America/Cayenne', label: 'Guyane', pays: 'GF' },
  { id: 'America/Martinique', label: 'Martinique', pays: 'MQ' },
  { id: 'America/Guadeloupe', label: 'Guadeloupe', pays: 'GP' },
  { id: 'Indian/Reunion', label: 'La Réunion', pays: 'RE' },
  { id: 'Indian/Mayotte', label: 'Mayotte', pays: 'YT' },
  { id: 'Europe/Paris', label: 'Hexagone', pays: 'FR' },
  { id: 'Pacific/Noumea', label: 'Nouvelle-Calédonie', pays: 'NC' },
  { id: 'Pacific/Tahiti', label: 'Polynésie', pays: 'PF' },
  { id: 'America/Port-au-Prince', label: 'Haïti', pays: 'HT' },
  // Afrique francophone (16/11/2026) : des profs inscrits vivent au Burkina Faso
  { id: 'Africa/Abidjan', label: 'Afrique de l’Ouest (Côte d’Ivoire, Burkina, Mali, Sénégal…)', court: 'Afrique de l’Ouest', pays: 'CI' },
  { id: 'Africa/Douala', label: 'Afrique centrale (Cameroun, Gabon, Congo, Bénin, Niger…)', court: 'Afrique centrale', pays: 'CM' },
  { id: 'Africa/Kinshasa', label: 'RD Congo (Kinshasa)', court: 'Kinshasa', pays: 'CD' },
  { id: 'Africa/Kigali', label: 'Rwanda, Burundi', court: 'Kigali', pays: 'RW' },
  { id: 'Africa/Casablanca', label: 'Maroc', pays: 'MA' },
];

const PAR_PAYS = Object.fromEntries(FUSEAUX.map((f) => [f.pays, f.id]));
// Saint-Martin et Saint-Barthélemy vivent à l'heure de la Guadeloupe.
PAR_PAYS.MF = 'America/Guadeloupe';
PAR_PAYS.BL = 'America/Guadeloupe';
for (const p of ['BF', 'ML', 'SN', 'GN', 'TG', 'MR', 'GM']) PAR_PAYS[p] = 'Africa/Abidjan';
for (const p of ['GA', 'CG', 'BJ', 'NE', 'TD', 'CF', 'GQ']) PAR_PAYS[p] = 'Africa/Douala';
PAR_PAYS.BI = 'Africa/Kigali';

// Indicatif téléphonique international → pays (hors France et DOM, gérés par _telephone.mjs)
const INDICATIFS = { 226: 'BF', 225: 'CI', 221: 'SN', 223: 'ML', 224: 'GN', 228: 'TG', 222: 'MR', 220: 'GM', 227: 'NE', 229: 'BJ', 235: 'TD', 236: 'CF', 237: 'CM', 240: 'GQ', 241: 'GA', 242: 'CG', 243: 'CD', 250: 'RW', 257: 'BI', 212: 'MA', 509: 'HT', 687: 'NC', 689: 'PF' };

/** Pays d'un numéro international (+226…), ou null. */
export function paysDepuisIndicatif(numero) {
  const m = String(numero || '').replace(/\s/g, '').match(/^\+(\d{3})/);
  return m ? INDICATIFS[m[1]] || null : null;
}
const DOM = new Set(['GF', 'MQ', 'GP', 'RE', 'YT', 'NC', 'PF', 'MF', 'BL']);

/** Le nom IANA est-il connu du moteur ? */
export function fuseauValide(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try { new Intl.DateTimeFormat('fr-FR', { timeZone: tz }); return true; } catch { return false; }
}

/** Fuseau d'un code pays (pays_inscription), ou null. */
export function fuseauDuPays(pays) {
  return PAR_PAYS[String(pays || '').toUpperCase()] || null;
}

/**
 * Fuseau à enregistrer sur un compte. Le navigateur fait foi, sauf s'il répond
 * Paris pour un compte inscrit depuis un DOM (VPN, ordinateur réglé sur Paris).
 */
export function fuseauProbable({ navigateur, pays } = {}) {
  const p = String(pays || '').toUpperCase();
  if (DOM.has(p) && (!fuseauValide(navigateur) || navigateur === 'Europe/Paris')) return fuseauDuPays(p);
  if (fuseauValide(navigateur)) return navigateur;
  return fuseauDuPays(p);
}

/** Fuseau du navigateur, ou null. */
export function fuseauNavigateur() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; }
}

const formateurs = new Map();
function formateur(tz) {
  if (!formateurs.has(tz)) {
    formateurs.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short',
    }));
  }
  return formateurs.get(tz);
}

const JOURS_EN = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
export const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

/** Ce que montre l'horloge de `tz` à cet instant. */
export function partiesLocales(instant, tz) {
  const d = instant instanceof Date ? instant : new Date(instant);
  const p = Object.fromEntries(formateur(tz).formatToParts(d).map((x) => [x.type, x.value]));
  const jourIdx = JOURS_EN[p.weekday];
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    heure: Number(p.hour) % 24,
    minute: Number(p.minute),
    jourIdx,
    jour: JOURS[jourIdx],
  };
}

/** Décalage de `tz` par rapport à UTC à cet instant, en minutes (Guyane = −180). */
export function decalageMinutes(tz, instant = new Date()) {
  const d = instant instanceof Date ? instant : new Date(instant);
  const p = partiesLocales(d, tz);
  const [y, m, j] = p.date.split('-').map(Number);
  const commeUtc = Date.UTC(y, m - 1, j, p.heure, p.minute);
  return Math.round((commeUtc - Math.floor(d.getTime() / 60000) * 60000) / 60000);
}

/** Instant d'une heure locale : « le 23/11 à 18 h, heure de Guyane ». */
export function instantLocal(date, heure, tz, minute = 0) {
  const [y, m, j] = String(date).slice(0, 10).split('-').map(Number);
  const naif = Date.UTC(y, m - 1, j, Number(heure) || 0, minute);
  let t = naif - decalageMinutes(tz, new Date(naif)) * 60000;
  t = naif - decalageMinutes(tz, new Date(t)) * 60000; // 2ᵉ passe : jour de changement d'heure
  return new Date(t);
}

/** "YYYY-MM-DD" + n jours (arithmétique sur la date seule, sans fuseau). */
export function ajouterJours(date, n) {
  const [y, m, j] = String(date).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, j + n)).toISOString().slice(0, 10);
}

/** Lundi de la semaine d'une date "YYYY-MM-DD". */
export function lundiDe(date) {
  const [y, m, j] = String(date).slice(0, 10).split('-').map(Number);
  const idx = (new Date(Date.UTC(y, m - 1, j)).getUTCDay() + 6) % 7;
  return ajouterJours(date, -idx);
}

/** « Guyane », « Martinique »… ou le nom IANA pour un fuseau hors liste. */
export function nomFuseau(tz) {
  const f = FUSEAUX.find((x) => x.id === tz);
  return f?.court || f?.label || String(tz || '').split('/').pop().replace(/_/g, ' ');
}

/** « UTC−3 », « UTC+1 », « UTC+5:30 » à cet instant. */
export function libelleUtc(tz, instant = new Date()) {
  const min = decalageMinutes(tz, instant);
  const signe = min < 0 ? '−' : '+';
  const a = Math.abs(min);
  return `UTC${signe}${Math.floor(a / 60)}${a % 60 ? `:${String(a % 60).padStart(2, '0')}` : ''}`;
}

/** « 17 h », « 17 h 30 ». */
export function formatHeure(heure, minute = 0) {
  return `${heure} h${minute ? ` ${String(minute).padStart(2, '0')}` : ''}`;
}

/** « 17 h » à l'heure de `tz`. */
export function heureDans(instant, tz) {
  const p = partiesLocales(instant, tz);
  return formatHeure(p.heure, p.minute);
}

/**
 * Pour un mail : « lundi 23 novembre à 17 h, heure de Martinique ».
 * Sans fuseau connu (vieux compte), on écrit l'heure de Guyane : c'est là que
 * vit la majorité des profs et des familles (mesure du 16/11/2026).
 */
export function dateHeureLongue(instant, tz) {
  const zone = fuseauValide(tz) ? tz : 'America/Cayenne';
  const d = instant instanceof Date ? instant : new Date(instant);
  const jour = new Intl.DateTimeFormat('fr-FR', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long' }).format(d);
  const nom = zone === 'Europe/Paris' ? 'Paris' : nomFuseau(zone);
  return `${jour} à ${heureDans(d, zone)}, heure ${/^([AEIOUÉ]|Haï)/i.test(nom) ? 'd’' : 'de '}${nom}`;
}
