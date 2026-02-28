// api/create-promo-first-review.js
import crypto from "crypto";
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

  // cours 1-to-1
  if (lesson.student_id === uid) return true;

  // participants list
  const ids = Array.isArray(lesson.participant_ids) ? lesson.participant_ids : [];
  if (ids.includes(uid)) return true;

  // participantsMap direct
  const pm = lesson.participantsMap || {};
  if (pm[uid]) return true;

  // parent / booked_by dans participantsMap
  return Object.values(pm).some((v) => v?.parent_id === uid || v?.booked_by === uid);
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  // ✅ Auth via ton helper (Authorization: Bearer <idToken>)
  const decoded = await verifyAuth(req, res);
  if (!decoded) return; // verifyAuth a déjà répondu 401

  const uid = decoded.uid;
  const { lessonId } = req.body || {};
  if (!lessonId) return res.status(400).json({ ok: false, error: "MISSING_LESSON_ID" });

  try {
    const userRef = adminDb.collection("users").doc(uid);

    // 1) Idempotent : si déjà code => renvoie
    const userSnap = await userRef.get();
    const existing = userSnap.data()?.promo?.first_review?.code;
    if (existing) {
      return res.status(200).json({ ok: true, code: existing, already: true });
    }

    // 2) Vérifier le cours
    const lessonRef = adminDb.collection("lessons").doc(lessonId);
    const lessonSnap = await lessonRef.get();
    if (!lessonSnap.exists) {
      return res.status(404).json({ ok: false, error: "LESSON_NOT_FOUND" });
    }

    const lesson = lessonSnap.data();
    if (!isCompleted(lesson)) {
      return res.status(403).json({ ok: false, error: "LESSON_NOT_COMPLETED" });
    }

    if (!isUserLinkedToLesson(uid, lesson)) {
      return res.status(403).json({ ok: false, error: "NOT_LINKED_TO_LESSON" });
    }

    // 3) Transaction : create promo + notification
    let issuedCode = null;

    await adminDb.runTransaction(async (tx) => {
      const freshUser = await tx.get(userRef);
      const freshExisting = freshUser.data()?.promo?.first_review?.code;
      if (freshExisting) {
        issuedCode = freshExisting;
        return;
      }

      for (let i = 0; i < 5; i++) {
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

    if (!issuedCode) {
      return res.status(500).json({ ok: false, error: "CODE_GENERATION_FAILED" });
    }

    // 4) Email via ton API existante /api/notify-email (Resend)
    const email = userSnap.data()?.email || decoded.email;
    if (email) {
      const baseUrl = process.env.APP_BASE_URL || "https://edukaraib.com";
      // important sur Vercel: origin pas toujours présent => fallback baseUrl
      const origin = req.headers.origin || baseUrl;

      // On tente d’envoyer l’email, mais on ne bloque pas le succès promo si email échoue
      try {
        await fetch(`${origin}/api/notify-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: email,
            title: "🎟️ Ton code promo EduKaraib",
            message:
              `Merci pour ton premier avis ! Ton code est ${issuedCode}. ` +
              `Il te donne +1h offerte en plus sur le pack 5h.`,
            ctaText: "Utiliser mon code",
            ctaUrl: `${baseUrl}/recherche-prof`,
          }),
        });
      } catch (e) {
        console.error("[notify-email] failed:", e?.message || e);
      }
    }

    return res.status(200).json({ ok: true, code: issuedCode, already: false });
  } catch (e) {
    console.error("[create-promo-first-review] error:", e?.message || e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
}