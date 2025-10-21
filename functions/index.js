import functions from "firebase-functions";
import admin from "firebase-admin";
import postmark from "postmark";

admin.initializeApp();

const db = admin.firestore();
const REGION = "europe-west1";

// Secrets (config)
const POSTMARK_KEY = functions.config().postmark?.key;
const FROM_EMAIL = functions.config().mail?.from || "notifications@edukaraib.com";
const FROM_NAME  = functions.config().mail?.from_name || "EduKaraib";

const client = POSTMARK_KEY ? new postmark.ServerClient(POSTMARK_KEY) : null;

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
function buildEmail({ to, title, message, createdAt }) {
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
      { merge: true }
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
export const onNotificationCreated = functions
  .region(REGION)
  .runWith({ timeoutSeconds: 60, memory: "256MB", maxInstances: 5 })
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
        { merge: true }
      );
    }

    return null;
  });