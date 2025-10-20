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
import { io } from "socket.io-client";

// ── CONFIG SOCKET ──────────────────────────────────────────
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:4000";

// -------- Helpers --------
function pairKey(a, b) {
  return [a, b].sort().join("_");
}

async function fetchUserProfile(uid) {
  if (!uid) return null;
  try {
    const d = await getDoc(doc(db, "users", uid));
    if (d.exists()) return { id: uid, ...d.data() };
  } catch {}
  try {
    const q = query(collection(db, "users"), where("uid", "==", uid), limit(1));
    const s = await getDocs(q);
    if (!s.empty) {
      const d = s.docs[0];
      return { id: d.id, ...d.data() };
    }
  } catch {}
  return null;
}

/** Trouve / crée une conversation unique entre myUid et otherUid */
async function ensureConversation(myUid, otherUid) {
  const key = pairKey(myUid, otherUid);
  const qConv = query(collection(db, "conversations"), where("key", "==", key), limit(1));
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

export default function Messages(props) {
  const routeParams = useParams();
  const routeReceiverId = routeParams?.id || null;
  const receiverId = props.receiverId || routeReceiverId;

  const [cid, setCid] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [receiverName, setReceiverName] = useState("");
  const [receiverAvatar, setReceiverAvatar] = useState("");
  const messagesEndRef = useRef(null);
  const navigate = useNavigate();

  const unsubRefs = useRef({ msgs: null });
  const socketRef = useRef(null);

  // 0) Init socket (une seule fois)
  useEffect(() => {
    const socket = io(SOCKET_URL, {
      autoConnect: false,
      auth: async (cb) => {
        const current = auth.currentUser;
        const idToken = current ? await current.getIdToken() : null;
        cb({ token: idToken });
      },
    });
    socket.connect();

    socket.on("connect", async () => {
      try {
        const current = auth.currentUser;
        const idToken = current ? await current.getIdToken() : null;
        if (idToken) socket.emit("auth", { idToken }, () => {});
      } catch {}
    });

    socketRef.current = socket;
    return () => {
      try { socket.disconnect(); } catch {}
      socketRef.current = null;
    };
  }, []);

  // 1) Résoudre/Créer la conversation
  useEffect(() => {
    (async () => {
      const myUid = auth.currentUser?.uid;
      if (!myUid || !receiverId) return;
      const conversationId = await ensureConversation(myUid, receiverId);
      setCid(conversationId);

      try {
        socketRef.current?.emit("join_dm", { otherUid: receiverId }, () => {});
      } catch {}
    })();
  }, [receiverId]);

  // 2) Charger le profil interlocuteur
  useEffect(() => {
    (async () => {
      if (!receiverId) return;
      const p = await fetchUserProfile(receiverId);
      setReceiverName(p?.fullName || p?.name || p?.displayName || "Utilisateur");
      setReceiverAvatar(
        p?.avatarUrl || p?.avatar_url || p?.photoURL || "/avatar-default.png"
      );
    })();
  }, [receiverId]);

  // 3) Flux messages
  useEffect(() => {
    if (!cid) return;
    const qMsg = query(
      collection(db, "messages"),
      where("conversationId", "==", cid),
      orderBy("sent_at", "asc")
    );
    const unsub = onSnapshot(qMsg, (snap) => {
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setMessages(data);
    });
    unsubRefs.current.msgs = unsub;
    return () => unsub();
  }, [cid]);

  // 4) Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 5) Envoi via Socket.io (persistance côté serveur)
  const handleSend = async (e) => {
    e.preventDefault();
    const myUid = auth.currentUser?.uid;
    if (!newMessage.trim() || !myUid || !cid || !receiverId) return;

    const socket = socketRef.current;
    const text = newMessage.trim();

    socket?.emit(
      "send_message",
      { conversationId: cid, toUid: receiverId, text },
      (res) => {
        if (!res?.ok) {
          addDoc(collection(db, "messages"), {
            conversationId: cid,
            sender_uid: myUid,
            receiver_uid: receiverId,
            participants_uids: [myUid, receiverId],
            message: text,
            sent_at: serverTimestamp(),
          }).then(() => {
            updateDoc(doc(db, "conversations", cid), {
              lastMessage: text,
              lastSentAt: serverTimestamp(),
              lastSender: myUid,
            });
          });
        }
      }
    );

    setNewMessage("");
  };

  /** HARD DELETE: supprime messages + doc conversation (limite 500/commit) */
  async function tryHardDeleteConversation(conversationId, myUid) {
    const convSnap = await getDoc(doc(db, "conversations", conversationId));
    if (!convSnap.exists()) throw new Error("Conversation introuvable.");
    const conv = convSnap.data();
    if (!Array.isArray(conv.participants) || !conv.participants.includes(myUid)) {
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

  /** SOFT DELETE: masque la conversation pour l'utilisateur courant */
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

    try { unsubRefs.current.msgs?.(); } catch {}

    try {
      await tryHardDeleteConversation(cid, myUid);
    } catch {
      await softDeleteForUser(cid, myUid);
    }

    // back to list if wrapper present, else dashboard
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
        <h2 className="text-lg font-semibold flex-1">{receiverName}</h2>

        {/* Supprimer */}
        <button
          onClick={handleDeleteConversation}
          className="text-sm px-3 py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
          title="Supprimer la discussion"
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
                {isMine ? "Moi" : receiverName} •{" "}
                {m.sent_at?.toDate ? m.sent_at.toDate().toLocaleTimeString() : ""}
              </span>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Formulaire */}
      <form onSubmit={handleSend} className="p-3 bg-white border-t flex gap-2 items-center">
        <input
          type="text"
          placeholder="Votre message..."
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          className="flex-1 border rounded-full px-4 py-2 outline-none"
        />
        <button
          type="submit"
          className="bg-primary text-white px-4 py-2 rounded-full shadow hover:bg-primary-dark transition"
        >
          Envoyer
        </button>
      </form>
    </div>
  );
}