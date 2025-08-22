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
import ReviewForm from '../components/ReviewForm';

/* ---------------------- Helpers ---------------------- */
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

const statusColors = {
  booked: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-green-100 text-green-800',
  completed: 'bg-gray-100 text-gray-700',
  rejected: 'bg-red-100 text-red-700',
};

function formatDateMaybe(ts) {
  if (!ts) return '';
  if (ts?.toDate) return ts.toDate().toLocaleString('fr-FR');
  if (typeof ts?.seconds === 'number') return new Date(ts.seconds * 1000).toLocaleString('fr-FR');
  if (typeof ts === 'number') return new Date(ts).toLocaleString('fr-FR');
  if (typeof ts === 'string') {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? '' : d.toLocaleString('fr-FR');
  }
  return '';
}

/* ---------------------- Modal Documents ---------------------- */
function DocumentsModal({ open, onClose, lesson }) {
  const [loading, setLoading] = useState(true);
  const [docsList, setDocsList] = useState([]);

  useEffect(() => {
    const run = async () => {
      if (!open || !lesson?.id) return;
      setLoading(true);
      try {
        const qDocs = query(collection(db, 'documents'), where('lesson_id', '==', lesson.id));
        const snap = await getDocs(qDocs);
        const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        items.sort((a, b) => (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0));
        setDocsList(items);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [open, lesson?.id]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl">
        <div className="p-5 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            Documents — {lesson?.subject_id || 'Cours'}
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        <div className="p-5">
          {loading ? (
            <div className="text-gray-500">Chargement…</div>
          ) : docsList.length === 0 ? (
            <div className="text-gray-500">Aucun document partagé pour ce cours.</div>
          ) : (
            <ul className="divide-y">
              {docsList.map(f => (
                <li key={f.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{f.filename}</div>
                    <div className="text-xs text-gray-500">
                      {f.created_at?.seconds
                        ? new Date(f.created_at.seconds * 1000).toLocaleString('fr-FR')
                        : '—'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <a
                      href={f.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-primary hover:underline font-semibold"
                    >
                      Ouvrir ⤴
                    </a>
                    <a
                      href={f.url}
                      download={f.filename || true}
                      className="bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded text-sm font-semibold"
                    >
                      ⬇️ Télécharger
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="p-4 border-t flex justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200">
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------- Page ---------------------- */
export default function MyCourses() {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modals/States pour actions
  const [docOpen, setDocOpen] = useState(false);
  const [docLesson, setDocLesson] = useState(null);
  const [openReviewFor, setOpenReviewFor] = useState(null); // course.id qui affiche ReviewForm

  useEffect(() => {
    const run = async () => {
      if (!auth.currentUser) return; // pas connecté
      setLoading(true);

      // 1) cours de l'élève
      const qLessons = query(
        collection(db, 'lessons'),
        where('student_id', '==', auth.currentUser.uid)
      );
      const lessonsSnap = await getDocs(qLessons);
      const rawCourses = lessonsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      // 2) avis déjà laissés
      const qReviews = query(
        collection(db, 'reviews'),
        where('student_id', '==', auth.currentUser.uid)
      );
      const reviewsSnap = await getDocs(qReviews);
      const reviewedLessonIds = new Set(reviewsSnap.docs.map(r => r.data().lesson_id));

      // 3) profils profs
      const teacherUids = Array.from(new Set(rawCourses.map(c => c.teacher_id).filter(Boolean)));
      const profiles = await Promise.all(teacherUids.map(uid => fetchUserProfile(uid)));
      const teacherMap = new Map(
        profiles
          .filter(Boolean)
          .map(p => [
            (p.uid || p.id),
            {
              name: p.fullName || p.name || p.displayName || 'Professeur',
              avatar: p.avatarUrl || p.avatar_url || p.photoURL || '',
            },
          ])
      );

      // 4) enrichissement
      const enriched = rawCourses.map(course => {
        const t = teacherMap.get(course.teacher_id) || {};
        return {
          ...course,
          teacherName: t.name || course.teacher_id,
          teacherAvatar: t.avatar || '',
          hasReview: reviewedLessonIds.has(course.id),
        };
      });

      // tri (les plus récents d'abord si date)
      enriched.sort((a, b) => {
        const as = a.start_datetime?.seconds || a.start_datetime?.toMillis?.() || 0;
        const bs = b.start_datetime?.seconds || b.start_datetime?.toMillis?.() || 0;
        return bs - as;
      });

      setCourses(enriched);
      setLoading(false);
    };

    run();
  }, []);

  const openDocs = (course) => {
    setDocLesson(course);
    setDocOpen(true);
  };

  const toggleReview = (courseId) => {
    setOpenReviewFor(prev => (prev === courseId ? null : courseId));
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
                className="bg-white p-6 rounded-xl shadow border flex flex-col gap-4"
              >
                <div className="flex items-center gap-4 min-w-0">
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
                      {course.start_datetime && <>📅 {formatDateMaybe(course.start_datetime)}</>}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded shadow font-semibold"
                    onClick={() => openDocs(course)}
                  >
                    📄 Documents
                  </button>

                  {course.status === 'completed' && !course.hasReview && (
                    <button
                      className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded shadow font-semibold"
                      onClick={() => toggleReview(course.id)}
                    >
                      ⭐ Laisser un avis
                    </button>
                  )}

                  {course.status === 'completed' && course.hasReview && (
                    <span className="text-green-600 text-xs font-semibold self-center">
                      Avis laissé ✔️
                    </span>
                  )}
                </div>

                {/* Zone ReviewForm (affichée quand on clique sur le bouton) */}
                {openReviewFor === course.id && (
                  <div className="border rounded-lg p-4 bg-gray-50">
                    <ReviewForm
                      lessonId={course.id}
                      teacherId={course.teacher_id}
                      studentId={course.student_id}
                      onReviewSent={() => {
                        setCourses(prev =>
                          prev.map(c => (c.id === course.id ? { ...c, hasReview: true } : c))
                        );
                        setOpenReviewFor(null);
                      }}
                    />
                    <div className="mt-2">
                      <button
                        className="text-sm text-gray-600 hover:text-gray-800 underline"
                        onClick={() => setOpenReviewFor(null)}
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal Documents */}
      <DocumentsModal
        open={docOpen}
        onClose={() => setDocOpen(false)}
        lesson={docLesson}
      />
    </DashboardLayout>
  );
}