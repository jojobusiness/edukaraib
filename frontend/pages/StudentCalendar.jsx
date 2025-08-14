import React, { useEffect, useState } from 'react';
import { auth, db } from '../lib/firebase';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  limit,
} from 'firebase/firestore';
import DashboardLayout from '../components/DashboardLayout';

// --- Helpers ---
const FR_DAY_CODES = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function getThisWeekDays() {
  // retourne un tableau de 7 objets { code:'Lun', label:'lundi 12 août', date: Date }
  const now = new Date();
  // JS: getDay() => 0=Dim ... 6=Sam ; on veut démarrer à Lundi
  const jsDay = now.getDay(); // 0..6
  const offsetToMonday = ((jsDay + 6) % 7); // 0=Mon,1=Tue,...6=Sun

  const monday = new Date(now);
  monday.setHours(0,0,0,0);
  monday.setDate(now.getDate() - offsetToMonday);

  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const code = FR_DAY_CODES[i];
    const label = d.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'short'
    });
    return { code, label, date: d };
  });
}

function formatHourFromSlot(slot_hour) {
  const h = Number(slot_hour) || 0;
  return `${String(h).padStart(2,'0')}:00`;
}

async function fetchUserProfile(uid) {
  if (!uid) return null;
  try {
    const direct = await getDoc(doc(db, 'users', uid));
    if (direct.exists()) return { id: uid, ...direct.data() };
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

export default function StudentCalendar() {
  const [lessons, setLessons] = useState([]);
  const [teacherMap, setTeacherMap] = useState(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLessons = async () => {
      if (!auth.currentUser) return;
      setLoading(true);

      // 1) Charger les cours de l'élève connecté
      const qLessons = query(
        collection(db, 'lessons'),
        where('student_id', '==', auth.currentUser.uid)
      );
      const snapshot = await getDocs(qLessons);
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(l => l.status === 'confirmed');

      setLessons(data);

      // 2) Charger les profils des profs en une passe
      const teacherUids = Array.from(new Set(data.map(l => l.teacher_id).filter(Boolean)));
      const profiles = await Promise.all(teacherUids.map(uid => fetchUserProfile(uid)));
      const map = new Map(
        profiles
          .filter(Boolean)
          .map(p => [
            (p.uid || p.id),
            {
              name: p.fullName || p.name || p.displayName || 'Professeur',
              avatar: p.avatarUrl || p.avatar_url || p.photoURL || '',
            }
          ])
      );
      setTeacherMap(map);

      setLoading(false);
    };

    fetchLessons();
  }, []);

  // Grouper par jour de la semaine courante (Lun..Dim) sur base slot_day
  const week = getThisWeekDays();
  const lessonsByDay = Object.fromEntries(week.map(w => [w.code, []]));

  lessons.forEach(l => {
    const code = typeof l.slot_day === 'string' ? l.slot_day : '';
    if (lessonsByDay[code]) {
      lessonsByDay[code].push(l);
    }
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

        {loading ? (
          <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">
            Chargement…
          </div>
        ) : (
          <div className="bg-white p-6 rounded-xl shadow border">
            {week.map(({ code, label }) => (
              <div key={code} className="mb-5">
                <div className="font-bold text-secondary text-sm mb-2 uppercase">
                  {label}
                </div>

                {lessonsByDay[code].length === 0 ? (
                  <div className="text-gray-400 text-xs">Aucun cours</div>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {lessonsByDay[code]
                      .sort((a, b) => (Number(a.slot_hour) || 0) - (Number(b.slot_hour) || 0))
                      .map(l => {
                        const prof = teacherMap.get(l.teacher_id) || {};
                        return (
                          <li
                            key={l.id}
                            className="flex items-center gap-2 bg-gray-50 px-3 py-2 rounded-lg border"
                          >
                            <span
                              className={`px-3 py-1 rounded-full text-xs font-semibold ${
                                statusColors[l.status] || 'bg-gray-200'
                              }`}
                            >
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

                            <span className="font-bold text-primary">
                              {l.subject_id || 'Matière'}
                            </span>

                            <span className="text-xs text-gray-600 flex items-center gap-2">
                              {prof.avatar ? (
                                <img
                                  src={prof.avatar}
                                  alt={prof.name}
                                  className="w-5 h-5 rounded-full object-cover border"
                                />
                              ) : null}
                              {prof.name || l.teacher_id}
                            </span>

                            <span className="text-xs text-gray-500 ml-auto">
                              {formatHourFromSlot(l.slot_hour)}
                            </span>
                          </li>
                        );
                      })}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
