import React, { useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import useStudentCourses from '../hooks/useStudentCourses';
import DocumentsModal from '../components/lessons/DocumentsModal';
import ReviewForm from '../components/ReviewForm'; // tu l'as déjà
import { formatDateMaybe } from '../utils/datetime';

const statusColors = {
  booked: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-green-100 text-green-800',
  completed: 'bg-gray-100 text-gray-700',
  rejected: 'bg-red-100 text-red-700',
};

export default function MyCourses() {
  const { courses, loading, setCourses } = useStudentCourses();

  const [docOpen, setDocOpen] = useState(false);
  const [docLesson, setDocLesson] = useState(null);
  const [openReviewFor, setOpenReviewFor] = useState(null);

  const openDocs = (course) => {
    setDocLesson(course);
    setDocOpen(true);
  };

  const toggleReview = (lessonId) => {
    setOpenReviewFor(prev => (prev === lessonId ? null : lessonId));
  };

  return (
    <DashboardLayout role="student">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-2xl font-bold text-primary mb-6">📚 Mes cours réservés</h2>

        {loading ? (
          <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Chargement…</div>
        ) : (
          <div className="grid grid-cols-1 gap-5">
            {courses.length === 0 && (
              <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">
                Aucun cours réservé pour le moment.
              </div>
            )}

            {courses.map((course) => (
              <div key={course.id} className="bg-white p-6 rounded-xl shadow border flex flex-col gap-4">
                <div className="flex items-center gap-4 min-w-0">
                  <img
                    src={course.teacherAvatar || '/avatar-default.png'}
                    alt={course.teacherName}
                    className="w-12 h-12 rounded-full object-cover border"
                  />
                  <div className="flex-1 min-w-0">
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
                    <span className="text-green-600 text-xs font-semibold self-center">Avis laissé ✔️</span>
                  )}
                </div>

                {/* Zone ReviewForm (inline) */}
                {openReviewFor === course.id && (
                  <div className="border rounded-lg p-4 bg-gray-50">
                    <ReviewForm
                      lessonId={course.id}
                      teacherId={course.teacher_id}
                      studentId={course.student_id}
                      onReviewSent={() => {
                        // le live se mettra à jour tout seul, mais on peut marquer localement
                        setCourses(prev => prev.map(c => (c.id === course.id ? { ...c, hasReview: true } : c)));
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

      {/* Modal Documents (lecture seule côté élève) */}
      <DocumentsModal
        open={docOpen}
        onClose={() => setDocOpen(false)}
        lesson={docLesson}
        allowUpload={false}
      />
    </DashboardLayout>
  );
}