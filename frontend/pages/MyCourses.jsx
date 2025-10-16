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
  onSnapshot
} from 'firebase/firestore';

/* ---------- Helpers ---------- */
// Helper: un cours est-il confirmé POUR MOI ?
const isConfirmedForMe = (lesson, uid) => {
  if (!uid || !lesson) return false;

  // ✅ Ne pas considérer “confirmé” si la leçon est terminée
  if (lesson.status === 'completed') return false;

  // Cours groupé: je suis "accepted" ou "confirmed" dans participantsMap
  if (lesson.is_group) {
    const st = lesson?.participantsMap?.[uid]?.status;
    return st === 'accepted' || st === 'confirmed';
  }

  // Cours individuel: statut global confirmé
  return lesson.status === 'confirmed';
};

const FR_DAY_CODES = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const codeIndex = (c) => Math.max(0, FR_DAY_CODES.indexOf(c));

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
function formatHour(h) { const n = Number(h) || 0; return `${String(n).padStart(2, '0')}:00`; }

const statusColors = {
  booked: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-green-100 text-green-800',
  completed: 'bg-gray-100 text-gray-700',
  rejected: 'bg-red-100 text-red-700',
};

// Statuts “en attente” (pour les cours individuels)
const PENDING_LESSON_STATUSES = new Set([
  'booked',
  'pending_teacher',
  'pending_parent',
  'requested',
  'pending',
  'awaiting_confirmation',
  'awaiting',
]);

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
async function resolveTeacherName(id, cache) {
  if (!id) return '';
  if (cache.current.has(id)) return cache.current.get(id);
  const u = await fetchUserProfile(id);
  const nm = (u && (u.fullName || u.name || u.displayName)) || id;
  cache.current.set(id, nm);
  return nm;
}
async function resolvePersonName(id, cache) {
  if (!id) return id;
  if (cache.current.has(id)) return cache.current.get(id);
  // users
  try {
    const u = await getDoc(doc(db, 'users', id));
    if (u.exists()) {
      const d = u.data();
      const nm = d.fullName || d.name || d.displayName || id;
      cache.current.set(id, nm);
      return nm;
    }
  } catch {}
  // students
  try {
    const s = await getDoc(doc(db, 'students', id));
    if (s.exists()) {
      const d = s.data();
      const nm = d.full_name || d.name || id;
      cache.current.set(id, nm);
      return nm;
    }
  } catch {}
  cache.current.set(id, id);
  return id;
}

/* ---------- logique “confirmé/pending” PAR PARTICIPANT ---------- */
function isGroupLesson(l) {
  return Array.isArray(l?.participant_ids) && l.participant_ids.length > 0;
}
function isConfirmedForUser(l, uid) {
  if (l?.status === 'completed') return false; // ✅ exclure les terminés
  if (isGroupLesson(l)) {
    const st = l?.participantsMap?.[uid]?.status;
    return st === 'accepted' || st === 'confirmed';
  }
  return l?.student_id === uid && l?.status === 'confirmed';
}
function isPendingForUser(l, uid) {
  if (isGroupLesson(l)) {
    const st = l?.participantsMap?.[uid]?.status;
    return !['accepted', 'confirmed', 'rejected', 'removed', 'deleted'].includes(String(st || ''));
  }
  if (l?.student_id !== uid) return false;
  return PENDING_LESSON_STATUSES.has(String(l?.status || ''));
}

