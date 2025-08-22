import React, { useMemo, useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import { db } from '../lib/firebase';
import { collection, addDoc, doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';

import DocumentsModal from '../components/lessons/DocumentsModal';
import LessonCard from '../components/lessons/LessonCard';
import useTeacherLessons from '../hooks/useTeacherLessons';

export default function TeacherLessons() {
  const { lessons, setLessons, loading } = useTeacherLessons();

  const [docModalOpen, setDocModalOpen] = useState(false);
  const [docModalLesson, setDocModalLesson] = useState(null);

  const demandes  = useMemo(() => lessons.filter((l) => l.status === 'booked'),    [lessons]);
  const confirmes = useMemo(() => lessons.filter((l) => l.status === 'confirmed'), [lessons]);
  const completes = useMemo(() => lessons.filter((l) => l.status === 'completed'), [lessons]);

  const openDocs = (lesson) => {
    setDocModalLesson(lesson);
    setDocModalOpen(true);
  };

  const handleStatus = async (lesson, status) => {
    await updateDoc(doc(db, 'lessons', lesson.id), {
      status,
      ...(status === 'completed' ? { completed_at: serverTimestamp() } : {}),
    });

    // UI optimiste
    setLessons((prev) => prev.map((l) => (l.id === lesson.id ? { ...l, status } : l)));

    // afficher nom prof (facultatif)
    let profName = 'Votre professeur';
    try {
      const profSnap = await getDoc(doc(db, 'users', lesson.teacher_id));
      if (profSnap.exists()) profName = profSnap.data().fullName || profName;
    } catch {}

    let notifText = '', notifType = '';
    if (status === 'confirmed') {
      notifText = `Votre cours avec ${profName} a été accepté !`;
      notifType = 'cours_accepted';
    } else if (status === 'rejected') {
      notifText = `Votre cours avec ${profName} a été refusé.`;
      notifType = 'cours_rejected';
    } else if (status === 'completed') {
      notifText = `Votre cours avec ${profName} est terminé.`;
      notifType = 'cours_completed';
    } else {
      return;
    }

    await addDoc(collection(db, 'notifications'), {
      user_id: lesson.student_id,
      type: notifType,
      with_id: lesson.teacher_id,
      withName: profName,
      lesson_id: lesson.id,
      message: notifText,
      created_at: serverTimestamp(),
      read: false,
    });
  };

  return (
    <DashboardLayout role="teacher">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-2xl font-bold text-primary mb-6">Cours — Professeur</h2>

        {/* SECTION 1 : Demandes de cours */}
        <section className="mb-10">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-xl font-semibold">Demandes de cours</h3>
            <span className="text-sm text-gray-500">{demandes.length} en attente</span>
          </div>
          {loading ? (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Chargement…</div>
          ) : demandes.length === 0 ? (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Aucune demande.</div>
          ) : (
            <div className="grid grid-cols-1 gap-5">
              {demandes.map((l) => (
                <LessonCard
                  key={l.id}
                  lesson={l}
                  variant="booked"
                  onAccept={(lesson) => handleStatus(lesson, 'confirmed')}
                  onReject={(lesson) => handleStatus(lesson, 'rejected')}
                />
              ))}
            </div>
          )}
        </section>

        {/* SECTION 2 : Gestion des cours (confirmés) */}
        <section className="mb-10">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-xl font-semibold">Gestion des cours</h3>
            <span className="text-sm text-gray-500">{confirmes.length} confirmés</span>
          </div>
          {loading ? (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Chargement…</div>
          ) : confirmes.length === 0 ? (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Aucun cours confirmé.</div>
          ) : (
            <div className="grid grid-cols-1 gap-5">
              {confirmes.map((l) => (
                <LessonCard
                  key={l.id}
                  lesson={l}
                  variant="confirmed"
                  onOpenDocs={openDocs}
                  onCompleted={(lesson) => handleStatus(lesson, 'completed')}
                />
              ))}
            </div>
          )}
        </section>

        {/* SECTION 3 : Cours terminés */}
        <section>
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-xl font-semibold">Cours terminés</h3>
            <span className="text-sm text-gray-500">{completes.length} terminés</span>
          </div>
          {loading ? (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Chargement…</div>
          ) : completes.length === 0 ? (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Aucun cours terminé.</div>
          ) : (
            <div className="grid grid-cols-1 gap-5">
              {completes.map((l) => (
                <LessonCard
                  key={l.id}
                  lesson={l}
                  variant="completed"
                  onOpenDocs={openDocs}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Modal documents (upload activé côté prof) */}
      <DocumentsModal
        open={docModalOpen}
        onClose={() => setDocModalOpen(false)}
        lesson={docModalLesson}
        allowUpload={true}
        onUploaded={() => {}}
      />
    </DashboardLayout>
  );
}