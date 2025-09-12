import React, { useEffect, useMemo, useRef, useState } from 'react';
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
const codeIndex = (c) => Math.max(0, FR_DAY_CODES.indexOf(c));

function getThisWeekDays() {
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

function nextOccurrence(slot_day, slot_hour, now = new Date()) {
  if (!FR_DAY_CODES.includes(slot_day)) return null;
  const jsDay = now.getDay();
  const offsetToMonday = ((jsDay + 6) % 7);

  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() - offsetToMonday);

  const idx = codeIndex(slot_day);
  const start = new Date(monday);
  start.setDate(monday.getDate() + idx);
  start.setHours(Number(slot_hour) || 0, 0, 0, 0);
  if (start <= now) start.setDate(start.getDate() + 7);
  return start;
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

      // 1) Charger les cours de l'élève connecté
      const uid = auth.currentUser.uid;

      // a) où il est l’élève « principal »
      const qA = query(collection(db, 'lessons'), where('student_id', '==', uid));
      const snapA = await getDocs(qA);

      // b) où il est dans participant_ids
      const qB = query(collection(db, 'lessons'), where('participant_ids', 'array-contains', uid));
      const snapB = await getDocs(qB);

      // Fusion + dédupe
      const map = new Map();
      snapA.docs.forEach(d => map.set(d.id, { id: d.id, ...d.data() }));
      snapB.docs.forEach(d => map.set(d.id, { id: d.id, ...d.data() }));

      const all = Array.from(map.values());

      // ✅ Filtrage éligible :
      // - Individuel: confirmed ou completed
      // - Groupe: inclure si JE suis accepted|confirmed (completed toujours inclus)
      const data = all.filter((l) => {
        if (l.status === 'completed') return true;
        if (l.is_group) {
          const st = l?.participantsMap?.[uid]?.status;
          return st === 'accepted' || st === 'confirmed';
        }
        return l.status === 'confirmed';
      });

      setLessons(data);

      // 2) Profils profs (sur l’ensemble affiché)
      const teacherUids = Array.from(new Set(data.map(l => l.teacher_id).filter(Boolean)));
      const profiles = await Promise.all(teacherUids.map(uid => fetchUserProfile(uid)));
      const tmap = new Map(
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
      setTeacherMap(tmap);

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

  // Grouper par jour
  const week = getThisWeekDays();
  const lessonsByDay = useMemo(() => {
    const m = Object.fromEntries(week.map(w => [w.code, []]));
    lessons.forEach(l => {
      const code = typeof l.slot_day === 'string' ? l.slot_day : '';
      if (m[code]) m[code].push(l);
    });
    return m;
  }, [week, lessons]);

  // 👉 Prochain cours : on exclut juste les "completed" et on prend le plus proche (groupé ou individuel)
  const nextCourse = useMemo(() => {
    const now = new Date();
    const future = lessons
      .filter(l => l.status !== 'completed' && FR_DAY_CODES.includes(l.slot_day))
      .map(l => ({ ...l, startAt: nextOccurrence(l.slot_day, l.slot_hour, now) }))
      .filter(l => l.startAt && l.startAt > now)
      .sort((a, b) => a.startAt - b.startAt);
    return future[0] || null;
  }, [lessons]);

  const statusColors = {
    booked: 'bg-yellow-100 text-yellow-800',
    confirmed: 'bg-green-100 text-green-800',
    completed: 'bg-gray-100 text-gray-700',
    rejected: 'bg-red-100 text-red-700',
  };

  return (
    <DashboardLayout role="student">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-2xl font-bold text-primary mb-6">🗓️ Mon planning hebdo</h2>

        {/* Prochain cours */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <div className="bg-white rounded-xl shadow p-6 border-l-4 border-primary flex flex-col items-start md:col-span-3">
            <span className="text-3xl mb-2">📅</span>
            <span className="text-xl font-bold text-primary">Prochain cours</span>
            <span className="text-gray-700 mt-1">
              {nextCourse
                ? (() => {
                    const prof = teacherMap.get(nextCourse.teacher_id) || {};
                    const when = `${nextCourse.slot_day} ${String(nextCourse.slot_hour).padStart(2,'0')}h`;
                    return `${nextCourse.subject_id || 'Cours'} · ${when} · avec ${prof.name || nextCourse.teacher_id}`;
                  })()
                : 'Aucun cours confirmé à venir'}
            </span>
          </div>
        </div>

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
                          {(() => {
                            const me = auth.currentUser?.uid;
                            const ds = (l?.is_group && (l?.participantsMap?.[me]?.status === 'accepted' || l?.participantsMap?.[me]?.status === 'confirmed'))
                              ? (l.status === 'completed' ? 'completed' : 'confirmed')
                              : l.status;
                            return (
                              <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColors[ds] || 'bg-gray-200'}`}>
                                {ds === 'confirmed' ? 'Confirmé' : ds === 'completed' ? 'Terminé' : ds}
                              </span>
                            );
                          })()}
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