import Pusher from "pusher";
import admin from "firebase-admin";

if (!admin.apps.length) {
  const svc = process.env.FIREBASE_SERVICE_ACCOUNT && JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: svc ? admin.credential.cert(svc) : admin.credential.applicationDefault() });
}
const db = admin.firestore();

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true,
});

function json(res, code, data) {
  res.status(code).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

export default async function handler(req, res) {
  try {
    // route segments après /api/
    const segments = (req.query.route || []).map(String);
    const path = `/${segments.join("/")}`;       // ex: "/pusher/auth", "/messages/send"
    const method = req.method.toUpperCase();

    // Helpers auth Firebase
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.replace(/^Bearer\s+/i, "") || (req.body && req.body.idToken);
    const verify = async () => {
      if (!idToken) throw new Error("missing_token");
      const decoded = await admin.auth().verifyIdToken(idToken);
      return decoded.uid;
    };

    // ─────────────────────────────────────────────────────────
    // ROUTES
    // ─────────────────────────────────────────────────────────

    // 1) Pusher auth (private/presence channels)
    if (method === "POST" && path === "/pusher/auth") {
      const uid = await verify();
      const { channel_name, socket_id } = req.body || {};
      if (!channel_name || !socket_id) return json(res, 400, { error: "bad_request" });

      const presenceData = { user_id: uid, user_info: { uid } };
      const authResponse = channel_name.startsWith("presence-")
        ? pusher.authorizeChannel(socket_id, channel_name, presenceData)
        : pusher.authorizeChannel(socket_id, channel_name);

      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify(authResponse));
    }

    // 2) Envoi de message (écrit Firestore + push WS)
    if (method === "POST" && path === "/messages/send") {
      const myUid = await verify();
      const { conversationId, toUid, text } = req.body || {};
      if (!conversationId || !text || !text.trim()) return json(res, 400, { error: "bad_request" });

      const messageRef = await db.collection("messages").add({
        conversationId,
        sender_uid: myUid,
        receiver_uid: toUid || null,
        participants_uids: toUid ? [myUid, toUid] : null,
        message: text.trim(),
        sent_at: admin.firestore.FieldValue.serverTimestamp(),
      });

      await db.collection("conversations").doc(conversationId).set({
        lastMessage: text.trim(),
        lastSentAt: admin.firestore.FieldValue.serverTimestamp(),
        lastSender: myUid,
      }, { merge: true });

      await pusher.trigger(`presence-conversation-${conversationId}`, "message:new", {
        id: messageRef.id,
        conversationId,
        sender_uid: myUid,
        message: text.trim(),
      });

      return json(res, 200, { ok: true, id: messageRef.id });
    }

    // (optionnel) d’autres endpoints regroupés ici plus tard…

    // 404 par défaut
    return json(res, 404, { error: "not_found", path, method });
  } catch (e) {
    console.error("API error:", e);
    return json(res, 401, { error: "unauthorized_or_failed" });
  }
}