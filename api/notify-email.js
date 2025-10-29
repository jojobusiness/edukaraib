// /api/notify-email.js — Vercel Serverless (ESM)
import { Resend } from "resend";

const APP_BASE_URL = process.env.APP_BASE_URL || "https://edukaraib.com";
const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = process.env.MAIL_FROM || "EduKaraib <notifications@edukaraib.com>";
const TEST_FROM = "EduKaraib <onboarding@resend.dev>"; // pour tester si domaine pas encore vérifié

const safe = (s = "") => String(s).replace(/</g, "&lt;").replace(/>/g, "&gt;");
const brandedHtml = ({ title = "Notification", message = "", ctaText = "Ouvrir", ctaUrl = APP_BASE_URL }) => `
  <div style="font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f6f7fb;padding:24px;">
    <table width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #eef0f4;">
      <tr><td style="background:#0ea5e9;padding:16px 20px;">
        <table width="100%"><tr>
          <td><img src="https://edukaraib.com/logo.png" alt="EduKaraib" style="height:36px;display:block;"/></td>
          <td align="right" style="color:#fff;font-weight:600">EduKaraib</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:24px 24px 8px 24px;">
        <h1 style="margin:0 0 8px 0;font-size:20px;color:#0f172a;">${safe(title)}</h1>
        <p style="margin:0;color:#334155;font-size:14px;line-height:1.6;">${safe(message)}</p>
        <div style="margin-top:16px;"><a href="${ctaUrl}" style="display:inline-block;background:#facc15;color:#111827;text-decoration:none;font-weight:600;padding:10px 16px;border-radius:10px;">${safe(ctaText)}</a></div>
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

    // Vercel parse normalement req.body en JSON si header correct
    const { to, title, message, ctaUrl, ctaText } = req.body || {};
    if (!process.env.RESEND_API_KEY) {
      console.error("Missing RESEND_API_KEY");
      return res.status(500).json({ ok: false, error: "missing_api_key" });
    }
    if (!to) return res.json({ ok: true, skipped: "no_email" });

    // 1er essai avec expéditeur pro
    let fromAddr = FROM;
    try {
      await resend.emails.send({
        from: fromAddr,
        to: [to],
        subject: title || "Notification EduKaraib",
        html: brandedHtml({ title, message, ctaUrl, ctaText }),
      });
    } catch (e) {
      // En cas de domaine non vérifié, on retente avec l’adresse test Resend
      console.warn("Primary send failed, retrying with onboarding@resend.dev", e?.response || e);
      fromAddr = TEST_FROM;
      await resend.emails.send({
        from: fromAddr,
        to: [to],
        subject: title || "Notification EduKaraib",
        html: brandedHtml({ title, message, ctaUrl, ctaText }),
      });
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error("notify-email error:", e?.response || e);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
}