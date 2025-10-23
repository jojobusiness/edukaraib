import React, { useEffect, useMemo, useRef, useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import { auth, db } from '../lib/firebase';
import {
  collection,
  onSnapshot,
  query,
  where,
  doc,
  getDoc,
  updateDoc,
  addDoc,
  serverTimestamp,
  getDocs,
  arrayRemove,
  deleteField,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';

import DocumentsModal from '../components/lessons/DocumentsModal';
import GroupSettingsModal from '../components/lessons/GroupSettingsModal';
import { createPaymentDueNotificationsForLesson } from '../lib/paymentNotifications';

/* ---------- UI helpers ---------- */
const statusColors = {
  booked: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-700',
  completed: 'bg-gray-200 text-gray-700',
};

const fmtTime = (ms) =>
  new Date(ms).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

const fmtFromSlot = (slot_day, slot_hour) =>
  `${slot_day || ''} ${slot_hour != null ? `• ${String(slot_hour).padStart(2, '0')}:00` : ''}`.trim();

function When({ lesson }) {
  const ts = lesson?.start_datetime;
  if (ts?.toDate) {
    try {
      return <span>📅 {ts.toDate().toLocaleString('fr-FR')}</span>;
    } catch {}
  }
  if (typeof ts?.seconds === 'number') return <span>📅 {fmtTime(ts.seconds * 1000)}</span>;
  if (lesson.slot_day || lesson.slot_hour != null) return <span>📅 {fmtFromSlot(lesson.slot_day, lesson.slot_hour)}</span>;
  return null;
}

function StatusPill({ status }) {
  const label =
    status === 'booked' ? 'En attente' :
    status === 'pending_teacher' ? 'En attente prof' :
    status === 'confirmed' ? 'Confirmé' :
    status === 'rejected' ? 'Refusé' :
    status === 'completed' ? 'Terminé' : status;

  return (
    <span className={`px-3 py-1 rounded-full text-xs font-semibold ml-2 ${statusColors[status] || 'bg-gray-200'}`}>
      {label}
    </span>
  );
}

/* ---------- data helpers ---------- */
async function resolvePersonName(id, cache, opts = {}) {
  const { parentId = null } = opts;
  if (!id) return '';
  if (cache.has(id)) return cache.get(id);

  try {
    const u = await getDoc(doc(db, 'users', id));
    if (u.exists()) {
      const d = u.data();
      const nm = d.fullName || d.name || d.displayName || id;
      cache.set(id, nm);
      return nm;
    }
  } catch {}

  try {
    const s = await getDoc(doc(db, 'students', id));
    if (s.exists()) {
      const d = s.data();
      const nm = d.full_name || d.name || id;
      cache.set(id, nm);
      return nm;
    }
  } catch {}

  // 🔎 fallback 1 : collection globale "children" (si utilisée)
  try {
    const c = await getDoc(doc(db, 'children', id));
    if (c.exists()) {
      const d = c.data();
      const nm = (d.fullName || d.full_name || [d.firstName, d.lastName].filter(Boolean).join(' ') || d.name || '').trim();
      if (nm) {
        cache.set(id, nm);
        return nm;
      }
    }
  } catch {}

  // 🔎 fallback 2 : sous-collection "parents/{parentId}/children/{childId}"
  if (parentId) {
    try {
      const pc = await getDoc(doc(db, 'parents', parentId, 'children', id));
      if (pc.exists()) {
        const d = pc.data();
        const nm = (d.fullName || d.full_name || [d.firstName, d.lastName].filter(Boolean).join(' ') || d.name || '').trim();
        if (nm) {
          cache.set(id, nm);
          return nm;
        }
      }
    } catch {}
  }

  cache.set(id, id);
  return id;
}

async function notifyUsers(userIds = [], payloadBase = {}) {
  const now = serverTimestamp();
  const writes = userIds.filter(Boolean).map((uid) =>
    addDoc(collection(db, 'notifications'), {
      user_id: uid,
      read: false,
      created_at: now,
      ...payloadBase,
    })
  );
  await Promise.all(writes);
}

/* ---------- pending helpers ---------- */
const PENDING_SET = new Set([
  'booked',
  'pending_teacher',
  'pending_parent',
  'invited_student',
  'invited_parent',
  'requested',
  'pending',
  'awaiting_confirmation',
  'reinvited',
  'awaiting',
]);

/* =================== PAGE =================== */
export default function TeacherLessons() {
  const [lessons, setLessons] = useState([]);
  const [loading, setLoading] = useState(true);

  // Docs
  const [docOpen, setDocOpen] = useState(false);
  const [docLesson, setDocLesson] = useState(null);

  // Group
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupLesson, setGroupLesson] = useState(null);

  // participants popover
  const [openParticipantsFor, setOpenParticipantsFor] = useState(null);

  // cache noms
  const nameCacheRef = useRef(new Map());

  // Pending group entries (par élève)
  const [pendingGroup, setPendingGroup] = useState([]); // [{lessonId, lesson, studentId, status, studentName, requesterName}]
  const [pendingIndiv, setPendingIndiv] = useState([]); // lessons individuels en attente (enrichis)

  // ✅ Branche l'écoute Firestore quand auth est prêt
  useEffect(() => {
    let unsubLessons = null;
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (unsubLessons) { unsubLessons(); unsubLessons = null; }

      if (!user) {
        setLessons([]);
        setPendingGroup([]);
        setPendingIndiv([]);
        setLoading(false);
        return;
      }
      const uid = user.uid;

      setLoading(true);
      const qLessons = query(collection(db, 'lessons'), where('teacher_id', '==', uid));

      unsubLessons = onSnapshot(qLessons, async (snap) => {
        const raw = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

        // ----- Construire pendingIndiv (tous statuts “pending”)
        const pIndivRaw = raw.filter((l) => !l.is_group && PENDING_SET.has(String(l.status || '')));

        // ----- Construire pendingGroup par élève (tout statut != accepted/confirmed)
        const pGroupRaw = [];
        raw
          .filter((l) => !!l.is_group || (Array.isArray(l.participant_ids) && l.participant_ids.length > 0))
          .forEach((l) =>  {
          const ids = Array.isArray(l.participant_ids) ? Array.from(new Set(l.participant_ids)) : [];
          const pm = l.participantsMap || {};
          ids.forEach((sid) => {
            const st = pm?.[sid]?.status;
            if (!st || PENDING_SET.has(String(st)) || (st !== 'accepted' && st !== 'confirmed')) {
              if (st === 'rejected' || st === 'removed' || st === 'deleted') return;
              pGroupRaw.push({
                lessonId: l.id,
                lesson: l,
                studentId: sid,
                status: st || 'booked',
              });
            }
          });
        });

        // enrichir noms + détails participants (confirmés uniquement pour popover) + requester
        const enriched = await Promise.all(
          raw.map(async (l) => {
            // élève principal (legacy)
            let studentName = '';
            if (l.student_id) studentName = await resolvePersonName(l.student_id, nameCacheRef.current);

            // participants (liste + statut paiement)
            let participantDetails = [];
            if (Array.isArray(l.participant_ids) && l.participant_ids.length > 0) {
              const pm = l.participantsMap || {};
              participantDetails = await Promise.all(
                l.participant_ids.map(async (sid) => {
                  const parentId = pm?.[sid]?.parent_id || pm?.[sid]?.booked_by || null;
                  return {
                    id: sid,
                    name: await resolvePersonName(sid, nameCacheRef.current, { parentId }),
                    is_paid: !!pm?.[sid]?.is_paid,
                    status: pm?.[sid]?.status || 'accepted',
                  };
                })
              );
            }

            // requester (qui a cliqué)
            let requesterName = '';
            const requesterId =
              (l.participantsMap && l.student_id && l.participantsMap[l.student_id]?.parent_id) ||
              l.parent_id ||
              l.booked_by ||
              null;
            if (requesterId) {
              requesterName = await resolvePersonName(requesterId, nameCacheRef.current);
            }

            // fallback : si pas de student_id mais un seul participant, utiliser son nom
            if (!studentName && Array.isArray(l.participant_ids) && l.participant_ids.length === 1) {
              const onlyId = l.participant_ids[0];
              const pm = l.participantsMap || {};
              const parentId = pm?.[onlyId]?.parent_id || pm?.[onlyId]?.booked_by || null;
              studentName = participantDetails[0]?.name
                || await resolvePersonName(onlyId, nameCacheRef.current, { parentId });
            }

            return { ...l, studentName, participantDetails, requesterName };
          })
        );

        // enrichir pendingIndiv
        const pIndiv = pIndivRaw.map((pi) => {
          const found = enriched.find((e) => e.id === pi.id);
          return found || pi;
        });

        // enrichir pendingGroup avec noms d'élève + "demande faite par"
        const pGroup = await Promise.all(
          pGroupRaw.map(async (g) => {
            const parentIdCtx =
              g.lesson?.participantsMap?.[g.studentId]?.parent_id ||
              g.lesson?.participantsMap?.[g.studentId]?.booked_by ||
              null;
            const nm = await resolvePersonName(g.studentId, nameCacheRef.current, { parentId: parentIdCtx });
            const pm = g.lesson?.participantsMap || {};
            const info = pm[g.studentId] || {};
            const requesterId = info.parent_id || info.booked_by || null;
            const requesterName = requesterId
              ? await resolvePersonName(requesterId, nameCacheRef.current)
              : '';
            return { ...g, studentName: nm, requesterName };
          })
        );

        // tri par date décroissante pour la liste principale
        const enrichedSorted = [...enriched].sort((a, b) => {
          const aTs =
            (a.start_datetime?.toDate?.() && a.start_datetime.toDate().getTime()) ||
            (a.start_datetime?.seconds && a.start_datetime.seconds * 1000) ||
            (a.created_at?.toDate?.() && a.created_at.toDate().getTime()) || 0;
          const bTs =
            (b.start_datetime?.toDate?.() && b.start_datetime.toDate().getTime()) ||
            (b.start_datetime?.seconds && b.start_datetime.seconds * 1000) ||
            (b.created_at?.toDate?.() && b.created_at.toDate().getTime()) || 0;
          return bTs - aTs;
        });

        setLessons(enrichedSorted);
        setPendingIndiv(pIndiv);
        setPendingGroup(pGroup);
        setLoading(false);
      }, (err) => {
        console.error(err);
        setLessons([]);
        setPendingGroup([]);
        setPendingIndiv([]);
        setLoading(false);
      });
    });

    return () => {
      if (unsubLessons) unsubLessons();
      unsubAuth();
    };
  }, []);

  // Helper : y a-t-il au moins un participant confirmé/accepté ?
  const hasAnyConfirmedParticipant = (l) => {
    if (!Array.isArray(l.participantDetails)) return false;
    return l.participantDetails.some((p) => p.status === 'accepted' || p.status === 'confirmed');
  };

  // vues confirmés/terminés (⚠ exclure 'completed' des confirmés)
  const confirmes = useMemo(() => {
    return lessons.filter((l) => {
      if (l.status === 'completed') return false; // ✅ ne pas dupliquer
      if (l.is_group) return hasAnyConfirmedParticipant(l) || l.status === 'confirmed';
      return l.status === 'confirmed';
    });
  }, [lessons]);

  const termines = useMemo(() => lessons.filter((l) => l.status === 'completed'), [lessons]);

  const openDocs = (lesson) => { setDocLesson(lesson); setDocOpen(true); };
  const openGroup = (lesson) => { setGroupLesson(lesson); setGroupOpen(true); };

  async function handleStatus(lesson, status) {
    try {
      const ref = doc(db, 'lessons', lesson.id);
      await updateDoc(ref, { status, ...(status === 'completed' ? { completed_at: serverTimestamp() } : {}) });

      // MAJ optimiste
      setLessons((prev) => prev.map((x) => (x.id === lesson.id ? { ...x, status } : x)));

      // nom prof
      let profName = 'Votre professeur';
      try {
        const me = await getDoc(doc(db, 'users', auth.currentUser.uid));
        if (me.exists()) profName = me.data().fullName || profName;
      } catch {}

      // destinataires
      const recipients = new Set();
      if (lesson.student_id) recipients.add(lesson.student_id);
      (lesson.participant_ids || []).forEach((sid) => recipients.add(sid));

      let notifType = '', message = '';
      if (status === 'confirmed') {
        notifType = 'cours_accepted';
        message = `Votre cours ${lesson.subject_id || ''} avec ${profName} a été accepté.`;
      } else if (status === 'rejected') {
        notifType = 'cours_rejected';
        message = `Votre cours ${lesson.subject_id || ''} avec ${profName} a été refusé.`;
      } else if (status === 'completed') {
        notifType = 'cours_completed';
        message = `Votre cours ${lesson.subject_id || ''} avec ${profName} est terminé.`;
      } else return;

      await notifyUsers(Array.from(recipients), {
        type: notifType,
        with_id: auth.currentUser.uid,
        withName: profName,
        lesson_id: lesson.id,
        message,
      });

      if (status === 'confirmed') {
        const snap = await getDoc(ref);
        const current = snap.exists() ? { id: snap.id, ...snap.data() } : { ...lesson, status: 'confirmed' };
        await createPaymentDueNotificationsForLesson(current);
      }
    } catch (e) {
      console.error(e);
      alert("Impossible de modifier le statut.");
    }
  }

  // actions groupe (par élève)
  async function acceptGroupStudent(lessonId, studentId) {
    try {
      await updateDoc(doc(db, 'lessons', lessonId), {
        [`participantsMap.${studentId}.status`]: 'confirmed',
      });
      try { await createPaymentDueNotificationsForLesson(lessonId, { onlyForStudentId: studentId }); } catch {}
    } catch (e) {
      console.error(e);
      alert("Impossible d'accepter l'élève.");
    }
  }
  async function rejectGroupStudent(lessonId, studentId) {
    try {
      await updateDoc(doc(db, 'lessons', lessonId), {
        participant_ids: arrayRemove(studentId),
        [`participantsMap.${studentId}`]: deleteField(),
      });
    } catch (e) {
      console.error(e);
      alert("Impossible de refuser l'élève.");
    }
  }

  const Card = ({ lesson, showActionsForPending }) => {
    const isGroup = !!lesson.is_group || (Array.isArray(lesson.participant_ids) && lesson.participant_ids.length > 0);
    const confirmedParticipants = (lesson.participantDetails || []).filter(
      (p) => p.status === 'accepted' || p.status === 'confirmed'
    );

    const capacity = lesson.capacity || (isGroup ? lesson.participant_ids.length : 1);
    const used = isGroup ? confirmedParticipants.length : (lesson.student_id ? 1 : 0);

    const showList = openParticipantsFor === lesson.id;

    // ✅ Si la leçon est terminée, la pastille doit être "Terminé", même si des participants étaient confirmés
    const displayedStatus = lesson.status === 'completed'
      ? 'completed'
      : (Array.isArray(lesson.participantDetails) && lesson.participantDetails.some(p => p.status === 'accepted' || p.status === 'confirmed'))
        ? 'confirmed'
        : lesson.status;

    return (
      <div className="bg-white p-6 rounded-xl shadow border flex flex-col md:flex-row md:items-center gap-4 justify-between relative">
        <div className="flex-1">
          <div className="flex gap-2 items-center mb-1">
            <span className="font-bold text-primary">{lesson.subject_id || 'Matière'}</span>
            <StatusPill status={displayedStatus} />
            {isGroup && (
              <>
                <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded ml-1">👥 {used}/{capacity}</span>
                <button
                  className="text-xs ml-1 bg-indigo-50 text-indigo-700 px-2 py-1 rounded hover:bg-indigo-100"
                  onClick={() => setOpenParticipantsFor(showList ? null : lesson.id)}
                >
                  Participants
                </button>
              </>
            )}
          </div>

          {/* Popover participants + statut paiement */}
          {isGroup && showList && (
            <div className="absolute top-full mt-2 left-6 z-10 bg-white border rounded-lg shadow p-3 w-72">
              <div className="text-xs font-semibold mb-2">Élèves du groupe</div>
              {confirmedParticipants.length ? (
                <ul className="text-sm text-gray-700 space-y-1">
                  {confirmedParticipants.map((p) => (
                    <li key={p.id} className="flex items-center justify-between">
                      <span className="truncate mr-2">{p.name}</span>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${p.is_paid ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                        {p.is_paid ? 'Payé' : 'À payer'}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-xs text-gray-500">Aucun participant confirmé.</div>
              )}
            </div>
          )}

          <div className="text-gray-700 mt-1">
            {isGroup ? (
              'Cours groupé'
            ) : (
              <>
                Élève : <span className="font-semibold">{lesson.studentName || '—'}</span>
                {lesson.requesterName ? (
                  <span className="text-xs text-gray-500 ml-2">(demande faite par {lesson.requesterName})</span>
                ) : null}
              </>
            )}
          </div>
          <div className="text-gray-500 text-sm"><When lesson={lesson} /></div>
        </div>

        {showActionsForPending ? (
          <div className="flex gap-2">
            <button className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded shadow font-semibold" onClick={() => handleStatus(lesson, 'confirmed')}>
              ✅ Accepter
            </button>
            <button className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded shadow font-semibold" onClick={() => handleStatus(lesson, 'rejected')}>
              ❌ Refuser
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded shadow font-semibold" onClick={() => openDocs(lesson)}>
              📄 Documents
            </button>
            <button className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded shadow font-semibold" onClick={() => openGroup(lesson)} title="Gérer capacité et participants">
              👥 Gérer le groupe
            </button>
            <button
              className="bg-gray-800 hover:bg-gray-900 text-white px-4 py-2 rounded shadow font-semibold"
              onClick={() => handleStatus(lesson, 'completed')}
              disabled={lesson.status === 'completed'}
              title={lesson.status === 'completed' ? 'Déjà terminé' : 'Marquer comme terminé'}
            >
              ✅ Terminé
            </button>
          </div>
        )}
      </div>
    );
  };

  // Demandes
  const demandesIndividuelles = useMemo(
    () => pendingIndiv, [pendingIndiv]
  );

  const demandesGroupes = useMemo(() => {
    const list = [...pendingGroup]; // ⚠️ ne pas muter le state
    list.sort((a, b) => {
      const aKey = `${a.lesson.slot_day || ''}|${String(a.lesson.slot_hour || 0).padStart(2,'0')}`;
      const bKey = `${b.lesson.slot_day || ''}|${String(b.lesson.slot_hour || 0).padStart(2,'0')}`;
      return aKey.localeCompare(bKey);
    });
    return list;
  }, [pendingGroup]);

  return (
    <DashboardLayout role="teacher">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-2xl font-bold text-primary mb-6">Cours — Professeur</h2>

        {/* Demandes */}
        <section className="mb-10">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-xl font-semibold">Demandes de cours</h3>
            <span className="text-sm text-gray-500">
              {demandesIndividuelles.length + demandesGroupes.length} en attente
            </span>
          </div>

          {loading ? (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Chargement…</div>
          ) : (demandesIndividuelles.length + demandesGroupes.length) === 0 ? (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Aucune demande de cours pour le moment.</div>
          ) : (
            <>
              {demandesIndividuelles.length > 0 && (
                <div className="grid grid-cols-1 gap-5 mb-6">
                  {demandesIndividuelles.map((l) => (
                    <Card key={l.id} lesson={l} showActionsForPending />
                  ))}
                </div>
              )}

              {demandesGroupes.length > 0 && (
                <div className="bg-white p-4 rounded-xl shadow border">
                  <div className="font-semibold text-sm mb-3">Groupes — demandes par élève</div>
                  <ul className="space-y-2">
                    {demandesGroupes.map(({ lessonId, lesson, studentId, status, studentName, requesterName }) => (
                      <li key={`${lessonId}:${studentId}`} className="border rounded-lg px-3 py-2 flex items-center gap-3">
                        <span className="text-xs text-gray-600">
                          {lesson.slot_day} {String(lesson.slot_hour).padStart(2, '0')}h
                        </span>
                        <span className="text-sm font-medium">{lesson.subject_id || 'Cours'}</span>
                        <span className="text-xs text-gray-600">
                          • Élève : <span className="font-medium">{studentName || studentId}</span>
                          {requesterName ? <span className="text-gray-500"> (demande faite par {requesterName})</span> : null}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                          {status === 'pending_teacher' ? 'En attente prof' :
                           status === 'pending_parent' ? 'En attente parent' :
                           status === 'invited_student' || status === 'invited_parent' ? 'Invitation envoyée' :
                           'En attente'}
                        </span>
                        <div className="ml-auto flex items-center gap-2">
                          <button className="px-3 py-1 rounded bg-green-600 text-white text-xs" onClick={() => acceptGroupStudent(lessonId, studentId)}>Accepter</button>
                          <button className="px-3 py-1 rounded bg-red-600 text-white text-xs" onClick={() => rejectGroupStudent(lessonId, studentId)}>Refuser</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>

        {/* Confirmés */}
        <section className="mb-10">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-xl font-semibold">Gestion des cours</h3>
            <span className="text-sm text-gray-500">{confirmes.length} confirmés</span>
          </div>
          {loading ? (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Chargement…</div>
          ) : confirmes.length === 0 ? (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Aucun cours confirmé pour le moment.</div>
          ) : (
            <div className="grid grid-cols-1 gap-5">
              {confirmes.map((l) => <Card key={l.id} lesson={l} showActionsForPending={false} />)}
            </div>
          )}
        </section>

        {/* Terminés */}
        <section>
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-xl font-semibold">Cours terminés</h3>
            <span className="text-sm text-gray-500">{termines.length} terminé(s)</span>
          </div>
          {loading ? (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Chargement…</div>
          ) : termines.length === 0 ? (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Aucun cours terminé récemment.</div>
          ) : (
            <div className="grid grid-cols-1 gap-5">
              {termines.map((l) => {
                const confirmedParticipants = (l.participantDetails || []).filter(
                  (p) => p.status === 'accepted' || p.status === 'confirmed'
                );
                const capacity = l.capacity || (Array.isArray(l.participant_ids) ? l.participant_ids.length : 1);
                return (
                  <div key={l.id} className="bg-white p-6 rounded-xl shadow border flex flex-col md:flex-row md:items-center gap-4 justify-between">
                    <div className="flex-1">
                      <div className="flex gap-2 items-center mb-1">
                        <span className="font-bold text-primary">{l.subject_id || 'Matière'}</span>
                        <StatusPill status="completed" />
                      </div>
                      <div className="text-gray-700">
                        {(Array.isArray(l.participant_ids) && l.participant_ids.length > 0)
                          ? `Élèves (👥 ${confirmedParticipants.length}/${capacity})`
                          : <>Élève : <span className="font-semibold">{l.studentName || '—'}</span></>}
                      </div>
                      <div className="text-gray-500 text-sm"><When lesson={l} /></div>
                    </div>
                    <div className="flex gap-2">
                      <button className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded shadow font-semibold" onClick={() => openDocs(l)}>
                        📄 Documents
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Modals */}
      <DocumentsModal open={docOpen} onClose={() => setDocOpen(false)} lesson={docLesson} allowUpload />
      <GroupSettingsModal open={groupOpen} onClose={() => setGroupOpen(false)} lesson={groupLesson} />
    </DashboardLayout>
  );
}