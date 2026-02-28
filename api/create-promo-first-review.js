// api/create-promo-first-review.js
import crypto from "crypto";
import { Resend } from "resend";
import { adminDb, verifyAuth } from "./_firebaseAdmin.mjs";

function makeCode() {
  const raw = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `AVIS-${raw.slice(0, 6)}`;
}

function isCompleted(lesson) {
  return String(lesson?.status || "").toLowerCase() === "completed";
}

function isUserLinkedToLesson(uid, lesson) {
  if (!lesson) return false;

  if (lesson.student_id === uid) return true;

  const ids = Array.isArray(lesson.participant_ids) ? lesson.participant_ids : [];
  if (ids.includes(uid)) return true;

  const pm = lesson.participantsMap || {};
  if (pm[uid]) return true;

  return Object.values(pm).some((v) => v?.parent_id === uid || v?.booked_by === uid);
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  const decoded = await verifyAuth(req, res);
  if (!decoded) return; // verifyAuth a déjà répondu

  const uid = decoded.uid;
  const { lessonId } = req.body || {};
  if (!lessonId) return res.status(400).json({ ok: false, error: "MISSING_LESSON_ID" });

  try {
    const userRef = adminDb.collection("users").doc(uid);

    // 1) idempotent : déjà code ?
    const userSnap = await userRef.get();
    const existing = userSnap.data()?.promo?.first_review?.code;
    if (existing) {
      return res.status(200).json({ ok: true, code: existing, already: true, emailSent: false });
    }

    // 2) check lesson
    const lessonRef = adminDb.collection("lessons").doc(lessonId);
    const lessonSnap = await lessonRef.get();
    if (!lessonSnap.exists) return res.status(404).json({ ok: false, error: "LESSON_NOT_FOUND" });

    const lesson = lessonSnap.data();
    if (!isCompleted(lesson)) return res.status(403).json({ ok: false, error: "LESSON_NOT_COMPLETED" });
    if (!isUserLinkedToLesson(uid, lesson)) {
      return res.status(403).json({ ok: false, error: "NOT_LINKED_TO_LESSON" });
    }

    // 3) transaction create promo + notif
    let issuedCode = null;

    await adminDb.runTransaction(async (tx) => {
      const freshUser = await tx.get(userRef);
      const freshExisting = freshUser.data()?.promo?.first_review?.code;
      if (freshExisting) {
        issuedCode = freshExisting;
        return;
      }

      for (let i = 0; i < 8; i++) {
        const code = makeCode();
        const promoRef = adminDb.collection("promo_codes").doc(code);

        const promoSnap = await tx.get(promoRef);
        if (promoSnap.exists) continue;

        tx.create(promoRef, {
          owner_id: uid,
          type: "first_review_pack5_bonus1",
          bonus_hours: 1,
          eligible_pack_hours: 5,
          status: "active",
          created_at: new Date(),
          source_lesson_id: lessonId,
        });

        tx.set(
          userRef,
          {
            promo: {
              first_review: {
                code,
                used: false,
                created_at: new Date(),
              },
            },
          },
          { merge: true }
        );

        tx.create(adminDb.collection("notifications").doc(), {
          user_id: uid,
          read: false,
          created_at: new Date(),
          type: "promo_first_review",
          title: "🎟️ Ton code promo est prêt !",
          promo_code: code,
          message:
            `Merci pour ton premier avis ! Voici ton code : ${code}. ` +
            `Il te donne +1h offerte en plus quand tu prends un pack 5h.`,
        });

        issuedCode = code;
        break;
      }
    });

    if (!issuedCode) return res.status(500).json({ ok: false, error: "CODE_GENERATION_FAILED" });

    // 4) Email direct Resend (plus fiable que fetch /api/notify-email)
    let emailSent = false;
    const resendKey = process.env.RESEND_API_KEY || "";
    const email = userSnap.data()?.email || decoded.email;

    if (resendKey && email) {
      try {
        const resend = new Resend(resendKey);

        const APP_BASE_URL = process.env.APP_BASE_URL || "https://edukaraib.com";
        const FROM_TEST = "EduKaraib <onboarding@resend.dev>";
        const FROM_PRO = "EduKaraib <notifications@edukaraib.com>";

        const html = `
          <div style="font-family:Arial,sans-serif;line-height:1.5">
            <h2>🎟️ Ton code promo est prêt !</h2>
            <p>Merci pour ton premier avis. Voici ton code :</p>
            <p style="font-size:20px;font-weight:700">${issuedCode}</p>
            <p>Il te donne <b>+1h offerte en plus</b> sur un <b>pack 5h</b>.</p>
            <p><a href="${APP_BASE_URL}/recherche-prof">Utiliser mon code</a></p>
          </div>
        `;

        let result = await resend.emails.send({
          from: FROM_TEST,
          to: [email],
          subject: "🎟️ Ton code promo EduKaraib",
          html,
        });

        // second try (sender pro)
        if (!result?.id) {
          result = await resend.emails.send({
            from: FROM_PRO,
            to: [email],
            subject: "🎟️ Ton code promo EduKaraib",
            html,
          });
        }

        emailSent = !!result?.id;
      } catch (e) {
        console.error("[resend] failed:", e?.message || e);
      }
    }

    return res.status(200).json({ ok: true, code: issuedCode, already: false, emailSent });
  } catch (e) {
    console.error("[create-promo-first-review] error:", e?.message || e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", details: e?.message });
  }
}