// server.js
// ───────────────────────────────────────────────────────────
// Socket.io realtime chat server for EduKaraib
// ───────────────────────────────────────────────────────────

import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import admin from "firebase-admin";

// ── ENV ────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  "https://edukaraib.vercel.app",
  "http://localhost:5173",
  "http://localhost:3000",
  ...(process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(",").map(s => s.trim()).filter(Boolean) : []),
];

const PORT = process.env.PORT || 4000;

// ── Firebase Admin init ────────────────────────────────────
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(svc) });
  } else {
    admin.initializeApp();
  }
} catch (e) {
  console.error("❌ Firebase admin init error:", e);
  process.exit(1);
}

const db = admin.firestore();

// ── Express + CORS ─────────────────────────────────────────
const app = express();

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || ALLOWED_ORIGINS.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin || "*");
  }
  res.header("Vary", "Origin");
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(cors({
  origin: (origin, cb) => cb(null, !origin || ALLOWED_ORIGINS.includes(origin)),
  credentials: true,
}));
app.use(express.json());

// Healthcheck
app.get("/", (_req, res) => {
  res.json({ ok: true, service: "edukaraib-socket", time: new Date().toISOString() });
});

// Préflight explicite pour socket.io polling
app.options("/socket.io/*", (req, res) => {
  res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  return res.sendStatus(200);
});

const server = http.createServer(app);

// ── Socket.io (polling only + CORS + path strict) ─────────
const io = new Server(server, {
  path: "/socket.io",                // ⚠ doit matcher côté client
  transports: ["polling"],           // Vercel-friendly
  serveClient: true,                 // expose le client si besoin
  cors: {
    origin: (origin, cb) => cb(null, !origin || ALLOWED_ORIGINS.includes(origin)),
    credentials: true,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  },
});

// Ceinture + bretelles : ajoute les headers CORS au niveau engine
io.engine.on("headers", (headers, req) => {
  const origin = req.headers.origin;
  if (!origin || ALLOWED_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin || "*";
  }
  headers["Access-Control-Allow-Credentials"] = "true";
  headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS";
  headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Requested-With";
});

// ── Helpers ────────────────────────────────────────────────
function pairKey(a, b) {
  return [a, b].sort().join("_");
}

async function ensureConversation(uidA, uidB) {
  const key = pairKey(uidA, uidB);
  const snap = await db.collection("conversations").where("key", "==", key).limit(1).get();
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
  await db.collection("presence").doc(uid).set({
    online: true,
    lastSeen: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function setPresenceOffline(uid) {
  if (!uid) return;
  await db.collection("presence").doc(uid).set({
    online: false,
    lastSeen: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

// ── Auth middleware ────────────────────────────────────────
io.use(async (socket, next) => {
  try {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.auth?.idToken ||
      (socket.handshake.headers.authorization || "").replace(/^Bearer\s+/i, "");

    if (!token) return next();

    const decoded = await admin.auth().verifyIdToken(token);
    socket.data.uid = decoded.uid;
    await setPresenceOnline(decoded.uid);
    next();
  } catch (e) {
    console.warn("⚠️  Auth handshake failed:", e?.message || e);
    next();
  }
});

// ── Events ─────────────────────────────────────────────────
io.on("connection", (socket) => {
  const sid = socket.id;
  let authedUid = socket.data.uid || null;
  console.log("🔌 Client connected:", sid, "uid:", authedUid);

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

  socket.on("join_conversation", async ({ conversationId }, cb) => {
    if (!conversationId) return cb && cb({ ok: false, error: "missing_conversationId" });
    await socket.join(`conv:${conversationId}`);
    cb && cb({ ok: true });
  });

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

  socket.on("typing", ({ conversationId, isTyping = true }) => {
    if (!conversationId || !authedUid) return;
    socket.to(`conv:${conversationId}`).emit("typing", {
      conversationId,
      uid: authedUid,
      isTyping: !!isTyping,
      ts: Date.now(),
    });
  });

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

      const messageDoc = await db.collection("messages").add({
        conversationId: convId,
        sender_uid: authedUid,
        receiver_uid: toUid || null,
        participants_uids: toUid ? [authedUid, toUid] : null,
        message: text.trim(),
        sent_at: admin.firestore.FieldValue.serverTimestamp(),
      });

      await db.collection("conversations").doc(convId).set({
        lastMessage: text.trim(),
        lastSentAt: admin.firestore.FieldValue.serverTimestamp(),
        lastSender: authedUid,
      }, { merge: true });

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

  socket.on("mark_read", async ({ conversationId }, cb) => {
    try {
      if (!authedUid || !conversationId) return cb && cb({ ok: false, error: "bad_request" });

      await db.collection("conversations").doc(conversationId).set({
        lastRead: { [authedUid]: admin.firestore.FieldValue.serverTimestamp() },
      }, { merge: true });

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
    if (authedUid) await setPresenceOffline(authedUid);
  });
});

// ── Start ──────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`✅ Socket server running on :${PORT} (CORS: ${ALLOWED_ORIGINS.join(",")})`);
});

export default server;