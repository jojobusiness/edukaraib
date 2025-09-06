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
  updateDoc,
  limit,
} from 'firebase/firestore';

/* ---------- Helpers ---------- */
const FR_DAY_CODES = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const codeIndex = (c) => Math.max(0, FR_DAY_CODES.indexOf(c));

function nextOccurrence(slot_day, slot_hour, now = new Date()) {
  if (!FR_DAY_CODES.includes(slot_day)) return null;
  const jsDay = now.getDay();
  const offsetToMonday = ((jsDay + 6) % 7);
  const monday = new Date(now);
  monday.setHours(0,0,0,0);
  monday.setDate(now.getDate() - offsetToMonday);

  const idx = codeIndex(slot_day);
  const start = new Date(monday);
  start.setDate(monday.getDate() + idx);
  start.setHours(Number(slot_hour) || 0, 0, 0, 0);
  if (start <= now) start.setDate(start.getDate() + 7);
  return start;
}
function formatHour(h) { const n = Number(h) || 0; return `${String(n).padStart(2, '0')}:00`; }

const statusColors = {
  booked: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-green-100 text-green-800',
  completed: 'bg-gray-100 text-gray-700',
  rejected: 'bg-red-100 text-red-700',
};

/* ---------- noms ---------- */
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
  try {
    const s = await getDoc(doc(db, 'students', id));
    if (s.exists()) {
      const d = s.data();
      const nm = d.full_name || d.name || id;
      cacheRef.current.set(id, nm);
      return nm;
    }
  } catch {}
  cacheRef.current.set(id, id);
  return id;
}

