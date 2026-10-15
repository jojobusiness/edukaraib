// Cron quotidien (vercel.json) — purge les conversations inactives depuis plus
// de 12 mois, messages et pièces jointes compris (15/10/2026).
//
// Pendant 12 mois, une conversation ne peut plus être détruite par un
// participant : il la masque pour lui, elle reste en base pour un éventuel
// litige. Passé ce délai, elle part — garder sans limite serait illégal
// (RGPD art. 5-1-e) et transformerait chaque fuite en catastrophe.
//
// ⛔ Une conversation marquée `conservation_litige` (signalement reçu) n'est
//    JAMAIS purgée : c'est précisément le dossier qu'on voudra produire.
import { adminDb, bucket } from './_firebaseAdmin.mjs';
import { captureError } from './_sentry.mjs';
import { aPurger, MOIS_CONSERVATION } from './_retention.mjs';

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(500).json({ error: 'SERVER_MISCONFIGURED' });
  const authHeader = req.headers.authorization || '';
  const key = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : req.headers['x-cron-secret'];
  if (!key || key !== secret) return res.status(403).json({ error: 'FORBIDDEN' });

  const rapport = {
    mois: MOIS_CONSERVATION, examinees: 0, purgees: 0, gelees: 0,
    messages_supprimes: 0, fichiers_supprimes: 0, errors: 0,
  };

  try {
    const convs = await adminDb.collection('conversations').get();
    for (const docSnap of convs.docs) {
      rapport.examinees += 1;
      const conv = docSnap.data();
      const { purger } = aPurger(conv);
      if (conv.conservation_litige) rapport.gelees += 1;
      if (!purger) continue;

      try {
        const msgs = await adminDb.collection('messages')
          .where('conversationId', '==', docSnap.id)
          .get();

        // Les fichiers Storage ne disparaissent pas avec le document Firestore :
        // sans ça, chaque purge laisserait des photos et vidéos payantes orphelines.
        for (const m of msgs.docs) {
          for (const a of (m.data()?.attachments || [])) {
            if (!a?.storage_path) continue;
            // eslint-disable-next-line no-await-in-loop
            await bucket.file(a.storage_path).delete().then(
              () => { rapport.fichiers_supprimes += 1; },
              () => {}, // déjà supprimé : sans conséquence
            );
          }
        }

        // Par lots de 400 : au-delà, une écriture groupée Firestore est refusée.
        for (let i = 0; i < msgs.docs.length; i += 400) {
          const lot = adminDb.batch();
          msgs.docs.slice(i, i + 400).forEach((m) => lot.delete(m.ref));
          // eslint-disable-next-line no-await-in-loop
          await lot.commit();
        }
        rapport.messages_supprimes += msgs.size;

        await docSnap.ref.delete();
        rapport.purgees += 1;
      } catch (e) {
        rapport.errors += 1;
        captureError(e, { where: 'purge-conversations-cron', conversation: docSnap.id });
      }
    }
  } catch (e) {
    captureError(e, { where: 'purge-conversations-cron' });
    return res.status(500).json({ error: 'CRON_FAILED', message: e?.message });
  }

  return res.status(200).json(rapport);
}
