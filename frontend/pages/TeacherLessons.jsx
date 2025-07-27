import React, { useEffect, useState } from 'react';
import { auth, db } from '../lib/firebase';
import { collection, getDocs, query, where, updateDoc, doc } from 'firebase/firestore';

export default function TeacherLessons() {
  const [lessons, setLessons] = useState([]);

  useEffect(() => {
    const fetch = async () => {
      const q = query(collection(db, 'lessons'), where('teacher_id', '==', auth.currentUser.uid));
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setLessons(data);
    };
    fetch();
  }, []);

  const handleStatus = async (id, status) => {
    await updateDoc(doc(db, 'lessons', id), { status });
    setLessons(prev => prev.map(l => l.id === id ? { ...l, status } : l));
  };

  return (
    <div>
      <h2>Demandes de cours</h2>
      <ul>
        {lessons.map(l => (
          <li key={l.id}>
            Étudiant ID: {l.student_id} | Date : {new Date(l.start_datetime.seconds * 1000).toLocaleString()} | Statut: {l.status}
            {l.status === 'booked' && (
              <>
                <button onClick={() => handleStatus(l.id, 'confirmed')}>✅ Accepter</button>
                <button onClick={() => handleStatus(l.id, 'rejected')}>❌ Refuser</button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}