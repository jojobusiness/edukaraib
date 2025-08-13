import React, { useEffect, useState, useRef } from "react";
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
} from "firebase/firestore";


// -------- Helpers --------
function pairKey(a, b) {
  return [a, b].sort().join("_");
}

async function fetchUserProfile(uid) {
  if (!uid) return null;
  // 1) users/{uid}
  try {
    const d = await getDoc(doc(db, "users", uid));
    if (d.exists()) return { id: uid, ...d.data() };
  } catch {}
  // 2) where uid == <uid>
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

/**
 * Trouve ou crée une conversation entre myUid et otherUid.
 * Utilise la clé unique "uidA_uidB" (triée) pour éviter les doublons.
 * Retourne l'ID de conversation (cid).
 */
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

export default function Messages({ receiverId }) {
  const [cid, setCid] = useState(null); // conversationId
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [receiverName, setReceiverName] = useState("");
  const [receiverAvatar, setReceiverAvatar] = useState("");
  const messagesEndRef = useRef(null);

  // 1) Résoudre/Créer la conversation à partir de l'UID destinataire (:id)
  useEffect(() => {
    (async () => {
      const myUid = auth.currentUser?.uid;
      if (!myUid || !receiverId) return;
      const conversationId = await ensureConversation(myUid, receiverId);
      setCid(conversationId);
    })();
  }, [receiverId]);

  // 2) Charger le profil de l'interlocuteur
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

  // 3) Flux temps réel des messages liés à cette conversation
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

    return () => unsub();
  }, [cid]);

  // 4) Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 5) Envoi d'un message (écrit messages + met à jour conversations)
  const handleSend = async (e) => {
    e.preventDefault();
    const myUid = auth.currentUser?.uid;
    if (!newMessage.trim() || !myUid || !cid || !receiverId) return;

    // Écrit le message lié à la conversation
    await addDoc(collection(db, "messages"), {
      conversationId: cid,
      sender_uid: myUid,
      receiver_uid: receiverId,
      participants_uids: [myUid, receiverId],
      message: newMessage.trim(),
      sent_at: serverTimestamp(),
    });

    // Met à jour les infos de synthèse de la conversation
    await updateDoc(doc(db, "conversations", cid), {
      lastMessage: newMessage.trim(),
      lastSentAt: serverTimestamp(),
      lastSender: myUid,
    });

    setNewMessage("");
  };

  if (!receiverId) {
    return <div className="p-4">Chargement…</div>;
  }
  
  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white p-4 shadow flex items-center gap-3">
        <img
          src={receiverAvatar || "/avatar-default.png"}
          alt="Avatar"
          className="w-10 h-10 rounded-full object-cover"
        />
        <h2 className="text-lg font-semibold">{receiverName}</h2>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((m) => {
          const isMine = m.sender_uid === auth.currentUser?.uid;
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