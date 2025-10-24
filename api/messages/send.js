import Pusher from "pusher";
import admin from "firebase-admin";

// Init Firebase Admin (idempotent)
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

// ── CORS helper (sécurisé, minimal) ─────────────────
function setCors(res, origin) {
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export default async function handler(req, res) {
  setCors(res, req.headers.origin);

  // Préflight
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  try {
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.replace(/^Bearer\s+/i, "") || req.body?.idToken;
    if (!idToken) return res.status(401).json({ error: "missing_token" });

    const decoded = await admin.auth().verifyIdToken(idToken);
    const myUid = decoded.uid;

    const { conversationId, toUid, text } = req.body || {};
    if (!conversationId || !text || !text.trim()) {
      return res.status(400).json({ error: "bad_request" });
    }
    if (toUid && toUid === myUid) {
      return res.status(400).json({ error: "self_message_forbidden" });
    }

    const messageRef = await db.collection("messages").add({
      conversationId,
      sender_uid: myUid,
      receiver_uid: toUid || null,
      participants_uids: toUid ? [myUid, toUid] : null,
      message: text.trim(),
      sent_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    await db.collection("conversations").doc(conversationId).set(
      {
        lastMessage: text.trim(),
        lastSentAt: admin.firestore.FieldValue.serverTimestamp(),
        lastSender: myUid,
      },
      { merge: true }
    );

    await pusher.trigger(`presence-conversation-${conversationId}`, "message:new", {
      id: messageRef.id,
      conversationId,
      sender_uid: myUid,
      message: text.trim(),
    });

    return res.json({ ok: true, id: messageRef.id });
  } catch (e) {
    console.error("send error", e);
    return res.status(401).json({ error: "unauthorized" });
  }
}