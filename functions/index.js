const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const crypto = require("crypto");
const {defineString, defineSecret} = require("firebase-functions/params");

admin.initializeApp();

const db = admin.firestore();
const REGION = "europe-west1";

// Config via le module params (functions.config() supprimé en
// firebase-functions v7). RESEND_API_KEY = secret (Cloud Secret Manager),
// le reste = chaînes avec valeurs par défaut (aucune conf requise).
const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const FROM_EMAIL = defineString("MAIL_FROM", {
  default: "notifications@edukaraib.com",
});
const FROM_NAME = defineString("MAIL_FROM_NAME", {default: "EduKaraib"});
// Adresse qui reçoit une copie de TOUT message envoyé à l'admin
const ADMIN_INBOX_EMAIL = defineString("ADMIN_INBOX", {
  default: "edukaraib@gmail.com",
});

// Repli sur le sender de test Resend si le domaine pro n'est pas vérifié
// (livre au moins vers l'email du compte Resend, ex: edukaraib@gmail.com).
const FROM_TEST = "EduKaraib <onboarding@resend.dev>";

// -----------------------------------------------------------------------------
// ⚙️ Réglages d'exécution communs aux 3 fonctions (MAJ 29/08/2026)
//
// - memory 512MB : en gen1 le CPU est INDEXÉ sur la mémoire (256MB = 0,167 vCPU,
//   512MB = 0,333 vCPU). Il n'existe pas d'option `cpu` : la seule façon de
//   donner plus de CPU à ces fonctions est de monter la mémoire. 512MB divise
//   par ~2 le démarrage à froid (boot Node 22 + init firebase-admin), donc le
//   délai avant que l'email parte. Coût : ces fonctions tournent quelques
//   dizaines de fois par jour, on reste très loin du quota gratuit.
// - maxInstances 5 : garde-fou volontaire, Resend limite à 5 requêtes/seconde.
//   Ne pas monter sans throttling côté envoi.
// - minInstances : laissé à 0 (défaut). Payer des instances chaudes n'a aucun
//   sens tant que le trafic est faible ; un email n'est pas temps réel.
// - timeoutSeconds 60 : large pour un appel HTTP Resend (+ retry).
// -----------------------------------------------------------------------------
const EXEC = {timeoutSeconds: 60, memory: "512MB", maxInstances: 5};

/**
 * Envoie un email via l'API REST Resend (pas de SDK = pas de dépendance).
 * Tente l'expéditeur pro (domaine vérifié) puis retombe sur le sender de
 * test Resend. La valeur du secret n'est lisible qu'au runtime.
 * @param {{to:string, subject:string, html:string, text:string}} m
 * @return {Promise<boolean>} true si un email est bien parti.
 */
async function sendEmailResend(m) {
  const key = RESEND_API_KEY.value();
  if (!key) {
    console.error("RESEND_API_KEY manquant (secret non configuré).");
    return false;
  }
  const fromPro = `${FROM_NAME.value()} <${FROM_EMAIL.value()}>`;
  for (const from of [fromPro, FROM_TEST]) {
    try {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [m.to],
          subject: m.subject,
          html: m.html,
          text: m.text,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data && data.id) {
        console.log("Resend email sent:", data.id, "from", from);
        return true;
      }
      console.error("Resend refus:", from, resp.status,
          data && (data.message || data.name) ? (data.message || data.name) :
          JSON.stringify(data));
    } catch (e) {
      console.error("Resend fetch error:", from, e && e.message ? e.message : e);
    }
  }
  return false;
}

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
 * Helper: fabrique le contenu email {subject, html, text}
 */
