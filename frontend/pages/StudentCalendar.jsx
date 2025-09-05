import React, { useEffect, useState, useMemo, useRef } from 'react';
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
  const jsDay = now.getDay(); // 0..6
  const offsetToMonday = ((jsDay + 6) % 7);

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

// Résolution profil prof
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

// Résolution noms participants (users -> students) avec cache
async function fetchStudentDoc(id) {
  if (!id) return null;
  try {
    const s = await getDoc(doc(db, 'students', id));
    if (s.exists()) return { id, ...s.data() };
  } catch {}
  return null;
}
async function resolvePersonName(id, cacheRef) {
  if (!id) return '';
  if (cacheRef.current.has(id)) return cacheRef.current.get(id);
  try {
    const u = await getDoc(doc(db, 'users', id));
    if (u.exists()) {
      const d = u.data();
      const nm = d.fullName || d.name || d.displayName || id;
      cacheRef.current.set(id, nm);
      return nm;
    }
  } catch {}
  const s = await fetchStudentDoc(id);
  if (s) {
    const nm = s.full_name || s.name || id;
    cacheRef.current.set(id, nm);
    return nm;
  }
  cacheRef.current.set(id, id);
  return id;
}

export default function StudentCalendar() {
  const [lessons, setLessons] = useState([]);
  const [teacherMap, setTeacherMap] = useState(new Map());
  const [groupNamesByLesson, setGroupNamesByLesson] = useState(new Map());
  const [openGroupId, setOpenGroupId] = useState(null);
  const [loading, setLoading] = useState(true);

  const nameCacheRef = useRef(new Map());

  useEffect(() => {
    const fetchLessons = async () => {
      if (!auth.currentUser) return;
      setLoading(true);

      // 1) Charger les cours de l'élève connecté (confirmés & terminés)
      const qLessons = query(
        collection(db, 'lessons'),
        where('student_id', '==', auth.currentUser.uid)
      );
      const snapshot = await getDocs(qLessons);
      const data = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(l => l.status === 'confirmed' || l.status === 'completed');

      setLessons(data);

      // 2) Profils profs
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

      // 3) Noms des participants pour cours groupés
      const idSet = new Set();
      data.forEach(l => {
        if (l.is_group) {
          (Array.isArray(l.participant_ids) ? l.participant_ids : []).forEach(id => id && idSet.add(id));
          if (l.student_id) idSet.add(l.student_id);
        }
      });
      const ids = Array.from(idSet);
      const names = await Promise.all(ids.map(id => resolvePersonName(id, nameCacheRef)));
      const idToName = new Map(ids.map((id, i) => [id, names[i]]));

      const mapByLesson = new Map();
      data.forEach(l => {
        if (!l.is_group) return;
        const idsForLesson = [
          ...(Array.isArray(l.participant_ids) ? l.participant_ids : []),
          ...(l.student_id ? [l.student_id] : []),
        ];
        const uniq = Array.from(new Set(idsForLesson));
        const nmList = uniq.map(id => idToName.get(id) || id);
        mapByLesson.set(l.id, nmList);
      });
      setGroupNamesByLesson(mapByLesson);

      setLoading(false);
    };

    fetchLessons();
  }, []);

  // Grouper par jour de la semaine courante (Lun..Dim)
  const week = getThisWeekDays();
  const lessonsByDay = useMemo(() => {
    const m = Object.fromEntries(week.map(w => [w.code, []]));
    lessons.forEach(l => {
      const code = typeof l.slot_day === 'string' ? l.slot_day : '';
      if (m[code]) m[code].push(l);
    });
    return m;
  }, [week, lessons]);

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
                        const isGroup = !!l.is_group;
                        const groupNames = groupNamesByLesson.get(l.id) || [];
                        const open = openGroupId === l.id;

                        return (
                          <li
                            key={l.id}
                            className="relative flex items-center gap-2 bg-gray-50 px-3 py-2 rounded-lg border"
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

                            {isGroup && (
                              <button
                                className="ml-2 text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded hover:bg-indigo-100"
                                onClick={() => setOpenGroupId(open ? null : l.id)}
                                title="Voir les élèves du groupe"
                              >
                                👥 {groupNames.length}
                              </button>
                            )}

                            <span className="text-xs text-gray-500 ml-auto">
                              {formatHourFromSlot(l.slot_hour)}
                            </span>

                            {/* Mini-fenêtre participants */}
                            {isGroup && open && (
                              <div className="absolute top-full mt-2 left-3 z-10 bg-white border rounded-lg shadow p-3 w-64">
                                <div className="text-xs font-semibold mb-1">Élèves du groupe</div>
                                {groupNames.length ? (
                                  <ul className="text-sm text-gray-700 list-disc pl-4 space-y-1">
                                    {groupNames.map((nm, i) => (
                                      <li key={i}>{nm}</li>
                                    ))}
                                  </ul>
                                ) : (
                                  <div className="text-xs text-gray-500">Aucun participant.</div>
                                )}
                              </div>
                            )}
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