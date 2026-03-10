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

    // Génère un code unique format AVIS-XXXXXX
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let suffix = '';
    for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
    const code = `AVIS-${suffix}`;

    // Expire dans 90 jours
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);

    // 1) Écrit dans la collection coupons (même système que le coupon de bienvenue)
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

    // 3) Mail de notification
    const proto = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const origin = `${proto}://${host}`;
    const email = userSnap.data()?.email || decoded.email;
    const firstName = (userSnap.data()?.firstName || userSnap.data()?.fullName || '').split(' ')[0] || '';

    await fetch(`${origin}/api/notify-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: email,
        title: `Merci pour ton avis${firstName ? `, ${firstName}` : ''} ! 🎟️ -5€ offerts`,
        message:
          `Merci pour ton premier avis sur EduKaraib 💚\n\n` +
          `Pour te remercier, voici un bon de réduction sur ton prochain cours :\n\n` +
          `🎟️ Code : ${code}\n` +
          `💶 Valeur : -5 € sur ton prochain cours\n` +
          `📅 Valable 90 jours\n\n` +
          `Saisis ce code au moment du paiement pour en bénéficier.`,
        ctaText: "Trouver un professeur",
        ctaUrl: "https://edukaraib.com/search",
      }),
    });

    return res.json({ ok: true, code, already: false });

  } catch (e) {
    console.error('[create-promo-first-review] error:', e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
}