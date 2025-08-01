import React, { useEffect, useRef, useState } from 'react';
import { auth, db } from '../lib/firebase';
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore';
import DashboardLayout from '../components/DashboardLayout';
import { useParams } from 'react-router-dom';

export default function Messages() {
  const { receiverId } = useParams(); // Permet d’utiliser /chat/:receiverId dans la route
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const bottomRef = useRef();

  useEffect(() => {
    const fetchMessages = async () => {
      if (!auth.currentUser || !receiverId) return;
      const q = query(
        collection(db, 'messages'),
        where('sender_id', 'in', [auth.currentUser.uid, receiverId]),
        where('receiver_id', 'in', [auth.currentUser.uid, receiverId]),
        orderBy('sent_at', 'asc')
      );
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setMessages(data);
    };
    fetchMessages();
  }, [receiverId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!newMessage.trim()) return;
    await addDoc(collection(db, 'messages'), {
      sender_id: auth.currentUser.uid,
      receiver_id: receiverId,
      message: newMessage,
      sent_at: serverTimestamp()
    });
    setNewMessage('');
    // Les messages seront récupérés via useEffect (rafraîchit automatiquement)
  };

  return (
    <DashboardLayout>
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-100px)] bg-gradient-to-br from-white via-gray-100 to-secondary/20 px-4 py-10">
        <div className="w-full max-w-xl bg-white rounded-2xl shadow-xl border border-gray-100 flex flex-col" style={{ height: 500 }}>
          <h2 className="text-xl font-bold text-primary p-4 border-b mb-0">💬 Conversation</h2>
          <div className="flex-1 overflow-y-auto px-4 py-2" style={{ minHeight: 0 }}>
            {messages.length === 0 && (
              <div className="text-center text-gray-400 pt-8">Aucun message pour l’instant.</div>
            )}
            {messages.map((m, idx) => (
              <div
                key={m.id || idx}
                className={`flex mb-2 ${m.sender_id === auth.currentUser.uid ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`rounded-lg px-4 py-2 max-w-xs break-words text-sm shadow
                    ${m.sender_id === auth.currentUser.uid
                      ? 'bg-primary text-white'
                      : 'bg-gray-100 text-gray-800'
                    }`}
                >
                  {m.message}
                  <div className="text-[10px] text-right text-gray-300 mt-1">
                    {m.sent_at?.seconds &&
                      new Date(m.sent_at.seconds * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
          <form onSubmit={handleSend} className="flex items-center p-4 border-t gap-2">
            <input
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Message..."
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary outline-none transition"
              autoFocus
            />
            <button
              type="submit"
              className="bg-primary text-white px-5 py-2 rounded-lg font-semibold shadow hover:bg-primary-dark transition"
            >
              Envoyer
            </button>
          </form>
        </div>
      </div>
    </DashboardLayout>
  );
}