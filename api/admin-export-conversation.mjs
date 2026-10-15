// Ouvrir UNE conversation depuis l'admin, pour un litige (15/10/2026).
// Même porte étroite que scripts/export-conversation.mjs, mais sans terminal :
// Joseph ne doit pas avoir à ouvrir une console pour traiter un signalement.
//
// ⚖️ EduKaraib ne lit pas les conversations (CPCE art. L32-3, et c'est écrit
// dans les CGU). Les trois seuls cas qui justifient d'en ouvrir une :
//   1. un utilisateur l'a signalée lui-même (DSA art. 16) ;
//   2. un litige dans lequel une partie la produit ou la réclame ;
//   3. une réquisition judiciaire.
// D'où le MOTIF obligatoire et la trace dans `acces_journal` : c'est elle qui
// distingue un accès légitime d'une indiscrétion, et elle protège Joseph le
// jour où on lui demandera des comptes.
import { adminDb } from './_firebaseAdmin.mjs';
import { requireAdmin } from './_adminAuth.mjs';

const MOTIF_MIN = 10;
const toDate = (v) => (v?.toDate ? v.toDate() : v ? new Date(v) : null);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const conversationId = String(body.conversationId || '').trim();
  const motif = String(body.motif || '').trim();
  if (!conversationId) return res.status(400).json({ error: 'MISSING_CONVERSATION' });
  if (motif.length < MOTIF_MIN) return res.status(400).json({ error: 'MOTIF_TROP_COURT', min: MOTIF_MIN });

  try {
    const convRef = adminDb.collection('conversations').doc(conversationId);
    const conv = await convRef.get();
    if (!conv.exists) return res.status(404).json({ error: 'CONVERSATION_INTROUVABLE' });

    const [msgs, participants] = await Promise.all([
      adminDb.collection('messages').where('conversationId', '==', conversationId).get(),
      Promise.all((conv.data().participants || []).map(async (uid) => {
        const u = await adminDb.collection('users').doc(uid).get();
        const d = u.exists ? u.data() : {};
        return { uid, nom: d.fullName || '?', role: d.role || '?', email: d.email || '' };
      })),
    ]);

    const lignes = msgs.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (toDate(a.sent_at) || 0) - (toDate(b.sent_at) || 0))
      .map((m) => {
        const qui = participants.find((p) => p.uid === (m.sender_uid || m.senderId));
        return {
          quand: toDate(m.sent_at)?.toISOString() || null,
          auteur: qui?.nom || m.sender_uid || '?',
          role: qui?.role || '?',
          texte: m.message || '',
          pieces: (m.attachments || []).map((a) => ({ type: a?.kind || 'fichier', url: a?.url || '' })),
        };
      });

    // La trace AVANT de rendre le contenu : un export sans trace n'existe pas.
    await adminDb.collection('acces_journal').add({
      type: 'export_conversation',
      par_uid: admin.uid,
      conversation_id: conversationId,
      motif,
      messages: lignes.length,
      created_at: new Date(),
    });
    // Une pièce de dossier ne part pas à la purge des 12 mois.
    await convRef.set({ conservation_litige: true, litige_depuis: new Date() }, { merge: true });

    return res.status(200).json({ conversationId, motif, participants, messages: lignes });
  } catch (e) {
    return res.status(500).json({ error: 'EXPORT_FAILED', message: e?.message });
  }
}
