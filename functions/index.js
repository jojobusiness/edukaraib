const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const postmark = require("postmark");
const crypto = require("crypto");

admin.initializeApp();

const db = admin.firestore();
const REGION = "europe-west1";

// Secrets (config)
const POSTMARK_KEY = functions.config().postmark?.key;
const FROM_EMAIL = functions.config().mail?.from || "notifications@edukaraib.com";
const FROM_NAME = functions.config().mail?.from_name || "EduKaraib";

const client = POSTMARK_KEY ? new postmark.ServerClient(POSTMARK_KEY) : null;

// Adresse qui reçoit une copie de TOUT message envoyé à l'admin
const ADMIN_INBOX_EMAIL =
  functions.config().admin?.inbox || "edukaraib@gmail.com";

/**
 * Helper: récupère l'email du destinataire à partir du user_id
 */
async function getUserEmail(userId) {
  if (!userId) return null;
  try {
    const snap = await db.collection("users").doc(userId).get();
    if (snap.exists) {
      const d = snap.data();
      return d?.email || null;
    }
  } catch (e) {
    console.error("getUserEmail error:", e);
  }
  return null;
}

/**
 * Helper: fabrique l'objet email
 */
function buildEmail({to, title, message, createdAt}) {
  const subject = title || "Nouvelle notification EduKaraib";
  const text =
    (message || "Vous avez une nouvelle notification sur EduKaraib.") +
    `\n\nDate: ${createdAt || ""}\n` +
    `\nConsultez vos notifications sur votre tableau de bord.`;
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.5;color:#111">
      <h2 style="margin:0 0 12px">🔔 ${subject}</h2>
      <p style="margin:0 0 8px">${(message || "Vous avez une nouvelle notification sur EduKaraib.")}</p>
      <p style="margin:0 0 8px;font-size:12px;color:#666">Date: ${createdAt || ""}</p>
      <p style="margin:16px 0">
        <a href="https://edukaraib.com" style="display:inline-block;background:#2563EB;color:white;padding:10px 16px;border-radius:8px;text-decoration:none">
          Ouvrir mon tableau de bord
        </a>
      </p>
      <hr style="border:none;border-top:1px solid #eee;margin:16px 0" />
      <p style="font-size:12px;color:#666">
        Cet email vous a été envoyé car vous avez un compte sur EduKaraib.
        <br/>Vous pouvez gérer vos préférences de notification dans votre profil.
      </p>
    </div>
  `;
  return {
    From: `${FROM_NAME} <${FROM_EMAIL}>`,
    To: to,
    Subject: subject,
    TextBody: text,
    HtmlBody: html,
    MessageStream: "outbound", // (Postmark) stream par défaut
  };
}

/**
 * Idempotence : on marque les notifs déjà mailées pour éviter les doublons
 */
async function markSent(notificationId) {
  try {
    await db.collection("notifications").doc(notificationId).set(
        {
          email_sent: true,
          email_sent_at: admin.firestore.FieldValue.serverTimestamp(),
        },
        {merge: true},
    );
  } catch (e) {
    console.error("markSent error:", e);
  }
}

/**
 * Firestore Trigger:
 *  - à chaque création de document dans "notifications/{id}"
 *  - on envoie un email au user_id
 */
exports.onNotificationCreated = functions
    .region(REGION)
    .runWith({timeoutSeconds: 60, memory: "256MB", maxInstances: 5})
    .firestore.document("notifications/{notifId}")
    .onCreate(async (snap, context) => {
      if (!client) {
        console.error("POSTMARK_KEY missing in functions config.");
        return null;
      }

      const notifId = context.params.notifId;
      const data = snap.data() || {};

      // si déjà envoyé (rare mais sécurité)
      if (data.email_sent) return null;

      const userId = data.user_id || data.userId;
      const to = await getUserEmail(userId);
      if (!to) {
        console.warn("No recipient email for notification:", notifId, userId);
        return null;
      }

      // anti-bruit : respect d'un éventuel champ "email_disabled"
      if (data.email_disabled) {
        console.log("Email disabled on notification:", notifId);
        return null;
      }

      // Facultatif: filtrer types (ex: on n'email pas 'payment_due' si déjà payé)
      // Ici: on envoie tout
      const createdAt = (() => {
        try {
          const ts = data.created_at;
          if (ts?.toDate) return ts.toDate().toLocaleString("fr-FR");
          if (typeof ts === "string") return new Date(ts).toLocaleString("fr-FR");
          return new Date().toLocaleString("fr-FR");
        } catch {
          return "";
        }
      })();

      const mail = buildEmail({
        to,
        title: data.title || data.type || "Notification EduKaraib",
        message: data.message || "",
        createdAt,
      });

      try {
        const res = await client.sendEmail(mail);
        console.log("Email sent:", res?.MessageID || res);
        await markSent(notifId);
      } catch (e) {
        console.error("sendEmail error:", e?.message || e);
        // trace l’erreur dans la notif pour debug
        await db.collection("notifications").doc(notifId).set(
            {
              email_error: String(e?.message || e),
              email_last_try: admin.firestore.FieldValue.serverTimestamp(),
            },
            {merge: true},
        );
      }

      return null;
    });

// -----------------------------------------------------------------------------
// 📩 Message envoyé à l'admin => email de copie sur ADMIN_INBOX_EMAIL
// -----------------------------------------------------------------------------

/** Récupère un nom lisible pour un uid (users > teachers > students > parents) */
async function getUserDisplayName(uid) {
  if (!uid) return "Un utilisateur";
  const cols = ["users", "teachers", "students", "parents"];
  for (const col of cols) {
    try {
      const snap = await db.collection(col).doc(uid).get();
      if (snap.exists) {
        const d = snap.data() || {};
        const byFL = [d.firstName, d.lastName].filter(Boolean).join(" ").trim();
        const name =
          d.fullName || d.full_name || byFL || d.name || d.displayName ||
          (typeof d.email === "string" ? d.email.split("@")[0] : "");
        if (name) return name;
      }
    } catch (e) {
      console.error("getUserDisplayName error:", col, e?.message || e);
    }
  }
  return `Utilisateur-${String(uid).slice(0, 6)}`;
}

/** Vrai si le user a le rôle admin */
async function isAdminUser(uid) {
  if (!uid) return false;
  try {
    const snap = await db.collection("users").doc(uid).get();
    return snap.exists && String(snap.data()?.role || "") === "admin";
  } catch (e) {
    console.error("isAdminUser error:", e?.message || e);
    return false;
  }
}

exports.onMessageCreated = functions
    .region(REGION)
    .runWith({timeoutSeconds: 60, memory: "256MB", maxInstances: 5})
    .firestore.document("messages/{msgId}")
    .onCreate(async (snap, context) => {
      if (!client) {
        console.error("POSTMARK_KEY missing in functions config.");
        return null;
      }

      const m = snap.data() || {};
      const receiverUid = m.receiver_uid || m.receiverId;
      const senderUid = m.sender_uid || m.senderId;
      const text = m.message || m.text || "";

      // On ne notifie que si le DESTINATAIRE est un admin
      if (!(await isAdminUser(receiverUid))) return null;

      const senderName = await getUserDisplayName(senderUid);
      const sentAt = (() => {
        try {
          const ts = m.sent_at;
          if (ts?.toDate) return ts.toDate().toLocaleString("fr-FR");
          return new Date().toLocaleString("fr-FR");
        } catch {
          return "";
        }
      })();

      const chatUrl = `https://edukaraib.com/chat/${senderUid}?from=admin`;
      const subject = `💬 Nouveau message de ${senderName}`;
      const mail = {
        From: `${FROM_NAME} <${FROM_EMAIL}>`,
        To: ADMIN_INBOX_EMAIL,
        ReplyTo: ADMIN_INBOX_EMAIL,
        Subject: subject,
        TextBody:
          `${senderName} vous a écrit sur EduKaraib :\n\n` +
          `« ${text} »\n\n` +
          `Date : ${sentAt}\n` +
          `Répondre : ${chatUrl}\n`,
        HtmlBody: `
          <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.5;color:#111">
            <h2 style="margin:0 0 12px">💬 Nouveau message de ${senderName}</h2>
            <p style="margin:0 0 8px;padding:12px;background:#f3f4f6;border-radius:8px">${text || "(message vide)"}</p>
            <p style="margin:0 0 8px;font-size:12px;color:#666">Date : ${sentAt}</p>
            <p style="margin:16px 0">
              <a href="${chatUrl}" style="display:inline-block;background:#2563EB;color:white;padding:10px 16px;border-radius:8px;text-decoration:none">
                Répondre dans le chat
              </a>
            </p>
          </div>`,
        MessageStream: "outbound",
      };

      try {
        const res = await client.sendEmail(mail);
        console.log("Admin message email sent:", res?.MessageID || res);
      } catch (e) {
        console.error("Admin message email error:", e?.message || e);
      }

      return null;
    });

