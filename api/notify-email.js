// /api/notify-email.js  (Projet Vercel: edukaraib)
// Envoi d'email pro via Resend, sans CORS (même origine)

const { Resend } = require("resend");

const APP_BASE_URL = process.env.APP_BASE_URL || "https://edukaraib.com";
const resend = new Resend(process.env.RESEND_API_KEY);

// Email HTML brandé EduKaraib
function brandedHtml({ title = "Notification", message = "", ctaText = "Ouvrir", ctaUrl = APP_BASE_URL }) {
  const safe = (s = "") => String(s).replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `
  <div style="font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f6f7fb;padding:24px;">
    <table width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #eef0f4;">
      <tr>
        <td style="background:#0ea5e9;padding:16px 20px;">
          <table width="100%"><tr>
            <td style="vertical-align:middle">
              <img src="https://edukaraib.com/logo.png" alt="EduKaraib" style="height:36px;display:block;"/>
            </td>
            <td align="right" style="color:#fff;font-weight:600">EduKaraib</td>
          </tr></table>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 24px 8px 24px;">
          <h1 style="margin:0 0 8px 0;font-size:20px;color:#0f172a;">${safe(title)}</h1>
          <p style="margin:0;color:#334155;font-size:14px;line-height:1.6;">${safe(message)}</p>
          <div style="margin-top:16px;">
            <a href="${ctaUrl}" style="display:inline-block;background:#facc15;color:#111827;text-decoration:none;font-weight:600;padding:10px 16px;border-radius:10px;">${safe(ctaText)}</a>
          </div>
        </td>
      </tr>
      <tr><td style="padding:16px 24px 0 24px;"><hr style="border:none;border-top:1px solid #eef0f4"/></td></tr>
      <tr>
        <td style="padding:12px 24px 24px 24px;color:#64748b;font-size:12px;line-height:1.6;">
          <div style="font-weight:600;color:#0f172a;">L’équipe EduKaraib</div>
          <div>contact@edukaraib.com · edukaraib.com</div>
        </td>
      </tr>
    </table>
  </div>`;
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    // Préflight (si jamais appelé directement)
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const { user_id, to, title, message, ctaUrl, ctaText } = req.body || {};

    // Trouver l’email si user_id fourni (dans la même base que tes autres APIs)
    let target = to || null;

    // ⚠️ Option: si tes autres fonctions utilisent Firebase Admin côté Vercel,
    // tu peux récupérer l'email ici comme tu le fais ailleurs. Sinon, on exige `to`.
    // Pour un démarrage immédiat, si pas de `to`, on skip :
    if (!target) {
      return res.json({ ok: true, skipped: "no_email" });
    }

    await resend.emails.send({
      from: "EduKaraib <notifications@edukaraib.com>",
      to: [target],
      subject: title || "Notification EduKaraib",
      html: brandedHtml({
        title: title || "Notification EduKaraib",
        message: message || "Vous avez une nouvelle notification.",
        ctaText: ctaText || "Ouvrir",
        ctaUrl: ctaUrl || APP_BASE_URL,
      }),
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("notify-email error:", e?.response || e);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
};