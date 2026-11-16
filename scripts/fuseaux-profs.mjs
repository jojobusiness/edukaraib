/* Fuseau horaire des comptes existants (PLAN_DISPOS_PROFS § 4.4, 16/11/2026).
     node --env-file=.env.local scripts/fuseaux-profs.mjs           → aperçu (profs)
     node --env-file=.env.local scripts/fuseaux-profs.mjs --tous    → aperçu (tous les comptes)
     node --env-file=.env.local scripts/fuseaux-profs.mjs --ecrire  → écrit

   Propose un fuseau par compte d'après, dans l'ordre : son fuseau déjà posé,
   sa ville, son pays d'inscription, l'indicatif de son téléphone. Un compte sans
   indice reste SANS fuseau (affiché « ? ») : on ne devine pas.
   Pour un prof, écrit aussi availability.fuseau : ses heures déjà cochées sont
   lues dans ce fuseau. Les cours déjà réservés gardent leur heure (startAt). */
import { adminDb } from '../api/_firebaseAdmin.mjs';
import { fuseauValide, fuseauDuPays, nomFuseau, paysDepuisIndicatif } from '../api/_fuseaux.mjs';
import { paysDepuisTelephone } from '../api/_telephone.mjs';

const ecrire = process.argv.includes('--ecrire');
const tous = process.argv.includes('--tous');

// Communes → fuseau. « Saint-Pierre » et « Saint-Denis » existent à La Réunion
// ET en Martinique / dans l'Hexagone : non résolues ici, on passe à l'indice suivant.
const VILLES = [
  [/cayenne|kourou|matoury|r[ée]mire|macouria|saint-laurent|maripasoula|sinnamary|mana|montsinery|roura|iracoubo|apatou|grand-santi|papaichton|saint-georges|camopi|awala|ouanary|r[ée]gina|guyane/i, 'America/Cayenne'],
  [/fort-de-france|lamentin|schoelcher|schœlcher|ducos|robert|fran[çc]ois|rivi[èe]re-pilote|sainte-marie|trinit[ée]|marin|diamant|martinique/i, 'America/Martinique'],
  [/pointe-[àa]-pitre|abymes|baie-mahault|basse-terre|gosier|sainte-anne|moule|petit-bourg|capesterre|lamentin \(gp\)|guadeloupe|saint-martin|saint-barth/i, 'America/Guadeloupe'],
  [/saint-paul|saint-louis|le port|tampon|saint-andr[ée]|saint-beno[iî]t|r[ée]union/i, 'Indian/Reunion'],
  [/mamoudzou|mayotte/i, 'Indian/Mayotte'],
  [/paris|lyon|marseille|toulouse|bordeaux|lille|nantes|montpellier|strasbourg|nice|rennes|hexagone|france m[ée]tropolitaine/i, 'Europe/Paris'],
  [/port-au-prince|ha[iï]ti|p[ée]tion-ville|cap-ha[iï]tien/i, 'America/Port-au-Prince'],
  [/noum[ée]a|nouvelle-cal[ée]donie/i, 'Pacific/Noumea'],
  [/papeete|tahiti|polyn[ée]sie/i, 'Pacific/Tahiti'],
];

// Tous les indices doivent concorder (16/11/2026) : six profs ont « Cayenne »
// (valeur par défaut de la liste) et un numéro du Burkina Faso. Les mettre à
// l'heure de Guyane les décalerait de 3 h. Indices en désaccord = « à confirmer » :
// rien n'est écrit pour eux, ils choisissent dans leur profil (« Votre fuseau »).
function proposer(u) {
  if (fuseauValide(u.timezone)) return { tz: u.timezone, pourquoi: 'déjà posé' };
  const ville = String(u.city || u.location || '');
  const v = VILLES.find(([re]) => re.test(ville));
  const paysTel = paysDepuisTelephone(u.phone || '') || paysDepuisIndicatif(u.phone || '');
  const indices = [
    v && { tz: v[1], src: `ville « ${ville} »` },
    fuseauDuPays(u.pays_inscription) && { tz: fuseauDuPays(u.pays_inscription), src: `pays ${u.pays_inscription}` },
    fuseauDuPays(paysTel) && { tz: fuseauDuPays(paysTel), src: `tél. ${String(u.phone).slice(0, 4)}…` },
  ].filter(Boolean);
  const distincts = [...new Set(indices.map((i) => i.tz))];
  if (distincts.length === 1) return { tz: distincts[0], pourquoi: indices.map((i) => i.src).join(' + ') };
  if (!distincts.length) return { tz: null, pourquoi: `aucun indice (ville « ${ville || '—'} »)` };
  return { tz: null, pourquoi: `À CONFIRMER : ${indices.map((i) => `${i.src} → ${nomFuseau(i.tz)}`).join(' · ')}` };
}

const q = tous ? adminDb.collection('users') : adminDb.collection('users').where('role', '==', 'teacher');
const snap = await q.get();
const parFuseau = {};
let aEcrire = 0;
for (const d of snap.docs) {
  const u = d.data();
  if (u.compteTest) continue;
  const { tz, pourquoi } = proposer(u);
  parFuseau[tz ? nomFuseau(tz) : '?'] = (parFuseau[tz ? nomFuseau(tz) : '?'] || 0) + 1;
  const maj = {};
  if (tz && u.timezone !== tz) maj.timezone = tz;
  if (tz && u.role === 'teacher' && u.availability && typeof u.availability === 'object' && u.availability.fuseau !== tz) {
    maj.availability = { ...u.availability, fuseau: tz };
  }
  const change = Object.keys(maj).length > 0;
  if (change) aEcrire += 1;
  console.log(`${change ? '→' : ' '} ${(u.fullName || d.id).padEnd(28)} ${String(u.role).padEnd(8)} ${(tz ? nomFuseau(tz) : '?').padEnd(18)} (${pourquoi})`);
  if (ecrire && change) await d.ref.update(maj);
}
console.log('\nRépartition :', parFuseau);
console.log(`${aEcrire} compte(s) ${ecrire ? 'mis à jour' : 'à mettre à jour (aperçu, ajouter --ecrire)'}`);
process.exit(0);
