import { adminDb, verifyAuth } from "./_firebaseAdmin.mjs";
import { Resend } from "resend";

const APP_BASE_URL = process.env.APP_BASE_URL || "https://edukaraib.com";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  const decoded = await verifyAuth(req, res);
  if (!decoded) return;

  const uid = decoded.uid;
  const { lessonId } = req.body || {};
  if (!lessonId) {
    return res.status(400).json({ ok: false, error: "MISSING_LESSON_ID" });
  }

  try {
    const userRef = adminDb.collection("users").doc(uid);
    const userSnap = await userRef.get();

    // Déjà un coupon premier avis ? On retourne le code existant
    const existingCode = userSnap.data()?.promo?.first_review?.code;
    if (existingCode) {
      return res.json({ ok: true, code: existingCode, already: true });
    }

    // Vérifie la leçon
    const lessonSnap = await adminDb.collection("lessons").doc(lessonId).get();
    if (!lessonSnap.exists) {
      return res.status(404).json({ ok: false, error: "LESSON_NOT_FOUND" });
    }
    const lesson = lessonSnap.data();

    if (lesson.status !== "completed") {
      return res.status(403).json({ ok: false, error: "LESSON_NOT_COMPLETED" });
    }

    // Vérifie que c'est bien le parent ou l'élève lié à ce cours
    const isStudent = lesson.student_id === uid;
    const isParent =
      lesson.parent_id === uid ||
      (lesson.participantsMap &&
        Object.values(lesson.participantsMap).some(
          (p) => p.parent_id === uid || p.booked_by === uid
        ));

    if (!isStudent && !isParent) {
      return res.status(403).json({ ok: false, error: "NOT_LINKED_TO_LESSON" });
    }

    // Génère un code unique format AVIS-XXXXXX (sans caractères ambigus)
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let suffix = "";
    for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
    const code = `AVIS-${suffix}`;

    // Expire dans 90 jours
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);

    // 1) Écrit dans la collection coupons
    await adminDb.collection("coupons").add({
      code,
      type: "first_review",
      discount_eur: 5,
      used: false,
      used_at: null,
      user_uid: uid,
      user_email: userSnap.data()?.email || decoded.email,
      created_at: new Date(),
      expires_at: expiresAt,
      source_lesson_id: lessonId,
    });

    // 2) Note sur le profil user (pour éviter les doublons)
    await userRef.set(
      { promo: { first_review: { code, used: false, created_at: new Date() } } },
      { merge: true }
    );

    // 3) Mail via Resend directement (fetch interne non supporté sur Vercel)
    const email = userSnap.data()?.email || decoded.email;
    const firstName = (userSnap.data()?.firstName || userSnap.data()?.fullName || "").split(" ")[0] || "";

    const resendClient = new Resend(process.env.RESEND_API_KEY);
    const mailResult = await resendClient.emails.send({
      from: "EduKaraib <notifications@edukaraib.com>",
      to: [email],
      subject: `Merci pour ton avis${firstName ? `, ${firstName}` : ""} ! 🎟️ -5€ offerts`,
      html: `
        <div style="font-family:Inter,system-ui,sans-serif;background:#f5f7fb;padding:24px;">
          <table width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;margin:auto;background:#fff;border-radius:18px;overflow:hidden;border:1px solid #eef0f4;">
            <tr><td style="background:#0ea5e9;padding:18px 20px;">
              <span style="color:#fff;font-weight:700;font-size:16px;">EduKaraib</span>
            </td></tr>
            <tr><td style="padding:26px;">
              <h1 style="margin:0 0 10px;font-size:20px;color:#0f172a;">Merci pour ton avis${firstName ? `, ${firstName}` : ""} ! 💚</h1>
              <p style="color:#334155;font-size:15px;line-height:1.65;">
                Ton retour nous aide à améliorer EduKaraib.<br><br>
                Pour te remercier, voici un bon de réduction sur ton prochain cours :
              </p>
              <div style="background:#f0fdf4;border:2px dashed #22c55e;border-radius:12px;padding:16px;margin:16px 0;text-align:center;">
                <div style="font-size:24px;font-weight:800;letter-spacing:3px;color:#15803d;">${code}</div>
                <div style="color:#166534;font-size:14px;margin-top:6px;">💶 -5 € sur ton prochain cours · 📅 Valable 90 jours</div>
              </div>
              <p style="color:#334155;font-size:14px;">Saisis ce code au moment du paiement pour en bénéficier.</p>
              <div style="margin-top:18px;">
                <a href="${APP_BASE_URL}/search" style="background:#facc15;color:#111827;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:12px;display:inline-block;">Trouver un professeur</a>
              </div>
            </td></tr>
            <tr><td style="padding:12px 26px 24px;color:#64748b;font-size:12px;">
              L'équipe EduKaraib · <a href="mailto:contact@edukaraib.com" style="color:#0ea5e9;">contact@edukaraib.com</a>
            </td></tr>
          </table>
        </div>
      `,
    });

    if (!mailResult?.id) {
      console.error("[create-promo-first-review] mail non envoyé:", mailResult);
    }

    return res.json({ ok: true, code, already: false });

  } catch (e) {
    console.error("[create-promo-first-review] error:", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
}