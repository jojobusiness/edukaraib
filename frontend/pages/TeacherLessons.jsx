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
} from 'firebase/firestore';

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
async function resolvePersonName(id, cache) {
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

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setLessons([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const qLessons = query(collection(db, 'lessons'), where('teacher_id', '==', uid));

    const unsub = onSnapshot(qLessons, async (snap) => {
      const raw = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

      // enrichir noms + détails participants (paiement temps réel via onSnapshot global)
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
              l.participant_ids.map(async (sid) => ({
                id: sid,
                name: await resolvePersonName(sid, nameCacheRef.current),
                is_paid: !!pm?.[sid]?.is_paid,
                status: pm?.[sid]?.status || 'accepted',
              }))
            );
          }

          return { ...l, studentName, participantDetails };
        })
      );

      // tri par date décroissante
      enriched.sort((a, b) => {
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

      setLessons(enriched);
      setLoading(false);
    }, (err) => {
      console.error(err);
      setLessons([]);
      setLoading(false);
    });

    return () => unsub();
  }, []);

  const demandes = useMemo(() => lessons.filter((l) => l.status === 'booked'), [lessons]);
  const confirmes = useMemo(() => lessons.filter((l) => l.status === 'confirmed'), [lessons]);
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

      // Paiement en attente (création des notifs) quand confirmé
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

  const Card = ({ lesson, showActionsForPending }) => {
    const isGroup = Array.isArray(lesson.participant_ids) && lesson.participant_ids.length > 0;
    const capacity = lesson.capacity || (isGroup ? lesson.participant_ids.length : 1);
    const used = isGroup ? lesson.participant_ids.length : (lesson.student_id ? 1 : 0);
    const showList = openParticipantsFor === lesson.id;

    return (
      <div className="bg-white p-6 rounded-xl shadow border flex flex-col md:flex-row md:items-center gap-4 justify-between relative">
        <div className="flex-1">
          <div className="flex gap-2 items-center mb-1">
            <span className="font-bold text-primary">{lesson.subject_id || 'Matière'}</span>
            <StatusPill status={lesson.status} />
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

          {/* Popover participants + statut paiement (temps réel via onSnapshot) */}
          {isGroup && showList && (
            <div className="absolute top-full mt-2 left-6 z-10 bg-white border rounded-lg shadow p-3 w-72">
              <div className="text-xs font-semibold mb-2">Élèves du groupe</div>
              {lesson.participantDetails?.length ? (
                <ul className="text-sm text-gray-700 space-y-1">
                  {lesson.participantDetails.map((p) => (
                    <li key={p.id} className="flex items-center justify-between">
                      <span className="truncate mr-2">{p.name}</span>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${p.is_paid ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                        {p.is_paid ? 'Payé' : 'À payer'}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-xs text-gray-500">Aucun participant.</div>
              )}
            </div>
          )}

          <div className="text-gray-700 mt-1">
            {isGroup
              ? 'Cours groupé'
              : <>Élève : <span className="font-semibold">{lesson.studentName || '—'}</span></>}
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

  return (
    <DashboardLayout role="teacher">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-2xl font-bold text-primary mb-6">Cours — Professeur</h2>

        {/* Demandes */}
        <section className="mb-10">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-xl font-semibold">Demandes de cours</h3>
            <span className="text-sm text-gray-500">{demandes.length} en attente</span>
          </div>
          {loading ? (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Chargement…</div>
          ) : demandes.length === 0 ? (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Aucune demande de cours pour le moment.</div>
          ) : (
            <div className="grid grid-cols-1 gap-5">
              {demandes.map((l) => <Card key={l.id} lesson={l} showActionsForPending />)}
            </div>
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
              {termines.map((l) => (
                <div key={l.id} className="bg-white p-6 rounded-xl shadow border flex flex-col md:flex-row md:items-center gap-4 justify-between">
                  <div className="flex-1">
                    <div className="flex gap-2 items-center mb-1">
                      <span className="font-bold text-primary">{l.subject_id || 'Matière'}</span>
                      <StatusPill status="completed" />
                    </div>
                    <div className="text-gray-700">
                      {(Array.isArray(l.participant_ids) && l.participant_ids.length > 0)
                        ? `Élèves (👥 ${l.participant_ids.length}/${l.capacity || l.participant_ids.length})`
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
              ))}
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