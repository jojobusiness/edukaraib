// Cron horaire (vercel.json) — prévient Joseph quand un prof laisse une demande
// de mise en relation sans réponse. Plan PLAN_PAGE_METHODE_15-10-2026.md,
// corrigé le jour même par PLAN_MESSAGES_SECRET_CORRESPONDANCES_15-10-2026.md.
//
// ⚖️ Ce cron ne lit AUCUN message : il lit `demandes_contact`, un événement du
// service (qui a demandé quel prof, quand, et si le prof a répondu). Le secret
// des correspondances (CPCE art. L32-3) couvre le contenu ET l'identité des
// correspondants ; suivre l'exécution d'une mise en relation relève du contrat.
//
// Pourquoi ça existe : entre le 02 et le 15/10, AUCUN prof n'est revenu sur le
// site (scripts/diag-retours.mjs). Le rattrapage, c'est le coup de fil de
// Joseph — ce cron lui dit quand décrocher.
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
    const snap = await adminDb.collection('demandes_contact')
      .orderBy('created_at', 'asc')
      .limit(200)
      .get();

    for (const docSnap of snap.docs) {
      const d = docSnap.data();
      rapport.checked += 1;
      if (d.alerte_sans_reponse_at) continue;
      if (d.prof_repondu_at) { rapport.repondu += 1; continue; }

      const depuis = toDate(d.created_at);
      if (!depuis || maintenant - depuis < DELAI_MS) { rapport.trop_recent += 1; continue; }

      try {
        const profSnap = await adminDb.collection('users').doc(d.prof_uid).get();
        const prof = profSnap.exists ? profSnap.data() : {};
        const heures = Math.floor((maintenant - depuis) / 3600000);
        const prenom = d.eleve_prenom || 'Un élève';
        const profNom = prof.fullName || d.prof_nom || 'un professeur';
        const tel = prof.phone ? ` · ☎️ ${prof.phone}` : ' (aucun téléphone en base)';
        await envoyer({
          to: process.env.ADMIN_INBOX || 'edukaraib@gmail.com',
          subject: `⏰ ${prenom} attend ${profNom} depuis ${heures} h`,
          html: `<div style="font-family:Arial,Helvetica,sans-serif;line-height:1.55;color:#222">
  <h2 style="margin:0 0 12px">⏰ Une demande attend une réponse</h2>
  <p><strong>${prenom}</strong> a demandé à être mis en relation avec <strong>${profNom}</strong> il y a ${heures} heures, et le professeur n'a pas encore répondu.</p>
  <p style="font-size:14px;color:#555">Professeur : ${profNom}${tel}</p>
  <p style="margin:16px 0"><a href="https://edukaraib.com/profils/${d.prof_uid}" style="display:inline-block;background:#00804B;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Voir le professeur</a></p>
  <p style="font-size:13px;color:#666">Appelle-le : à ce stade, c'est toi le rattrapage.</p>
</div>`,
        });
        await docSnap.ref.set({ alerte_sans_reponse_at: new Date() }, { merge: true });
        rapport.alertes += 1;
      } catch (e) {
        rapport.errors += 1;
        captureError(e, { where: 'leads-sans-reponse-cron', demande: docSnap.id });
      }
    }
  } catch (e) {
    captureError(e, { where: 'leads-sans-reponse-cron' });
    return res.status(500).json({ error: 'CRON_FAILED', message: e?.message });
  }

  return res.status(200).json(rapport);
}
