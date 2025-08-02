import React, { useEffect, useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import { auth, db } from '../lib/firebase';
import { collection, getDocs, query, where, updateDoc, doc, getDoc, addDoc, serverTimestamp } from 'firebase/firestore';

export default function TeacherLessons() {
  const [lessons, setLessons] = useState([]);

  useEffect(() => {
    const fetch = async () => {
      const q = query(collection(db, 'lessons'), where('teacher_id', '==', auth.currentUser.uid));
      const snapshot = await getDocs(q);
      // On enrichit avec les infos élèves
      const data = await Promise.all(snapshot.docs.map(async d => {
        const lesson = { id: d.id, ...d.data() };
        // Aller chercher le nom de l'élève
        let studentName = lesson.student_id;
        try {
          const studentSnap = await getDoc(doc(db, 'users', lesson.student_id));
          if (studentSnap.exists()) studentName = studentSnap.data().fullName || studentName;
        } catch {}
        return { ...lesson, studentName };
      }));
      setLessons(data);
    };
    fetch();
  }, []);

  const handleStatus = async (id, status) => {
    // Mets à jour le statut
    await updateDoc(doc(db, 'lessons', id), { status });
    setLessons(prev => prev.map(l => l.id === id ? { ...l, status } : l));

    // Cherche la leçon et infos élève pour notification
    const lesson = lessons.find(l => l.id === id);
    if (!lesson) return;
    let profName = "Votre professeur";
    try {
      const profSnap = await getDoc(doc(db, 'users', auth.currentUser.uid));
      if (profSnap.exists()) profName = profSnap.data().fullName || profName;
    } catch {}

    // Texte et type de notif selon le statut
    let notifText = "";
    let notifType = "";
    if (status === "confirmed") {
      notifText = `Votre cours avec ${profName} a été accepté !`;
      notifType = "cours_accepted";
    } else if (status === "rejected") {
      notifText = `Votre cours avec ${profName} a été refusé.`;
      notifType = "cours_rejected";
    } else {
      return;
    }

    // Création de la notification côté élève
    await addDoc(collection(db, 'notifications'), {
      user_id: lesson.student_id,
      type: 'cours_accepted',
      with_id: auth.currentUser.uid, // UID du prof
      withName: profName,
      created_at: serverTimestamp(),
      read: false
    });

  };

  const statusColors = {
    booked: 'bg-yellow-100 text-yellow-800',
    confirmed: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-700',
    completed: 'bg-gray-200 text-gray-700',
  };

  return (
    <DashboardLayout role="teacher">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-2xl font-bold text-primary mb-6">Demandes de cours</h2>
        <div className="grid grid-cols-1 gap-5">
          {lessons.length === 0 && (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">
              Aucune demande de cours pour le moment.
            </div>
          )}
          {lessons.map(l => (
            <div
              key={l.id}
              className="bg-white p-6 rounded-xl shadow border flex flex-col md:flex-row md:items-center gap-4 justify-between"
            >
              <div className="flex-1">
                <div className="flex gap-2 items-center mb-1">
                  <span className="font-bold text-primary">{l.subject_id || 'Matière'}</span>
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ml-2 ${statusColors[l.status] || 'bg-gray-200'}`}>
                    {l.status === 'booked'
                      ? 'En attente'
                      : l.status === 'confirmed'
                      ? 'Confirmé'
                      : l.status === 'rejected'
                      ? 'Refusé'
                      : l.status === 'completed'
                      ? 'Terminé'
                      : l.status}
                  </span>
                </div>
                <div className="text-gray-700">
                  Élève : <span className="font-semibold">{l.studentName}</span>
                </div>
                <div className="text-gray-500 text-sm">
                  {l.start_datetime && (
                    <>📅 {new Date(l.start_datetime.seconds * 1000).toLocaleString()}</>
                  )}
                </div>
              </div>
              {l.status === 'booked' && (
                <div className="flex gap-2">
                  <button
                    className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded shadow font-semibold"
                    onClick={() => handleStatus(l.id, 'confirmed')}
                  >
                    ✅ Accepter
                  </button>
                  <button
                    className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded shadow font-semibold"
                    onClick={() => handleStatus(l.id, 'rejected')}
                  >
                    ❌ Refuser
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}