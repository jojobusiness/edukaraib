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

const FR_DAY_CODES = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const codeIndex = (c) => Math.max(0, FR_DAY_CODES.indexOf(c));

function getThisWeekDays() {
  const now = new Date();
  const jsDay = now.getDay();
  const offsetToMonday = ((jsDay + 6) % 7);
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() - offsetToMonday);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const code = FR_DAY_CODES[i];
    const label = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
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

export default function ParentCalendar() {
  const [lessons, setLessons] = useState([]);
  const [studentMap, setStudentMap] = useState(new Map());
  const [teacherMap, setTeacherMap] = useState(new Map());
  const [groupNamesByLesson, setGroupNamesByLesson] = useState(new Map());
  const [openGroupId, setOpenGroupId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [kidIds, setKidIds] = useState([]);
  const nameCacheRef = useRef(new Map());

  useEffect(() => {
    const run = async () => {
      if (!auth.currentUser) return;
      setLoading(true);
      const kidsSnap = await getDocs(query(collection(db, 'students'), where('parent_id', '==', auth.currentUser.uid)));
      const kids = kidsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const kidIdsLocal = kids.map(k => k.id);
      setKidIds(kidIdsLocal);

      if (kids.length === 0) {
        setLessons([]); setStudentMap(new Map()); setTeacherMap(new Map()); setGroupNamesByLesson(new Map());
        setOpenGroupId(null); setLoading(false); return;
      }

      // Récup toutes les leçons liées aux enfants (élève principal OU participant)
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

      // ✅ Filtrage éligible :
      // - Individuel: confirmed ou completed (et l'enfant est bien l'élève)
      // - Groupe: inclure si AU MOINS un de mes enfants est accepted|confirmed (completed toujours inclus)
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

      setLessons(eligible);

      setStudentMap(new Map(kids.map(k => [k.id, k.full_name || k.fullName || k.name || 'Enfant'])));
      const teacherUids = Array.from(new Set(eligible.map(l => l.teacher_id).filter(Boolean)));
      const profiles = await Promise.all(teacherUids.map(uid => fetchUserProfile(uid)));
      setTeacherMap(new Map(
        profiles.filter(Boolean).map(p => [
          (p.uid || p.id),
          { name: p.fullName || p.name || p.displayName || 'Professeur' }
        ])
      ));

      // Noms des participants pour les cours groupés
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const week = getThisWeekDays();
  const lessonsByDay = useMemo(() => {
    const m = Object.fromEntries(week.map(w => [w.code, []]));
    lessons.forEach(l => { const code = typeof l.slot_day === 'string' ? l.slot_day : ''; if (m[code]) m[code].push(l); });
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

  const teacherNameOf = (uid) => (teacherMap.get(uid)?.name) || uid || 'Professeur';
  const subjectOf = (l) => l.subject_id || 'Cours';

  return (
    <DashboardLayout role="parent">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-2xl font-bold text-primary mb-6">🗓️ Planning hebdo des enfants</h2>

        {/* Prochain cours — + Matière & Prof */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <div className="bg-white rounded-xl shadow p-6 border-l-4 border-primary flex flex-col items-start md:col-span-3">
            <span className="text-3xl mb-2">📅</span>
            <span className="text-xl font-bold text-primary">Prochain cours</span>
            <div className="text-gray-700 mt-2 flex flex-wrap gap-2 items-center">
              {nextCourse ? (
                <>
                  <span className="text-xs text-gray-600">
                    {nextCourse.slot_day} {String(nextCourse.slot_hour).padStart(2,'0')}h
                  </span>
                  <span className="text-xs text-gray-600">•</span>
                  <span className="text-sm font-medium">{subjectOf(nextCourse)}</span>
                  <span className="text-xs text-gray-600">— Prof : {teacherNameOf(nextCourse.teacher_id)}</span>
                  <span className="text-xs text-gray-600">•</span>
                  {childNamesForLesson(nextCourse).map((nm, i) => (
                    <NameChip key={`nc:${i}`}>{nm}</NameChip>
                  ))}
                </>
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
                            {/* Matière — Prof */}
                            <span className="text-sm font-medium">{subjectOf(l)}</span>
                            <span className="text-xs text-gray-500">— Prof : {teacherNameOf(l.teacher_id)}</span>

                            {/* Enfants concernés */}
                            <div className="flex flex-wrap gap-2 ml-2">
                              {kidsNames.length ? kidsNames.map((nm, i) => <NameChip key={`kid:${l.id}:${i}`}>{nm}</NameChip>) : (
                                <span className="text-xs text-gray-500">—</span>
                              )}
                            </div>

                            {/* Heure à droite */}
                            <span className="text-xs text-gray-500 ml-auto">{formatHourFromSlot(l.slot_hour)}</span>

                            {/* Participants groupe (optionnel) */}
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