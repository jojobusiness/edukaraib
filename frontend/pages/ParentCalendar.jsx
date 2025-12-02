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

const DAY_OFFSETS = { lun: 0, mar: 1, mer: 2, jeu: 3, ven: 4, sam: 5, dim: 6 };

function getLessonStartDate(lesson) {
  if (!lesson) return null;
  const hour = Number(lesson.slot_hour ?? 0);

  // 1) Timestamp Firestore : start_datetime ou startAt
  const ts = lesson.start_datetime || lesson.startAt;
  if (ts?.toDate) {
    try {
      const d = ts.toDate();
      d.setHours(hour, 0, 0, 0);
      return d;
    } catch {}
  }
  if (typeof ts?.seconds === 'number') {
    const d = new Date(ts.seconds * 1000);
    d.setHours(hour, 0, 0, 0);
    return d;
  }

  // 2) Champ "date" (YYYY-MM-DD)
  if (lesson.date) {
    const d = new Date(`${lesson.date}T00:00:00`);
    if (!Number.isNaN(d.getTime())) {
      d.setHours(hour, 0, 0, 0);
      return d;
    }
  }

  // 3) Champ "week" (lundi de la semaine) + slot_day
  if (lesson.week && lesson.slot_day) {
    const d = new Date(`${lesson.week}T00:00:00`);
    if (!Number.isNaN(d.getTime())) {
      const key = String(lesson.slot_day).toLowerCase().slice(0, 3); // "Lun" -> "lun"
      const offset = DAY_OFFSETS[key];
      if (typeof offset === 'number') {
        d.setDate(d.getDate() + offset);
        d.setHours(hour, 0, 0, 0);
        return d;
      }
    }
  }

  return null;
}

// Format : 📅 lun. 24/11 · 10:00
function formatNextLessonDate(d) {
  if (!d) return '';
  const weekday = d.toLocaleDateString('fr-FR', { weekday: 'short' }); // "lun."
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `📅 ${weekday} ${day}/${month} · ${time}`;
}

const FR_DAY_CODES = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

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
function chunk(arr, size = 10) { const out=[]; for(let i=0;i<arr.length;i+=size) out.push(arr.slice(i,i+size)); return out; }
function NameChip({ children }) {
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-800 text-xs font-medium">
      {children}
    </span>
  );
}

// Helpers semaine
const mondayOf = (d) => {
  const x = new Date(d);
  const js = x.getDay(); // 0=Dim..6=Sam
  const off = (js + 6) % 7; // 0=Lun..6=Dim
  x.setHours(0,0,0,0);
  x.setDate(x.getDate() - off);
  return x;
};
const weekKeyOf = (d) => mondayOf(d).toISOString().slice(0,10);


