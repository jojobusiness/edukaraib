import React, { useEffect, useState } from 'react';
import { auth, db } from '../lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import DashboardLayout from '../components/DashboardLayout';

function formatDay(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
}
function formatHour(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export default function StudentCalendar() {
  const [lessons, setLessons] = useState([]);

  useEffect(() => {
    const fetchLessons = async () => {
      const q = query(collection(db, 'lessons'), where('student_id', '==', auth.currentUser.uid));
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setLessons(data);
    };
    fetchLessons();
  }, []);

  // Trie les cours par jour de la semaine à venir
  const now = new Date();
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(now.getDate() - now.getDay() + 1 + i); // lundi-dimanche
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
    <DashboardLayout role="student">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold text-primary mb-6">🗓️ Mon planning hebdo</h2>
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
                        <span className="font-bold text-primary">{l.subject_id || "Matière"}</span>
                        <span className="text-xs text-gray-600">{l.teacher_id}</span>
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