// -----------------------------------------------------------------------------
// 🎟️ 1er avis => génération d’un code promo (1h bonus sur pack 5h)
// -----------------------------------------------------------------------------

function genFirstReviewCode() {
  const raw = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `AVIS-${raw.slice(0, 6)}`;
}

exports.onReviewCreatedGivePromo = functions
    .region(REGION)
    .runWith({timeoutSeconds: 60, memory: "256MB", maxInstances: 5})
    .firestore.document("reviews/{reviewId}")
    .onCreate(async (snap, context) => {
      const r = snap.data() || {};

      // ✅ Chez toi l’auteur est left_by_parent_id (prioritaire)
      const reviewerId =
      r.left_by_parent_id ||
      r.reviewer_id ||
      r.author_id ||
      r.user_id ||
      r.student_id ||
      r.created_by;

      if (!reviewerId) return null;

      const userRef = db.collection("users").doc(reviewerId);

      // ✅ stop si déjà un code “1er avis”
      const uSnap = await userRef.get();
      const existing = uSnap.data()?.promo?.first_review?.code;
      if (existing) return null;

      // ✅ vérifier cours terminé + accepter parent_id / booked_by
      if (r.lesson_id) {
        const lessonSnap = await db.collection("lessons").doc(r.lesson_id).get();
        if (!lessonSnap.exists) return null;

        const lesson = lessonSnap.data() || {};
        const st = String(lesson.status || "").toLowerCase();
        if (st !== "completed") return null;

        const participantIds = Array.isArray(lesson.participant_ids) ? lesson.participant_ids : [];
        const pm = lesson.participantsMap || {};

        const isParticipant =
        lesson.student_id === reviewerId ||
        participantIds.includes(reviewerId) ||
        !!pm[reviewerId] ||
        Object.values(pm).some((v) => v?.parent_id === reviewerId || v?.booked_by === reviewerId);

        if (!isParticipant) return null;
      }

      let issuedCode = null;

      for (let i = 0; i < 5; i++) {
        const code = genFirstReviewCode();
        const promoRef = db.collection("promo_codes").doc(code);

        try {
          await db.runTransaction(async (tx) => {
            const u = await tx.get(userRef);
            const already = u.data()?.promo?.first_review?.code;
            if (already) return; // idempotent

            tx.create(promoRef, {
              owner_id: reviewerId,
              type: "first_review_pack5_bonus1",
              bonus_hours: 1,
              eligible_pack_hours: 5,
              status: "active",
              created_at: admin.firestore.FieldValue.serverTimestamp(),
              source_review_id: context.params.reviewId,
            });

            tx.set(
                userRef,
                {
                  promo: {
                    first_review: {
                      code,
                      used: false,
                      created_at: admin.firestore.FieldValue.serverTimestamp(),
                    },
                  },
                },
                {merge: true},
            );
          });

          issuedCode = code;
          break;
        } catch (e) {
          console.error("promo code tx failed:", e?.message || e);
        }
      }

      if (!issuedCode) return null;

      // ✅ Crée une notif => ton onNotificationCreated enverra le mail
      await db.collection("notifications").add({
        user_id: reviewerId,
        read: false,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        type: "promo_first_review",
        title: "🎟️ Ton code promo est prêt !",
        promo_code: issuedCode,
        message:
        `Merci pour ton premier avis ! Voici ton code : ${issuedCode}. ` +
        `Il te donne +1h offerte en plus sur le pack 5h.`,
      });

      return null;
    });
