import React, { useEffect, useState } from 'react';
import { auth, db } from '../lib/firebase';
import {
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  doc,
  arrayRemove,
  deleteField,
  serverTimestamp,
  addDoc,
} from 'firebase/firestore';

function countAccepted(l) {
  const pm = l.participantsMap || {};
  const ids = Array.isArray(l.participant_ids) ? l.participant_ids : [];
  let a = 0;
  for (const id of ids) if (pm?.[id]?.status === 'accepted') a += 1;
  return a;
}

export default function StudentInvitations() {
  const me = auth.currentUser;
  const uid = me?.uid;
  const [invites, setInvites] = useState([]); // [{id, ...lesson}]
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) return;
    (async () => {
      setLoading(true);
      // On ne peut pas requêter sur participantsMap[uid].status directement → on récupère tous les cours où participant_ids contient uid puis filtrage client.
      const qL = query(collection(db, 'lessons'), where('participant_ids', 'array-contains', uid));
      const snap = await getDocs(qL);
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setInvites(rows);
      setLoading(false);
    })();
  }, [uid]);

  async function accept(lesson) {
    const cap = Number(lesson.capacity || 0);
    const accepted = countAccepted(lesson);
    if (cap > 0 && accepted >= cap) {
      alert('Capacité atteinte, impossible d’accepter.');
      return;
    }
    try {
      await updateDoc(doc(db, 'lessons', lesson.id), {
        [`participantsMap.${uid}.status`]: 'accepted',
      });
      // notif prof
      try {
        await addDoc(collection(db, 'notifications'), {
          user_id: lesson.teacher_id,
          read: false,
          created_at: serverTimestamp(),
          type: 'group_invite_accepted',
          lesson_id: lesson.id,
          message: `Un élève a accepté l’invitation (${lesson.slot_day} ${lesson.slot_hour}h).`,
        });
      } catch {}
      setInvites((prev) => prev.map((x) => x.id === lesson.id
        ? { ...x, participantsMap: { ...(x.participantsMap||{}), [uid]: { ...(x.participantsMap?.[uid]||{}), status: 'accepted' } } }
        : x));
    } catch (e) {
      console.error(e);
      alert("Impossible d'accepter l’invitation.");
    }
  }

  async function decline(lesson) {
    const ok = window.confirm('Refuser l’invitation ?');
    if (!ok) return;
    try {
      await updateDoc(doc(db, 'lessons', lesson.id), {
        participant_ids: arrayRemove(uid),
        [`participantsMap.${uid}`]: deleteField(),
      });
      setInvites((prev) => prev.filter((x) => x.id !== lesson.id));
    } catch (e) {
      console.error(e);
      alert("Impossible de refuser l’invitation.");
    }
  }

  const myItems = invites
    .map((l) => ({
      ...l,
      myStatus: l.participantsMap?.[uid]?.status || null,
      title: l.subject_id || 'Cours',
      when: `${l.slot_day || ''} ${l.slot_hour != null ? `${String(l.slot_hour).padStart(2, '0')}h` : ''}`,
    }))
    .filter((x) => x.myStatus === 'invited_student' || x.myStatus === 'pending_teacher');

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h2 className="text-2xl font-bold text-primary mb-4">Mes invitations & demandes</h2>

      {loading && <div className="bg-white p-4 rounded shadow text-gray-500">Chargement…</div>}

      {!loading && myItems.length === 0 && (
        <div className="bg-white p-4 rounded shadow text-gray-500">Aucune invitation ou demande en cours.</div>
      )}

      <div className="space-y-3">
        {myItems.map((it) => (
          <div key={it.id} className="bg-white p-4 rounded-xl shadow flex items-center justify-between">
            <div>
              <div className="font-semibold text-primary">{it.title}</div>
              <div className="text-sm text-gray-600">{it.when}</div>
              <div className="text-xs mt-1">
                Statut :{' '}
                {it.myStatus === 'invited_student' ? 'Invitation reçue (à valider)' :
                 it.myStatus === 'pending_teacher' ? 'Demande envoyée (en attente du professeur)' :
                 it.myStatus}
              </div>
            </div>
            <div className="flex gap-2">
              {it.myStatus === 'invited_student' ? (
                <>
                  <button className="px-3 py-1 rounded bg-green-600 text-white" onClick={() => accept(it)}>Accepter</button>
                  <button className="px-3 py-1 rounded bg-red-600 text-white" onClick={() => decline(it)}>Décliner</button>
                </>
              ) : (
                <span className="text-xs text-gray-400">En attente du prof…</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}