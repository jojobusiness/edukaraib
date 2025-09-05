import React, { useEffect, useMemo, useRef, useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import DocumentsModal from '../components/lessons/DocumentsModal';
import ReviewModal from '../components/lessons/ReviewModal';
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

/* ---------- Helpers ---------- */
const FR_DAY_CODES = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const codeIndex = (c) => Math.max(0, FR_DAY_CODES.indexOf(c));

function nextOccurrence(slot_day, slot_hour, now = new Date()) {
  if (!FR_DAY_CODES.includes(slot_day)) return null;
  const jsDay = now.getDay(); // 0..6
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

function fmtHourFromSlot(h) {
  const n = Number(h) || 0;
  return `${String(n).padStart(2, '0')}:00`;
}

const statusColors = {
  booked: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-green-100 text-green-800',
  completed: 'bg-gray-100 text-gray-700',
  rejected: 'bg-red-100 text-red-700',
};

/* ---------- Résolution de noms (users -> students) ---------- */
async function fetchUserProfile(uid) {
  if (!uid) return null;
  try {
    const s = await getDoc(doc(db, 'users', uid));
    if (s.exists()) return { id: uid, ...s.data() };
  } catch {}
  try {
    const q = query(collection(db, 'users'), where('uid', '==', uid), limit(1));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const d = snap.docs[0];
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
  try {
    const u = await getDoc(doc(db, 'users', id));
    if (u.exists()) {
      const d = u.data();
      const nm = d.fullName || d.name || d.displayName || id;
      cacheRef.current.set(id, nm);
      return nm;
    }
  } catch {}
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
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);

  // participants UI
  const [openGroupId, setOpenGroupId] = useState(null);
  const [groupNamesByLesson, setGroupNamesByLesson] = useState(new Map());
  const [teacherMap, setTeacherMap] = useState(new Map()); // teacher_id -> name
  const nameCacheRef = useRef(new Map());

  // modals
  const [docOpen, setDocOpen] = useState(false);
  const [docLesson, setDocLesson] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewLesson, setReviewLesson] = useState(null);

  const openDocs = (lesson) => { setDocLesson(lesson); setDocOpen(true); };
  const openReview = (lesson) => { setReviewLesson(lesson); setReviewOpen(true); };

  // charge mes cours + noms profs/participants
  useEffect(() => {
    const run = async () => {
      if (!auth.currentUser) return;
      setLoading(true);
      const uid = auth.currentUser.uid;

      // A) je suis dans student_id
      const qA = query(collection(db, 'lessons'), where('student_id', '==', uid));
      const sA = await getDocs(qA);

      // B) je suis dans participant_ids
      const qB = query(collection(db, 'lessons'), where('participant_ids', 'array-contains', uid));
      const sB = await getDocs(qB);

      const map = new Map();
      sA.docs.forEach(d => map.set(d.id, { id: d.id, ...d.data() }));
      sB.docs.forEach(d => map.set(d.id, { id: d.id, ...d.data() }));

      const data = Array.from(map.values());
      setCourses(data);

      // participants
      const partIdSet = new Set();
      data.forEach(l => {
        if (l.is_group) {
          (Array.isArray(l.participant_ids) ? l.participant_ids : []).forEach(id => id && partIdSet.add(id));
          if (l.student_id) partIdSet.add(l.student_id);
        }
      });
      const partIds = Array.from(partIdSet);
      const partNames = await Promise.all(partIds.map(id => resolvePersonName(id, nameCacheRef)));
      const idToName = new Map(partIds.map((id, i) => [id, partNames[i]]));

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

      // profs
      const tIds = Array.from(new Set(data.map(l => l.teacher_id).filter(Boolean)));
      const tProfiles = await Promise.all(tIds.map(uid => fetchUserProfile(uid)));
      const tMap = new Map(
        tProfiles
          .filter(Boolean)
          .map(p => [p.id || p.uid, p.fullName || p.name || p.displayName || 'Professeur'])
      );
      setTeacherMap(tMap);

      // si un panneau ouvert correspond à un cours qui n’est plus affiché, on le referme
      if (openGroupId && !data.some(x => x.id === openGroupId)) setOpenGroupId(null);

      setLoading(false);
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // prochain cours confirmé (à partir des slot_day/hour)
  const nextCourse = useMemo(() => {
    const now = new Date();
    const future = courses
      .filter(l => l.status === 'confirmed' && FR_DAY_CODES.includes(l.slot_day))
      .map(l => ({ ...l, startAt: nextOccurrence(l.slot_day, l.slot_hour, now) }))
      .filter(l => l.startAt && l.startAt > now)
      .sort((a, b) => a.startAt - b.startAt);
    return future[0] || null;
  }, [courses]);

  // sections
  const booked = useMemo(() => courses.filter(c => c.status === 'booked'), [courses]);
  const confirmed = useMemo(() => courses.filter(c => c.status === 'confirmed'), [courses]);
  const completed = useMemo(() => courses.filter(c => c.status === 'completed'), [courses]);

  function CourseCard({ c }) {
    const isGroup = !!c.is_group;
    const groupNames = groupNamesByLesson.get(c.id) || [];
    const open = openGroupId === c.id;
    const teacherName = teacherMap.get(c.teacher_id) || c.teacher_id;

    return (
      <div
        className="bg-white p-6 rounded-xl shadow border flex flex-col md:flex-row md:items-center gap-4 justify-between relative"
      >
        <div className="flex-1 min-w-0">
          <div className="flex gap-2 items-center mb-1">
            <span className="font-bold text-primary">{c.subject_id || 'Matière'}</span>
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ml-2 ${statusColors[c.status] || 'bg-gray-200'}`}>
              {c.status === 'confirmed' ? 'Confirmé' : c.status === 'completed' ? 'Terminé' : c.status === 'booked' ? 'En attente' : c.status}
            </span>

            {isGroup && (
              <button
                className="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded hover:bg-indigo-100"
                onClick={() => setOpenGroupId(open ? null : c.id)}
                title="Voir les élèves du groupe"
              >
                👥 {groupNames.length}
              </button>
            )}
          </div>

          <div className="text-gray-700 text-sm">
            Professeur : <span className="font-semibold">{teacherName}</span>
          </div>
          <div className="text-gray-500 text-xs mb-1">
            {(c.slot_day || c.slot_hour !== undefined) && `${c.slot_day} ${fmtHourFromSlot(c.slot_hour)}`}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <button
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded shadow font-semibold"
            onClick={() => openDocs(c)}
          >
            📄 Documents
          </button>

          {c.status === 'completed' && (
            <button
              className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded shadow font-semibold"
              onClick={() => openReview(c)}
            >
              ⭐ Laisser un avis
            </button>
          )}
        </div>

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
  }

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
                    const when = `${nextCourse.slot_day} ${fmtHourFromSlot(nextCourse.slot_hour)}`;
                    const profName = teacherMap.get(nextCourse.teacher_id) || nextCourse.teacher_id;
                    return `${nextCourse.subject_id || 'Cours'} · ${when} · avec ${profName}`;
                  })()
                : 'Aucun cours confirmé à venir'}
            </span>
          </div>
        </div>

        {loading ? (
          <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Chargement…</div>
        ) : (
          <>
            {/* En attente */}
            <section className="mb-8">
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-lg font-semibold">En attente de confirmation</h3>
                <span className="text-sm text-gray-500">{booked.length}</span>
              </div>
              {booked.length === 0 ? (
                <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">
                  Aucun cours en attente.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {booked.map((c) => <CourseCard key={c.id} c={c} />)}
                </div>
              )}
            </section>

            {/* Confirmés */}
            <section className="mb-8">
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-lg font-semibold">Cours confirmés</h3>
                <span className="text-sm text-gray-500">{confirmed.length}</span>
              </div>
              {confirmed.length === 0 ? (
                <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">
                  Aucun cours confirmé.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {confirmed.map((c) => <CourseCard key={c.id} c={c} />)}
                </div>
              )}
            </section>

            {/* Terminés */}
            <section className="mb-8">
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-lg font-semibold">Cours terminés</h3>
                <span className="text-sm text-gray-500">{completed.length}</span>
              </div>
              {completed.length === 0 ? (
                <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">
                  Aucun cours terminé.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {completed.map((c) => <CourseCard key={c.id} c={c} />)}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {/* Modals */}
      <DocumentsModal
        open={docOpen}
        onClose={() => setDocOpen(false)}
        lesson={docLesson}
        allowUpload={false}
      />
      <ReviewModal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        lesson={reviewLesson}
        onSent={() => {}}
      />
    </DashboardLayout>
  );
}