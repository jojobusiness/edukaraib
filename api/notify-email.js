// /api/notify-email.js (version améliorée avec design + lien dynamique)
import { Resend } from "resend";

const APP_BASE_URL = process.env.APP_BASE_URL || "https://edukaraib.com";
const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_TEST = "EduKaraib <onboarding@resend.dev>"; // test
const FROM_PRO = "EduKaraib <notifications@edukaraib.com>"; // pro (après vérif DKIM)

const safe = (s = "") => String(s).replace(/</g, "&lt;").replace(/>/g, "&gt;");

// 🧩 nouveau template visuel
const htmlTpl = ({
  title = "Notification",
  message = "",
  ctaText = "Ouvrir le tableau de bord",
  ctaUrl = `${APP_BASE_URL}/smart-dashboard`,
}) => `
  <div style="font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f5f7fb;padding:24px;">
    <table width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;margin:auto;background:#fff;border-radius:18px;overflow:hidden;border:1px solid #eef0f4;">
      <!-- Header -->
      <tr>
        <td style="background:#0ea5e9;padding:18px 20px;">
          <table width="100%" cellspacing="0" cellpadding="0">
            <tr>
              <td style="vertical-align:middle;">
                <span style="display:inline-flex;align-items:center;gap:10px;">
                  <img src="https://edukaraib.com/edukaraib_logo.png" alt="EduKaraib" style="width:40px;height:40px;border-radius:8px;background:#fff;display:block;border:1px solid rgba(255,255,255,.35);" />
                  <span style="color:#fff;font-weight:700;font-size:16px;letter-spacing:.2px;">EduKaraib</span>
                </span>
              </td>
              <td align="right" style="color:#dff3ff;font-weight:600;font-size:12px;">Notification</td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Corps -->
      <tr>
        <td style="padding:26px 26px 8px 26px;">
          <h1 style="margin:0 0 10px 0;font-size:20px;line-height:1.25;color:#0f172a;">${safe(title)}</h1>
          <p style="margin:0;color:#334155;font-size:15px;line-height:1.65;">${safe(message)}</p>

          <!-- CTA -->
          <div style="margin-top:18px;">
            <a href="${ctaUrl}" style="display:inline-block;background:#facc15;color:#111827;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:12px;">${safe(ctaText)}</a>
          </div>
        </td>
      </tr>

      <!-- Footer -->
      <tr><td style="padding:14px 26px 0;"><hr style="border:none;border-top:1px solid #eef0f4"/></td></tr>
      <tr>
        <td style="padding:12px 26px 24px;color:#64748b;font-size:12px;line-height:1.6;">
          <div style="font-weight:600;color:#0f172a;">L’équipe EduKaraib</div>
          <div>
            <a href="mailto:contact@edukaraib.com" style="color:#0ea5e9;text-decoration:none;">contact@edukaraib.com</a> ·
            <a href="${APP_BASE_URL}" style="color:#0ea5e9;text-decoration:none;">edukaraib.com</a>
          </div>
        </td>
      </tr>
    </table>
  </div>
`;

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

    // Body JSON sécurisé
    let data = req.body;
    if (!data || typeof data === "string") {
      try { data = JSON.parse(req.body || "{}"); } catch { data = {}; }
    }

    const { to, title, message, ctaUrl, ctaText } = data || {};

    if (!process.env.RESEND_API_KEY) {
      return res.status(500).json({ ok: false, error: "missing_RESEND_API_KEY" });
    }
    if (!to) return res.json({ ok: true, skipped: "no_email" });

    // Envoi
    let result = await resend.emails.send({
      from: FROM_TEST,
      to: [to],
      subject: title || "Notification EduKaraib",
      html: htmlTpl({ title, message, ctaUrl, ctaText }),
    });

    // Deuxième essai avec le domaine pro si dispo
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
    const msg = (e && e.response) || e?.message || String(e);
    return res.status(500).json({ ok: false, error: msg });
  }
}