/* =================== PAGE =================== */
export default function ParentCourses() {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [docOpen, setDocOpen] = useState(false);
  const [docLesson, setDocLesson] = useState(null);

  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewLesson, setReviewLesson] = useState(null);

  // Group popup
  const [openGroupId, setOpenGroupId] = useState(null);

  // maps
  const [studentMap, setStudentMap] = useState(new Map());
  const [teacherMap, setTeacherMap] = useState(new Map());
  const nameCacheRef = useRef(new Map());

  useEffect(() => {
    const run = async () => {
      if (!auth.currentUser) return;
      setLoading(true);

      // enfants
      const kidsSnap = await getDocs(query(collection(db, 'students'), where('parent_id', '==', auth.currentUser.uid)));
      const kids = kidsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const kidIds = kids.map(k => k.id);

      setStudentMap(new Map(kids.map(k => [k.id, k.full_name || k.fullName || k.name || 'Enfant'])));

      if (kidIds.length === 0) {
        setCourses([]); setLoading(false); return;
      }

      // A) lessons via student_id
      const map = new Map();
      for (let i = 0; i < kidIds.length; i += 10) {
        const chunk = kidIds.slice(i, i + 10);
        const qA = query(collection(db, 'lessons'), where('student_id', 'in', chunk));
        const sA = await getDocs(qA);
        sA.docs.forEach(d => map.set(d.id, { id: d.id, ...d.data() }));
      }
      // B) lessons via participant_ids
      for (const kid of kidIds) {
        const qB = query(collection(db, 'lessons'), where('participant_ids', 'array-contains', kid));
        const sB = await getDocs(qB);
        sB.docs.forEach(d => map.set(d.id, { id: d.id, ...d.data() }));
      }

      const data = Array.from(map.values());

      // prof names
      const tIds = Array.from(new Set(data.map(l => l.teacher_id).filter(Boolean)));
      const tProfiles = await Promise.all(tIds.map((tid) => fetchUserProfile(tid)));
      setTeacherMap(new Map(tProfiles.filter(Boolean).map(p => [p.id || p.uid, p.fullName || p.name || p.displayName || 'Professeur'])));

      setCourses(data);
      setLoading(false);
    };
    run();
  }, []);

  // prochaines (confirmées)
  const nextCourse = useMemo(() => {
    const now = new Date();
    const futureConfirmed = courses
      .filter(l => l.status === 'confirmed' && FR_DAY_CODES.includes(l.slot_day))
      .map(l => ({ ...l, startAt: nextOccurrence(l.slot_day, l.slot_hour, now) }))
      .filter(l => l.startAt && l.startAt > now)
      .sort((a, b) => a.startAt - b.startAt);
    return futureConfirmed[0] || null;
  }, [courses]);

  // invitations pour mes enfants (status invited_student)
  const invitations = useMemo(() => {
    const list = [];
    for (const c of courses) {
      const pm = c.participantsMap || {};
      const ids = c.participant_ids || [];
      const invitedChild = ids.find((sid) => pm?.[sid]?.status === 'invited_student' && studentMap.has(sid));
      if (invitedChild) list.push({ ...c, __child: invitedChild });
    }
    return list;
  }, [courses, studentMap]);

  // confirmés/terminés (on exclut les en attente comme demandé)
  const confirmed = useMemo(() => courses.filter(c => c.status === 'confirmed'), [courses]);
  const completed = useMemo(() => courses.filter(c => c.status === 'completed'), [courses]);

  // actions invitations (pour l’enfant)
  async function acceptInvite(c) {
    const sid = c.__child;
    try {
      await updateDoc(doc(db, 'lessons', c.id), { [`participantsMap.${sid}.status`]: 'accepted' });
      setCourses(prev => prev.map(x => x.id === c.id ? {
        ...x,
        participantsMap: { ...(x.participantsMap||{}), [sid]: { ...(x.participantsMap?.[sid]||{}), status: 'accepted' } }
      } : x));
    } catch (e) {
      console.error(e);
      alert("Impossible d'accepter l'invitation.");
    }
  }
  async function declineInvite(c) {
    const sid = c.__child;
    try {
      const newIds = (c.participant_ids || []).filter(x => x !== sid);
      await updateDoc(doc(db, 'lessons', c.id), {
        participant_ids: newIds,
        [`participantsMap.${sid}`]: null,
      });
      setCourses(prev => prev.map(x => x.id === c.id ? { ...x, participant_ids: newIds } : x));
    } catch (e) {
      console.error(e);
      alert("Impossible de refuser l'invitation.");
    }
  }

  function teacherNameFor(id) { return teacherMap.get(id) || id; }
  function childNameFor(id) { return studentMap.get(id) || id; }

  function paymentBadgeForChild(c, sid) {
    const isGroup = !!c.is_group;
    const paid = isGroup ? !!c.participantsMap?.[sid]?.is_paid : !!c.is_paid;
    return (
      <span className={`text-[11px] px-2 py-0.5 rounded-full ${paid ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
        {paid ? 'Payé' : 'À payer'}
      </span>
    );
  }

  function ParticipantsPopover({ c }) {
    const [open, setOpen] = useState(false);
    const [names, setNames] = useState([]);
    useEffect(() => {
      if (!open) return;
      (async () => {
        const ids = (c.participant_ids || []).slice(0, 40);
        const nm = await Promise.all(ids.map((id) => resolvePersonName(id, nameCacheRef)));
        setNames(nm);
      })();
    }, [open, c]);
    return (
      <>
        <button className="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded hover:bg-indigo-100" onClick={() => setOpen(v => !v)}>
          👥 {(c.participant_ids || []).length}
        </button>
        {open && (
          <div className="mt-2 bg-white border rounded-lg shadow p-3 w-64">
            <div className="text-xs font-semibold mb-1">Élèves du groupe</div>
            {names.length ? (
              <ul className="text-sm text-gray-700 list-disc pl-4 space-y-1">
                {names.map((nm, i) => <li key={i}>{nm}</li>)}
              </ul>
            ) : (
              <div className="text-xs text-gray-500">Aucun participant.</div>
            )}
          </div>
        )}
      </>
    );
  }

  function statusBadge(st) {
    return (
      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColors[st] || 'bg-gray-200'}`}>
        {st === 'confirmed' ? 'Confirmé' : st === 'completed' ? 'Terminé' : st === 'booked' ? 'En attente' : st}
      </span>
    );
  }

  function CourseCard({ c }) {
    const isGroup = !!c.is_group;
    // élève concerné :
    const studentId = (c.student_id && studentMap.has(c.student_id)) ? c.student_id
      : (c.participant_ids || []).find((sid) => studentMap.has(sid)) || c.student_id;

    return (
      <div className="bg-white p-6 rounded-xl shadow border flex flex-col md:flex-row md:items-center gap-4 justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-primary">{c.subject_id || 'Matière'}</span>
            {statusBadge(c.status)}
            {isGroup && <ParticipantsPopover c={c} />}
          </div>
          <div className="text-gray-700 text-sm">Enfant : <span className="font-semibold">{childNameFor(studentId)}</span></div>
          <div className="text-gray-700 text-sm">Professeur : <span className="font-semibold">{teacherNameFor(c.teacher_id)}</span></div>
          <div className="text-gray-500 text-xs">{c.slot_day} {formatHour(c.slot_hour)}</div>
          <div className="mt-1">{paymentBadgeForChild(c, studentId)}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded shadow font-semibold" onClick={() => { setDocLesson(c); setDocOpen(true); }}>
            📄 Documents
          </button>
          {c.status === 'completed' && (
            <button className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded shadow font-semibold" onClick={() => { setReviewLesson(c); setReviewOpen(true); }}>
              ⭐ Laisser un avis
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <DashboardLayout role="parent">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-2xl font-bold text-primary mb-6">📚 Suivi des cours (enfants)</h2>

        {/* Prochain cours */}
        <div className="bg-white rounded-xl shadow p-6 border-l-4 border-primary mb-6">
          <div className="text-3xl mb-2">📅</div>
          <div className="text-xl font-bold text-primary">Prochain cours</div>
          <div className="text-gray-700 mt-1">
            {nextCourse
              ? (() => {
                  const sid =
                    (nextCourse.student_id && studentMap.has(nextCourse.student_id)) ? nextCourse.student_id
                    : (nextCourse.participant_ids || []).find((id) => studentMap.has(id)) || nextCourse.student_id;
                  return `${nextCourse.subject_id || 'Cours'} · ${nextCourse.slot_day} ${formatHour(nextCourse.slot_hour)} · ${childNameFor(sid)} · avec ${teacherNameFor(nextCourse.teacher_id)}`;
                })()
              : 'Aucun cours confirmé à venir'}
          </div>
        </div>

        {loading ? (
          <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Chargement…</div>
        ) : (
          <>
            {/* Invitations reçues (par enfant) */}
            <section className="mb-8">
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-lg font-semibold">Invitations reçues</h3>
                <span className="text-sm text-gray-500">{invitations.length}</span>
              </div>
              {invitations.length === 0 ? (
                <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Aucune invitation.</div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {invitations.map((c) => (
                    <div key={c.id} className="bg-white p-6 rounded-xl shadow border flex flex-col md:flex-row md:items-center gap-4 justify-between">
                      <div className="flex-1">
                        <div className="flex gap-2 items-center mb-1">
                          <span className="font-bold text-primary">{c.subject_id || 'Matière'}</span>
                          <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded">Invitation</span>
                        </div>
                        <div className="text-gray-700 text-sm">Enfant : <span className="font-semibold">{childNameFor(c.__child)}</span></div>
                        <div className="text-gray-700 text-sm">Professeur : <span className="font-semibold">{teacherNameFor(c.teacher_id)}</span></div>
                        <div className="text-gray-500 text-xs">{c.slot_day} {formatHour(c.slot_hour)}</div>
                      </div>
                      <div className="flex gap-2">
                        <button className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded shadow font-semibold" onClick={() => acceptInvite(c)}>
                          ✅ Accepter
                        </button>
                        <button className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded shadow font-semibold" onClick={() => declineInvite(c)}>
                          ❌ Refuser
                        </button>
                      </div>
                    </div>
                  ))}
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
                <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Aucun cours confirmé.</div>
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
                <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Aucun cours terminé.</div>
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
      <DocumentsModal open={docOpen} onClose={() => setDocOpen(false)} lesson={docLesson} allowUpload={false} />
      <ReviewModal open={reviewOpen} onClose={() => setReviewOpen(false)} lesson={reviewLesson} onSent={() => {}} />
    </DashboardLayout>
  );
}