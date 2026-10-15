// Cron horaire (vercel.json) — prévient Joseph quand un prof laisse un lead
// sans réponse. Plan docs/plans/PLAN_PAGE_METHODE_15-10-2026.md (15/10/2026).
//
// Pourquoi ça existe : entre le 02 et le 15/10, AUCUN prof n'est revenu sur le
// site (scripts/diag-retours.mjs). Un élève qui écrit peut donc attendre des
// jours. Le mail au prof part déjà ; ce cron dit à Joseph quand il doit
// décrocher son téléphone — c'est lui le rattrapage, pas le produit.
//
// Une seule alerte par conversation (`admin_alerte_sans_reponse_at`), et
// uniquement entre 8 h et 21 h, heure de Paris : une alerte à 3 h du matin ne
// sert personne et apprend à ignorer les suivantes.
import { adminDb } from './_firebaseAdmin.mjs';
import { captureError } from './_sentry.mjs';

const DELAI_MS = 4 * 60 * 60 * 1000;
const HEURE_DEBUT = 8;
const HEURE_FIN = 21;
const FROM = 'EduKaraib <notifications@edukaraib.com>';

const heureParis = (d = new Date()) =>
  Number(new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', hour12: false, timeZone: 'Europe/Paris' }).format(d));

const toDate = (v) => (v?.toDate ? v.toDate() : v ? new Date(v) : null);

async function envoyer({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY || !to) return false;
  try {
    const { Resend } = await import('resend');
    // Resend v6 renvoie { data, error } au lieu de lever une exception.
    const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({ from: FROM, to: [to], subject, html });
    if (error) { console.warn('[lead-relance]', error.message || error); return false; }
    return true;
  } catch (e) {
    console.warn('[lead-relance]', e?.message);
    return false;
  }
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(500).json({ error: 'SERVER_MISCONFIGURED' });
  const authHeader = req.headers.authorization || '';
  const key = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : req.headers['x-cron-secret'];
  if (!key || key !== secret) return res.status(403).json({ error: 'FORBIDDEN' });

  const maintenant = new Date();
  const h = heureParis(maintenant);
  if (h < HEURE_DEBUT || h >= HEURE_FIN) {
    return res.status(200).json({ skipped: 'hors 8h-21h (Paris)', heure: h });
  }

  const rapport = { checked: 0, alertes: 0, repondu: 0, trop_recent: 0, errors: 0 };
  try {
    // orderBy plutôt que where('!=', null) : Firestore n'accepte l'égalité
    // que sur null, et un tri exclut déjà les conversations sans le champ.
    const snap = await adminDb.collection('conversations')
      .orderBy('lead_alerte_at', 'asc')
      .limit(200)
      .get();

    for (const docSnap of snap.docs) {
      const conv = docSnap.data();
      rapport.checked += 1;
      if (conv.admin_alerte_sans_reponse_at) continue;

      const depuis = toDate(conv.lead_alerte_at);
      if (!depuis || maintenant - depuis < DELAI_MS) { rapport.trop_recent += 1; continue; }

      try {
        // Le prof a-t-il écrit depuis ? `lastSender` suffit : s'il a répondu,
        // c'est lui le dernier à avoir parlé (ou l'élève a relancé après lui,
        // et dans ce cas on cherche un message du prof dans la conversation).
        const messages = await adminDb.collection('messages')
          .where('conversationId', '==', docSnap.id)
          .get();
        const expediteurs = new Set(messages.docs.map((d) => d.data()?.sender_uid).filter(Boolean));

        const participants = Array.isArray(conv.participants) ? conv.participants : [];
        const profils = await Promise.all(participants.map(async (uid) => {
          const u = await adminDb.collection('users').doc(uid).get();
          return { uid, ...(u.exists ? u.data() : {}) };
        }));
        const prof = profils.find((p) => p.role === 'teacher');
        const eleve = profils.find((p) => ['student', 'parent'].includes(p.role));
        if (!prof || !eleve) continue;

        if (expediteurs.has(prof.uid)) { rapport.repondu += 1; continue; }

        const heures = Math.floor((maintenant - depuis) / 3600000);
        const prenom = eleve.firstName || (eleve.fullName || '').split(' ')[0] || 'Un élève';
        const tel = prof.phone ? ` · ☎️ ${prof.phone}` : ' (aucun téléphone en base)';
        await envoyer({
          to: process.env.ADMIN_INBOX || 'edukaraib@gmail.com',
          subject: `⏰ ${prenom} attend ${prof.fullName || 'un prof'} depuis ${heures} h`,
          html: `<div style="font-family:Arial,Helvetica,sans-serif;line-height:1.55;color:#222">
  <h2 style="margin:0 0 12px">⏰ Un lead attend une réponse</h2>
  <p><strong>${prenom}</strong> a écrit à <strong>${prof.fullName || 'un professeur'}</strong> il y a ${heures} heures, et le professeur n'a pas encore répondu.</p>
  <p style="font-size:14px;color:#555">Professeur : ${prof.fullName || prof.uid}${tel}</p>
  <p style="margin:16px 0"><a href="https://edukaraib.com/profils/${prof.uid}" style="display:inline-block;background:#00804B;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Voir le professeur</a></p>
  <p style="font-size:13px;color:#666">Appelle-le : à ce stade, c'est toi le rattrapage.</p>
</div>`,
        });
        await docSnap.ref.set({ admin_alerte_sans_reponse_at: new Date() }, { merge: true });
        rapport.alertes += 1;
      } catch (e) {
        rapport.errors += 1;
        captureError(e, { where: 'leads-sans-reponse-cron', conversation: docSnap.id });
      }
    }
  } catch (e) {
    captureError(e, { where: 'leads-sans-reponse-cron' });
    return res.status(500).json({ error: 'CRON_FAILED', message: e?.message });
  }

  return res.status(200).json(rapport);
}
