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
  onSnapshot,
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
  try {
    const u = await getDoc(doc(db, 'users', id));
    if (u.exists()) {
      const d = u.data();
      const nm = d.fullName || d.name || d.displayName || id;
      cacheRef.current.set(id, nm);
      return nm;
    }
  } catch {}
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

/* ---------- helpers “confirmé pour l’enfant” ---------- */
function isGroupLesson(l) {
  return Array.isArray(l?.participant_ids) && l.participant_ids.length > 0;
}
function isConfirmedForChild(l, sid) {
  if (!sid) return false;
  if (l?.status === 'completed') return false; // ✅ exclure terminés
  if (isGroupLesson(l)) {
    const st = l?.participantsMap?.[sid]?.status;
    return st === 'accepted' || st === 'confirmed';
  }
  return l?.student_id === sid && l?.status === 'confirmed';
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

  // maps
  const [studentMap, setStudentMap] = useState(new Map());
  const [teacherMap, setTeacherMap] = useState(new Map());
  const nameCacheRef = useRef(new Map());

  // enfants du parent (temps réel) + parent lui-même
  const [kidIds, setKidIds] = useState([]);

  // --- Enfants (temps réel) ---
  useEffect(() => {
    const me = auth.currentUser;
    if (!me) { setLoading(false); return; }
    setLoading(true);

    const unsubKids = onSnapshot(
      query(collection(db, 'students'), where('parent_id', '==', me.uid)),
      async (kidsSnap) => {
        const kids = kidsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const ids = kids.map(k => k.id);

        // nom du parent
        let parentLabel = 'Moi (parent)';
        try {
          const meSnap = await getDoc(doc(db, 'users', me.uid));
          if (meSnap.exists()) {
            const d = meSnap.data();
            parentLabel = d.fullName || d.name || 'Moi (parent)';
          }
        } catch {}

        const newMap = new Map(kids.map(k => [k.id, k.full_name || k.fullName || k.name || 'Enfant']));
        newMap.set(me.uid, parentLabel);
        setStudentMap(newMap);

        setKidIds([...ids, me.uid]);
      },
      () => { setLoading(false); }
    );

    return () => {
      unsubKids();
    };
  }, []);

  // --- Leçons des enfants + parent (temps réel) ---
  useEffect(() => {
    const me = auth.currentUser;
    if (!me) { setLoading(false); return; }
    if (!kidIds.length) { setCourses([]); setLoading(false); return; }

    setLoading(true);
    const unsubs = [];
    const map = new Map(); // id leçon -> leçon

    const upsert = (docId, data) => {
      map.set(docId, { id: docId, ...data });
      setCourses(Array.from(map.values()));
    };
    const remove = (docId) => {
      map.delete(docId);
      setCourses(Array.from(map.values()));
    };

    const chunks = (arr, n=10) => Array.from({ length: Math.ceil(arr.length / n)}, (_,i)=>arr.slice(i*n,(i+1)*n));

    const chunksA = chunks(kidIds, 10);
    const chunksB = chunks(kidIds, 10);
    const totalListeners = chunksA.length + chunksB.length;
    let readyCount = 0;

    const onFirstSnapshot = () => {
      readyCount += 1;
      if (readyCount >= totalListeners) setLoading(false);
    };

    // A) lessons via student_id
    for (const chunk of chunksA) {
      const qA = query(collection(db, 'lessons'), where('student_id', 'in', chunk));
      const unsubA = onSnapshot(
        qA,
        (sA) => {
          sA.docChanges().forEach((ch) => {
            if (ch.type === 'removed') remove(ch.doc.id);
            else upsert(ch.doc.id, ch.doc.data());
          });
          onFirstSnapshot();
        },
        () => { onFirstSnapshot(); }
      );
      unsubs.push(unsubA);
    }

    // B) lessons via participant_ids
    for (const chunk of chunksB) {
      const qB = query(collection(db, 'lessons'), where('participant_ids', 'array-contains-any', chunk));
      const unsubB = onSnapshot(
        qB,
        (sB) => {
          sB.docChanges().forEach((ch) => {
            if (ch.type === 'removed') remove(ch.doc.id);
            else upsert(ch.doc.id, ch.doc.data());
          });
          onFirstSnapshot();
        },
        () => { onFirstSnapshot(); }
      );
      unsubs.push(unsubB);
    }

    return () => { unsubs.forEach(fn => fn && fn()); };
  }, [kidIds]);

  // 3) enrichissements (noms profs)
  useEffect(() => {
    (async () => {
      const tIds = Array.from(new Set(courses.map(l => l.teacher_id).filter(Boolean)));
      const tProfiles = await Promise.all(tIds.map((tid) => fetchUserProfile(tid)));
      setTeacherMap(new Map(tProfiles.filter(Boolean).map(p => [p.id || p.uid, p.fullName || p.name || p.displayName || 'Professeur'])));
    })();
  }, [courses]);

  // prochaines (confirmées pour au moins un enfant/parent) — exclure terminées
  const nextCourse = useMemo(() => {
    const now = new Date();
    const kidsSetLocal = new Set(kidIds);

    const eligible = courses.filter((c) => {
      if (!FR_DAY_CODES.includes(c.slot_day)) return false;
      if (c.status === 'completed') return false; // ✅ exclure terminé
      if (isGroupLesson(c)) {
        const ids = c.participant_ids || [];
        const pm = c.participantsMap || {};
        return ids.some((sid) => kidsSetLocal.has(sid) && (pm?.[sid]?.status === 'accepted' || pm?.[sid]?.status === 'confirmed'));
      } else {
        return c.status === 'confirmed' && kidsSetLocal.has(c.student_id);
      }
    });

    const future = eligible
      .map(l => ({ ...l, startAt: nextOccurrence(l.slot_day, l.slot_hour, now) }))
      .filter(l => l.startAt && l.startAt > now)
      .sort((a, b) => a.startAt - b.startAt);

    return future[0] || null;
  }, [courses, kidIds]);

  // invitations
  const invitations = useMemo(() => {
    const kidsSetLocal = new Set(kidIds);
    const list = [];
    for (const c of courses) {
      const pm = c.participantsMap || {};
      const ids = c.participant_ids || [];
      const invitedChild = ids.find((sid) => kidsSetLocal.has(sid) && pm?.[sid]?.status === 'invited_student');
      if (invitedChild) list.push({ ...c, __child: invitedChild });
    }
    return list;
  }, [courses, kidIds]);

  // --- Construire les vues par “élève” suivi (enfants + parent) ---

  const kidsSet = useMemo(() => new Set(kidIds), [kidIds]);

  // En attente
  const pendingItems = useMemo(() => {
    const out = [];
    for (const c of courses) {
      if (isGroupLesson(c)) {
        const pm = c.participantsMap || {};
        const ids = c.participant_ids || [];
        ids.forEach((sid) => {
          if (!kidsSet.has(sid)) return;
          const st = pm?.[sid]?.status;
          if (st !== 'accepted' && st !== 'confirmed') {
            out.push({ c, sid });
          }
        });
      } else {
        if (c.status === 'booked' && kidsSet.has(c.student_id)) {
          out.push({ c, sid: c.student_id });
        }
      }
    }
    out.sort((a, b) => (FR_DAY_CODES.indexOf(a.c.slot_day) - FR_DAY_CODES.indexOf(b.c.slot_day)) || ((a.c.slot_hour||0)-(b.c.slot_hour||0)));
    return out;
  }, [courses, kidsSet]);

  // Confirmés — exclure les cours terminés
  const confirmedCourses = useMemo(() => {
    const arr = [];
    for (const c of courses) {
      if (c.status === 'completed') continue; // ✅ ne pas dupliquer
      if (isGroupLesson(c)) {
        const pm = c.participantsMap || {};
        const ids = c.participant_ids || [];
        const confirmedKids = ids.filter((sid) => kidsSet.has(sid) && (pm?.[sid]?.status === 'accepted' || pm?.[sid]?.status === 'confirmed'));
        if (confirmedKids.length) arr.push({ c, confirmedKids });
      } else {
        if (c.status === 'confirmed' && kidsSet.has(c.student_id)) arr.push({ c, confirmedKids: [c.student_id] });
      }
    }
    return arr;
  }, [courses, kidsSet]);

  // Terminés
  const completedCourses = useMemo(() => {
    const arr = [];
    for (const c of courses) {
      if (c.status !== 'completed') continue;
      if (isGroupLesson(c)) {
        const pm = c.participantsMap || {};
        const ids = c.participant_ids || [];
        const confirmedKids = ids.filter((sid) => kidsSet.has(sid) && (pm?.[sid]?.status === 'accepted' || pm?.[sid]?.status === 'confirmed'));
        if (confirmedKids.length) arr.push({ c, confirmedKids });
      } else {
        if (kidsSet.has(c.student_id)) arr.push({ c, confirmedKids: [c.student_id] });
      }
    }
    return arr;
  }, [courses, kidsSet]);

  // Refusés
  const rejectedCourses = useMemo(() => {
    return courses.filter((c) => c.status === 'rejected' && (
      (isGroupLesson(c) && (c.participant_ids || []).some((sid) => kidsSet.has(sid))) ||
      (!isGroupLesson(c) && kidsSet.has(c.student_id))
    ));
  }, [courses, kidsSet]);

  // actions invitations
  async function acceptInvite(c) {
    const sid = c.__child;
    try {
      await updateDoc(doc(db, 'lessons', c.id), { [`participantsMap.${sid}.status`]: 'accepted' });
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
    } catch (e) {
      console.error(e);
      alert("Impossible de refuser l'invitation.");
    }
  }

  function teacherNameFor(id) { return teacherMap.get(id) || id; }
  function childNameFor(id) { return studentMap.get(id) || id; }

  // --- UI ---

  function PendingItemCard({ c, sid }) {
    return (
      <div className="bg-white p-6 rounded-xl shadow border flex flex-col md:flex-row md:items-center gap-4 justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-primary">{c.subject_id || 'Matière'}</span>
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-800">En attente</span>
          </div>
          <div className="text-gray-700 text-sm flex flex-wrap items-center gap-2">
            <span className="opacity-80">Élève&nbsp;:</span>
            <span className="inline-flex items-center gap-2 bg-gray-50 px-2 py-0.5 rounded-full border">
              <span className="font-semibold">{childNameFor(sid)}</span>
            </span>
          </div>
          <div className="text-gray-700 text-sm">Professeur : <span className="font-semibold">{teacherNameFor(c.teacher_id)}</span></div>
          <div className="text-gray-500 text-xs">{c.slot_day} {formatHour(c.slot_hour)}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded shadow font-semibold" onClick={() => { setDocLesson(c); setDocOpen(true); }}>
            📄 Documents
          </button>
        </div>
      </div>
    );
  }

  function ParticipantsPopover({ c }) {
    const [open, setOpen] = useState(false);
    const [names, setNames] = useState([]);

    const pm = c.participantsMap || {};
    const allIds = Array.isArray(c.participant_ids) ? c.participant_ids : [];
    const visibleIds = allIds.filter(
      (sid) => pm?.[sid]?.status === 'accepted' || pm?.[sid]?.status === 'confirmed'
    );

    useEffect(() => {
      if (!open) return;
      (async () => {
        const nm = await Promise.all(visibleIds.slice(0, 40).map((id) => resolvePersonName(id, nameCacheRef)));
        setNames(nm);
      })();
    }, [open, c.id]);

    return (
      <>
        <button
          className="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded hover:bg-indigo-100"
          onClick={() => setOpen((v) => !v)}
          title="Participants confirmés"
        >
          👥 {visibleIds.length}
        </button>

        {open && (
          <div className="mt-2 bg-white border rounded-lg shadow p-3 w-64">
            <div className="text-xs font-semibold mb-1">Élèves confirmés</div>
            {names.length ? (
              <ul className="text-sm text-gray-700 list-disc pl-4 space-y-1">
                {names.map((nm, i) => <li key={i}>{nm}</li>)}
              </ul>
            ) : (
              <div className="text-xs text-gray-500">Aucun participant confirmé.</div>
            )}
          </div>
        )}
      </>
    );
  }

  function statusBadge(st) {
    return (
      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColors[st] || 'bg-gray-200'}`}>
        {st === 'confirmed' ? 'Confirmé' : st === 'completed' ? 'Terminé' : st === 'booked' ? 'En attente' : st === 'rejected' ? 'Refusé' : st}
      </span>
    );
  }

  function paymentBadgeForChild(c, sid) {
    const group = isGroupLesson(c);
    const paid = group ? !!c.participantsMap?.[sid]?.is_paid : !!c.is_paid;
    return (
      <span className={`text-[11px] px-2 py-0.5 rounded-full ${paid ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
        {paid ? 'Payé' : 'À payer'}
      </span>
    );
  }

  function CourseCard({ c, kids }) {
    const group = isGroupLesson(c);

    // ✅ priorité à “Terminé”
    const displayedStatus = c.status === 'completed'
      ? 'completed'
      : ((c.is_group && (kids?.length > 0)) ? 'confirmed' : c.status);

    return (
      <div className="bg-white p-6 rounded-xl shadow border flex flex-col md:flex-row md:items-center gap-4 justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-primary">{c.subject_id || 'Matière'}</span>
            {statusBadge(displayedStatus)}
            {group && <ParticipantsPopover c={c} />}
          </div>

          {/* Enfants confirmés/acceptés */}
          <div className="text-gray-700 text-sm flex flex-wrap items-center gap-2">
            <span className="opacity-80">Élève(s)&nbsp;:</span>
            {kids && kids.length ? kids.map((sid) => (
              <span key={sid} className="inline-flex items-center gap-2 bg-gray-50 px-2 py-0.5 rounded-full border">
                <span className="font-semibold">{childNameFor(sid)}</span>
                {paymentBadgeForChild(c, sid)}
              </span>
            )) : <span className="font-semibold">—</span>}
          </div>

          <div className="text-gray-700 text-sm">Professeur : <span className="font-semibold">{teacherNameFor(c.teacher_id)}</span></div>
          <div className="text-gray-500 text-xs">{c.slot_day} {formatHour(c.slot_hour)}</div>
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
        <h2 className="text-2xl font-bold text-primary mb-6">📚 Suivi des cours</h2>

        {/* Prochain cours */}
        <div className="bg-white rounded-xl shadow p-6 border-l-4 border-primary mb-6">
          <div className="text-3xl mb-2">📅</div>
          <div className="text-xl font-bold text-primary">Prochain cours</div>
          <div className="text-gray-700 mt-1">
            {nextCourse
              ? (() => {
                  const c = nextCourse;
                  const pm = c.participantsMap || {};
                  const kidsConfirmed = isGroupLesson(c)
                    ? (c.participant_ids || []).filter((sid) => kidIds.includes(sid) && (pm?.[sid]?.status === 'accepted' || pm?.[sid]?.status === 'confirmed'))
                    : (c.student_id ? [c.student_id] : []);
                  const childrenLabel = kidsConfirmed.length > 1
                    ? `Participants: ${kidsConfirmed.map((id) => studentMap.get(id) || id).join(', ')}`
                    : (studentMap.get(kidsConfirmed[0]) || c.student_id);
                  return `${c.subject_id || 'Cours'} · ${c.slot_day} ${formatHour(c.slot_hour)} · ${childrenLabel} · avec ${teacherNameFor(c.teacher_id)}`;
                })()
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
                        <div className="text-gray-700 text-sm">Élève : <span className="font-semibold">{studentMap.get(c.__child) || c.__child}</span></div>
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

            {/* En attente */}
            <section className="mb-8">
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-lg font-semibold">En attente de confirmation</h3>
                <span className="text-sm text-gray-500">{pendingItems.length}</span>
              </div>
              {pendingItems.length === 0 ? (
                <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Aucun cours en attente.</div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {pendingItems.map(({ c, sid }) => (
                    <PendingItemCard key={`${c.id}:${sid}`} c={c} sid={sid} />
                  ))}
                </div>
              )}
            </section>

            {/* Confirmés */}
            <section className="mb-8">
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-lg font-semibold">Cours confirmés</h3>
                <span className="text-sm text-gray-500">{confirmedCourses.length}</span>
              </div>
              {confirmedCourses.length === 0 ? (
                <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Aucun cours confirmé.</div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {confirmedCourses.map(({ c, confirmedKids }) => (
                    <CourseCard key={c.id} c={c} kids={confirmedKids} />
                  ))}
                </div>
              )}
            </section>

            {/* Refusés */}
            <section className="mb-8">
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-lg font-semibold">Cours refusés</h3>
                <span className="text-sm text-gray-500">{rejectedCourses.length}</span>
              </div>
              {rejectedCourses.length === 0 ? (
                <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Aucun cours refusé.</div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {rejectedCourses.map((c) => (
                    <CourseCard key={c.id} c={c} kids={
                      isGroupLesson(c)
                        ? (c.participant_ids || []).filter((sid) => kidsSet.has(sid))
                        : (kidsSet.has(c.student_id) ? [c.student_id] : [])
                    } />
                  ))}
                </div>
              )}
            </section>

            {/* Terminés */}
            <section className="mb-8">
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-lg font-semibold">Cours terminés</h3>
                <span className="text-sm text-gray-500">{completedCourses.length}</span>
              </div>
              {completedCourses.length === 0 ? (
                <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Aucun cours terminé.</div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {completedCourses.map(({ c, confirmedKids }) => (
                    <CourseCard key={c.id} c={c} kids={confirmedKids} />
                  ))}
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