// 🔒 23/10/2026 — Avant, l'e-mail reprenait le titre et le texte LIBRES de la
// notification, sans échappement HTML. Or n'importe quel compte pouvait en
// créer une pour n'importe quel inscrit : c'était un relais de mails
// « EduKaraib » (liens, images compris). Désormais :
//   - les types créés depuis le navigateur reçoivent un texte FIXE ;
//   - seuls deux types gardent leur texte : l'annonce de l'admin (la règle
//     Firestore la réserve à l'admin) et le code promo (créé par le serveur) ;
//   - tout est échappé ; un type inconnu ne part pas par e-mail.
const MODELES_EMAIL = {
  lesson_request: ["Nouvelle demande de cours", "Vous avez reçu une demande de cours sur EduKaraib. Ouvrez votre tableau de bord pour l'accepter ou la refuser."],
  review_left: ["Nouvel avis reçu", "Un élève a laissé un avis sur l'un de vos cours."],
  document_shared: ["Nouveau document de cours", "Un document a été partagé dans l'un de vos cours."],
  group_invite: ["Invitation à un cours collectif", "Un professeur vous invite à rejoindre un cours collectif."],
  group_invite_accepted: ["Invitation acceptée", "Un élève a accepté votre invitation à un cours collectif."],
  payment_due: ["Paiement à régler", "Un cours confirmé attend votre paiement."],
  cours_accepted: ["Cours accepté", "Votre cours a été accepté par le professeur."],
  cours_rejected: ["Cours refusé", "Votre demande de cours a été refusée par le professeur."],
  cours_completed: ["Cours terminé", "Votre cours est terminé. Vous pouvez laisser un avis."],
};
const TYPES_TEXTE_DE_CONFIANCE = ["admin_broadcast", "promo_first_review"];
const echapper = (t) => String(t || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Titre et texte de l'e-mail d'une notification, ou null si elle ne doit
 * pas partir par e-mail.
 * @param {object} data la notification
 * @return {{title: string, message: string}|null}
 */
function contenuEmail(data) {
  if (TYPES_TEXTE_DE_CONFIANCE.includes(data.type)) {
    return {title: data.title || "Notification EduKaraib", message: data.message || ""};
  }
  const m = MODELES_EMAIL[data.type];
  return m ? {title: m[0], message: m[1]} : null;
}

function buildEmail({title: titreBrut, message: messageBrut, createdAt}) {
  const title = echapper(titreBrut);
  const message = echapper(messageBrut);
  const subject = titreBrut || "Nouvelle notification EduKaraib";
  const text =
    (messageBrut || "Vous avez une nouvelle notification sur EduKaraib.") +
    `\n\nDate: ${createdAt || ""}\n` +
    `\nConsultez vos notifications sur votre tableau de bord.`;
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.5;color:#111">
      <h2 style="margin:0 0 12px">🔔 ${title || "Nouvelle notification EduKaraib"}</h2>
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
  return {subject, html, text};
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
    .runWith({...EXEC, secrets: [RESEND_API_KEY]})
    .firestore.document("notifications/{notifId}")
    .onCreate(async (snap, context) => {
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

      const contenu = contenuEmail(data);
      if (!contenu) {
        console.log("Pas d'e-mail pour ce type de notification :", notifId, data.type);
        return null;
      }
      const mail = buildEmail({...contenu, createdAt});

      const ok = await sendEmailResend({to, ...mail});
      if (ok) {
        await markSent(notifId);
      } else {
        await db.collection("notifications").doc(notifId).set(
            {
              email_error: "resend_send_failed",
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
/**
 * Fiche utilisateur (rôle, ville, acquisition) — pour qualifier un lead.
 * 15/10/2026 : sert à l'alerte « nouveau lead », pas aux emails d'un élève.
 */
async function getUserDoc(uid) {
  if (!uid) return null;
  try {
    const snap = await db.collection("users").doc(uid).get();
    return snap.exists ? snap.data() : null;
  } catch (e) {
    console.error("getUserDoc error:", e?.message || e);
    return null;
  }
}

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
    .runWith({...EXEC, secrets: [RESEND_API_KEY]})
    .firestore.document("messages/{msgId}")
    .onCreate(async (snap, context) => {
      const m = snap.data() || {};
      const receiverUid = m.receiver_uid || m.receiverId;
      const senderUid = m.sender_uid || m.senderId;
      const rawText = m.message || m.text || "";
      const attachments = Array.isArray(m.attachments) ? m.attachments : [];
      // Un message peut n'être QUE des pièces jointes (photo, vidéo, vocal) :
      // sans ce résumé l'email admin arriverait vide.
      const resumePieces = attachments.length ?
        attachments
            .map((a) => {
              if (a?.kind === "image") return "📷 Photo";
              if (a?.kind === "video") return "🎥 Vidéo";
              if (a?.kind === "audio") return "🎤 Message vocal";
              return `📎 ${a?.name || "Pièce jointe"}`;
            })
            .join(" · ") :
        "";
      const text = rawText || resumePieces;

      // ───────────────────────────────────────────────────────────────────
      // 🔥 DEMANDE DE MISE EN RELATION (15/10/2026, corrigé le jour même)
      //
      // ⚖️ Secret des correspondances (CPCE art. L32-3) : l'alerte envoyée ce
      // matin contenait un EXTRAIT du message. Retiré. Le secret couvre le
      // contenu ET l'identité des correspondants ; seule l'exécution du
      // contrat de mise en relation justifie de tracer l'événement lui-même.
      //
      // On enregistre donc un objet distinct de la correspondance :
      // demandes_contact/{eleveUid_profUid} — qui a demandé quel prof, quand,
      // et si le prof a répondu. Jamais ce qui a été écrit.
      // ───────────────────────────────────────────────────────────────────
      const conversationId = m.conversationId || m.conversation_id || null;
      {
        const [expediteur, destinataire] = await Promise.all([
          getUserDoc(senderUid),
          getUserDoc(receiverUid),
        ]);

        // a) Élève/parent → prof : c'est une demande de mise en relation
        if (["student", "parent"].includes(expediteur?.role) && destinataire?.role === "teacher") {
          const demandeRef = db.collection("demandes_contact").doc(`${senderUid}_${receiverUid}`);
          const prenom = (expediteur?.firstName ||
            (expediteur?.fullName || "").split(" ")[0] || "Un élève").trim();
          const profNom = destinataire?.fullName || "le professeur";
          const matiere = destinataire?.subjects ? String(destinataire.subjects) : "";
          const acq = expediteur?.acquisition || {};

          // Transaction : deux messages coup sur coup ne font qu'une demande.
          const nouvelle = await db.runTransaction(async (tx) => {
            const snapD = await tx.get(demandeRef);
            if (snapD.exists) return false;
            tx.set(demandeRef, {
              eleve_uid: senderUid,
              prof_uid: receiverUid,
              eleve_prenom: prenom,
              prof_nom: profNom,
              role: expediteur?.role || null,
              source: acq.source || null,
              campagne: acq.campaign || null,
              matiere_profil: matiere || null,
              conversation_id: conversationId,
              created_at: new Date(),
              prof_repondu_at: null,
              alerte_sans_reponse_at: null,
            });
            return true;
          }).catch((e) => {
            console.error("demande_contact transaction:", e?.message || e);
            return false;
          });

          if (nouvelle) {
            const ville = expediteur?.city ? ` · ${expediteur.city}` : "";
            const source = [acq.source, acq.campaign && `campagne ${acq.campaign}`]
                .filter(Boolean).join(" · ") || "source inconnue";
            const lienProf = `https://edukaraib.com/profils/${receiverUid}`;
            // ⛔ Aucun extrait du message : on annonce l'événement, pas son contenu.
            const okLead = await sendEmailResend({
              to: ADMIN_INBOX_EMAIL.value(),
              subject: `🔥 Nouveau lead : ${prenom} → ${profNom}` +
                `${matiere ? ` (${matiere})` : ""} — via ${acq.source || "source inconnue"}`,
              text:
                `${prenom} (${expediteur?.role || "?"}${ville}) vient de demander à être mis en relation avec ${profNom}.
` +
                `Source : ${source}
` +
                `${matiere ? `Matières du prof : ${matiere}
` : ""}` +
                `
Profil du prof : ${lienProf}
` +
                `Le contenu du message n'est pas communiqué : secret des correspondances.
` +
                `⚠️ Si le prof ne répond pas, relance-le toi-même : un lead qui attend est un lead perdu.
`,
              html: `
          <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.5;color:#111">
            <h2 style="margin:0 0 12px">🔥 Nouveau lead : ${prenom} → ${profNom}</h2>
            <p style="margin:0 0 8px"><strong>${prenom}</strong> (${expediteur?.role || "?"}${ville}) vient de demander à être mis en relation avec <strong>${profNom}</strong>.</p>
            <p style="margin:0 0 8px;font-size:13px;color:#555">Source : ${source}${matiere ? ` · Matières du prof : ${matiere}` : ""}</p>
            <p style="margin:0 0 12px;font-size:12px;color:#888">Le contenu du message n'est pas communiqué : secret des correspondances.</p>
            <p style="margin:16px 0">
              <a href="${lienProf}" style="display:inline-block;background:#00804B;color:white;padding:10px 16px;border-radius:8px;text-decoration:none">
                Voir le professeur
              </a>
            </p>
            <p style="margin:0;font-size:12px;color:#666">⚠️ Si le prof ne répond pas, relance-le toi-même : un lead qui attend est un lead perdu.</p>
          </div>`,
            });
            if (!okLead) console.error("Alerte lead : échec Resend");
          }
        }

        // b) Prof → élève/parent : la réponse. Horodater est de l'acheminement
        //    (L32-3 III), pas de l'analyse de contenu.
        if (expediteur?.role === "teacher" && ["student", "parent"].includes(destinataire?.role)) {
          const demandeRef = db.collection("demandes_contact").doc(`${receiverUid}_${senderUid}`);
          await demandeRef.set({prof_repondu_at: new Date()}, {merge: true})
              .catch((e) => console.error("prof_repondu_at:", e?.message || e));
        }
      }

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
      const piecesTexte = attachments.length ?
        `\nPièces jointes :\n${attachments.map((a) => `- ${a?.name || a?.kind || "fichier"} : ${a?.url || ""}`).join("\n")}\n` :
        "";
      const piecesHtml = attachments.length ?
        `<p style="margin:0 0 8px;font-size:13px">Pièces jointes :<br>${
          attachments
              .map((a) => `<a href="${a?.url || "#"}" style="color:#2563EB">${a?.name || a?.kind || "fichier"}</a>`)
              .join("<br>")
        }</p>` :
        "";
      const ok = await sendEmailResend({
        to: ADMIN_INBOX_EMAIL.value(),
        subject: `💬 Nouveau message de ${senderName}`,
        text:
          `${senderName} vous a écrit sur EduKaraib :\n\n` +
          `« ${text} »\n` +
          piecesTexte +
          `\nDate : ${sentAt}\n` +
          `Répondre : ${chatUrl}\n`,
        html: `
          <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.5;color:#111">
            <h2 style="margin:0 0 12px">💬 Nouveau message de ${senderName}</h2>
            <p style="margin:0 0 8px;padding:12px;background:#f3f4f6;border-radius:8px">${text || "(message vide)"}</p>
            ${piecesHtml}
            <p style="margin:0 0 8px;font-size:12px;color:#666">Date : ${sentAt}</p>
            <p style="margin:16px 0">
              <a href="${chatUrl}" style="display:inline-block;background:#2563EB;color:white;padding:10px 16px;border-radius:8px;text-decoration:none">
                Répondre dans le chat
              </a>
            </p>
          </div>`,
      });
      if (!ok) console.error("Admin message email: échec Resend");

      return null;
    });

// -----------------------------------------------------------------------------
// 🚩 Signalement d'un message par un utilisateur (15/10/2026)
//
// ⚖️ C'est la SEULE voie par laquelle un contenu de conversation arrive
// légitimement sous les yeux de l'équipe : l'utilisateur le transmet lui-même
// (DSA art. 16). Le secret des correspondances interdit la lecture d'office.
// -----------------------------------------------------------------------------
exports.onSignalementCreated = functions
    .region(REGION)
    .runWith({...EXEC, secrets: [RESEND_API_KEY]})
    .firestore.document("signalements/{id}")
    .onCreate(async (snap, context) => {
      const sg = snap.data() || {};
      const [auteur, expediteur] = await Promise.all([
        getUserDisplayName(sg.auteur_uid),
        getUserDisplayName(sg.expediteur_uid),
      ]);
      const pieces = Array.isArray(sg.pieces_jointes) ? sg.pieces_jointes : [];

      // Une conversation signalée est GELÉE : la purge des 12 mois ne la
      // touchera pas. C'est exactement le dossier qu'on voudra produire.
      if (sg.conversation_id) {
        await db.collection("conversations").doc(sg.conversation_id)
            .set({conservation_litige: true, litige_depuis: new Date()}, {merge: true})
            .catch((e) => console.error("gel conversation:", e?.message || e));
      }

      const ok = await sendEmailResend({
        to: ADMIN_INBOX_EMAIL.value(),
        subject: `🚩 Message signalé par ${auteur}`,
        text:
          `${auteur} signale un message de ${expediteur}.

` +
          `Motif : ${sg.motif || "(non précisé)"}

` +
          `Message signalé :
« ${sg.contenu_signale || "(sans texte)"} »
` +
          (pieces.length ? `
Pièces jointes :
${pieces.join(String.fromCharCode(10))}
` : "") +
          `
Conversation : ${sg.conversation_id || "?"}
`,
        html: `
          <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.5;color:#111">
            <h2 style="margin:0 0 12px">🚩 Message signalé par ${auteur}</h2>
            <p style="margin:0 0 8px">Expéditeur du message : <strong>${expediteur}</strong></p>
            <p style="margin:0 0 8px"><strong>Motif :</strong> ${sg.motif || "(non précisé)"}</p>
            <p style="margin:0 0 12px;padding:12px;background:#fef2f2;border-radius:8px">${sg.contenu_signale || "(sans texte)"}</p>
            ${pieces.length ? `<p style="margin:0 0 8px;font-size:13px">Pièces jointes :<br>${pieces.map((u) => `<a href="${u}">${u}</a>`).join("<br>")}</p>` : ""}
            <p style="margin:0;font-size:12px;color:#666">Signalement transmis par l'utilisateur lui-même (DSA art. 16).</p>
          </div>`,
      });
      if (!ok) console.error("Signalement : échec Resend");
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
    .runWith(EXEC)
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

// -----------------------------------------------------------------------------
// 🔒 Copie publique des profils (23/10/2026)
//
// `users` n'est plus lisible que par soi-même et l'admin (il contient e-mail,
// téléphone, date de naissance, compte Stripe). Ce que les AUTRES ont le droit
// de voir (vitrine d'un prof, nom et avatar d'un élève) est recopié dans
// `profils/{uid}` à chaque écriture, sur une liste blanche : profilPublic.js.
// `profils` n'est écrit que par cette fonction (règle : write false).
// -----------------------------------------------------------------------------
const {profilPublic} = require("./profilPublic");

exports.onUserWrittenSyncProfil = functions
    .region(REGION)
    .runWith({timeoutSeconds: 30, memory: "256MB"})
    .firestore.document("users/{uid}")
    .onWrite(async (change, context) => {
      const uid = context.params.uid;
      const ref = db.collection("profils").doc(uid);
      const profil = change.after.exists ?
        profilPublic(uid, change.after.data()) : null;
      if (!profil) {
        await ref.delete().catch(() => {});
        return null;
      }
      // lastSeenAt s'écrit jusqu'à 1×/h et n'est pas dans la copie : on ne
      // réécrit que si la copie publique change vraiment.
      const avant = change.before.exists ?
        profilPublic(uid, change.before.data()) : null;
      if (avant && JSON.stringify(avant) === JSON.stringify(profil)) return null;
      // set sans merge : un champ retiré de la liste blanche disparaît aussi
      await ref.set(profil);
      return null;
    });

// -----------------------------------------------------------------------------
// 🔒 Cours : accès et copie publique (23/10/2026)
//
// `lessons` n'est plus lisible que par les comptes du cours (`acces`) ; la
// page publique d'un prof lit `creneaux/{id}`, sans aucun identifiant
// d'élève. Les deux sont recalculés ici à chaque écriture d'un cours.
// Règles : functions/coursAcces.js.
// -----------------------------------------------------------------------------
const {accesDuCours, creneauPublic, memeListe, idsDuCours} = require("./coursAcces");
const {verdictGratuite, retirerGratuite} = require("./gratuites");

/**
 * À la création d'un cours : retire une gratuité injustifiée (essai déjà
 * utilisé, heures offertes en trop, code « premier avis » invalide) et
 * marque le code promo comme utilisé. Voir functions/gratuites.js.
 * @param {string} id
 * @param {object} lecon
 * @param {FirebaseFirestore.DocumentReference} ref
 * @return {Promise<void>}
 */
async function verifierGratuite(id, lecon, ref) {
  const ms = (t) => (t && t.toMillis ? t.toMillis() : Number(t) || 0);
  const l = {...lecon, _created_ms: ms(lecon.created_at)};
  const gratuit = l.is_trial === true || l.is_free_hour === true ||
    Object.values(l.participantsMap || {}).some((p) => p && (p.is_free_hour === true || p.paid_by === "trial"));
  if (!gratuit) return;

  const profSnap = l.teacher_id ? await db.collection("users").doc(String(l.teacher_id)).get() : null;
  const prof = profSnap && profSnap.exists ? profSnap.data() : null;
  const reservants = new Set(Object.values(l.participantsMap || {})
      .map((p) => p && p.booked_by).filter(Boolean));
  const eleves = new Set(idsDuCours(l).filter((x) => x !== l.teacher_id));

  let autresEssais = [];
  if (l.is_trial === true && l.teacher_id) {
    const s = await db.collection("lessons").where("teacher_id", "==", String(l.teacher_id))
        .where("is_trial", "==", true).get();
    autresEssais = s.docs.filter((d) => {
      const o = d.data();
      const ids = idsDuCours(o);
      return ids.some((x) => eleves.has(x) || reservants.has(x));
    }).map((d) => ({id: d.id, created_ms: ms(d.data().created_at)}));
  }
  let coursDuPack = [];
  if (l.pack === true && l.pack_id) {
    const s = await db.collection("lessons").where("pack_id", "==", String(l.pack_id)).get();
    coursDuPack = s.docs.map((d) => ({id: d.id, created_ms: ms(d.data().created_at), l: d.data()}));
  }
  let promoDoc = null;
  if (l.free_reason === "first_review_promo") {
    for (const owner of reservants) {
      const s = await db.collection("promo_codes").where("owner_id", "==", owner)
          .where("status", "==", "active").where("eligible_pack_hours", "==", 5).limit(1).get();
      if (!s.empty) {
        promoDoc = s.docs[0];
        break;
      }
    }
  }

  const v = verdictGratuite(id, l, {prof, autresEssais, coursDuPack, promoValide: !!promoDoc});
  if (!v.ok) {
    const tarif = Number(prof && prof.price_per_hour) || 0;
    await ref.update({...retirerGratuite(l, tarif, admin.firestore.FieldValue.delete()), gratuite_refusee_raison: v.raison});
    console.warn("[gratuité refusée]", id, v.raison);
    return;
  }
  if (v.utiliserPromo && promoDoc) {
    await promoDoc.ref.update({status: "used", used_at: admin.firestore.FieldValue.serverTimestamp(), used_lesson_id: id});
  }
}

exports.onLessonWrittenSync = functions
    .region(REGION)
    .runWith({timeoutSeconds: 30, memory: "256MB"})
    .firestore.document("lessons/{lessonId}")
    .onWrite(async (change, context) => {
      const id = context.params.lessonId;
      const refCreneau = db.collection("creneaux").doc(id);
      if (!change.after.exists) {
        await refCreneau.delete().catch(() => {});
        return null;
      }
      const lecon = change.after.data() || {};
      if (!change.before.exists) {
        try {
          await verifierGratuite(id, lecon, change.after.ref);
        } catch (e) {
          console.error("[verifierGratuite]", id, e && e.message);
        }
      }
      const lireEleve = async (sid) => {
        const s = await db.collection("students").doc(sid).get();
        return s.exists ? s.data() : null;
      };
      const acces = await accesDuCours(lecon, lireEleve);
      const creneau = creneauPublic(lecon);

      const avant = change.before.exists ? change.before.data() || {} : null;
      const creneauAvant = avant ? creneauPublic(avant) : null;
      if (!creneauAvant || JSON.stringify(creneauAvant) !== JSON.stringify(creneau)) {
        await refCreneau.set(creneau);
      }
      // Ne réécrit `acces` que s'il change : sinon la fonction se relancerait sans fin
      if (!memeListe(lecon.acces, acces)) {
        await change.after.ref.update({acces});
      }
      return null;
    });
