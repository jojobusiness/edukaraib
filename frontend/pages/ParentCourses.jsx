import React, { useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import useParentCourses from '../hooks/useParentCourses';
import DocumentsModal from '../components/lessons/DocumentsModal';
import ReviewModal from '../components/lessons/ReviewModal';
import { whenString } from '../utils/datetime';

const statusColors = {
  booked: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-green-100 text-green-800',
  completed: 'bg-gray-100 text-gray-700',
  rejected: 'bg-red-100 text-red-700',
};

export default function ParentCourses() {
  const { courses, loading } = useParentCourses();

  // Modals
  const [docOpen, setDocOpen] = useState(false);
  const [docLesson, setDocLesson] = useState(null);

  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewLesson, setReviewLesson] = useState(null);

  const openDocs = (lesson) => { setDocLesson(lesson); setDocOpen(true); };
  const openReview = (lesson) => { setReviewLesson(lesson); setReviewOpen(true); };

  return (
    <DashboardLayout role="parent">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-2xl font-bold text-primary mb-6">📚 Suivi des cours de vos enfants</h2>

        {loading ? (
          <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Chargement…</div>
        ) : (
          <div className="grid grid-cols-1 gap-5">
            {courses.length === 0 && (
              <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">
                Aucun cours trouvé pour vos enfants.
              </div>
            )}

            {courses.map((c) => (
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
                    Enfant : <span className="font-semibold">{c.studentName || c.student_id}</span>
                  </div>
                  <div className="text-gray-700 text-sm">
                    Professeur : <span className="font-semibold">{c.teacherName || c.teacher_id}</span>
                  </div>
                  <div className="text-gray-500 text-xs mb-1">{whenString(c)}</div>
                </div>

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
        )}
      </div>

      {/* Modals */}
      <DocumentsModal
        open={docOpen}
        onClose={() => setDocOpen(false)}
        lesson={docLesson}
        allowUpload={false}
      />

      <ReviewModal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        lesson={reviewLesson}
        onSent={() => {}}
      />
    </DashboardLayout>
  );
}