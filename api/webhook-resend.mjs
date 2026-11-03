// POST /api/webhook-resend — ce que deviennent nos e-mails (03/11/2026).
// Recopié du webhook de Factur'Peyi (signature Svix, corps brut, idempotence).
// Le compte est retrouvé par l'ADRESSE du destinataire : pas besoin de faire
// passer un identifiant dans chacun des envois du site.
// Plan : docs/plans/PLAN_SUIVI_EMAILS_27-10-2026.md. Règles : api/_suiviEmails.mjs.
import { Resend } from 'resend';
import { adminDb } from './_firebaseAdmin.mjs';
import { etatApresEvenement, motifRejet } from './_suiviEmails.mjs';

export const config = { api: { bodyParser: false } };

function corpsBrut(req) {
  return new Promise((resolve, reject) => {
    const morceaux = [];
    req.on('data', (c) => morceaux.push(c));
    req.on('end', () => resolve(Buffer.concat(morceaux)));
    req.on('error', reject);
  });
}

async function comptesDe(adresse) {
  const a = String(adresse || '').trim();
  if (!a) return [];
  const [x, y] = await Promise.all([
    adminDb.collection('users').where('email', '==', a).limit(5).get(),
    a !== a.toLowerCase() ? adminDb.collection('users').where('email', '==', a.toLowerCase()).limit(5).get() : { docs: [] },
  ]);
  return [...new Map([...x.docs, ...y.docs].map((d) => [d.id, d.ref])).values()];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const secret = (process.env.RESEND_WEBHOOK_SECRET || '').trim();
  if (!secret) return res.status(500).json({ error: 'RESEND_WEBHOOK_SECRET absent' });

  const id = String(req.headers['svix-id'] || '');
  let evenement;
  try {
    evenement = new Resend(process.env.RESEND_API_KEY).webhooks.verify({
      payload: (await corpsBrut(req)).toString('utf8'),
      headers: { id, timestamp: String(req.headers['svix-timestamp'] || ''), signature: String(req.headers['svix-signature'] || '') },
      webhookSecret: secret,
    });
  } catch (e) {
    return res.status(400).json({ error: `Signature invalide : ${e.message}` });
  }

  // Livraison « au moins une fois » : marqué traité seulement après succès
  const evRef = adminDb.collection('emailEvents').doc(id || `${evenement?.data?.email_id}-${evenement?.type}`);
  if ((await evRef.get()).exists) return res.status(200).json({ deja_traite: true });

  try {
    const adresses = Array.isArray(evenement?.data?.to) ? evenement.data.to : [evenement?.data?.to].filter(Boolean);
    let maj = 0;
    for (const adresse of adresses) {
      for (const ref of await comptesDe(adresse)) {
        const ecrit = await adminDb.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          const suivant = etatApresEvenement(snap.data()?.dernierMail, evenement);
          if (!suivant) return false;
          tx.update(ref, { dernierMail: suivant });
          return true;
        });
        if (ecrit) maj += 1;
      }
      const motif = motifRejet(evenement);
      if (motif) {
        await adminDb.collection('emailsBloques').doc(String(adresse).toLowerCase()).set({
          motif, depuis: new Date(), resendId: evenement.data?.email_id || null,
        }, { merge: true });
      }
    }
    await evRef.set({ type: evenement?.type || null, traiteLe: new Date() });
    return res.status(200).json({ ok: true, comptes: maj });
  } catch (e) {
    console.error('[webhook-resend]', e?.message || e);
    return res.status(500).json({ error: 'INTERNAL' });
  }
}
