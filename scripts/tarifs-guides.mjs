/* Les prix cités par les guides publics, LUS dans la base (11/11/2026).
     node --env-file=.env.local scripts/tarifs-guides.mjs
   Écrit frontend/data/tarifsGuides.json : fourchette des tarifs horaires des
   profs RÉSERVABLES (règle de frontend/lib/offreProf.js), comptes test exclus,
   + les 10 €/h de frais. Le build ne lit que ce fichier : il ne dépend pas de
   la base. À relancer quand les tarifs changent, puis commit.
   ⛔ Jamais un « prix moyen du marché » inventé (PLAN_PAGES_CHATGPT_11-11-2026). */
import { writeFileSync } from 'node:fs';
import { adminDb } from '../api/_firebaseAdmin.mjs';
import { estReservable } from '../frontend/lib/offreProf.js';

const FRAIS_PAR_HEURE = 10;
const profs = (await adminDb.collection('users').where('role', '==', 'teacher').get()).docs
  .map((d) => ({ id: d.id, ...d.data() }))
  .filter((t) => t.compteTest !== true);
const avis = {};
for (const r of (await adminDb.collection('reviews').get()).docs) {
  const t = r.data().teacher_id;
  if (t) avis[t] = (avis[t] || 0) + 1;
}
const prix = [];
for (const t of profs) {
  if (!estReservable({ profil: t, nbAvis: avis[t.id] || 0 })) continue;
  const p = Number(t.price_per_hour);
  if (t.presentiel_enabled !== false && p > 0) prix.push(p);
  const v = t.visio_same_rate ? p : Number(t.visio_price_per_hour);
  if (t.visio_enabled && v > 0) prix.push(v);
}
if (prix.length < 2) throw new Error(`tarifs-guides : seulement ${prix.length} tarif(s) réservable(s), fourchette impossible`);
const sortie = {
  majLe: new Date().toISOString().slice(0, 10),
  tarifMin: Math.min(...prix),
  tarifMax: Math.max(...prix),
  fraisParHeure: FRAIS_PAR_HEURE,
};
writeFileSync('frontend/data/tarifsGuides.json', `${JSON.stringify(sortie, null, 2)}\n`);
console.log(sortie, `(${prix.length} tarifs, profs réservables)`);
process.exit(0);
