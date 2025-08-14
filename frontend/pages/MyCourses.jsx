import React, { useEffect, useState } from 'react';
import { auth, db } from '../lib/firebase';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  limit
} from 'firebase/firestore';
import DashboardLayout from '../components/DashboardLayout';

// --- Helpers: récupérer un profil user par UID, qu'il soit docId==uid ou champ uid ---
async function fetchUserProfile(uid) {
  if (!uid) return null;
  try {
    const d = await getDoc(doc(db, 'users', uid));
    if (d.exists()) return { id: uid, ...d.data() };
  } catch {}
  try {
    const q = query(collection(db, 'users'), where('uid', '==', uid), limit(1));
    const s = await getDocs(q);
    if (!s.empty) {
      const d = s.docs[0];
      return { id: d.id, ...d.data() };
    }
  } catch {}
  return null;
}

export default function MyCourses() {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const run = async () => {
      if (!auth.currentUser) return; // garde‑fou: pas de requête si pas connecté
      setLoading(true);

      // 1) Charger les cours de l'élève connecté
      const qLessons = query(
        collection(db, 'lessons'),
        where('student_id', '==', auth.currentUser.uid)
      );
      const lessonsSnap = await getDocs(qLessons);
      const rawCourses = lessonsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      // 2) Charger les avis laissés par cet élève (évite get all)
      const qReviews = query(
        collection(db, 'reviews'),
        where('student_id', '==', auth.currentUser.uid)
      );
      const reviewsSnap = await getDocs(qReviews);
      const reviewedLessonIds = new Set(reviewsSnap.docs.map(r => r.data().lesson_id));

      // 3) Récupérer les profils des profs en 1 passe
      const teacherUids = Array.from(new Set(rawCourses.map(c => c.teacher_id).filter(Boolean)));
      const profiles = await Promise.all(teacherUids.map(uid => fetchUserProfile(uid)));
      const teacherMap = new Map(
        profiles
          .filter(Boolean)
          .map(p => [
            // clé = UID (si doc users n'est pas par UID, on a quand même le champ uid côté lesson)
            (p.uid || p.id),
            {
              name: p.fullName || p.name || p.displayName || 'Professeur',
              avatar: p.avatarUrl || p.avatar_url || p.photoURL || '',
            },
          ])
      );

      // 4) Enrichir les cours avec nom/avatar prof + flag hasReview
      const enriched = rawCourses.map(course => {
        const t = teacherMap.get(course.teacher_id) || {};
        return {
          ...course,
          teacherName: t.name || course.teacher_id, // fallback UID si jamais
          teacherAvatar: t.avatar || '',
          hasReview: reviewedLessonIds.has(course.id),
        };
      });

      setCourses(enriched);
      setLoading(false);
    };

    run();
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

        {loading && (
          <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">
            Chargement…
          </div>
        )}

        {!loading && (
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
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  {/* Avatar prof (si dispo) */}
                  <img
                    src={course.teacherAvatar || '/avatar-default.png'}
                    alt={course.teacherName}
                    className="w-12 h-12 rounded-full object-cover border"
                  />

                  <div className="flex-1 min-w-0">
                    <div className="flex gap-2 items-center mb-1">
                      <span className="font-bold text-primary">
                        {course.subject_id || 'Matière'}
                      </span>
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-semibold ml-2 ${
                          statusColors[course.status] || 'bg-gray-200'
                        }`}
                      >
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
                      Professeur : <span className="font-semibold">{course.teacherName}</span>
                    </div>

                    <div className="text-gray-500 text-sm mb-1">
                      {course.start_datetime && (
                        <>
                          📅{' '}
                          {course.start_datetime?.toDate
                            ? course.start_datetime.toDate().toLocaleString()
                            : // si c'est un timestamp "sec" ou une string ISO
                              (course.start_datetime.seconds
                                ? new Date(course.start_datetime.seconds * 1000).toLocaleString()
                                : new Date(course.start_datetime).toLocaleString())}
                        </>
                      )}
                    </div>
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
                        setCourses(prev =>
                          prev.map(c => (c.id === course.id ? { ...c, hasReview: true } : c))
                        );
                      }}
                    />
                    */}
                    <span className="text-xs text-primary">
                      À noter&nbsp;: ajouter le composant Review ici !
                    </span>
                  </div>
                )}

                {course.status === 'completed' && course.hasReview && (
                  <span className="text-green-600 text-xs font-semibold">Avis laissé ✔️</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}