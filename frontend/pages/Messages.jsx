import React, { useEffect, useState } from 'react';
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

export default function Messages({ receiverId }) {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');

  useEffect(() => {
    const fetchMessages = async () => {
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

  const handleSend = async (e) => {
    e.preventDefault();
    if (!newMessage) return;
    await addDoc(collection(db, 'messages'), {
      sender_id: auth.currentUser.uid,
      receiver_id: receiverId,
      message: newMessage,
      sent_at: serverTimestamp()
    });
    setNewMessage('');
    setMessages(prev => [...prev, {
      sender_id: auth.currentUser.uid,
      receiver_id: receiverId,
      message: newMessage,
      sent_at: new Date()
    }]);
  };

  return (
    <div>
      <h2>Conversation</h2>
      <div style={{ maxHeight: '300px', overflowY: 'scroll', border: '1px solid #ccc', padding: '1rem' }}>
        {messages.map(m => (
          <p key={m.id || m.sent_at} style={{ textAlign: m.sender_id === auth.currentUser.uid ? 'right' : 'left' }}>
            <span>{m.message}</span>
          </p>
        ))}
      </div>
      <form onSubmit={handleSend}>
        <input value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder="Message..." />
        <button type="submit">Envoyer</button>
      </form>
    </div>
  );
}