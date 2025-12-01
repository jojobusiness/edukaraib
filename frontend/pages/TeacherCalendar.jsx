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

export default function TeacherCalendar() {
  const [lessons, setLessons] = useState([]);
  const [nextAny, setNextAny] = useState(null);
  const [studentMap, setStudentMap] = useState(new Map());
  const [groupNamesByLesson, setGroupNamesByLesson] = useState(new Map());
  const [openGroupId, setOpenGroupId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [monthAnchor, setMonthAnchor] = useState(() => new Date());
  const [weekKey, setWeekKey] = useState(weekKeyOf(new Date()));

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
          const d = getLessonStartDate(l);
          if (!d) return null;
          return { ...l, startAt: d };
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
        .filter(l => l.status === 'confirmed')
        .map(l => {
          const d = getLessonStartDate(l);
          return d && d > now ? { ...l, startAtGlobal: d } : null;
        })
        .filter(Boolean)
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
    .filter(l => l.status === 'confirmed' && l.startAt >= now)
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

    const getDateForDisplay = (L) => {
    if (!L) return null;

    // 1) startAt déjà un Date (cas "semaine courante")
    if (L.startAt instanceof Date) return L.startAt;
    if (L.startAt?.toDate) {
      try { return L.startAt.toDate(); } catch {}
    }
    if (typeof L.startAt?.seconds === 'number') {
      return new Date(L.startAt.seconds * 1000);
    }

    // 2) startAtGlobal (prochain cours global)
    if (L.startAtGlobal instanceof Date) return L.startAtGlobal;
    if (L.startAtGlobal?.toDate) {
      try { return L.startAtGlobal.toDate(); } catch {}
    }
    if (typeof L.startAtGlobal?.seconds === 'number') {
      return new Date(L.startAtGlobal.seconds * 1000);
    }

    return null;
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
                  const d = getDateForDisplay(L);
                  if (!d) return null;
                  return (
                    <span className="text-sm text-gray-500 ml-auto">
                      {formatNextLessonDate(d)}
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

            {/* Mini calendrier (mois) */}
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
                      const pad = (first.getDay() + 6) % 7; // aligner sur lundi
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