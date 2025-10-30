// /api/notify-email.js (ENVOI - Resend ESM)
import { Resend } from "resend";

const APP_BASE_URL = process.env.APP_BASE_URL || "https://edukaraib.com";
const resend = new Resend(process.env.RESEND_API_KEY || "re_bKjMkKaa_JGfC8Y2BAJ2fouRA24p7zdyn");

const FROM_TEST = "EduKaraib <onboarding@resend.dev>";          // marche même si domaine non vérifié
const FROM_PRO  = "EduKaraib <notifications@edukaraib.com>";    // utiliser après vérification du domaine Resend

const safe = (s = "") => String(s).replace(/</g, "&lt;").replace(/>/g, "&gt;");
const htmlTpl = ({ title="Notification", message="", ctaText="Ouvrir", ctaUrl=APP_BASE_URL }) => `
  <div style="font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f6f7fb;padding:24px;">
    <table width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #eef0f4;">
      <tr><td style="background:#0ea5e9;padding:16px 20px;">
        <table width="100%"><tr>
          <td><img src="https://edukaraib.com/logo.png" alt="EduKaraib" style="height:36px;display:block"/></td>
          <td align="right" style="color:#fff;font-weight:600">EduKaraib</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:24px 24px 8px 24px;">
        <h1 style="margin:0 0 8px 0;font-size:20px;color:#0f172a;">${safe(title)}</h1>
        <p style="margin:0;color:#334155;font-size:14px;line-height:1.6;">${safe(message)}</p>
        <div style="margin-top:16px;">
          <a href="${ctaUrl}" style="display:inline-block;background:#facc15;color:#111827;text-decoration:none;font-weight:600;padding:10px 16px;border-radius:10px;">${safe(ctaText)}</a>
        </div>
      </td></tr>
      <tr><td style="padding:16px 24px 0 24px;"><hr style="border:none;border-top:1px solid #eef0f4"/></td></tr>
      <tr><td style="padding:12px 24px 24px 24px;color:#64748b;font-size:12px;line-height:1.6;">
        <div style="font-weight:600;color:#0f172a;">L’équipe EduKaraib</div>
        <div>contact@edukaraib.com · edukaraib.com</div>
      </td></tr>
    </table>
  </div>`;

export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
      return res.status(204).end();
    }
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "method_not_allowed" });
    }

    // parse body robuste
    let data = req.body;
    if (!data || typeof data === "string") {
      try { data = JSON.parse(req.body || "{}"); } catch { data = {}; }
    }
    const { to, title, message, ctaUrl, ctaText } = data || {};

    if (!process.env.RESEND_API_KEY) {
      return res.status(500).json({ ok: false, error: "missing_RESEND_API_KEY" });
    }
    if (!to) {
      return res.json({ ok: true, skipped: "no_email" });
    }

    // 1er essai : expéditeur test (garanti)
    let result = await resend.emails.send({
      from: FROM_TEST,
      to: [to],
      subject: title || "Notification EduKaraib",
      html: htmlTpl({ title, message, ctaUrl, ctaText }),
    });

    // Quand ton domaine sera vérifié chez Resend, tu pourras switcher PRO :
    if (!result?.id) {
       result = await resend.emails.send({
         from: FROM_PRO,
         to: [to],
         subject: title || "Notification EduKaraib",
         html: htmlTpl({ title, message, ctaUrl, ctaText }),
       });
    }

    if (result?.id) return res.json({ ok: true, id: result.id });
    return res.status(500).json({ ok: false, error: "send_failed" });
  } catch (e) {
    // renvoyer l’erreur lisible (utile pendant le setup)
    const msg = (e && e.response) || e && e.message || String(e);
    return res.status(500).json({ ok: false, error: msg });
  }
}