import React, { useEffect, useState } from 'react';
import { auth, db } from '../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';

export default function MyCourses() {
  const [courses, setCourses] = useState([]);

  useEffect(() => {
    const fetchCourses = async () => {
      const q = query(
        collection(db, 'lessons'),
        where('student_id', '==', auth.currentUser.uid)
      );
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setCourses(data);
    };
    fetchCourses();
  }, []);

  return (
    <div>
      <h2>Mes cours réservés</h2>
      <ul>
        {courses.map((course) => (
          <li key={course.id}>
            {course.subject_id} — {new Date(course.start_datetime.seconds * 1000).toLocaleString()} — {course.status}
          </li>
        ))}
      </ul>
    </div>
  );
}