import React, { useEffect, useState } from 'react';
import { auth, db } from '../lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';

export default function ParentCourses() {
  const [courses, setCourses] = useState([]);

  useEffect(() => {
    const fetch = async () => {
      const childrenQuery = query(collection(db, 'students'), where('parent_id', '==', auth.currentUser.uid));
      const childrenSnap = await getDocs(childrenQuery);
      const childIds = childrenSnap.docs.map(doc => doc.id);

      const lessonQuery = query(collection(db, 'lessons'));
      const lessonsSnap = await getDocs(lessonQuery);
      const lessons = lessonsSnap.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(lesson => childIds.includes(lesson.student_id));

      setCourses(lessons);
    };
    fetch();
  }, []);

  return (
    <div>
      <h2>Suivi des cours de vos enfants</h2>
      <ul>
        {courses.map(c => (
          <li key={c.id}>
            Enfant ID: {c.student_id}, Prof: {c.teacher_id}, {c.subject_id}, {c.status}
          </li>
        ))}
      </ul>
    </div>
  );
}