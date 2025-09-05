import React, { useEffect, useMemo, useRef, useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import useStudentCourses from '../hooks/useStudentCourses';
import DocumentsModal from '../components/lessons/DocumentsModal';
import ReviewForm from '../components/ReviewForm';
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
import { formatDateMaybe } from '../utils/datetime';

// ---- Helpers ----
const FR_DAY_CODES = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const codeIndex = (c) => Math.max(0, FR_DAY_CODES.indexOf(c));
const statusColors = {
  booked: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-green-100 text-green-800',
  completed: 'bg-gray-100 text-gray-700',
  rejected: 'bg-red-100 text-red-700',
};

function nextOccurrence(slot_day, slot_hour, now = new Date()) {
  if (!FR_DAY_CODES.includes(slot_day)) return null;
  const jsDay = now.getDay(); // 0=Dim..6=Sam
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

// Résolution de noms (users -> students) avec cache
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

export default function MyCourses() {
  const { courses, loading, setCourses } = useStudentCourses();

  const [docOpen, setDocOpen] = useState(false);
  const [docLesson, setDocLesson] = useState(null);
  const [openReviewFor, setOpenReviewFor] = useState(null);

  // group UI
  const [openGroupId, setOpenGroupId] = useState(null);
  const [groupNamesByLesson, setGroupNamesByLesson] = useState(new Map());
  const nameCacheRef = useRef(new Map());

  // On force l’affichage aux seuls confirmés/terminés
  const visible = useMemo(
    () => (courses || []).filter(c => c && (c.status === 'confirmed' || c.status === 'completed')),
    [courses]
  );

  // Prochain cours
  const nextCourse = useMemo(() => {
    const now = new Date();
    const futureConfirmed = visible
      .filter(l => l.status === 'confirmed' && FR_DAY_CODES.includes(l.slot_day))
      .map(l => ({ ...l, startAt: nextOccurrence(l.slot_day, l.slot_hour, now) }))
      .filter(l => l.startAt && l.startAt > now)
      .sort((a, b) => a.startAt - b.startAt);
    return futureConfirmed[0] || null;
  }, [visible]);

  // Charger les noms des participants pour les cours groupés
  useEffect(() => {
    const run = async () => {
      if (!auth.currentUser) return;
      const idSet = new Set();
      visible.forEach(l => {
        if (l?.is_group) {
          (Array.isArray(l.participant_ids) ? l.participant_ids : []).forEach(id => id && idSet.add(id));
          if (l.student_id) idSet.add(l.student_id);
        }
      });
      const ids = Array.from(idSet);
      const names = await Promise.all(ids.map(id => resolvePersonName(id, nameCacheRef)));
      const idToName = new Map(ids.map((id, i) => [id, names[i]]));

      const map = new Map();
      visible.forEach(l => {
        if (!l?.is_group) return;
        const idsForLesson = [
          ...(Array.isArray(l.participant_ids) ? l.participant_ids : []),
          ...(l.student_id ? [l.student_id] : []),
        ];
        const uniq = Array.from(new Set(idsForLesson));
        const nmList = uniq.map(id => idToName.get(id) || id);
        map.set(l.id, nmList);
      });
      setGroupNamesByLesson(map);

      // fermer popup si le lesson n’est plus visible
      if (openGroupId && !visible.some(x => x.id === openGroupId)) {
        setOpenGroupId(null);
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const openDocs = (course) => {
    setDocLesson(course);
    setDocOpen(true);
  };

  const toggleReview = (lessonId) => {
    setOpenReviewFor(prev => (prev === lessonId ? null : lessonId));
  };

  return (
    <DashboardLayout role="student">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-2xl font-bold text-primary mb-6">📚 Mes cours</h2>

        {/* Prochain cours */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <div className="bg-white rounded-xl shadow p-6 border-l-4 border-primary flex flex-col items-start md:col-span-3">
            <span className="text-3xl mb-2">📅</span>
            <span className="text-xl font-bold text-primary">Prochain cours</span>
            <span className="text-gray-700 mt-1">
              {nextCourse
                ? (() => {
                    const when = `${nextCourse.slot_day} ${String(nextCourse.slot_hour).padStart(2,'0')}h`;
                    return `${nextCourse.subject_id || 'Cours'} · ${when} · avec ${nextCourse.teacherName || nextCourse.teacher_id}`;
                  })()
                : 'Aucun cours confirmé à venir'}
            </span>
          </div>
        </div>

        {loading ? (
          <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Chargement…</div>
        ) : (
          <div className="grid grid-cols-1 gap-5">
            {visible.length === 0 && (
              <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">
                Aucun cours confirmé/terminé pour le moment.
              </div>
            )}

            {visible.map((course) => {
              const isGroup = !!course.is_group;
              const groupNames = groupNamesByLesson.get(course.id) || [];
              const open = openGroupId === course.id;

              return (
                <div key={course.id} className="bg-white p-6 rounded-xl shadow border flex flex-col gap-4 relative">
                  <div className="flex items-center gap-4 min-w-0">
                    <img
                      src={course.teacherAvatar || '/avatar-default.png'}
                      alt={course.teacherName || 'Professeur'}
                      className="w-12 h-12 rounded-full object-cover border"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex gap-2 items-center mb-1">
                        <span className="font-bold text-primary">{course.subject_id || 'Matière'}</span>
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ml-2 ${statusColors[course.status] || 'bg-gray-200'}`}>
                          {course.status === 'confirmed' ? 'Confirmé' : course.status === 'completed' ? 'Terminé' : course.status}
                        </span>

                        {isGroup && (
                          <button
                            className="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded hover:bg-indigo-100"
                            onClick={() => setOpenGroupId(open ? null : course.id)}
                            title="Voir les élèves du groupe"
                          >
                            👥 {groupNames.length}
                          </button>
                        )}
                      </div>

                      <div className="text-gray-700">
                        Professeur : <span className="font-semibold">{course.teacherName || course.teacher_id}</span>
                      </div>
                      <div className="text-gray-500 text-sm mb-1">
                        {/* start_datetime (si présent) ou affichage simple de slot */}
                        {course.start_datetime ? (
                          <>📅 {formatDateMaybe(course.start_datetime)}</>
                        ) : (
                          (course.slot_day || course.slot_hour !== undefined) && (
                            <>📅 {course.slot_day} {formatHourFromSlot(course.slot_hour)}</>
                          )
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col sm:flex-row gap-2">
                    <button
                      className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded shadow font-semibold"
                      onClick={() => openDocs(course)}
                    >
                      📄 Documents
                    </button>

                    {course.status === 'completed' && !course.hasReview && (
                      <button
                        className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded shadow font-semibold"
                        onClick={() => toggleReview(course.id)}
                      >
                        ⭐ Laisser un avis
                      </button>
                    )}

                    {course.status === 'completed' && course.hasReview && (
                      <span className="text-green-600 text-xs font-semibold self-center">Avis laissé ✔️</span>
                    )}
                  </div>

                  {/* Zone ReviewForm (inline) */}
                  {openReviewFor === course.id && (
                    <div className="border rounded-lg p-4 bg-gray-50">
                      <ReviewForm
                        lessonId={course.id}
                        teacherId={course.teacher_id}
                        studentId={course.student_id}
                        onReviewSent={() => {
                          setCourses(prev => prev.map(c => (c.id === course.id ? { ...c, hasReview: true } : c)));
                          setOpenReviewFor(null);
                        }}
                      />
                      <div className="mt-2">
                        <button
                          className="text-sm text-gray-600 hover:text-gray-800 underline"
                          onClick={() => setOpenReviewFor(null)}
                        >
                          Annuler
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Mini-fenêtre participants */}
                  {isGroup && open && (
                    <div className="absolute top-full mt-2 left-6 z-10 bg-white border rounded-lg shadow p-3 w-64">
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
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal Documents (lecture seule côté élève) */}
      <DocumentsModal
        open={docOpen}
        onClose={() => setDocOpen(false)}
        lesson={docLesson}
        allowUpload={false}
      />
    </DashboardLayout>
  );
}