/* =================== PAGE =================== */
export default function MyCourses() {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [docOpen, setDocOpen] = useState(false);
  const [docLesson, setDocLesson] = useState(null);

  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewLesson, setReviewLesson] = useState(null);

  const nameCache = useRef(new Map());

  useEffect(() => {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;
    setLoading(true);

    const map = new Map();
    const upsert = (id, data) => { map.set(id, { id, ...data }); setCourses(Array.from(map.values())); };
    const remove = (id) => { map.delete(id); setCourses(Array.from(map.values())); };

    const qA = query(collection(db, 'lessons'), where('student_id', '==', uid));
    const qB = query(collection(db, 'lessons'), where('participant_ids', 'array-contains', uid));

    const unsubA = onSnapshot(qA, (snap) => {
      snap.docChanges().forEach((ch) => (
        ch.type === 'removed' ? remove(ch.doc.id) : upsert(ch.doc.id, ch.doc.data())
      ));
      setLoading(false);
    }, () => setLoading(false));

    const unsubB = onSnapshot(qB, (snap) => {
      snap.docChanges().forEach((ch) => (
        ch.type === 'removed' ? remove(ch.doc.id) : upsert(ch.doc.id, ch.doc.data())
      ));
      setLoading(false);
    }, () => setLoading(false));

    return () => { unsubA(); unsubB(); };
  }, []);

  // prochain confirmé (toi) — basé sur “confirmé pour moi” (participantsMap OU status global)
  const nextCourse = useMemo(() => {
    const now = new Date();
    const uid = auth.currentUser?.uid;
    const list = courses
      .filter(l => isConfirmedForUser(l, uid) && FR_DAY_CODES.includes(l.slot_day))
      .map(l => ({ ...l, startAt: nextOccurrence(l.slot_day, l.slot_hour, now) } ))
      .filter(l => l.startAt && l.startAt > now)
      .sort((a, b) => a.startAt - b.startAt);
    return list[0] || null;
  }, [courses]);

  // Invitations reçues (prof t’a invité)
  const invitations = useMemo(() => {
    const uid = auth.currentUser?.uid;
    return courses.filter(l => {
      const pm = l.participantsMap || {};
      return isGroupLesson(l)
        && l.participant_ids.includes(uid)
        && pm?.[uid]?.status === 'invited_student';
    });
  }, [courses]);

  // Listes “en attente / confirmés / …” PAR UTILISATEUR
  const uid = auth.currentUser?.uid;
  const booked = useMemo(() => courses.filter(c => isPendingForUser(c, uid)), [courses, uid]);
  const confirmed = useMemo(() => courses.filter(c => isConfirmedForUser(c, uid)), [courses, uid]);
  const rejected = useMemo(() => courses.filter(c => c.status === 'rejected'), [courses]);
  const completed = useMemo(() => courses.filter(c => c.status === 'completed'), [courses]);

  function teacherNameFor(id) {
    return nameCache.current.get(id) || id;
  }

  async function acceptInvite(lesson) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      await updateDoc(doc(db, 'lessons', lesson.id), {
        [`participantsMap.${uid}.status`]: 'accepted',
      });
      // local
      setCourses(prev => prev.map(c => c.id === lesson.id
        ? { ...c, participantsMap: { ...(c.participantsMap||{}), [uid]: { ...(c.participantsMap?.[uid]||{}), status: 'accepted' } } }
        : c
      ));
    } catch (e) {
      console.error(e);
      alert("Impossible d'accepter l'invitation.");
    }
  }

  async function declineInvite(lesson) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      await updateDoc(doc(db, 'lessons', lesson.id), {
        participant_ids: (lesson.participant_ids || []).filter(x => x !== uid),
        [`participantsMap.${uid}`]: null,
      });
      setCourses(prev => prev.filter(c => !(c.id === lesson.id && (c.participant_ids||[]).includes(uid))));
    } catch (e) {
      console.error(e);
      alert("Impossible de refuser l'invitation.");
    }
  }

  const statusBadge = (st) => (
    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColors[st] || 'bg-gray-200'}`}>
      {st === 'booked' ? 'En attente' : st === 'confirmed' ? 'Confirmé' : st === 'completed' ? 'Terminé' : st === 'rejected' ? 'Refusé' : st}
    </span>
  );

  function paymentBadgeForMe(c) {
    const uid = auth.currentUser?.uid;
    const group = isGroupLesson(c);
    const paid = group ? !!c.participantsMap?.[uid]?.is_paid : !!c.is_paid;
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
        const ids = (c.participant_ids || []).slice(0, 50);
        const nm = await Promise.all(ids.map((id) => resolvePersonName(id, nameCache)));
        setNames(nm);
      })();
    }, [open, c]);
    return (
      <>
        <button
          className="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded hover:bg-indigo-100"
          onClick={() => setOpen(v => !v)}
          title="Voir les élèves du groupe"
        >
          👥 {(c.participant_ids || []).length}
        </button>
        {open && (
          <div className="mt-2 bg-white border rounded-lg shadow p-3 w-64">
            <div className="text-xs font-semibold mb-1">Élèves du groupe</div>
            {names.length ? (
              <ul className="text-sm text-gray-700 list-disc pl-4 space-y-1">
                {names.map((nm, i) => (
                  <li key={i}>{nm}</li>
                ))}
              </ul>
            ) : (
              <div className="text-xs text-gray-500">Aucun participant.</div>
            )}
          </div>
        )}
      </>
    );
  }

  function CourseCard({ c, showDocs = true, showReview = false }) {
    const when = (c.slot_day || c.slot_hour != null) ? `${c.slot_day} ${formatHour(c.slot_hour)}` : '';
    const group = isGroupLesson(c);

    // ✅ priorité à “Terminé”
    const displayedStatus = c.status === 'completed'
      ? 'completed'
      : (isConfirmedForMe(c, auth.currentUser?.uid) ? 'confirmed' : c.status);

    return (
      <div className="bg-white p-6 rounded-xl shadow border flex flex-col md:flex-row md:items-center gap-4 justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-bold text-primary">{c.subject_id || 'Matière'}</span>
            {statusBadge(displayedStatus)}
            {group && <ParticipantsPopover c={c} />}
          </div>
          <div className="text-gray-700 text-sm">Professeur : <span className="font-semibold">{teacherNameFor(c.teacher_id)}</span></div>
          <div className="text-gray-500 text-xs">{when}</div>
          <div className="mt-1">{paymentBadgeForMe(c)}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {showDocs && (
            <button className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded shadow font-semibold" onClick={() => { setDocLesson(c); setDocOpen(true); }}>
              📄 Documents
            </button>
          )}
          {showReview && (
            <button
              className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded shadow font-semibold"
              onClick={() => { setReviewLesson(c); setReviewOpen(true); }}
            >
              ⭐ Laisser un avis
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <DashboardLayout role="student">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-2xl font-bold text-primary mb-6">📚 Mes cours</h2>

        {/* Prochain cours */}
        <div className="bg-white rounded-xl shadow p-6 border-l-4 border-primary mb-6">
          <div className="text-3xl mb-2">📅</div>
          <div className="text-xl font-bold text-primary">Prochain cours</div>
          <div className="text-gray-700 mt-1">
            {nextCourse
              ? `${nextCourse.subject_id || 'Cours'} · ${nextCourse.slot_day} ${formatHour(nextCourse.slot_hour)} · avec ${teacherNameFor(nextCourse.teacher_id)}`
              : 'Aucun cours confirmé à venir'}
          </div>
        </div>

        {loading ? (
          <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Chargement…</div>
        ) : (
          <>
            {/* Invitations reçues */}
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

            {/* En attente (pour MOI) */}
            <section className="mb-8">
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-lg font-semibold">En attente de confirmation</h3>
                <span className="text-sm text-gray-500">{booked.length}</span>
              </div>
              {booked.length === 0 ? (
                <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Aucun cours en attente.</div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {booked.map((c) => <CourseCard key={c.id} c={c} />)}
                </div>
              )}
            </section>

            {/* Confirmés (pour MOI) */}
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

            {/* Refusés */}
            <section className="mb-8">
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-lg font-semibold">Cours refusés</h3>
                <span className="text-sm text-gray-500">{rejected.length}</span>
              </div>
              {rejected.length === 0 ? (
                <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Aucun cours refusé.</div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {rejected.map((c) => <CourseCard key={c.id} c={c} />)}
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
                  {completed.map((c) => <CourseCard key={c.id} c={c} showReview />)}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {/* Modals */}
      <DocumentsModal open={docOpen} onClose={() => setDocOpen(false)} lesson={docLesson} allowUpload={false} />
      {/* 👉 permet plusieurs avis sur le même cours */}
      <ReviewModal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        lesson={reviewLesson}
        allowMultiple={true}
        lessonId={reviewLesson?.id || null}
        teacherId={reviewLesson?.teacher_id || null}
        reviewerId={auth.currentUser?.uid || null}
        key={reviewLesson?.id || 'review-modal'}
        onSent={() => {}}
      />
    </DashboardLayout>
  );
}