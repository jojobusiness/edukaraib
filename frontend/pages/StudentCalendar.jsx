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

// Semaine
const mondayOf = (d) => {
  const x = new Date(d);
  const js = x.getDay(); // 0=Dim..6=Sam
  const off = (js + 6) % 7;
  x.setHours(0,0,0,0);
  x.setDate(x.getDate() - off);
  return x;
};
const weekKeyOf = (d) => mondayOf(d).toISOString().slice(0,10);

// Calcule la prochaine date réelle (au-delà de la semaine en cours)
// Ex : (Mar, 10) renverra le mardi à 10h de cette semaine ou de la prochaine
function nextOccurrenceFromNow(slot_day, slot_hour) {
  if (!FR_DAY_CODES.includes(slot_day)) return null;

  const now = new Date();
  now.setSeconds(0, 0);
  const targetHour = Number(slot_hour) || 0;

  // 0 = Lundi ... 6 = Dimanche
  const todayIdx = (now.getDay() + 6) % 7;
  const slotIdx = FR_DAY_CODES.indexOf(slot_day);

  let addDays = slotIdx - todayIdx;
  if (addDays < 0) addDays += 7; // jour suivant la semaine si passé

  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + addDays);
  d.setHours(targetHour, 0, 0, 0);

  // Si le cours d'aujourd'hui est déjà passé → semaine prochaine
  if (addDays === 0 && d <= now) d.setDate(d.getDate() + 7);

  return d;
}

export default function StudentCalendar() {
  const [lessons, setLessons] = useState([]);
  const [nextAny, setNextAny] = useState(null);
  const [teacherMap, setTeacherMap] = useState(new Map());
  const [groupNamesByLesson, setGroupNamesByLesson] = useState(new Map());
  const [openGroupId, setOpenGroupId] = useState(null);
  const [loading, setLoading] = useState(true);
  const nameCacheRef = useRef(new Map());

  // weekKey auto (se met à jour quand on change de semaine)
  const [weekKey, setWeekKey] = useState(weekKeyOf(new Date()));
  useEffect(() => {
    const id = setInterval(() => {
      const k = weekKeyOf(new Date());
      setWeekKey(prev => (prev === k ? prev : k));
    }, 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // Semaine courante
  const weekStart = useMemo(() => mondayOf(new Date(weekKey)), [weekKey]);
  const weekEnd   = useMemo(() => { const d = new Date(weekStart); d.setDate(d.getDate()+7); return d; }, [weekStart]);
  const week = useMemo(() => {
    const labels = FR_DAY_CODES;
    const out = [];
    for (let i=0;i<7;i++) {
      const d = new Date(weekStart); d.setDate(d.getDate()+i);
      const label = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
      out.push({ code: labels[i], label, date: d });
    }
    return out;
  }, [weekStart]);
  const weekByCode = useMemo(() => Object.fromEntries(week.map(w => [w.code, w.date])), [week]);

  // Projeter un cours sur la semaine courante
  const withStartAt = (l) => {
    const base = weekByCode[l.slot_day];
    if (!base) return null;
    const d = new Date(base);
    d.setHours(Number(l.slot_hour) || 0, 0, 0, 0);
    return { ...l, startAt: d };
  };

  useEffect(() => {
    const fetchLessons = async () => {
      if (!auth.currentUser) return;
      setLoading(true);

      const uid = auth.currentUser.uid;

      // a) élève principal
      const qA = query(collection(db, 'lessons'), where('student_id', '==', uid));
      const snapA = await getDocs(qA);

      // b) participant_ids
      const qB = query(collection(db, 'lessons'), where('participant_ids', 'array-contains', uid));
      const snapB = await getDocs(qB);

      const map = new Map();
      snapA.docs.forEach(d => map.set(d.id, { id: d.id, ...d.data() }));
      snapB.docs.forEach(d => map.set(d.id, { id: d.id, ...d.data() }));

      const all = Array.from(map.values());

      // Éligibles
      const data = all.filter((l) => {
        if (l.status === 'completed') return true;
        if (l.is_group) {
          const st = l?.participantsMap?.[uid]?.status;
          return st === 'accepted' || st === 'confirmed';
        }
        return l.status === 'confirmed';
      });

      // Scope semaine
      const weekScoped = data
        .map(withStartAt)
        .filter(Boolean)
        .filter(l => l.startAt >= weekStart && l.startAt < weekEnd);
      setLessons(weekScoped);

      // Fallback global pour "Prochain cours"
      const now = new Date();
      const nextGlobal = data
        .filter(l => l.status === 'confirmed')
        .map(l => {
          const when = nextOccurrenceFromNow(l.slot_day, l.slot_hour);
          return when ? { ...l, startAtGlobal: when } : null;
        })
        .filter(Boolean)
        .filter(l => l.startAtGlobal > now)
        .sort((a, b) => a.startAtGlobal - b.startAtGlobal)[0] || null;
      setNextAny(nextGlobal);

      // Profils profs pour affichage
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

      // Noms des participants pour cours groupés
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
  }, [weekKey]);

  const lessonsByDay = useMemo(() => {
    const m = Object.fromEntries(week.map(w => [w.code, []]));
    lessons.forEach(l => { if (m[l.slot_day]) m[l.slot_day].push(l); });
    return m;
  }, [week, lessons]);

  const nextCourse = useMemo(() => {
    const now = new Date();
    const future = lessons
      .filter(l => l.status === 'confirmed' && l.startAt && l.startAt > now)
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
              { (nextCourse || nextAny)
                ? (() => {
                    const nc = nextCourse || nextAny;
                    const prof = teacherMap.get(nc.teacher_id) || {};
                    const when = `${nc.slot_day} ${String(nc.slot_hour).padStart(2,'0')}h`;
                    return `${nc.subject_id || 'Cours'} · ${when} · avec ${prof.name || nc.teacher_id}`;
                  })()
                : 'Aucun cours confirmé à venir' }
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