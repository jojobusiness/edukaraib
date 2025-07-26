import React, { useEffect, useState } from 'react';
import { auth, db } from '../lib/firebase';
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

    // Vérifier les avis pour chaque cours terminé
    const reviewsSnapshot = await getDocs(collection(db, 'reviews'));
    const reviewedLessons = reviewsSnapshot.docs.map(r => r.data().lesson_id);

    const enriched = data.map(course => ({
      ...course,
      hasReview: reviewedLessons.includes(course.id),
    }));

    setCourses(enriched);
  };

  fetchCourses();
}, []);

  return (
    <div>
      <h2>Mes cours réservés</h2>
        <ul>
            {courses.map((course) => (
                <li key={course.id}>
                <p>
                    {course.subject_id} — {new Date(course.start_datetime.seconds * 1000).toLocaleString()} — {course.status}
                </p>

                {course.status === 'completed' && !course.hasReview && (
                    <ReviewForm
                    lessonId={course.id}
                    teacherId={course.teacher_id}
                    studentId={course.student_id}
                    onReviewSent={() => {
                        setCourses(prev => prev.map(c => c.id === course.id ? { ...c, hasReview: true } : c));
                    }}
                    />
                )}
                </li>
            ))}
        </ul>
    </div>
  );
}