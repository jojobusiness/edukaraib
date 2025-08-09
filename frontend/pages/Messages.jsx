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
} from "firebase/firestore";

export default function Messages({ receiverId }) {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [receiverName, setReceiverName] = useState("");
  const messagesEndRef = useRef(null);

  // Charger le nom de l'interlocuteur
  useEffect(() => {
    const fetchReceiverName = async () => {
      try {
        const userSnap = await getDoc(doc(db, "users", receiverId));
        if (userSnap.exists()) {
          setReceiverName(userSnap.data().fullName || "Utilisateur");
        } else {
          setReceiverName(receiverId);
        }
      } catch {
        setReceiverName(receiverId);
      }
    };
    fetchReceiverName();
  }, [receiverId]);

  // Flux temps réel des messages (les miens + ceux de l'autre)
  useEffect(() => {
    if (!auth.currentUser) return;

    const q = query(
      collection(db, "messages"),
      where("participants", "array-contains", auth.currentUser.uid),
      orderBy("sent_at", "asc")
    );

    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter(
          (m) =>
            (m.sender_id === auth.currentUser.uid && m.receiver_id === receiverId) ||
            (m.sender_id === receiverId && m.receiver_id === auth.currentUser.uid)
        );
      setMessages(data);
    });

    return () => unsub();
  }, [receiverId]);

  // Scroll auto en bas
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Envoi d'un message
  const handleSend = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !auth.currentUser) return;

    await addDoc(collection(db, "messages"), {
      sender_id: auth.currentUser.uid,
      receiver_id: receiverId,
      participants: [auth.currentUser.uid, receiverId], // IMPORTANT
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
          src="/avatar-default.png"
          alt="Avatar"
          className="w-10 h-10 rounded-full"
        />
        <h2 className="text-lg font-semibold">{receiverName}</h2>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((m) => {
          const isMine = m.sender_id === auth.currentUser.uid;
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
          className="bg-primary text-white px-4 py-2 rounded-full shadow hover:bg-primary-dark transition"
        >
          Envoyer
        </button>
      </form>
    </div>
  );
}