/* ————————————————————————————————————————————————————————————
   Sortir UNE conversation, pour un litige, un signalement ou une réquisition.

     node --env-file=.env.local scripts/export-conversation.mjs \
       --conversation=<id> --motif="signalement de X du 15/10, harcèlement"

   ⚖️ C'est la porte de secours, et elle est volontairement étroite.
   EduKaraib ne lit pas les conversations (CPCE art. L32-3, et c'est écrit dans
   les CGU). Les trois seuls cas où ouvrir un échange se défend :
     1. un utilisateur l'a signalé lui-même (DSA art. 16) ;
     2. une partie à un litige la produit ou la réclame ;
     3. une réquisition judiciaire.

   Ce script exige donc un MOTIF, et il laisse une trace : chaque export écrit
   une ligne dans `acces_journal` (qui, quelle conversation, quand, pourquoi).
   Cette trace est la différence entre un accès légitime et une indiscrétion —
   elle protège les utilisateurs, et elle protège Joseph le jour où on lui
   demandera des comptes.

   Le fichier produit n'est PAS dans le dépôt : il va dans le dossier indiqué
   par --sortie (par défaut le dossier courant), et il contient des données
   personnelles. À supprimer dès que l'affaire est close.
   ———————————————————————————————————————————————————————————— */

import fs from 'node:fs';
import path from 'node:path';
import { adminDb } from '../api/_firebaseAdmin.mjs';

const arg = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [c, ...v] = a.replace(/^--/, '').split('=');
  return [c, v.join('=')];
}));

if (!arg.conversation || !arg.motif || arg.motif.length < 10) {
  console.error(`
⛔ Il manque --conversation ou --motif.

   --conversation=<id>   l'identifiant de la conversation
   --motif="..."         pourquoi vous l'ouvrez (10 caractères minimum)
                         ex. « signalement de Marie du 15/10, propos menaçants »
                             « réquisition gendarmerie n° 2026-123 »

   Sans motif, pas d'export : la trace fait partie de la procédure.
`);
  process.exit(1);
}

const convRef = adminDb.collection('conversations').doc(arg.conversation);
const conv = await convRef.get();
if (!conv.exists) {
  console.error('Conversation introuvable :', arg.conversation);
  process.exit(1);
}

const [msgs, participants] = await Promise.all([
  adminDb.collection('messages').where('conversationId', '==', arg.conversation).get(),
  Promise.all((conv.data().participants || []).map(async (uid) => {
    const u = await adminDb.collection('users').doc(uid).get();
    const d = u.exists ? u.data() : {};
    return { uid, nom: d.fullName || '?', role: d.role || '?', email: d.email || '' };
  })),
]);

const toDate = (v) => (v?.toDate ? v.toDate() : v ? new Date(v) : null);
const lignes = msgs.docs
  .map((d) => ({ id: d.id, ...d.data() }))
  .sort((a, b) => (toDate(a.sent_at) || 0) - (toDate(b.sent_at) || 0))
  .map((m) => {
    const qui = participants.find((p) => p.uid === (m.sender_uid || m.senderId));
    const quand = toDate(m.sent_at)?.toISOString().replace('T', ' ').slice(0, 19) || '?';
    const pj = (m.attachments || []).map((a) => `[${a?.kind || 'fichier'} ${a?.url || ''}]`).join(' ');
    return `${quand}  ${(qui?.nom || m.sender_uid || '?').padEnd(28)} ${m.message || ''}${pj ? ` ${pj}` : ''}`;
  });

const entete = [
  '=== EXPORT DE CONVERSATION — EduKaraib ===',
  `Conversation : ${arg.conversation}`,
  `Exporté le   : ${new Date().toISOString()}`,
  `Motif        : ${arg.motif}`,
  'Participants :',
  ...participants.map((p) => `  - ${p.nom} (${p.role}) ${p.email} · ${p.uid}`),
  `Messages     : ${lignes.length}`,
  '',
  "⚠️ Données personnelles. À détruire dès que l'affaire est close.",
  '='.repeat(60),
  '',
];

const contenu = entete.concat(lignes).join('\n');
const sortie = path.resolve(arg.sortie || '.', `conversation_${arg.conversation}_${Date.now()}.txt`);
fs.writeFileSync(sortie, contenu, 'utf8');

// La trace, écrite AVANT d'annoncer la réussite : un export sans trace n'existe pas.
await adminDb.collection('acces_journal').add({
  type: 'export_conversation',
  conversation_id: arg.conversation,
  motif: arg.motif,
  messages: lignes.length,
  fichier: path.basename(sortie),
  created_at: new Date(),
});

// La conversation exportée est gelée : la purge des 12 mois ne doit pas
// emporter une pièce de dossier en cours.
await convRef.set({ conservation_litige: true, litige_depuis: new Date() }, { merge: true });

console.log(`\n✅ ${lignes.length} message(s) exporté(s) dans :\n   ${sortie}`);
console.log('   Accès enregistré dans acces_journal · conversation gelée (plus de purge auto).');
console.log('   ⚠️ Fichier à détruire dès que l\'affaire est close.\n');
process.exit(0);
