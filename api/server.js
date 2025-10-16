// server.js
// ───────────────────────────────────────────────────────────
// Socket.io realtime chat server for EduKaraib
// - Auth Firebase ID token (Bearer <token> or {idToken} event)
// - Presence (online/lastSeen)
// - Ensure one conversation per pair
// - Persist messages to Firestore
// - Broadcast to conversation room
// - Typing / Read receipts
// ───────────────────────────────────────────────────────────

import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import admin from "firebase-admin";

// ── ENV ────────────────────────────────────────────────────
// Recommandé : GOOGLE_APPLICATION_CREDENTIALS pointe vers ton JSON service account
// ou bien utilise une variable FIREBASE_SERVICE_ACCOUNT (JSON) si tu préfères.
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const PORT = process.env.PORT || 4000;

// ── Firebase Admin init ────────────────────────────────────
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    // Init via JSON en variable d'env (stringifié)
    const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(svc),
    });
  } else {
    // Utilise GOOGLE_APPLICATION_CREDENTIALS ou ADC
    admin.initializeApp();
  }
} catch (e) {
  console.error("❌ Firebase admin init error:", e);
  process.exit(1);
}

const db = admin.firestore();

// ── Express + Socket.io ────────────────────────────────────
const app = express();
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    credentials: true,
  },
});

// ── Helpers Firestore ──────────────────────────────────────
function pairKey(a, b) {
  return [a, b].sort().join("_");
}

async function ensureConversation(uidA, uidB) {
  const key = pairKey(uidA, uidB);
  const snap = await db
    .collection("conversations")
    .where("key", "==", key)
    .limit(1)
    .get();

  if (!snap.empty) return { id: snap.docs[0].id, data: snap.docs[0].data() };

  const docRef = await db.collection("conversations").add({
    participants: [uidA, uidB],
    key,
    lastMessage: "",
    lastSentAt: admin.firestore.FieldValue.serverTimestamp(),
    lastSender: "",
    created_at: admin.firestore.FieldValue.serverTimestamp(),
  });

  const data = (await docRef.get()).data();
  return { id: docRef.id, data };
}

