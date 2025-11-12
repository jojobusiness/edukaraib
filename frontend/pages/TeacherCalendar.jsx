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

const FR_DAY_CODES = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

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
async function fetchUserProfile(uid) {
  if (!uid) return null;
  try {
    const s = await getDoc(doc(db, 'users', uid));
    if (s.exists()) return { id: uid, ...s.data(), _src: 'users' };
  } catch {}
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
async function resolveStudentName(id, cacheRef) {
  if (!id) return '';
  if (cacheRef.current.has(id)) return cacheRef.current.get(id);
  const u = await fetchUserProfile(id);
  if (u) {
    const nm = u.fullName || u.name || u.displayName || id;
    cacheRef.current.set(id, nm);
    return nm;
  }
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
  const off = (js + 6) % 7; // 0=Lun..6=Dim
  x.setHours(0,0,0,0);
  x.setDate(x.getDate() - off);
  return x;
};
const weekKeyOf = (d) => mondayOf(d).toISOString().slice(0,10);

// Projette (slot_day, slot_hour) vers la prochaine date >= maintenant (au-delà de la semaine courante)
function nextOccurrenceFromNow(slot_day, slot_hour) {
  if (!FR_DAY_CODES.includes(slot_day)) return null;
  const now = new Date();
  now.setSeconds(0,0);
  const targetHour = Number(slot_hour) || 0;

  const todayIdx = (now.getDay() + 6) % 7; // 0=Lun..6=Dim
  const slotIdx  = FR_DAY_CODES.indexOf(slot_day);

  let add = slotIdx - todayIdx;
  if (add < 0) add += 7;

  const d = new Date(now);
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() + add);
  d.setHours(targetHour, 0, 0, 0);

  // si c’est aujourd’hui et déjà passé → semaine suivante
  if (add === 0 && d <= now) d.setDate(d.getDate()+7);

  return d;
}