export default function ParentCalendar() {
  const [lessons, setLessons] = useState([]);
  const [nextAny, setNextAny] = useState(null); // prochain cours même si pas dans cette semaine
  const [studentMap, setStudentMap] = useState(new Map());
  const [teacherMap, setTeacherMap] = useState(new Map());
  const [groupNamesByLesson, setGroupNamesByLesson] = useState(new Map());
  const [openGroupId, setOpenGroupId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [kidIds, setKidIds] = useState([]);
  const nameCacheRef = useRef(new Map());

  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [monthAnchor, setMonthAnchor] = useState(() => new Date());

  // Semaine courante pilotée par weekKey (lundi ISO)
  const [weekKey, setWeekKey] = useState(weekKeyOf(new Date()));
  useEffect(() => {
    const id = setInterval(() => {
      const k = weekKeyOf(new Date());
      setWeekKey(prev => (prev === k ? prev : k));
    }, 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // Dates de la semaine à partir de weekKey
  const weekStart = useMemo(() => mondayOf(new Date(weekKey)), [weekKey]);
  const weekEnd   = useMemo(() => { const d = new Date(weekStart); d.setDate(d.getDate()+7); return d; }, [weekStart]);
  const week = useMemo(() => {
    const out = [];
    for (let i=0;i<7;i++) {
      const d = new Date(weekStart); d.setDate(d.getDate()+i);
      const code = FR_DAY_CODES[i];
      const label = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
      out.push({ code, label, date: d });
    }
    return out;
  }, [weekStart]);

  useEffect(() => {
    setMonthAnchor(new Date(weekStart));
  }, [weekStart]);

  const goToWeek = (d) => {
    setWeekKey(weekKeyOf(d));
  };

  const goPrevWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    setWeekKey(weekKeyOf(d));
  };

  const goNextWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    setWeekKey(weekKeyOf(d));
  };

  const weekRangeLabel = useMemo(() => {
    const start = new Date(weekStart);
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 6);
    const s = start.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    const e = end.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    return `${s} - ${e}`;
  }, [weekStart]);

  const buildMonthDays = () => {
    const year = monthAnchor.getFullYear();
    const month = monthAnchor.getMonth();
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const days = [];
    for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
      days.push(new Date(d));
    }
    return days;
  };

  useEffect(() => {
    const run = async () => {
      if (!auth.currentUser) return;
      setLoading(true);

      // Enfants du parent
      const kidsSnap = await getDocs(query(collection(db, 'students'), where('parent_id', '==', auth.currentUser.uid)));
      const kids = kidsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const kidIdsLocal = kids.map(k => k.id);
      setKidIds(kidIdsLocal);

      if (kids.length === 0) {
        setLessons([]); setStudentMap(new Map()); setTeacherMap(new Map()); setGroupNamesByLesson(new Map());
        setOpenGroupId(null); setLoading(false); return;
      }

      // cours: élève principal OU participant
      const map = new Map();
      for (const c of chunk(kidIdsLocal, 10)) {
        const qLessons = query(collection(db, 'lessons'), where('student_id', 'in', c));
        (await getDocs(qLessons)).docs.forEach(d => map.set(d.id, { id: d.id, ...d.data() }));
      }
      for (const kid of kidIdsLocal) {
        const qPart = query(collection(db, 'lessons'), where('participant_ids', 'array-contains', kid));
        (await getDocs(qPart)).docs.forEach(d => map.set(d.id, { id: d.id, ...d.data() }));
      }
      const allLessons = Array.from(map.values());

      // Éligibilité
      const kidSet = new Set(kidIdsLocal);
      const eligible = allLessons.filter((l) => {
        if (l.status === 'completed') return true;
        if (l.is_group) {
          const ids = Array.isArray(l.participant_ids) ? l.participant_ids : [];
          const pm = l.participantsMap || {};
          return ids.some((sid) => kidSet.has(sid) && (pm?.[sid]?.status === 'accepted' || pm?.[sid]?.status === 'confirmed'));
        }
        return l.status === 'confirmed' && kidSet.has(l.student_id);
      });

      // Projection avec vraie date (startAt) + scope semaine
      const enhanced = eligible
        .map(l => {
          const d = getLessonStartDate(l);
          if (!d) return null;
          return { ...l, startAt: d };
        })
        .filter(Boolean);

      const weekScoped = enhanced
        .filter(l => l.startAt >= weekStart && l.startAt < weekEnd);

      setLessons(weekScoped);

      // Prochain cours global (toutes semaines confondues)
      const now = new Date();
      const nextGlobal = enhanced
        .filter(l => l.status === 'confirmed' && l.startAt > now)
        .sort((a, b) => a.startAt - b.startAt)[0] || null;

      setNextAny(nextGlobal);

      // Libellés enfants / profs / groupes
      setStudentMap(new Map(kids.map(k => [k.id, k.full_name || k.fullName || k.name || 'Enfant'])));
      const teacherUids = Array.from(new Set(eligible.map(l => l.teacher_id).filter(Boolean)));
      const profiles = await Promise.all(teacherUids.map(uid => fetchUserProfile(uid)));
      setTeacherMap(new Map(
        profiles.filter(Boolean).map(p => [
          (p.uid || p.id),
          { name: p.fullName || p.name || p.displayName || 'Professeur' }
        ])
      ));

      const idSet = new Set();
      eligible.forEach(l => {
        if (!l.is_group) return;
        (Array.isArray(l.participant_ids) ? l.participant_ids : []).forEach(id => id && idSet.add(id));
        if (l.student_id) idSet.add(l.student_id);
      });
      const ids = Array.from(idSet);
      const names = await Promise.all(ids.map(id => resolvePersonName(id, nameCacheRef)));
      const idToName = new Map(ids.map((id, i) => [id, names[i]]));
      const mapByLesson = new Map();
      eligible.forEach(l => {
        if (!l.is_group) return;
        const idsForLesson = [
          ...(Array.isArray(l.participant_ids) ? l.participant_ids : []),
          ...(l.student_id ? [l.student_id] : []),
        ];
        const uniq = Array.from(new Set(idsForLesson));
        mapByLesson.set(l.id, uniq.map(id => idToName.get(id) || id));
      });
      setGroupNamesByLesson(mapByLesson);

      if (openGroupId && !eligible.some(l => l.id === openGroupId)) setOpenGroupId(null);
      setLoading(false);
    };
    run();
  }, [weekKey]); // ← refetch à chaque nouvelle semaine

  const lessonsByDay = useMemo(() => {
    const m = Object.fromEntries(week.map(w => [w.code, []]));
    lessons.forEach(l => { if (m[l.slot_day]) m[l.slot_day].push(l); });
    return m;
  }, [week, lessons]);

  const childNamesForLesson = (l) => {
    const ids = new Set();
    if (l.student_id && kidIds.includes(l.student_id)) ids.add(l.student_id);
    if (Array.isArray(l.participant_ids)) l.participant_ids.forEach(id => { if (kidIds.includes(id)) ids.add(id); });
    const list = Array.from(ids);
    if (list.length === 0 && l.student_id && studentMap.has(l.student_id)) list.push(l.student_id);
    return list.map(id => studentMap.get(id) || id);
  };

  const nextCourse = useMemo(() => {
    const now = new Date();
    const future = lessons
      .filter(l => l.status === 'confirmed')
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

  const teacherNameOf = (uid) => (teacherMap.get(uid)?.name) || uid || 'Professeur';
  const subjectOf = (l) => l.subject_id || 'Cours';

  return (
    <DashboardLayout role="parent">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-2xl font-bold text-primary mb-6">🗓️ Planning hebdo des enfants</h2>

        {/* Prochain cours */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <div className="bg-white rounded-xl shadow p-6 border-l-4 border-primary flex flex-col items-start md:col-span-3">
            <span className="text-3xl mb-2">📅</span>
            <span className="text-xl font-bold text-primary">Prochain cours</span>
            <div className="text-gray-700 mt-2 flex flex-wrap gap-2 items-center">
              {(nextCourse || nextAny) ? (
                (() => {
                  const L = nextCourse || nextAny;
                  const d = L.startAt || L.startAtGlobal;
                  return (
                    <>
                      <span className="text-xs text-gray-600">
                        {formatNextLessonDate(d)}
                      </span>
                      <span className="text-xs text-gray-600">•</span>
                      <span className="text-sm font-medium">{subjectOf(L)}</span>
                      <span className="text-xs text-gray-600">— Prof : {teacherNameOf(L.teacher_id)}</span>
                      <span className="text-xs text-gray-600">•</span>
                      {childNamesForLesson(L).map((nm, i) => (
                        <NameChip key={`nc:${i}`}>{nm}</NameChip>
                      ))}
                    </>
                  );
                })()
                ) : (
                <span className="text-gray-700">Aucun cours confirmé à venir</span>
              )}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Chargement…</div>
        ) : (
          <div className="bg-white p-6 rounded-xl shadow border">
            {/* Header navigation semaines */}
            <div className="flex items-center justify-between mb-4">
              <button
                type="button"
                onClick={goPrevWeek}
                className="px-2 py-1 text-sm rounded hover:bg-gray-100"
              >
                ← Semaine précédente
              </button>

              <div className="text-sm font-semibold text-gray-700">
                Semaine du {weekRangeLabel}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowMonthPicker(v => !v)}
                  className="px-2 py-1 text-sm rounded border hover:bg-gray-50"
                >
                  📆 Calendrier
                </button>
                <button
                  type="button"
                  onClick={goNextWeek}
                  className="px-2 py-1 text-sm rounded hover:bg-gray-100"
                >
                  Semaine suivante →
                </button>
              </div>
            </div>

            {/* Mini calendrier (popup) */}
            {showMonthPicker && (
              <div className="relative mb-4">
                <div className="absolute z-20 right-0 bg-white border rounded-lg shadow p-3">
                  <div className="flex items-center justify-between mb-2">
                    <button
                      type="button"
                      onClick={() => {
                        const d = new Date(monthAnchor);
                        d.setMonth(d.getMonth() - 1);
                        setMonthAnchor(d);
                      }}
                      className="px-2 py-1 text-xs rounded hover:bg-gray-100"
                    >
                      ←
                    </button>
                    <div className="text-xs font-semibold">
                      {monthAnchor.toLocaleDateString('fr-FR', {
                        month: 'long',
                        year: 'numeric',
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const d = new Date(monthAnchor);
                        d.setMonth(d.getMonth() + 1);
                        setMonthAnchor(d);
                      }}
                      className="px-2 py-1 text-xs rounded hover:bg-gray-100"
                    >
                      →
                    </button>
                  </div>

                  <div className="grid grid-cols-7 gap-1 text-[11px] text-center mb-1">
                    {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => (
                      <div key={i} className="font-semibold text-gray-500">
                        {d}
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-7 gap-1 text-[11px] text-center">
                    {(() => {
                      const days = buildMonthDays();
                      const first = days[0];
                      const pad = (first.getDay() + 6) % 7; // aligné sur lundi
                      const blanks = Array.from({ length: pad }, (_, i) => (
                        <div key={`b${i}`} />
                      ));
                      return [
                        ...blanks,
                        ...days.map((d) => {
                          const dayNum = d.getDate();
                          const isCurrentWeek =
                            d >= weekStart &&
                            d < (() => {
                              const e = new Date(weekStart);
                              e.setDate(e.getDate() + 7);
                              return e;
                            })();
                          return (
                            <button
                              key={d.toISOString()}
                              type="button"
                              onClick={() => {
                                goToWeek(d);
                                setShowMonthPicker(false);
                              }}
                              className={
                                'w-7 h-7 rounded-full flex items-center justify-center ' +
                                (isCurrentWeek
                                  ? 'bg-primary text-white'
                                  : 'hover:bg-gray-100 text-gray-700')
                              }
                            >
                              {dayNum}
                            </button>
                          );
                        }),
                      ];
                    })()}
                  </div>
                </div>
              </div>
            )}

            {/* Planning hebdo */}
            {week.map(({ code, label }) => (
              <div key={code} className="mb-5">
                <div className="font-bold text-secondary text-sm mb-2 uppercase">{label}</div>
                {lessonsByDay[code].length === 0 ? (
                  <div className="text-gray-400 text-xs">Aucun cours</div>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {lessonsByDay[code]
                      .sort((a, b) => (Number(a.slot_hour) || 0) - (Number(b.slot_hour) || 0))
                      .map(l => {
                        const isGroup = !!l.is_group;
                        const open = openGroupId === l.id;
                        const kidsNames = childNamesForLesson(l);
                        return (
                          <li key={l.id} className="relative flex items-center gap-3 bg-gray-50 px-3 py-2 rounded-lg border">
                            {(() => {
                              const ds = (l?.is_group && Array.isArray(l.participant_ids) &&
                                l.participant_ids.some(sid => kidIds.includes(sid) && (
                                  l.participantsMap?.[sid]?.status === 'accepted' || l.participantsMap?.[sid]?.status === 'confirmed'
                                )))
                                ? (l.status === 'completed' ? 'completed' : 'confirmed')
                                : l.status;
                              return (
                                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColors[ds] || 'bg-gray-200'}`}>
                                  {ds === 'confirmed' ? 'Confirmé' : ds === 'completed' ? 'Terminé' : ds}
                                </span>
                              );
                            })()}
                            <span className="text-sm font-medium">{subjectOf(l)}</span>
                            <span className="text-xs text-gray-500">— Prof : {teacherNameOf(l.teacher_id)}</span>

                            <div className="flex flex-wrap gap-2 ml-2">
                              {kidsNames.length ? kidsNames.map((nm, i) => <NameChip key={`kid:${l.id}:${i}`}>{nm}</NameChip>) : (
                                <span className="text-xs text-gray-500">—</span>
                              )}
                            </div>

                            <span className="text-xs text-gray-500 ml-auto">{formatHourFromSlot(l.slot_hour)}</span>

                            {isGroup && (
                              <button
                                className="ml-2 text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded hover:bg-indigo-100"
                                onClick={() => setOpenGroupId(open ? null : l.id)}
                                title="Voir les élèves du groupe"
                              >
                                👥
                              </button>
                            )}
                            {isGroup && open && (
                              <div className="absolute top-full mt-2 left-3 z-10 bg-white border rounded-lg shadow p-3 w-64">
                                <div className="text-xs font-semibold mb-1">Tous les élèves du groupe</div>
                                {Array.isArray(groupNamesByLesson.get(l.id)) && groupNamesByLesson.get(l.id).length ? (
                                  <ul className="text-sm text-gray-700 list-disc pl-4 space-y-1">
                                    {groupNamesByLesson.get(l.id).map((nm, i) => <li key={i}>{nm}</li>)}
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