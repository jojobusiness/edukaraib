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
  limit,
} from "firebase/firestore";

/**
 * Récupère un profil utilisateur à partir d'un identifiant quelconque.
 * - Si anyId est déjà un UID: on le trouve direct.
 * - Sinon on tente des fallbacks.
 */
async function fetchUserProfile(uid) {
  if (!uid) return null;

  // 1) Essai direct: users/{uid}
  try {
    const direct = await getDoc(doc(db, "users", uid));
    if (direct.exists()) return { id: uid, ...direct.data() };
  } catch {}

  // 2) Fallback: where uid == <uid>
  try {
    const q = query(collection(db, "users"), where("uid", "==", uid), limit(1));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const d = snap.docs[0];
      return { id: d.id, ...d.data() };
    }
  } catch {}

  return null;
}

/**
 * Essaie de convertir n'importe quel identifiant (docId, ancien id…) en UID Firebase Auth.
 * Si c'est déjà un UID, on retourne tel quel.
 */
async function toUid(anyId) {
  if (!anyId) return anyId;

  // 1) users/{anyId}
  try {
    const direct = await getDoc(doc(db, "users", anyId));
    if (direct.exists()) {
      const d = direct.data();
      return d?.uid || anyId;
    }
  } catch {}

  // 2) where uid == anyId
  try {
    const q = query(collection(db, "users"), where("uid", "==", anyId), limit(1));
    const s = await getDocs(q);
    if (!s.empty) return s.docs[0].data().uid || anyId;
  } catch {}

  return anyId;
}

export default function Messages({ receiverId }) {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [receiverUid, setReceiverUid] = useState("");
  const [receiverName, setReceiverName] = useState("");
  const [receiverAvatar, setReceiverAvatar] = useState("");
  const messagesEndRef = useRef(null);

  // Résoudre l'UID réel du destinataire (si route non standard)
  useEffect(() => {
    (async () => {
      const uid = await toUid(receiverId);
      setReceiverUid(uid);
    })();
  }, [receiverId]);

  // Charger le profil de l'interlocuteur
  useEffect(() => {
    (async () => {
      if (!receiverUid) return;
      const p = await fetchUserProfile(receiverUid);
      setReceiverName(p?.fullName || p?.name || p?.displayName || "Utilisateur");
      setReceiverAvatar(
        p?.avatarUrl || p?.avatar_url || p?.photoURL || "/avatar-default.png"
      );
    })();
  }, [receiverUid]);

  // Flux temps réel des messages (les miens + ceux de l'autre), compat ancien/nouveau schéma
  useEffect(() => {
    if (!auth.currentUser || !receiverUid) return;
    const myUid = auth.currentUser.uid;

    const qNew = query(
      collection(db, "messages"),
      where("participants_uids", "array-contains", myUid),
      orderBy("sent_at", "asc")
    );
    const qOld = query(
      collection(db, "messages"),
      where("participants", "array-contains", myUid),
      orderBy("sent_at", "asc")
    );

    let listNew = [];
    let listOld = [];

    const recompute = () => {
      // Merge + dédupe
      const map = new Map();
      for (const d of [...listNew, ...listOld]) map.set(d.id, d);
      const all = Array.from(map.values());

      // Filtrer pour cette conversation uniquement
      const filtered = all.filter((m) => {
        const s = m.sender_uid ?? m.sender_id;
        const r = m.receiver_uid ?? m.receiver_id;
        if (!s || !r) return false;
        return (
          (s === myUid && r === receiverUid) ||
          (s === receiverUid && r === myUid)
        );
      });

      setMessages(filtered);
    };

    const unsubNew = onSnapshot(qNew, (snap) => {
      listNew = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      recompute();
    });
    const unsubOld = onSnapshot(qOld, (snap) => {
      listOld = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      recompute();
    });

    return () => {
      unsubNew();
      unsubOld();
    };
  }, [receiverUid]);

  // Scroll auto en bas
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Envoi d'un message (écrit le nouveau schéma + legacy)
  const handleSend = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !auth.currentUser || !receiverUid) return;

    const myUid = auth.currentUser.uid;

    await addDoc(collection(db, "messages"), {
      // Nouveau schéma recommandé
      sender_uid: myUid,
      receiver_uid: receiverUid,
      participants_uids: [myUid, receiverUid],

      // Legacy pour compat (tu pourras supprimer plus tard)
      sender_id: myUid,
      receiver_id: receiverUid,
      participants: [myUid, receiverUid],

      message: newMessage.trim(),
      sent_at: serverTimestamp(),
    });

    setNewMessage("");
  };

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
          const isMine = m.sender_uid
            ? m.sender_uid === auth.currentUser?.uid
            : m.sender_id === auth.currentUser?.uid;

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