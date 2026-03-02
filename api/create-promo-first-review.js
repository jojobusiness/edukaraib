import { adminDb, verifyAuth } from "./_firebaseAdmin.mjs";

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
    const existing = userSnap.data()?.promo?.first_review?.code;

    if (existing) {
      return res.json({ ok: true, code: existing, already: true });
    }

    const lessonRef = adminDb.collection("lessons").doc(lessonId);
    const lessonSnap = await lessonRef.get();
    if (!lessonSnap.exists) {
      return res.status(404).json({ ok: false, error: "LESSON_NOT_FOUND" });
    }

    const lesson = lessonSnap.data();
    if (lesson.status !== "completed") {
      return res.status(403).json({ ok: false, error: "LESSON_NOT_COMPLETED" });
    }

    if (lesson.student_id !== uid) {
      return res.status(403).json({ ok: false, error: "NOT_LINKED_TO_LESSON" });
    }

    const code = `AVIS-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    await adminDb.collection("promo_codes").doc(code).set({
      owner_id: uid,
      type: "first_review_pack5_bonus1",
      bonus_hours: 1,
      eligible_pack_hours: 5,
      status: "active",
      created_at: new Date(),
      source_lesson_id: lessonId,
    });

    await userRef.set(
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

    // 🔥 Appel simple à l'API email existante
    const proto = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const origin = `${proto}://${host}`;

    const email = userSnap.data()?.email || decoded.email;

    await fetch(`${origin}/api/notify-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: email,
        title: "🎟️ Code promo débloqué",
        message: `
    Ton code promo est prêt !

    Merci pour ton premier avis sur EduKaraib 💚

    Voici ton code :

    ${code}

    Il te donne +1h offerte en plus sur un pack 5h.
        `,
        ctaText: "Utiliser mon code",
        ctaUrl: "https://edukaraib.com/recherche-prof",
      }),
    });

    return res.json({ ok: true, code });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
}