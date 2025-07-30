import React, { useEffect, useState } from 'react';
import { db, auth } from '../lib/firebase';
import { collection, getDocs, query, or, where } from 'firebase/firestore';
import { Link } from 'react-router-dom';

export default function ChatList() {
  const [users, setUsers] = useState([]);

  useEffect(() => {
    const fetch = async () => {
      const snapshot = await getDocs(collection(db, 'messages'));
      const msgs = snapshot.docs.map(doc => doc.data());
      const related = msgs.filter(m => m.sender_id === auth.currentUser.uid || m.receiver_id === auth.currentUser.uid);

      const contactIds = [...new Set(related.map(m =>
        m.sender_id === auth.currentUser.uid ? m.receiver_id : m.sender_id
      ))];

      setUsers(contactIds);
    };
    fetch();
  }, []);

  return (
    <div>
      <h2>Mes conversations</h2>
      <ul>
        {users.map(uid => (
          <li key={uid}>
            <Link to={`/chat/${uid}`}>Discuter avec {uid}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}