export default function TeacherCalendar() {
  const [lessons, setLessons] = useState([]);
  const [nextAny, setNextAny] = useState(null);
  const [studentMap, setStudentMap] = useState(new Map());
  const [groupNamesByLesson, setGroupNamesByLesson] = useState(new Map());
  const [openGroupId, setOpenGroupId] = useState(null);
  const [loading, setLoading] = useState(true);

  // Semaine auto
  const [weekKey, setWeekKey] = useState(weekKeyOf(new Date()));
  useEffect(() => {
    const id = setInterval(() => {
      const k = weekKeyOf(new Date());
      setWeekKey(prev => (prev === k ? prev : k));
    }, 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const weekStart = useMemo(() => mondayOf(new Date(weekKey)), [weekKey]);
  const weekEnd   = useMemo(() => { const d = new Date(weekStart); d.setDate(d.getDate()+7); return d; }, [weekStart]);
  const week = useMemo(() => {
    const out = [];
    for (let i=0;i<7;i++) {
      const d = new Date(weekStart); d.setDate(d.getDate()+i);
      const label = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
      out.push({ code: FR_DAY_CODES[i], label, date: d });
    }
    return out;
  }, [weekStart]);
  const weekByCode = useMemo(() => {
    const map = {};
    for (let i=0;i<7;i++) {
      const d = new Date(weekStart); d.setDate(d.getDate()+i);
      map[FR_DAY_CODES[i]] = d;
    }
    return map;
  }, [weekStart]);

  const nameCacheRef = useRef(new Map());
  const teacherUid = auth.currentUser?.uid || null;

  useEffect(() => {
    const fetchLessons = async () => {
      if (!teacherUid) return;
      setLoading(true);

      // 1) cours du prof
      const qLessons = query(collection(db, 'lessons'), where('teacher_id', '==', teacherUid));
      const snap = await getDocs(qLessons);
      const rawAll = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      // 2) enrichir + scoper sur semaine
      const scoped = rawAll
        .map(l => {
          const base = weekByCode[l.slot_day];
          if (!base) return null;
          const startAt = dateWithHour(base, l.slot_hour);
          return { ...l, startAt };
        })
        .filter(Boolean)
        .filter(l => l.startAt >= weekStart && l.startAt < weekEnd);

      // 3) Éligibilité
      const eligible = scoped.filter((l) => {
        if (l.status === 'completed') return true;
        if (l.is_group) {
          const ids = Array.isArray(l.participant_ids) ? l.participant_ids : [];
          const pm = l.participantsMap || {};
          return ids.some((sid) => {
            const st = pm?.[sid]?.status;
            return st === 'accepted' || st === 'confirmed';
          });
        }
        return l.status === 'confirmed';
      });

      setLessons(eligible);

      // Fallback global "Prochain cours" (au‐delà de la semaine)
      const now = new Date();
      const nextGlobal = rawAll
        .filter(l => l.status !== 'completed')
        .map(l => {
          const when = nextOccurrenceFromNow(l.slot_day, l.slot_hour);
          return when ? { ...l, startAtGlobal: when } : null;
        })
        .filter(Boolean)
        .filter(l => l.startAtGlobal > now)
        .sort((a, b) => a.startAtGlobal - b.startAtGlobal)[0] || null;
      setNextAny(nextGlobal);

      // 4) Noms
      const studentIds = Array.from(new Set(eligible.map(l => l.student_id).filter(Boolean)));
      const names = await Promise.all(studentIds.map(id => resolveStudentName(id, nameCacheRef)));
      setStudentMap(new Map(studentIds.map((id, i) => [id, names[i]]) ));

      const idSet = new Set();
      eligible.forEach(l => {
        if (l.is_group) {
          (Array.isArray(l.participant_ids) ? l.participant_ids : []).forEach(id => id && idSet.add(id));
          if (l.student_id) idSet.add(l.student_id);
        }
      });
      const ids = Array.from(idSet);
      const resolvedNames = await Promise.all(ids.map(id => resolveStudentName(id, nameCacheRef)));
      const idToName = new Map(ids.map((id, i) => [id, resolvedNames[i]]));

      const mapByLesson = new Map();
      eligible.forEach(l => {
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
  }, [teacherUid, weekKey]); // refetch à chaque nouvelle semaine

  const now = new Date();
  const upcoming = lessons
    .filter(l => l.status !== 'completed' && l.startAt >= now)
    .sort((a, b) => a.startAt - b.startAt);
  const nextOne = upcoming[0] || null;

  const lessonsByDay = useMemo(() => {
    const m = Object.fromEntries(week.map(w => [w.code, []]));
    lessons.forEach(l => { if (m[l.slot_day]) m[l.slot_day].push(l); });
    return m;
  }, [week, lessons]);

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

        {!loading && (
          <div className="bg-white p-4 rounded-xl shadow border mb-6">
            <div className="font-semibold text-primary mb-2">Prochain cours</div>
            {(nextOne || nextAny) ? (
              <div className="flex items-center gap-3">
                {(() => {
                  const L = nextOne || nextAny; // ⬅️ on unifie
                  const isGroupConfirmedForTeacher =
                    L?.is_group &&
                    Array.isArray(L.participant_ids) &&
                    L.participant_ids.some(sid => {
                      const st = L.participantsMap?.[sid]?.status;
                      return st === 'accepted' || st === 'confirmed';
                    });

                const ds = isGroupConfirmedForTeacher
                  ? (L.status === 'completed' ? 'completed' : 'confirmed')
                  : L.status;

                  return (
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      {
                        booked: 'bg-yellow-100 text-yellow-800',
                        confirmed: 'bg-green-100 text-green-800',
                        completed: 'bg-gray-100 text-gray-700',
                        rejected: 'bg-red-100 text-red-700',
                      }[ds] || 'bg-gray-200'
                    }`}>
                      {ds === 'booked' ? 'En attente'
                        : ds === 'confirmed' ? 'Confirmé'
                        : ds === 'rejected' ? 'Refusé'
                        : ds === 'completed' ? 'Terminé'
                        : ds}
                    </span>
                  );
                })()}

                {/* Matière */}
                <span className="font-bold text-secondary">
                  {(nextOne || nextAny).subject_id || 'Matière'}
                </span>

                {/* Élève / Groupe */}
                {(() => {
                  const L = nextOne || nextAny;
                  if (!L.is_group) {
                    return (
                      <span className="text-sm text-gray-700">
                        {studentMap.get(L.student_id) || L.student_id}
                      </span>
                    );
                  }
                  const count = (groupNamesByLesson.get(L.id) || L.participant_ids || []).length;
                  return (
                    <span className="ml-1 text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded" title="Cours groupé">
                      👥 {count}
                    </span>
                  );
                })()}

                {/* Date/heure — startAt (semaine) sinon startAtGlobal (fallback) */}
                {(() => {
                  const L = nextOne || nextAny;
                  const d = (L.startAt) || (L.startAtGlobal) || null;
                  return (
                    <span className="text-sm text-gray-500 ml-auto">
                      {d?.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' })} • {d?.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  );
                })()}
              </div>
            ) : (
              <div className="text-gray-500 text-sm">Aucun cours confirmé à venir cette semaine.</div>
            )}
          </div>
        )}

        {loading ? (
          <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Chargement…</div>
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
                      .map(l => {
                        const isGroup = !!l.is_group;
                        const groupNames = groupNamesByLesson.get(l.id) || [];
                        const open = openGroupId === l.id;

                        return (
                          <li key={l.id} className="relative flex items-center gap-2 bg-gray-50 px-3 py-2 rounded-lg border">
                            {(() => {
                              const ds = (l?.is_group && Array.isArray(l.participant_ids) &&
                                l.participant_ids.some(sid => {
                                  const st = l.participantsMap?.[sid]?.status;
                                  return st === 'accepted' || st === 'confirmed';
                                }))
                                ? (l.status === 'completed' ? 'completed' : 'confirmed')
                                : l.status;
                              return (
                                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColors[ds] || 'bg-gray-200'}`}>
                                  {ds === 'booked' ? 'En attente'
                                    : ds === 'confirmed' ? 'Confirmé'
                                    : ds === 'rejected' ? 'Refusé'
                                    : ds === 'completed' ? 'Terminé'
                                    : ds}
                                </span>
                              );
                            })()}

                            <span className="font-bold text-primary">{l.subject_id || 'Matière'}</span>

                            {!isGroup && (
                              <span className="text-xs text-gray-600">
                                {studentMap.get(l.student_id) || l.student_id}
                              </span>
                            )}

                            {isGroup && (
                              <>
                                <button
                                  className="ml-1 text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded hover:bg-indigo-100"
                                  onClick={() => setOpenGroupId(open ? null : l.id)}
                                  title="Voir les élèves du groupe"
                                >
                                  👥 {groupNames.length}
                                </button>
                                {open && (
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
                              </>
                            )}

                            <span className="text-xs text-gray-500 ml-auto">
                              {formatHour(l.slot_hour)}
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