import React, { useEffect, useState, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { auth, db } from "../lib/firebase";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  serverTimestamp,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  limit,
  deleteDoc,
  writeBatch,
} from "firebase/firestore";
import Pusher from "pusher-js";
import { io } from "socket.io-client";

// --- EMAIL HELPERS (Messages.jsx) ---

async function getUserEmail(uid) {
  if (!uid) return null;
  try {
    const snap = await getDoc(doc(db, "users", uid));
    return snap.exists() ? (snap.data().email || null) : null;
  } catch { return null; }
}

async function notifyEmailUser(uid, { title, message, ctaUrl, ctaText = "Ouvrir" }) {
  const to = await getUserEmail(uid);
  if (!to) return;
  await fetch("/api/notify-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, title, message, ctaUrl, ctaText }),
  }).catch(() => {});
}

// -------- Helpers communs --------

function pairKey(a, b) {
  return [a, b].sort().join("_");
}

async function fetchFromColById(col, uid) {
  try {
    const d = await getDoc(doc(db, col, uid));
    if (d.exists()) return { id: d.id, ...d.data(), _col: col, _mode: "byId" };
  } catch {}
  return null;
}
async function fetchFromColByUid(col, uid) {
  try {
    const qy = query(collection(db, col), where("uid", "==", uid), limit(1));
    const s = await getDocs(qy);
    if (!s.empty) {
      const d = s.docs[0];
      return { id: d.id, ...d.data(), _col: col, _mode: "byUid" };
    }
  } catch {}
  return null;
}
function buildName(p, uidFallback) {
  if (!p) return uidFallback ? `Utilisateur-${String(uidFallback).slice(0, 6)}` : "Utilisateur";
  const byFL = [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
  return (
    p.fullName ||
    p.full_name ||
    byFL ||
    p.name ||
    p.displayName ||
    (typeof p.email === "string" ? p.email.split("@")[0] : "") ||
    (uidFallback ? `Utilisateur-${String(uidFallback).slice(0, 6)}` : "Utilisateur")
  );
}
function buildAvatar(p) {
  if (!p) return "/avatar-default.png";
  return (
    p.avatarUrl ||
    p.avatar_url ||
    p.photoURL ||
    p.photo_url ||
    "/avatar-default.png"
  );
}

async function fetchUserProfile(uid) {
  if (!uid) return null;

  // 1) users
  let p =
    (await fetchFromColById("users", uid)) ||
    (await fetchFromColByUid("users", uid));
  if (p) return p;

  // 2) teachers
  p =
    (await fetchFromColById("teachers", uid)) ||
    (await fetchFromColByUid("teachers", uid));
  if (p) return p;

  // 3) students
  p =
    (await fetchFromColById("students", uid)) ||
    (await fetchFromColByUid("students", uid));
  if (p) return p;

  return null;
}

/** Trouve / crée une conversation unique entre myUid et otherUid (fallback client) */
async function ensureConversationClient(myUid, otherUid) {
  const key = pairKey(myUid, otherUid);
  const qConv = query(
    collection(db, "conversations"),
    where("key", "==", key),
    limit(1)
  );
  const snap = await getDocs(qConv);
  if (!snap.empty) return snap.docs[0].id;

  const ref = await addDoc(collection(db, "conversations"), {
    participants: [myUid, otherUid],
    key,
    lastMessage: "",
    lastSentAt: serverTimestamp(),
    lastSender: "",
    created_at: serverTimestamp(),
  });
  return ref.id;
}

/** Trouve une conversation EXISTANTE entre myUid et otherUid via participants */
async function findExistingConversationByParticipants(myUid, otherUid) {
  const qMine = query(
    collection(db, "conversations"),
    where("participants", "array-contains", myUid),
    orderBy("lastSentAt", "desc"),
    limit(20)
  );
  const snap = await getDocs(qMine);
  let found = null;
  snap.forEach((d) => {
    const c = d.data();
    if (Array.isArray(c.participants) && c.participants.includes(otherUid)) {
      if (!found) found = { id: d.id, ...c };
    }
  });
  return found?.id || null;
}

export default function Messages(props) {
  const routeParams = useParams();
  const routeReceiverId = routeParams?.id || null;
  const receiverId = props.receiverId || routeReceiverId;

  const [cid, setCid] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [receiverName, setReceiverName] = useState("");
  const [receiverAvatar, setReceiverAvatar] = useState("/avatar-default.png");
  const messagesEndRef = useRef(null);
  const navigate = useNavigate();

  const unsubRefs = useRef({ msgs: null });
  const pusherRef = useRef(null);
  const channelRef = useRef(null);

  // socket ref (évite connexions multiples)
  const socketRef = useRef(null);

  // 1) Résoudre/choisir la conversation (existante > serveur > fallback client)
  useEffect(() => {
    (async () => {
      const myUid = auth.currentUser?.uid;
      if (!myUid || !receiverId) return;

      if (myUid === receiverId) {
        alert("Impossible de discuter avec soi-même.");
        return;
      }

      // (A) Conversation existante ?
      const existingByParticipants = await findExistingConversationByParticipants(
        myUid,
        receiverId
      );
      if (existingByParticipants) {
        setCid(existingByParticipants);
        // join room côté socket (sans recréer)
        try {
          const SERVER_URL =
            import.meta.env.VITE_SOCKET_URL ||
            "https://edukaraib-server.vercel.app";
          if (!socketRef.current) {
            const s = io(SERVER_URL, {
              path: "/socket.io",
              transports: ["polling"],
              upgrade: false,
              withCredentials: true,
              reconnection: true,
              reconnectionAttempts: Infinity,
              reconnectionDelay: 1000,
              reconnectionDelayMax: 5000,
              timeout: 20000,
            });
            s.on("connect_error", (e) => {
              if (!String(e?.message || "").includes("xhr poll error")) {
                console.warn("socket connect_error", e?.message || e);
              }
            });
            socketRef.current = s;
          }
          const idToken = await auth.currentUser?.getIdToken();
          await new Promise((resolve) =>
            socketRef.current.emit("auth", { idToken }, () => resolve())
          );
          await new Promise((resolve) =>
            socketRef.current.emit(
              "join_conversation",
              { conversationId: existingByParticipants },
              () => resolve()
            )
          );
        } catch {}
        return; // ✅ utilise l'existante
      }

      // (B) Sinon, ESSAI serveur (join_dm crée si besoin côté admin)
      try {
        const SERVER_URL =
          import.meta.env.VITE_SOCKET_URL ||
          "https://edukaraib-server.vercel.app";
        if (!socketRef.current) {
          const s = io(SERVER_URL, {
            path: "/socket.io",
            transports: ["polling"],
            upgrade: false,
            withCredentials: true,
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            timeout: 20000,
          });
          s.on("connect_error", (e) => {
            if (!String(e?.message || "").includes("xhr poll error")) {
              console.warn("socket connect_error", e?.message || e);
            }
          });
          socketRef.current = s;
        }
        const idToken = await auth.currentUser?.getIdToken();
        await new Promise((resolve) =>
          socketRef.current.emit("auth", { idToken }, () => resolve())
        );
        const convId = await new Promise((resolve) => {
          socketRef.current.emit(
            "join_dm",
            { otherUid: receiverId },
            (res) => {
              if (res?.ok && res.conversationId) resolve(res.conversationId);
              else resolve(null);
            }
          );
        });
        if (convId) {
          setCid(convId);
          return; // ✅ serveur OK
        }
      } catch {
        // continue sur (C)
      }

      // (C) Dernier recours : créer côté client
      const convIdFallback = await ensureConversationClient(myUid, receiverId);
      setCid(convIdFallback);
    })();

    return () => {
      // on garde la socket pour ce composant
    };
  }, [receiverId]);

  // 2) Profil interlocuteur
  useEffect(() => {
    (async () => {
      if (!receiverId) return;
      const p = await fetchUserProfile(receiverId);
      setReceiverName(buildName(p, receiverId));
      setReceiverAvatar(buildAvatar(p));
    })();
  }, [receiverId]);

  // 3) Flux messages Firestore (source de vérité)
  useEffect(() => {
    if (!cid) return;
    const qMsg = query(
      collection(db, "messages"),
      where("conversationId", "==", cid),
      orderBy("sent_at", "asc")
    );
    const unsub = onSnapshot(
      qMsg,
      (snap) => {
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setMessages(data);
      },
      (err) => {
        console.warn(
          "onSnapshot messages error:",
          err?.code || err?.message || err
        );
      }
    );
    unsubRefs.current.msgs = unsub;
    return () => unsub();
  }, [cid]);

  // 4) Pusher temps réel (optionnel)
  useEffect(() => {
    let mounted = true;

    async function setupPusher() {
      if (!cid) return;
      const key = import.meta.env.VITE_PUSHER_KEY;
      const cluster = import.meta.env.VITE_PUSHER_CLUSTER;
      if (!key || !cluster) {
        console.warn(
          "Pusher env vars manquantes (VITE_PUSHER_KEY / VITE_PUSHER_CLUSTER)."
        );
        return;
      }
      const idToken = await auth.currentUser?.getIdToken();
      if (!mounted) return;

      const pusher = new Pusher(key, {
        cluster,
        authEndpoint: "/api/pusher/auth",
        auth: {
          headers: { Authorization: `Bearer ${idToken || ""}` },
        },
      });
      pusherRef.current = pusher;

      const channelName = `presence-conversation-${cid}`;
      const channel = pusher.subscribe(channelName);
      channelRef.current = channel;

      channel.bind("message:new", () => {
        // Firestore pousse déjà via onSnapshot; on peut ignorer
      });
    }

    setupPusher();

    return () => {
      mounted = false;
      try {
        const ch = channelRef.current;
        if (ch) {
          ch.unbind_all();
          const p = pusherRef.current;
          if (p) p.unsubscribe(ch.name);
        }
      } catch {}
      channelRef.current = null;
      try {
        const p = pusherRef.current;
        if (p) p.disconnect();
      } catch {}
      pusherRef.current = null;
    };
  }, [cid]);

  // 5) Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 6) Envoi via API -> fallback Firestore si besoin
  const handleSend = async (e) => {
    e.preventDefault();
    if (sending) return;
    const myUid = auth.currentUser?.uid;
    const text = newMessage.trim();
    if (!text) return;

    try {
      setSending(true);

      // s’assurer d’un conversationId
      let conversationId = cid;
      if (!myUid || !receiverId) throw new Error("Destinataire introuvable.");
      if (!conversationId) {
        conversationId =
          (await findExistingConversationByParticipants(myUid, receiverId)) ||
          (await ensureConversationClient(myUid, receiverId));
        setCid(conversationId);
      }

      // 1) tentative API
      try {
        const idToken = await auth.currentUser?.getIdToken();
        const res = await fetch("/api/messages/send", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken || ""}`,
          },
          body: JSON.stringify({ conversationId, toUid: receiverId, text }),
        });
        if (!res.ok) throw new Error("api_failed");
        setNewMessage("");
        // --- ENVOI EMAIL AU DESTINATAIRE ---
        notifyEmailUser(receiverId, {
          title: "Nouveau message sur EduKaraib",
          message: text,
          ctaUrl: `${window.location.origin}/messages`,
          ctaText: "Ouvrir la conversation",
        });
        // --- /ENVOI EMAIL ---
        return;
      } catch {
        // 2) fallback Firestore
        await addDoc(collection(db, "messages"), {
          conversationId,
          sender_uid: myUid,
          receiver_uid: receiverId,
          participants_uids: [myUid, receiverId],
          message: text,
          sent_at: serverTimestamp(),
        });

        await updateDoc(doc(db, "conversations", conversationId), {
          lastMessage: text,
          lastSentAt: serverTimestamp(),
          lastSender: myUid,
        });

        // --- ENVOI EMAIL AU DESTINATAIRE ---
        notifyEmailUser(receiverId, {
          title: "Nouveau message sur EduKaraib",
          message: text,
          ctaUrl: `${window.location.origin}/messages`,
          ctaText: "Ouvrir la conversation",
        });
        // --- /ENVOI EMAIL ---

        setNewMessage("");
        return;
      }
    } catch (err) {
      console.warn("send failed:", err?.message || err);
      alert("Échec de l’envoi du message. Réessayez.");
    } finally {
      setSending(false);
    }
  };

  // Suppression (hard/soft) — complet
  async function tryHardDeleteConversation(conversationId, myUid) {
    const convSnap = await getDoc(doc(db, "conversations", conversationId));
    if (!convSnap.exists()) throw new Error("Conversation introuvable.");
    const conv = convSnap.data();
    if (
      !Array.isArray(conv.participants) ||
      !conv.participants.includes(myUid)
    ) {
      throw new Error("Accès refusé.");
    }

    while (true) {
      const qMsgs = query(
        collection(db, "messages"),
        where("conversationId", "==", conversationId),
        limit(400)
      );
      const snap = await getDocs(qMsgs);
      if (snap.empty) break;

      const batch = writeBatch(db);
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }

    await deleteDoc(doc(db, "conversations", conversationId));
  }

  async function softDeleteForUser(conversationId, myUid) {
    await updateDoc(doc(db, "conversations", conversationId), {
      hiddenFor:
        (window.firebase?.firestore?.FieldValue ||
          (await import("firebase/firestore"))).arrayUnion(myUid),
    }).catch(() => {});
  }

  const handleDeleteConversation = async () => {
    const myUid = auth.currentUser?.uid;
    if (!myUid || !cid) return;

    const ok = window.confirm(
      "Supprimer cette discussion ?\nTous les messages seront définitivement effacés (ou masqués si la suppression est refusée)."
    );
    if (!ok) return;

    try {
      unsubRefs.current.msgs?.();
    } catch {}

    try {
      await tryHardDeleteConversation(cid, myUid);
    } catch {
      await softDeleteForUser(cid, myUid);
    }

    if (typeof props.onBack === "function") props.onBack();
    else navigate("/chat-list");
  };

  if (!receiverId) return <div className="p-4">Chargement…</div>;

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white p-4 shadow flex items-center gap-3">
        <button
          onClick={props.onBack || (() => navigate("/dashboard"))}
          className="text-sm px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50"
        >
          ← Retour
        </button>

        <img
          src={receiverAvatar || "/avatar-default.png"}
          alt="Avatar"
          className="w-10 h-10 rounded-full object-cover ml-2"
        />
        <h2 className="text-lg font-semibold flex-1">
          {receiverName || "Utilisateur"}
        </h2>

        <button
          onClick={handleDeleteConversation}
          className="text-sm px-3 py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
          title="Supprimer la discussion"
          disabled={sending}
        >
          Supprimer
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((m) => {
          const myUid = auth.currentUser?.uid;
          const isMine = m.sender_uid === myUid;
          return (
            <div
              key={m.id}
              className={`flex flex-col max-w-xs ${
                isMine ? "ml-auto items-end" : "mr-auto items-start"
              }`}
            >
              <div
                className={`px-4 py-2 rounded-2xl shadow ${
                  isMine
                    ? "bg-primary text-white rounded-br-none"
                    : "bg-gray-200 text-gray-900 rounded-bl-none"
                }`}
              >
                {m.message}
              </div>
              <span className="text-xs text-gray-500 mt-1">
                {isMine ? "Moi" : receiverName || "Utilisateur"} •{" "}
                {m.sent_at?.toDate
                  ? m.sent_at.toDate().toLocaleTimeString()
                  : ""}
              </span>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Formulaire */}
      <form
        onSubmit={handleSend}
        className="p-3 bg-white border-t flex gap-2 items-center"
      >
        <input
          type="text"
          placeholder="Votre message..."
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          className="flex-1 border rounded-full px-4 py-2 outline-none"
        />
        <button
          type="submit"
          disabled={sending || !newMessage.trim()}
          className="bg-primary text-white px-4 py-2 rounded-full shadow hover:bg-primary-dark transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Envoyer
        </button>
      </form>
    </div>
  );
}