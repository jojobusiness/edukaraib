/* ————————————————————————————————————————————————————————————
   Qui écrit à qui, combien, et qui répond.

     node scripts/diag-messages.mjs
     node scripts/diag-messages.mjs --jours=30

   Demandé par Joseph le 15/10/2026 : « il faut que je sache à qui et combien
   de messages sont envoyés ». Avant, un élève pouvait écrire à un prof sans
   que personne ne le voie (functions/index.js ne prévenait l'admin que si le
   DESTINATAIRE était l'admin).

   ⚠️ Ce relevé n'affiche AUCUN contenu de message : seulement des comptes,
   des délais et des statuts. Le contenu ne sort pas de la messagerie.

   Lecture seule. ⚠️ Contrairement aux autres diag, il lui faut les identifiants
   ADMIN : `messages` et `conversations` ne sont pas en lecture publique.
   Une fois, pour récupérer les variables depuis Vercel :

     npx vercel env pull .env.local
     node --env-file=.env.local scripts/diag-messages.mjs
   ———————————————————————————————————————————————————————————— */

import { adminDb } from '../api/_firebaseAdmin.mjs';

const arg = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const JOURS = Number(arg.jours || 7);
const DEPUIS = new Date(Date.now() - JOURS * 86400000);

const toDate = (v) => (v?.toDate ? v.toDate() : v ? new Date(v) : null);
const jjmm = (d) => (d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}` : '—');
const duree = (ms) => {
  if (ms === null || ms === undefined) return '—';
  const h = ms / 3600000;
  return h < 1 ? `${Math.round(ms / 60000)} min` : h < 48 ? `${h.toFixed(1)} h` : `${Math.round(h / 24)} j`;
};
const mediane = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

// Comptes de test : ils fausseraient tous les taux sur une base de cette taille
const EST_TEST = (u) => /test|essai|demo/i.test(`${u?.fullName || ''} ${u?.email || ''}`);

const [usersSnap, messagesSnap, lessonsSnap] = await Promise.all([
  adminDb.collection('users').get(),
  adminDb.collection('messages').get(),
  adminDb.collection('lessons').get(),
]);

const users = new Map(usersSnap.docs.map((d) => [d.id, { uid: d.id, ...d.data() }]));
const nom = (uid) => users.get(uid)?.fullName || users.get(uid)?.email || uid?.slice(0, 8) || '?';
const role = (uid) => users.get(uid)?.role || '?';

// Une réservation existe-t-elle entre ces deux-là ? (le but final)
const reserves = new Set();
lessonsSnap.docs.forEach((d) => {
  const l = d.data();
  const eleve = l.student_id || l.student_uid;
  if (l.teacher_id && eleve) reserves.add(`${eleve}|${l.teacher_id}`);
});

// Regroupement par conversation
const convs = new Map();
for (const d of messagesSnap.docs) {
  const m = d.data();
  const cid = m.conversationId || m.conversation_id;
  const envoye = toDate(m.sent_at);
  if (!cid || !envoye) continue;
  const c = convs.get(cid) || { messages: [], premier: null };
  c.messages.push({ de: m.sender_uid || m.senderId, a: m.receiver_uid || m.receiverId, le: envoye });
  convs.set(cid, c);
}

const lignes = [];
for (const [cid, c] of convs) {
  c.messages.sort((a, b) => a.le - b.le);
  const premier = c.messages[0];
  if (!premier || premier.le < DEPUIS) continue;

  const eleveUid = ['student', 'parent'].includes(role(premier.de)) ? premier.de : premier.a;
  const profUid = eleveUid === premier.de ? premier.a : premier.de;
  if (role(profUid) !== 'teacher') continue; // on ne suit que élève/parent → prof
  if (EST_TEST(users.get(eleveUid)) || EST_TEST(users.get(profUid))) continue;
  if (role(eleveUid) === 'admin' || role(profUid) === 'admin') continue;

  const reponse = c.messages.find((m) => m.de === profUid);
  const delai = reponse ? reponse.le - premier.le : null;
  lignes.push({
    cid,
    eleveUid,
    profUid,
    premier: premier.le,
    deLEleve: c.messages.filter((m) => m.de === eleveUid).length,
    duProf: c.messages.filter((m) => m.de === profUid).length,
    delai,
    statut: reserves.has(`${eleveUid}|${profUid}`) ? 'réservé' : reponse ? 'répondu' : 'SANS RÉPONSE',
    source: users.get(eleveUid)?.acquisition?.source || '—',
  });
}
lignes.sort((a, b) => b.premier - a.premier);

console.log(`\n=== MESSAGES — ${JOURS} derniers jours — ${lignes.length} conversation(s) élève/parent → prof ===`);
console.log('(aucun contenu de message n\'est affiché)\n');
console.log('1er msg  élève                     prof                       envoyés  reçus  1re réponse  statut        source');
for (const l of lignes) {
  console.log(
    `${jjmm(l.premier).padEnd(8)} ${nom(l.eleveUid).slice(0, 25).padEnd(26)} ${nom(l.profUid).slice(0, 25).padEnd(26)} `
    + `${String(l.deLEleve).padStart(7)} ${String(l.duProf).padStart(6)}  ${duree(l.delai).padEnd(12)} ${l.statut.padEnd(13)} ${l.source}`,
  );
}

const repondues = lignes.filter((l) => l.delai !== null);
const reservees = lignes.filter((l) => l.statut === 'réservé');
const pct = (n) => (lignes.length ? `${Math.round((100 * n) / lignes.length)} %` : '—');
console.log(`\n--- Conversations ouvertes : ${lignes.length}`);
console.log(`--- Messages envoyés       : ${lignes.reduce((n, l) => n + l.deLEleve + l.duProf, 0)}`);
console.log(`--- Répondues par le prof  : ${repondues.length} (${pct(repondues.length)})`);
console.log(`--- Délai médian de réponse: ${duree(mediane(repondues.map((l) => l.delai)))}`);
console.log(`--- Ont donné une réservation : ${reservees.length} (${pct(reservees.length)})`);

const parProf = new Map();
for (const l of lignes) {
  const p = parProf.get(l.profUid) || { recues: 0, repondues: 0, delais: [] };
  p.recues += 1;
  if (l.delai !== null) { p.repondues += 1; p.delais.push(l.delai); }
  parProf.set(l.profUid, p);
}
if (parProf.size) {
  console.log('\n--- Par professeur (qui mettre en avant, et qui relancer)');
  [...parProf.entries()].sort((a, b) => b[1].recues - a[1].recues).forEach(([uid, p]) => {
    console.log(`    ${nom(uid).slice(0, 28).padEnd(29)} ${p.recues} reçue(s) · ${p.repondues} répondue(s) · médiane ${duree(mediane(p.delais))}`);
  });
}
console.log('');
process.exit(0);
