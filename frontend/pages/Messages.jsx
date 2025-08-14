import React, { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
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

export default function Messages({ receiverId }) {
  const [cid, setCid] = useState(null); // conversationId
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [receiverName, setReceiverName] = useState("");
  const [receiverAvatar, setReceiverAvatar] = useState("");
  const messagesEndRef = useRef(null);
  const navigate = useNavigate();

  const unsubRefs = useRef({ conv: null, msgs: null });

  // 1) Résoudre/Créer la conversation
  useEffect(() => {
    (async () => {
      const myUid = auth.currentUser?.uid;
      if (!myUid || !receiverId) return;
      const conversationId = await ensureConversation(myUid, receiverId);
      setCid(conversationId);
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

  // 3) Flux messages (de cette conversation)
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

  // 5) Envoi
  const handleSend = async (e) => {
    e.preventDefault();
    const myUid = auth.currentUser?.uid;
    if (!newMessage.trim() || !myUid || !cid || !receiverId) return;

    await addDoc(collection(db, "messages"), {
      conversationId: cid,
      sender_uid: myUid,
      receiver_uid: receiverId,
      participants_uids: [myUid, receiverId],
      message: newMessage.trim(),
      sent_at: serverTimestamp(),
    });

    await updateDoc(doc(db, "conversations", cid), {
      lastMessage: newMessage.trim(),
      lastSentAt: serverTimestamp(),
      lastSender: myUid,
    });

    setNewMessage("");
  };

  /** HARD DELETE: supprime messages + doc conversation (limite 500/commit) */
  async function tryHardDeleteConversation(conversationId, myUid) {
    // 1) sécurité simple côté client (les règles doivent faire foi côté serveur)
    const convSnap = await getDoc(doc(db, "conversations", conversationId));
    if (!convSnap.exists()) throw new Error("Conversation introuvable.");
    const conv = convSnap.data();
    if (!Array.isArray(conv.participants) || !conv.participants.includes(myUid)) {
      throw new Error("Accès refusé.");
    }

    // 2) supprimer tous les messages par lots
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

    // 3) supprimer la conversation
    await deleteDoc(doc(db, "conversations", conversationId));
  }

  /** SOFT DELETE: masque la conversation pour l'utilisateur courant (sans toucher aux règles) */
  async function softDeleteForUser(conversationId, myUid) {
    // Marquer la conversation comme masquée pour moi
    await updateDoc(doc(db, "conversations", conversationId), {
      hiddenFor: (window.firebase?.firestore?.FieldValue || (await import("firebase/firestore"))).arrayUnion(myUid),
    }).catch(() => {}); // si pas de champ -> ok

    // Marquer chaque message comme supprimé pour moi
    let done = false;
    while (!done) {
      const qMsgs = query(
        collection(db, "messages"),
        where("conversationId", "==", conversationId),
        limit(400)
      );
      const snap = await getDocs(qMsgs);
      if (snap.empty) break;

      const batch = writeBatch(db);
      snap.docs.forEach((d) => {
        batch.update(d.ref, {
          deletedFor: (window.firebase?.firestore?.FieldValue || null),
        });
      });
      // Comme on ne peut pas utiliser arrayUnion via batch sans FieldValue, on fait un set merge:
      // Fallback: on met un flag "deletedFor_<uid>: true"
      await Promise.all(
        snap.docs.map(async (d) => {
          try {
            await updateDoc(d.ref, { [`deletedFor_${myUid}`]: true });
          } catch {}
        })
      );
      done = snap.size < 400;
    }
  }

  // 6) Suppression (avec fallback si rules bloquent)
  const handleDeleteConversation = async () => {
    const myUid = auth.currentUser?.uid;
    if (!myUid || !cid) return;

    const ok = window.confirm(
      "Supprimer cette discussion ?\nTous les messages seront définitivement effacés (ou masqués si la suppression est refusée)."
    );
    if (!ok) return;

    // désabonne les listeners avant d'effacer
    try { unsubRefs.current.msgs?.(); } catch {}

    try {
      await tryHardDeleteConversation(cid, myUid); // tente la suppression réelle
    } catch (e) {
      // Si les règles refusent (permission-denied), on passe en soft delete pour toi
      if ((e && (e.code === "permission-denied" || /PERMISSION|denied/i.test(String(e)))) || true) {
        await softDeleteForUser(cid, myUid);
      } else {
        console.error(e);
        alert("Erreur lors de la suppression.");
        return;
      }
    }

    navigate("/conversations"); // redirection après suppression/masquage
  };

  if (!receiverId) return <div className="p-4">Chargement…</div>;

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white p-4 shadow flex items-center gap-3">
        <img
          src={receiverAvatar || "/avatar-default.png"}
          alt="Avatar"
          className="w-10 h-10 rounded-full object-cover"
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
          // si soft-delete: masque les messages marqués pour moi
          const myUid = auth.currentUser?.uid;
          if (m[`deletedFor_${myUid}`]) return null;

          const isMine = m.sender_uid === myUid;
          return (
            <div
              key={m.id}
              className={`flex flex-col max-w-xs ${isMine ? "ml-auto items-end" : "mr-auto items-start"}`}
            >
              <div
                className={`px-4 py-2 rounded-2xl shadow ${
                  isMine ? "bg-primary text-white rounded-br-none" : "bg-gray-200 text-gray-900 rounded-bl-none"
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