import React, { useEffect, useState } from 'react';
import { auth, db } from '../lib/firebase';
import {
  collection,
  getDocs,
  query,
  where,
  doc,
  getDoc,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import DashboardLayout from '../components/DashboardLayout';

/* ---------- Helpers ---------- */
const statusColors = {
  booked: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-green-100 text-green-800',
  completed: 'bg-gray-100 text-gray-700',
  rejected: 'bg-red-100 text-red-700',
};

function formatDateMaybe(ts) {
  if (!ts) return '';
  if (ts?.toDate) return ts.toDate().toLocaleString('fr-FR');
  if (ts?.seconds) return new Date(ts.seconds * 1000).toLocaleString('fr-FR');
  return new Date(ts).toLocaleString('fr-FR');
}

/* ---------- Modals ---------- */
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
            Documents — {lesson?.subject_id || 'Cours'} ({lesson?.studentName})
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

function ReviewModal({ open, onClose, lesson, onSent }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open) {
      setRating(5);
      setComment('');
      setSending(false);
    }
  }, [open]);

  const submit = async () => {
    if (!lesson?.id) return;
    setSending(true);
    try {
      // Enregistrer l'avis au nom de l'enfant (student_id = enfant)
      await addDoc(collection(db, 'reviews'), {
        lesson_id: lesson.id,
        student_id: lesson.student_id, // enfant
        teacher_id: lesson.teacher_id,
        rating: Number(rating),
        comment: comment.trim(),
        created_at: serverTimestamp(),
        left_by_parent_id: auth.currentUser?.uid || null, // trace utile
      });

      // Notifier le prof
      await addDoc(collection(db, 'notifications'), {
        user_id: lesson.teacher_id,
        type: 'review_left',
        with_id: lesson.student_id, // auteur réel = élève (enfant)
        lesson_id: lesson.id,
        message: `Un nouvel avis a été laissé pour le cours (${lesson.subject_id || 'Cours'}).`,
        created_at: serverTimestamp(),
        read: false,
      });

      onSent?.();
      onClose();
    } catch (e) {
      console.error(e);
      alert("Impossible d'envoyer l'avis pour le moment.");
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="p-5 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">Laisser un avis (au nom de {lesson?.studentName})</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Note</label>
            <select
              value={rating}
              onChange={(e) => setRating(e.target.value)}
              className="w-full border rounded-lg p-2"
            >
              {[5,4,3,2,1].map(n => (
                <option key={n} value={n}>{n} / 5</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Commentaire (optionnel)</label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              className="w-full border rounded-lg p-2"
              placeholder="Partagez le ressenti de votre enfant sur le cours…"
            />
          </div>
        </div>

        <div className="p-4 border-t flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200">
            Annuler
          </button>
          <button
            onClick={submit}
            disabled={sending}
            className="px-4 py-2 rounded-lg bg-primary text-white hover:opacity-90"
          >
            {sending ? 'Envoi…' : 'Envoyer'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Page ---------- */
export default function ParentCourses() {
  const [courses, setCourses] = useState([]);
  const [docOpen, setDocOpen] = useState(false);
  const [docLesson, setDocLesson] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewLesson, setReviewLesson] = useState(null);

  useEffect(() => {
    const fetch = async () => {
      if (!auth.currentUser) return;

      // 1) Enfants du parent
      const childrenQuery = query(
        collection(db, 'students'),
        where('parent_id', '==', auth.currentUser.uid)
      );
      const childrenSnap = await getDocs(childrenQuery);
      const children = childrenSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const childIds = children.map(c => c.id);

      // 2) Tous les cours liés à ces enfants
      const lessonQuery = query(collection(db, 'lessons'));
      const lessonsSnap = await getDocs(lessonQuery);
      const lessons = lessonsSnap.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(lesson => childIds.includes(lesson.student_id));

      // 3) Noms enfant + prof
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

      // 4) Avis déjà laissés (par enfant) -> Set des lesson_id notés
      const reviewedIds = new Set();
      for (const childId of childIds) {
        const qReviews = query(collection(db, 'reviews'), where('student_id', '==', childId));
        const rSnap = await getDocs(qReviews);
        rSnap.docs.forEach(r => reviewedIds.add(r.data().lesson_id));
      }

      // 5) Ajouter flag hasReview
      const withFlags = enriched.map(l => ({
        ...l,
        hasReview: reviewedIds.has(l.id),
      }));

      // tri (plus récent d'abord si date)
      withFlags.sort((a, b) => {
        const as = a.start_datetime?.seconds || a.start_datetime?.toMillis?.() || 0;
        const bs = b.start_datetime?.seconds || b.start_datetime?.toMillis?.() || 0;
        return bs - as;
      });

      setCourses(withFlags);
    };
    fetch();
  }, []);

  const openDocs = (lesson) => {
    setDocLesson(lesson);
    setDocOpen(true);
  };

  const openReview = (lesson) => {
    setReviewLesson(lesson);
    setReviewOpen(true);
  };

  const markReviewedLocally = (lessonId) => {
    setCourses(prev => prev.map(c => (c.id === lessonId ? { ...c, hasReview: true } : c)));
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
              <div className="flex-1 min-w-0">
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
                  {c.start_datetime && <>📅 {formatDateMaybe(c.start_datetime)}</>}
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded shadow font-semibold"
                  onClick={() => openDocs(c)}
                >
                  📄 Documents
                </button>

                {c.status === 'completed' && !c.hasReview && (
                  <button
                    className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded shadow font-semibold"
                    onClick={() => openReview(c)}
                  >
                    ⭐ Laisser un avis
                  </button>
                )}

                {c.status === 'completed' && c.hasReview && (
                  <span className="text-green-600 text-xs font-semibold self-center">
                    Avis laissé ✔️
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Modals */}
      <DocumentsModal
        open={docOpen}
        onClose={() => setDocOpen(false)}
        lesson={docLesson}
      />

      <ReviewModal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        lesson={reviewLesson}
        onSent={() => {
          if (reviewLesson?.id) markReviewedLocally(reviewLesson.id);
        }}
      />
    </DashboardLayout>
  );
}