async function setPresenceOnline(uid) {
  if (!uid) return;
  await db.collection("presence").doc(uid).set(
    {
      online: true,
      lastSeen: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function setPresenceOffline(uid) {
  if (!uid) return;
  await db.collection("presence").doc(uid).set(
    {
      online: false,
      lastSeen: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

// ── Auth middleware (Socket.io) ────────────────────────────
// On accepte le token soit dans auth.handshake, soit via un 1er event "auth"
io.use(async (socket, next) => {
  try {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.auth?.idToken ||
      (socket.handshake.headers.authorization || "").replace(/^Bearer\s+/i, "");

    if (!token) {
      // On autorise la connexion "non auth" pour permettre un event 'auth' ensuite.
      // Tu peux forcer le reject si tu veux strict :
      // return next(new Error("Missing auth token"));
      return next();
    }

    const decoded = await admin.auth().verifyIdToken(token);
    socket.data.uid = decoded.uid;
    await setPresenceOnline(decoded.uid);
    next();
  } catch (e) {
    console.warn("⚠️  Auth handshake failed:", e?.message || e);
    next(); // autoriser, le client peut appeler 'auth' après
  }
});

// ── Socket events ──────────────────────────────────────────
io.on("connection", (socket) => {
  const sid = socket.id;
  let authedUid = socket.data.uid || null;

  console.log("🔌 Client connected:", sid, "uid:", authedUid);

  // Permettre auth après la connexion si besoin
  socket.on("auth", async ({ idToken } = {}, cb) => {
    try {
      const decoded = await admin.auth().verifyIdToken(idToken);
      authedUid = decoded.uid;
      socket.data.uid = authedUid;
      await setPresenceOnline(authedUid);
      cb && cb({ ok: true, uid: authedUid });
    } catch (e) {
      cb && cb({ ok: false, error: "invalid_token" });
    }
  });

  // Rejoindre un salon de conversation existant
  socket.on("join_conversation", async ({ conversationId }, cb) => {
    if (!conversationId) return cb && cb({ ok: false, error: "missing_conversationId" });
    await socket.join(`conv:${conversationId}`);
    cb && cb({ ok: true });
  });

  // Rejoindre ou créer la conversation avec un autre utilisateur (DM)
  socket.on("join_dm", async ({ otherUid }, cb) => {
    try {
      if (!authedUid) return cb && cb({ ok: false, error: "not_authenticated" });
      if (!otherUid) return cb && cb({ ok: false, error: "missing_otherUid" });

      const conv = await ensureConversation(authedUid, otherUid);
      await socket.join(`conv:${conv.id}`);
      cb && cb({ ok: true, conversationId: conv.id });
    } catch (e) {
      console.error(e);
      cb && cb({ ok: false, error: "internal_error" });
    }
  });

  // Saisie en cours
  socket.on("typing", ({ conversationId, isTyping = true }) => {
    if (!conversationId || !authedUid) return;
    socket.to(`conv:${conversationId}`).emit("typing", {
      conversationId,
      uid: authedUid,
      isTyping: !!isTyping,
      ts: Date.now(),
    });
  });

  // Envoyer un message
  // payload attendu: { conversationId? , toUid? , text }
  socket.on("send_message", async (payload = {}, cb) => {
    try {
      if (!authedUid) return cb && cb({ ok: false, error: "not_authenticated" });

      const { conversationId, toUid, text } = payload;
      if (!text || !text.trim()) return cb && cb({ ok: false, error: "empty_text" });

      let convId = conversationId;
      if (!convId) {
        if (!toUid) return cb && cb({ ok: false, error: "missing_toUid_or_conversationId" });
        const conv = await ensureConversation(authedUid, toUid);
        convId = conv.id;
      }

      // Persist message
      const messageDoc = await db.collection("messages").add({
        conversationId: convId,
        sender_uid: authedUid,
        // si tu fournis toUid côté client c'est utile mais facultatif pour l'historique
        receiver_uid: toUid || null,
        participants_uids: toUid ? [authedUid, toUid] : null,
        message: text.trim(),
        sent_at: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Update conversation metadata
      await db.collection("conversations").doc(convId).set(
        {
          lastMessage: text.trim(),
          lastSentAt: admin.firestore.FieldValue.serverTimestamp(),
          lastSender: authedUid,
        },
        { merge: true }
      );

      // Broadcast to room
      io.to(`conv:${convId}`).emit("message_created", {
        id: messageDoc.id,
        conversationId: convId,
        sender_uid: authedUid,
        message: text.trim(),
      });

      cb && cb({ ok: true, conversationId: convId, messageId: messageDoc.id });
    } catch (e) {
      console.error("send_message error:", e);
      cb && cb({ ok: false, error: "internal_error" });
    }
  });

  // Marquer comme lu
  socket.on("mark_read", async ({ conversationId }, cb) => {
    try {
      if (!authedUid || !conversationId)
        return cb && cb({ ok: false, error: "bad_request" });

      // Option simple: stocker une map lastRead[uid] = serverTimestamp
      await db
        .collection("conversations")
        .doc(conversationId)
        .set(
          {
            lastRead: {
              [authedUid]: admin.firestore.FieldValue.serverTimestamp(),
            },
          },
          { merge: true }
        );

      socket.to(`conv:${conversationId}`).emit("read", {
        conversationId,
        uid: authedUid,
        ts: Date.now(),
      });

      cb && cb({ ok: true });
    } catch (e) {
      console.error("mark_read error:", e);
      cb && cb({ ok: false, error: "internal_error" });
    }
  });

  socket.on("disconnect", async () => {
    console.log("🔌 Client disconnected:", sid, "uid:", authedUid);
    if (authedUid) {
      await setPresenceOffline(authedUid);
    }
  });
});

// ── Health & root ──────────────────────────────────────────
app.get("/", (_req, res) => {
  res.json({ ok: true, service: "edukaraib-socket", time: new Date().toISOString() });
});

// ── Start ──────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`✅ Socket server running on :${PORT} (CORS: ${ALLOWED_ORIGINS.join(",")})`);
});