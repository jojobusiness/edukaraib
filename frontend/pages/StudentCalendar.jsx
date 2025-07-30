import React, { useEffect, useState } from 'react';
import { auth, db } from '../lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';

export default function StudentCalendar() {
  const [lessons, setLessons] = useState([]);

  useEffect(() => {
    const fetchLessons = async () => {
      const q = query(collection(db, 'lessons'), where('student_id', '==', auth.currentUser.uid));
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setLessons(data);
    };
    fetchLessons();
  }, []);

  return (
    <div>
      <h2>Mon planning</h2>
      <ul>
        {lessons.map(l => (
          <li key={l.id}>
            {new Date(l.start_datetime.seconds * 1000).toLocaleString()} — {l.subject_id} — {l.status}
          </li>
        ))}
      </ul>
    </div>
  );
}