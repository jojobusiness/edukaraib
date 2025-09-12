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
/** users d'abord (élève autonome), puis students (enfant rattaché). */
async function resolveStudentName(id, cacheRef) {
  if (!id) return '';
  if (cacheRef.current.has(id)) return cacheRef.current.get(id);
  // users
  const u = await fetchUserProfile(id);
  if (u) {
    const nm = u.fullName || u.name || u.displayName || id;
    cacheRef.current.set(id, nm);
    return nm;
  }
  // students
  const s = await fetchStudentDoc(id);
  if (s) {
    const nm = s.full_name || s.name || id;
    cacheRef.current.set(id, nm);
    return nm;
  }
  cacheRef.current.set(id, id);
  return id;
}

export default function TeacherCalendar() {
  const [lessons, setLessons] = useState([]);
  const [studentMap, setStudentMap] = useState(new Map()); // student_id -> name
  const [groupNamesByLesson, setGroupNamesByLesson] = useState(new Map()); // lessonId -> [names]
  const [openGroupId, setOpenGroupId] = useState(null);
  const [loading, setLoading] = useState(true);

  const week = getThisWeekDays();
  const weekByCode = useMemo(() => Object.fromEntries(week.map(w => [w.code, w.date])), [week]);
  const nameCacheRef = useRef(new Map());

  useEffect(() => {
    const fetchLessons = async () => {
      if (!auth.currentUser) return;
      setLoading(true);

      // 1) cours du prof
      const qLessons = query(
        collection(db, 'lessons'),
        where('teacher_id', '==', auth.currentUser.uid)
      );
      const snap = await getDocs(qLessons);
      const rawAll = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      // 2) enrichir (semaine courante)
      const enrichedAll = rawAll
        .map(l => {
          const base = weekByCode[l.slot_day];
          if (!base) return null;
          const startAt = dateWithHour(base, l.slot_hour);
          return { ...l, startAt };
        })
        .filter(Boolean);

      // ✅ Filtrage éligible :
      // - Individuel: confirmed ou completed
      // - Groupe: inclure si AU MOINS un participant est accepted|confirmed (completed toujours inclus)
      const eligible = enrichedAll.filter((l) => {
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

      // 3) Précharger noms de l'élève principal (pour affichage simple)
      const studentIds = Array.from(new Set(eligible.map(l => l.student_id).filter(Boolean)));
      const names = await Promise.all(studentIds.map(id => resolveStudentName(id, nameCacheRef)));
      setStudentMap(new Map(studentIds.map((id, i) => [id, names[i]]) ));

      // 4) Noms des participants pour cours groupés
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
  }, []); // eslint-disable-line

  // Données dérivées
  const now = new Date();

  // 👉 Prochain cours : on exclut juste les "completed" et on prend le plus proche (groupé ou individuel)
  const upcoming = lessons
    .filter(l => l.status !== 'completed' && l.startAt >= now)
    .sort((a, b) => a.startAt - b.startAt);

  const nextOne = upcoming[0] || null;

  // Groupage hebdo par code
  const lessonsByDay = useMemo(() => {
    const m = Object.fromEntries(week.map(w => [w.code, []]));
    lessons.forEach(l => {
      if (m[l.slot_day]) m[l.slot_day].push(l);
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
    <DashboardLayout role="teacher">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold text-primary mb-6">🗓️ Mon agenda de la semaine</h2>

        {/* ---- Bandeau Prochain cours ---- */}
        {!loading && (
          <div className="bg-white p-4 rounded-xl shadow border mb-6">
            <div className="font-semibold text-primary mb-2">Prochain cours</div>
            {nextOne ? (
              <div className="flex items-center gap-3">
              {(() => {
                const ds = (nextOne?.is_group && Array.isArray(nextOne.participant_ids) &&
                  nextOne.participant_ids.some(sid => {
                    const st = nextOne.participantsMap?.[sid]?.status;
                    return st === 'accepted' || st === 'confirmed';
                  }))
                  ? (nextOne.status === 'completed' ? 'completed' : 'confirmed')
                  : nextOne.status;
                return (
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColors[ds] || 'bg-gray-200'}`}>
                    {ds === 'confirmed' ? 'Confirmé' : ds === 'completed' ? 'Terminé' : ds}
                  </span>
                );
              })()}
                <span className="font-bold text-secondary">{nextOne.subject_id || 'Matière'}</span>
                <span className="text-sm text-gray-700">
                  {studentMap.get(nextOne.student_id) || nextOne.student_id || (nextOne.is_group ? 'Cours groupé' : '')}
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

        {/* ---- Vue hebdo (confirmés & groupés acceptés, + terminés) ---- */}
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

                            {/* Élève principal (si cours individuel) */}
                            {!isGroup && (
                              <span className="text-xs text-gray-600">
                                {studentMap.get(l.student_id) || l.student_id}
                              </span>
                            )}

                            {/* Badge groupe + mini-fenêtre des élèves */}
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