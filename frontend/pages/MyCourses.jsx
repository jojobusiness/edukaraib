import React, { useEffect, useState } from 'react';
import { auth, db } from '../lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import DashboardLayout from '../components/DashboardLayout';
// import ReviewForm from '../components/ReviewForm'; // décommente quand tu as ce composant

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

  const statusColors = {
    booked: 'bg-yellow-100 text-yellow-800',
    confirmed: 'bg-green-100 text-green-800',
    completed: 'bg-gray-100 text-gray-700',
    rejected: 'bg-red-100 text-red-700',
  };

  return (
    <DashboardLayout role="student">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-2xl font-bold text-primary mb-6">📚 Mes cours réservés</h2>
        <div className="grid grid-cols-1 gap-5">
          {courses.length === 0 && (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">
              Aucun cours réservé pour le moment.
            </div>
          )}
          {courses.map((course) => (
            <div
              key={course.id}
              className="bg-white p-6 rounded-xl shadow border flex flex-col md:flex-row md:items-center gap-4 justify-between"
            >
              <div className="flex-1">
                <div className="flex gap-2 items-center mb-1">
                  <span className="font-bold text-primary">{course.subject_id || 'Matière'}</span>
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ml-2 ${statusColors[course.status] || 'bg-gray-200'}`}>
                    {course.status === 'booked'
                      ? 'En attente'
                      : course.status === 'confirmed'
                      ? 'Confirmé'
                      : course.status === 'rejected'
                      ? 'Refusé'
                      : course.status === 'completed'
                      ? 'Terminé'
                      : course.status}
                  </span>
                </div>
                <div className="text-gray-700">
                  Professeur : <span className="font-semibold">{course.teacher_id}</span>
                </div>
                <div className="text-gray-500 text-sm mb-1">
                  {course.start_datetime && (
                    <>📅 {new Date(course.start_datetime.seconds * 1000).toLocaleString()}</>
                  )}
                </div>
              </div>
              {/* Avis à laisser si cours terminé et pas d'avis */}
              {course.status === 'completed' && !course.hasReview && (
                <div>
                  {/* 
                  <ReviewForm
                    lessonId={course.id}
                    teacherId={course.teacher_id}
                    studentId={course.student_id}
                    onReviewSent={() => {
                      setCourses(prev => prev.map(c => c.id === course.id ? { ...c, hasReview: true } : c));
                    }}
                  /> 
                  */}
                  <span className="text-xs text-primary">À noter&nbsp;: ajouter le composant Review ici !</span>
                </div>
              )}
              {course.status === 'completed' && course.hasReview && (
                <span className="text-green-600 text-xs font-semibold">Avis laissé ✔️</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}