import React, { useEffect, useState } from 'react';
import { auth, db } from '../lib/firebase';
import { collection, getDocs, query, where, updateDoc, doc, getDoc } from 'firebase/firestore';
import DashboardLayout from '../components/DashboardLayout';

export default function TeacherLessons() {
  const [lessons, setLessons] = useState([]);

  useEffect(() => {
    const fetch = async () => {
      const q = query(collection(db, 'lessons'), where('teacher_id', '==', auth.currentUser.uid));
      const snapshot = await getDocs(q);
      // On enrichit avec les infos élèves
      const data = await Promise.all(snapshot.docs.map(async d => {
        const lesson = { id: d.id, ...d.data() };
        // Optionnel : aller chercher le nom de l'élève
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
    await updateDoc(doc(db, 'lessons', id), { status });
    setLessons(prev => prev.map(l => l.id === id ? { ...l, status } : l));
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