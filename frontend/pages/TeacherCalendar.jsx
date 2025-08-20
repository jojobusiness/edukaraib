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

function dateWithHour(baseDate, hour) {
  const h = Number(hour) || 0;
  const d = new Date(baseDate);
  d.setHours(h, 0, 0, 0);
  return d;
}

function formatHour(h) {
  const n = Number(h) || 0;
  return `${String(n).padStart(2, '0')}:00`;
}

// ---------- Résolution profil élève (users OU students) ----------
async function fetchUserProfile(uid) {
  if (!uid) return null;
  // users/{uid}
  try {
    const s = await getDoc(doc(db, 'users', uid));
    if (s.exists()) return { id: uid, ...s.data(), _src: 'users' };
  } catch {}
  // where uid == <uid>
  try {
    const q = query(collection(db, 'users'), where('uid', '==', uid), limit(1));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const d = snap.docs[0];
      return { id: d.id, ...d.data(), _src: 'users-query' };
    }
  } catch {}
  return null;
}

async function fetchStudentDoc(id) {
  if (!id) return null;
  try {
    const s = await getDoc(doc(db, 'students', id));
    if (s.exists()) return { id, ...s.data(), _src: 'students' };
  } catch {}
  return null;
}

/** Essaie users d'abord (élève autonome), puis students (enfant rattaché). */
async function resolveStudentProfile(studentIdOrUid) {
  // 1) users
  const u = await fetchUserProfile(studentIdOrUid);
  if (u) {
    return {
      name: u.fullName || u.name || u.displayName || 'Élève',
      avatar: u.avatarUrl || u.avatar_url || u.photoURL || '',
    };
  }
  // 2) students
  const s = await fetchStudentDoc(studentIdOrUid);
  if (s) {
    return {
      name: s.full_name || s.name || 'Élève',
      avatar: s.avatarUrl || s.avatar_url || '',
    };
  }
  // fallback
  return { name: studentIdOrUid, avatar: '' };
}

export default function TeacherCalendar() {
  const [lessons, setLessons] = useState([]);
  const [studentMap, setStudentMap] = useState(new Map());
  const [loading, setLoading] = useState(true);

  const week = getThisWeekDays();
  const weekByCode = Object.fromEntries(week.map(w => [w.code, w.date]));

  useEffect(() => {
    const fetchLessons = async () => {
      if (!auth.currentUser) return;
      setLoading(true);

      // 1) cours du prof
      const qLessons = query(
        collection(db, 'lessons'),
        where('teacher_id', '==', auth.currentUser.uid)
        // si besoin : where('status','==','confirmed')
      );
      const snap = await getDocs(qLessons);
      const raw = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      // 2) profiler les élèves (users OU students, une passe)
      const studentIds = Array.from(new Set(raw.map(l => l.student_id).filter(Boolean)));
      const profiles = await Promise.all(studentIds.map(id => resolveStudentProfile(id)));
      const sMap = new Map(studentIds.map((id, i) => [id, profiles[i]]));
      setStudentMap(sMap);

      // 3) enrichir avec startAt (semaine courante)
      const enriched = raw
        .map(l => {
          const base = weekByCode[l.slot_day]; // Date du jour (semaine courante)
          if (!base) return null; // slot_day hors semaine? on ignore
          const startAt = dateWithHour(base, l.slot_hour);
          return { ...l, startAt };
        })
        .filter(Boolean);

      setLessons(enriched);
      setLoading(false);
    };

    fetchLessons();
  }, []); // eslint-disable-line

  // Données dérivées
  const now = new Date();

  const upcoming = lessons
    .filter(l => l.status === 'confirmed' && l.startAt >= now)
    .sort((a, b) => a.startAt - b.startAt);

  const nextOne = upcoming[0] || null;

  // Groupage hebdo par code
  const lessonsByDay = Object.fromEntries(week.map(w => [w.code, []]));
  lessons.forEach(l => {
    const code = l.slot_day;
    if (lessonsByDay[code]) lessonsByDay[code].push(l);
  });

  const statusColors = {
    booked: 'bg-yellow-100 text-yellow-800',
    confirmed: 'bg-green-100 text-green-800',
    completed: 'bg-gray-100 text-gray-700',
    rejected: 'bg-red-100 text-red-700',
  };

  return (
    <DashboardLayout role="teacher">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold text-primary mb-6">🗓️ Mon agenda de la semaine</h2>

        {/* ---- Bandeau Prochain cours ---- */}
        {!loading && (
          <div className="bg-white p-4 rounded-xl shadow border mb-6">
            <div className="font-semibold text-primary mb-2">Prochain cours</div>
            {nextOne ? (
              <div className="flex items-center gap-3">
                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColors[nextOne.status] || 'bg-gray-200'}`}>
                  Confirmé
                </span>
                <span className="font-bold text-secondary">{nextOne.subject_id || 'Matière'}</span>
                <span className="text-sm text-gray-700">
                  {studentMap.get(nextOne.student_id)?.name || nextOne.student_id}
                </span>
                <span className="text-sm text-gray-500 ml-auto">
                  {FR_DAY_CODES.includes(nextOne.slot_day) ? nextOne.startAt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' }) : ''}
                  {' • '}
                  {nextOne.startAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ) : (
              <div className="text-gray-500 text-sm">Aucun cours confirmé à venir cette semaine.</div>
            )}
          </div>
        )}

        {/* ---- Liste des cours à venir (confirmés) ---- */}
        {!loading && upcoming.length > 1 && (
          <div className="bg-white p-4 rounded-xl shadow border mb-6">
            <div className="font-semibold text-primary mb-2">À venir</div>
            <ul className="flex flex-col gap-2">
              {upcoming.slice(1).map(l => (
                <li key={l.id} className="flex items-center gap-2 bg-gray-50 px-3 py-2 rounded-lg border">
                  <span className="font-bold text-secondary">{l.subject_id || 'Matière'}</span>
                  <span className="text-xs text-gray-700">
                    {studentMap.get(l.student_id)?.name || l.student_id}
                  </span>
                  <span className="text-xs text-gray-500 ml-auto">
                    {l.startAt.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })} • {l.startAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ---- Vue hebdo ---- */}
        {loading ? (
          <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">
            Chargement…
          </div>
        ) : (
          <div className="bg-white p-6 rounded-xl shadow border">
            {week.map(({ code, label }) => (
              <div key={code} className="mb-5">
                <div className="font-bold text-secondary text-sm mb-2 uppercase">{label}</div>

                {lessonsByDay[code].length === 0 ? (
                  <div className="text-gray-400 text-xs">Aucun cours</div>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {lessonsByDay[code]
                      .sort((a, b) => a.startAt - b.startAt)
                      .map(l => (
                        <li key={l.id} className="flex items-center gap-2 bg-gray-50 px-3 py-2 rounded-lg border">
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColors[l.status] || 'bg-gray-200'}`}>
                            {l.status === 'booked' ? 'En attente'
                              : l.status === 'confirmed' ? 'Confirmé'
                              : l.status === 'rejected' ? 'Refusé'
                              : l.status === 'completed' ? 'Terminé'
                              : l.status}
                          </span>

                          <span className="font-bold text-primary">{l.subject_id || 'Matière'}</span>

                          <span className="text-xs text-gray-600">
                            {studentMap.get(l.student_id)?.name || l.student_id}
                          </span>

                          <span className="text-xs text-gray-500 ml-auto">
                            {formatHour(l.slot_hour)}
                          </span>
                        </li>
                      ))}
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