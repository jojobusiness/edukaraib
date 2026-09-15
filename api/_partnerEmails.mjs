// Mails du programme partenaires — vouvoiement, sans emoji.
// Mise en page en tables + styles inline : Gmail supprime flex et gap.

const FROM = 'EduKaraib <notifications@edukaraib.com>';
const appUrl = () => process.env.APP_BASE_URL || 'https://www.edukaraib.com';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function layout(title, bodyHtml, cta) {
  const button = cta
    ? `<table cellspacing="0" cellpadding="0" style="margin-top:22px;"><tr><td style="background:#00804B;border-radius:10px;">
        <a href="${cta.url}" style="display:inline-block;padding:13px 22px;color:#ffffff;font-weight:700;font-size:15px;text-decoration:none;">${esc(cta.label)}</a>
      </td></tr></table>`
    : '';
  return `<div style="font-family:Arial,Helvetica,sans-serif;background:#f5f7fb;padding:24px;">
<table width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:auto;background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;">
  <tr><td style="background:#00804B;padding:18px 24px;border-radius:16px 16px 0 0;">
    <span style="color:#ffffff;font-weight:700;font-size:17px;">EduKaraib</span>
  </td></tr>
  <tr><td style="padding:26px;color:#334155;font-size:15px;line-height:1.65;">
    <h1 style="margin:0 0 14px;font-size:21px;color:#0f172a;">${esc(title)}</h1>
    ${bodyHtml}
    ${button}
  </td></tr>
  <tr><td style="padding:12px 26px 22px;color:#94a3b8;font-size:12px;border-top:1px solid #f1f5f9;">
    EduKaraib · <a href="mailto:contact@edukaraib.com" style="color:#00804B;">contact@edukaraib.com</a>
  </td></tr>
</table></div>`;
}

const codeBox = (code) => `<table width="100%" cellspacing="0" cellpadding="0" style="margin:18px 0;"><tr>
  <td style="background:#f0fdf4;border:2px dashed #22c55e;border-radius:12px;padding:18px;text-align:center;">
    <div style="font-size:28px;font-weight:800;letter-spacing:4px;color:#15803d;">${esc(code)}</div>
  </td></tr></table>`;

const gridTable = () => {
  const rows = [['Cours d’une heure', '−2 €', '+2 €'], ['Pack 5 h', '−10 €', '+10 €'], ['Pack 10 h', '−20 €', '+20 €']];
  return `<table width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e2e8f0;border-radius:10px;margin:14px 0;font-size:14px;">
  <tr style="background:#f8fafc;">
    <td style="padding:9px 12px;font-weight:700;color:#0f172a;">Achat de la famille</td>
    <td style="padding:9px 12px;font-weight:700;color:#0f172a;text-align:right;">Remise famille</td>
    <td style="padding:9px 12px;font-weight:700;color:#0f172a;text-align:right;">Pour vous</td>
  </tr>
  ${rows.map(([t, f, p]) => `<tr>
    <td style="padding:9px 12px;border-top:1px solid #e2e8f0;">${t}</td>
    <td style="padding:9px 12px;border-top:1px solid #e2e8f0;text-align:right;">${f}</td>
    <td style="padding:9px 12px;border-top:1px solid #e2e8f0;text-align:right;font-weight:700;color:#15803d;">${p}</td>
  </tr>`).join('')}
</table>`;
};

async function send({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY || !to) return false;
  try {
    const { Resend } = await import('resend');
    // Resend v6 renvoie { data, error } au lieu de lever une exception.
    const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({ from: FROM, to: [to], subject, html });
    if (error) { console.warn('[partner-email]', subject, error.message || error); return false; }
    return true;
  } catch (e) {
    console.warn('[partner-email]', subject, e?.message);
    return false;
  }
}

/** Bienvenue — le code est actif dès l'inscription. */
export function sendPartnerWelcomeEmail({ to, structureName, contactName, code }) {
  const hello = contactName ? `Bonjour ${esc(contactName)},` : 'Bonjour,';
  const who = esc(structureName);
  return send({
    to,
    subject: `Votre code partenaire EduKaraib : ${code}`,
    html: layout(`Le partenariat avec ${structureName} est actif`, `
      <p>${hello}</p>
      <p>Voici le code de <strong>${who}</strong>, à transmettre à vos familles :</p>
      ${codeBox(code)}
      <p>Chaque famille qui utilise ce code bénéficie de <strong>2 € de remise par heure de cours</strong>, et <strong>${who}</strong> reçoit <strong>2 € par heure</strong>, sur tous les achats de la famille pendant l’année scolaire :</p>
      ${gridTable()}
      <p>Le code s’enregistre sur le compte de la famille dès son premier paiement : ensuite la remise s’applique toute seule, pour tous ses enfants. Il est valable jusqu’au 31 juillet 2027.</p>
      <p><strong>Pour recevoir vos reversements</strong>, connectez le compte bancaire de votre structure depuis votre espace partenaire (2 minutes, via Stripe, notre prestataire de paiement). Chaque cours payé vous est ensuite reversé automatiquement, 7 jours après le paiement.</p>
      <p>Votre espace contient aussi le lien et un message prêts à transférer aux familles.</p>`,
    { url: `${appUrl()}/partenaire/espace`, label: 'Ouvrir mon espace partenaire' }),
  });
}

/** Reversement automatique effectué (transfert Stripe vers le compte du partenaire). */
export function sendPartnerPayoutEmail({ to, structureName, amountEur, reference }) {
  const amount = Number(amountEur).toFixed(2).replace('.', ',');
  return send({
    to,
    subject: `Reversement de ${amount} € — EduKaraib`,
    html: layout('Votre reversement est parti', `
      <p>Bonjour,</p>
      <p>Nous venons de reverser <strong>${amount} €</strong> à <strong>${esc(structureName)}</strong>, au titre des cours payés par vos familles.</p>
      <p>Stripe, notre prestataire de paiement, vire ce montant sur le compte bancaire que vous avez indiqué, en général sous 1 à 3 jours ouvrés.</p>
      ${reference ? `<p style="font-size:13px;color:#64748b;">Référence : ${esc(reference)}</p>` : ''}`,
    { url: `${appUrl()}/partenaire/espace`, label: 'Voir mon espace partenaire' }),
  });
}

/** Information admin : une structure vient de s'inscrire (aucune action requise). */
export function sendAdminNewPartnerEmail({ structureName, kind, email, code }) {
  return send({
    to: process.env.ADMIN_INBOX || 'contact@edukaraib.com',
    subject: `Nouveau partenaire inscrit : ${structureName}`,
    html: layout('Nouveau partenaire inscrit', `
      <p><strong>${esc(structureName)}</strong> (${esc(kind)}) — ${esc(email)}</p>
      <p>Code : <strong>${esc(code)}</strong>. Il est actif. Aucune action de votre part ; vous pouvez le désactiver dans l’onglet Partenaires de l’admin en cas d’abus.</p>`),
  });
}
