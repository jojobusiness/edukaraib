import React, { useEffect, useState } from 'react';
import { auth, db } from '../lib/firebase';
import { collection, getDocs, query, where, doc, getDoc } from 'firebase/firestore';
import DashboardLayout from '../components/DashboardLayout';

export default function ParentCourses() {
  const [courses, setCourses] = useState([]);

  useEffect(() => {
    const fetch = async () => {
      // 1. Récupérer enfants du parent
      const childrenQuery = query(collection(db, 'students'), where('parent_id', '==', auth.currentUser.uid));
      const childrenSnap = await getDocs(childrenQuery);
      const children = childrenSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const childIds = children.map(c => c.id);

      // 2. Récupérer tous les cours liés à ces enfants
      const lessonQuery = query(collection(db, 'lessons'));
      const lessonsSnap = await getDocs(lessonQuery);
      const lessons = lessonsSnap.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(lesson => childIds.includes(lesson.student_id));

      // 3. Enrichir avec le nom enfant et prof
      const enriched = await Promise.all(lessons.map(async (lesson) => {
        let studentName = lesson.student_id;
        let teacherName = lesson.teacher_id;

        try {
          const sSnap = await getDoc(doc(db, 'students', lesson.student_id));
          if (sSnap.exists()) studentName = sSnap.data().full_name || studentName;
        } catch {}

        try {
          const tSnap = await getDoc(doc(db, 'users', lesson.teacher_id));
          if (tSnap.exists()) teacherName = tSnap.data().fullName || teacherName;
        } catch {}

        return { ...lesson, studentName, teacherName };
      }));

      setCourses(enriched);
    };
    fetch();
  }, []);

  const statusColors = {
    booked: 'bg-yellow-100 text-yellow-800',
    confirmed: 'bg-green-100 text-green-800',
    completed: 'bg-gray-100 text-gray-700',
    rejected: 'bg-red-100 text-red-700',
  };

  return (
    <DashboardLayout role="parent">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-2xl font-bold text-primary mb-6">📚 Suivi des cours de vos enfants</h2>
        <div className="grid grid-cols-1 gap-5">
          {courses.length === 0 && (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">
              Aucun cours trouvé pour vos enfants.
            </div>
          )}
          {courses.map(c => (
            <div
              key={c.id}
              className="bg-white p-6 rounded-xl shadow border flex flex-col md:flex-row md:items-center gap-4 justify-between"
            >
              <div className="flex-1">
                <div className="flex gap-2 items-center mb-1">
                  <span className="font-bold text-primary">{c.subject_id || 'Matière'}</span>
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ml-2 ${statusColors[c.status] || 'bg-gray-200'}`}>
                    {c.status === 'booked'
                      ? 'En attente'
                      : c.status === 'confirmed'
                      ? 'Confirmé'
                      : c.status === 'rejected'
                      ? 'Refusé'
                      : c.status === 'completed'
                      ? 'Terminé'
                      : c.status}
                  </span>
                </div>
                <div className="text-gray-700 text-sm">
                  Enfant : <span className="font-semibold">{c.studentName}</span>
                </div>
                <div className="text-gray-700 text-sm">
                  Professeur : <span className="font-semibold">{c.teacherName}</span>
                </div>
                <div className="text-gray-500 text-xs mb-1">
                  {c.start_datetime && (
                    <>📅 {new Date(c.start_datetime.seconds * 1000).toLocaleString()}</>
                  )}
                </div>
              </div>
              {/* Ici tu peux ajouter un bouton payer, contacter prof, etc. */}
            </div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}