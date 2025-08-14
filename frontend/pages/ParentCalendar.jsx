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

// ----- Helpers communs -----
const FR_DAY_CODES = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function getThisWeekDays() {
  // [{ code:'Lun', label:'lundi 12 août', date: Date }, ...]
  const now = new Date();
  const jsDay = now.getDay(); // 0=Dim..6=Sam
  const offsetToMonday = ((jsDay + 6) % 7);

  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() - offsetToMonday);

  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const code = FR_DAY_CODES[i];
    const label = d.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
    });
    return { code, label, date: d };
  });
}

function formatHourFromSlot(h) {
  const n = Number(h) || 0;
  return `${String(n).padStart(2, '0')}:00`;
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

function chunk(arr, size = 10) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export default function ParentCalendar() {
  const [lessons, setLessons] = useState([]);
  const [studentMap, setStudentMap] = useState(new Map());
  const [teacherMap, setTeacherMap] = useState(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const run = async () => {
      if (!auth.currentUser) return;
      setLoading(true);

      // 1) Récupérer les enfants du parent
      const kidsSnap = await getDocs(
        query(collection(db, 'students'), where('parent_id', '==', auth.currentUser.uid))
      );
      const kids = kidsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      if (kids.length === 0) {
        setLessons([]);
        setStudentMap(new Map());
        setTeacherMap(new Map());
        setLoading(false);
        return;
      }

      // 2) Récupérer les leçons des enfants (where in par lots de 10)
      const kidIds = kids.map(k => k.id);
      const lessonChunks = chunk(kidIds, 10);
      let allLessons = [];
      for (const c of lessonChunks) {
        const qLessons = query(collection(db, 'lessons'), where('student_id', 'in', c));
        const snap = await getDocs(qLessons);
        allLessons = allLessons.concat(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }

      // (Optionnel) garde uniquement la semaine courante :
      allLessons = allLessons.filter(l => l.status === 'confirmed');

      setLessons(allLessons);
      
      // 3) Construire la map enfants (id -> nom)
      const sMap = new Map(
        kids.map(k => [k.id, k.full_name || k.fullName || k.name || 'Enfant'])
      );
      setStudentMap(sMap);

      // 4) Charger les profils profs en une passe
      const teacherUids = Array.from(new Set(allLessons.map(l => l.teacher_id).filter(Boolean)));
      const profiles = await Promise.all(teacherUids.map(uid => fetchUserProfile(uid)));
      const tMap = new Map(
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
      setTeacherMap(tMap);

      setLoading(false);
    };

    run();
  }, []);

  // Groupage par jour (slot_day) pour la semaine courante
  const week = getThisWeekDays();
  const lessonsByDay = Object.fromEntries(week.map(w => [w.code, []]));
  lessons.forEach(l => {
    const code = typeof l.slot_day === 'string' ? l.slot_day : '';
    if (lessonsByDay[code]) lessonsByDay[code].push(l);
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
                        const childName = studentMap.get(l.student_id) || 'Enfant';
                        const teacher = teacherMap.get(l.teacher_id) || {};
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

                            <span className="font-bold text-primary">{childName}</span>
                            <span className="font-bold text-secondary">{l.subject_id || 'Matière'}</span>

                            <span className="text-xs text-gray-600 flex items-center gap-2">
                              {teacher.avatar ? (
                                <img
                                  src={teacher.avatar}
                                  alt={teacher.name}
                                  className="w-5 h-5 rounded-full object-cover border"
                                />
                              ) : null}
                              {teacher.name || l.teacher_id}
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