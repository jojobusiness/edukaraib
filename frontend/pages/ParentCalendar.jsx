import React, { useEffect, useState } from 'react';
import { auth, db } from '../lib/firebase';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import DashboardLayout from '../components/DashboardLayout';

function formatDay(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
}
function formatHour(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export default function ParentCalendar() {
  const [lessons, setLessons] = useState([]);

  useEffect(() => {
    const fetchLessons = async () => {
      // Récupérer tous les enfants du parent
      const kidsSnap = await getDocs(query(collection(db, 'students'), where('parent_id', '==', auth.currentUser.uid)));
      const kids = kidsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const kidIds = kids.map(k => k.id);

      // Récupérer tous les cours liés à ces enfants
      const lessonSnap = await getDocs(collection(db, 'lessons'));
      const allLessons = lessonSnap.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(l => kidIds.includes(l.student_id));

      // Ajoute info enfant/prof
      const enriched = await Promise.all(
        allLessons.map(async l => {
          let childName = l.student_id;
          let teacherName = l.teacher_id;
          try {
            const sSnap = await getDoc(doc(db, 'students', l.student_id));
            if (sSnap.exists()) childName = sSnap.data().full_name || childName;
          } catch {}
          try {
            const tSnap = await getDoc(doc(db, 'users', l.teacher_id));
            if (tSnap.exists()) teacherName = tSnap.data().fullName || teacherName;
          } catch {}
          return { ...l, childName, teacherName };
        })
      );

      setLessons(enriched);
    };
    fetchLessons();
  }, []);

  // Vue hebdo (lundi-dimanche)
  const now = new Date();
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(now.getDate() - now.getDay() + 1 + i);
    return d.toDateString();
  });
  const lessonsByDay = {};
  week.forEach(dayStr => { lessonsByDay[dayStr] = []; });
  lessons.forEach(l => {
    if (!l.start_datetime) return;
    const date = new Date(l.start_datetime.seconds * 1000);
    const day = date.toDateString();
    if (lessonsByDay[day]) lessonsByDay[day].push(l);
  });

  const statusColors = {
    booked: 'bg-yellow-100 text-yellow-800',
    confirmed: 'bg-green-100 text-green-800',
    completed: 'bg-gray-100 text-gray-700',
    rejected: 'bg-red-100 text-red-700',
  };

  return (
    <DashboardLayout role="parent">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold text-primary mb-6">🗓️ Planning hebdo des enfants</h2>
        <div className="bg-white p-6 rounded-xl shadow border">
          {week.map(dayStr => (
            <div key={dayStr} className="mb-5">
              <div className="font-bold text-secondary text-sm mb-2 uppercase">
                {formatDay(dayStr)}
              </div>
              {lessonsByDay[dayStr].length === 0 ? (
                <div className="text-gray-400 text-xs">Aucun cours</div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {lessonsByDay[dayStr]
                    .sort((a, b) =>
                      a.start_datetime.seconds - b.start_datetime.seconds
                    )
                    .map(l => (
                      <li key={l.id} className="flex items-center gap-2 bg-gray-50 px-3 py-2 rounded-lg border">
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColors[l.status] || 'bg-gray-200'}`}>
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
                        <span className="font-bold text-primary">{l.childName || "Enfant"}</span>
                        <span className="font-bold text-secondary">{l.subject_id || "Matière"}</span>
                        <span className="text-xs text-gray-600">{l.teacherName || "Prof"}</span>
                        <span className="text-xs text-gray-500 ml-auto">{formatHour(l.start_datetime.seconds * 1000)}</span>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}