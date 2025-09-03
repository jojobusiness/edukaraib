import React, { useEffect, useState } from 'react';
import { db } from '../../lib/firebase';
import {
  doc, updateDoc, getDoc, serverTimestamp,
  arrayUnion, arrayRemove
} from 'firebase/firestore';

export default function GroupSettingsModal({ open, onClose, lesson }) {
  const [capacity, setCapacity] = useState(lesson?.capacity || 1);
  const [participantsMap, setParticipantsMap] = useState(lesson?.participantsMap || {});
  const [participantIds, setParticipantIds] = useState(lesson?.participant_ids || []);
  const [newStudentId, setNewStudentId] = useState('');

  useEffect(() => {
    if (!lesson) return;
    setCapacity(lesson.capacity || 1);
    setParticipantsMap(lesson.participantsMap || {});
    setParticipantIds(lesson.participant_ids || []);
  }, [lesson]);

  if (!open || !lesson) return null;

  const saveCapacity = async () => {
    await updateDoc(doc(db, 'lessons', lesson.id), { capacity });
    alert('Capacité mise à jour.');
  };

  const addStudent = async () => {
    const sid = newStudentId.trim();
    if (!sid) return;

    // Si déjà présent, on ignore
    if (participantIds.includes(sid)) {
      alert('Déjà dans la liste.');
      return;
    }
    if (participantIds.length >= (capacity || 1)) {
      alert('Capacité atteinte.');
      return;
    }

    const ref = doc(db, 'lessons', lesson.id);
    const patch = {
      participant_ids: arrayUnion(sid),
      [`participantsMap.${sid}`]: {
        parent_id: null,
        booked_by: null,
        is_paid: false,
        paid_by: null,
        paid_at: null,
        status: 'confirmed', // on part du principe que le prof confirme
        added_at: serverTimestamp(),
      },
      is_group: true,
    };
    await updateDoc(ref, patch);

    setParticipantIds((p) => [...p, sid]);
    setParticipantsMap((p) => ({
      ...p,
      [sid]: patch[`participantsMap.${sid}`],
    }));
    setNewStudentId('');
  };

  const removeStudent = async (sid) => {
    const ok = confirm('Retirer cet élève du cours ?');
    if (!ok) return;

    const ref = doc(db, 'lessons', lesson.id);
    // on nettoie l’array + la map
    await updateDoc(ref, {
      participant_ids: arrayRemove(sid),
      [`participantsMap.${sid}`]: null,   // Firestore supprime la clé si null
    });

    setParticipantIds((p) => p.filter((x) => x !== sid));
    const copy = { ...participantsMap };
    delete copy[sid];
    setParticipantsMap(copy);
  };

  const used = participantIds.length;
  const free = (capacity || 0) - used;

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl">
        <div className="p-5 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">👥 Groupe — {lesson.subject_id || 'Cours'}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            <label className="font-medium">Capacité (places max)</label>
            <input
              type="number"
              min={1}
              className="border rounded px-2 py-1 w-24"
              value={capacity}
              onChange={(e) => setCapacity(Number(e.target.value || 1))}
            />
            <button
              onClick={saveCapacity}
              className="bg-gray-800 hover:bg-gray-900 text-white px-3 py-1 rounded"
            >
              Enregistrer
            </button>
          </div>

          <div className="text-sm text-gray-600">
            Occupées : <b>{used}</b> / {capacity} — Places libres : <b>{Math.max(free, 0)}</b>
          </div>

          <div className="border rounded-lg p-3">
            <div className="font-medium mb-2">Participants</div>
            {participantIds.length === 0 ? (
              <div className="text-gray-500 text-sm">Aucun élève dans ce cours.</div>
            ) : (
              <ul className="divide-y">
                {participantIds.map((sid) => {
                  const p = participantsMap?.[sid] || {};
                  return (
                    <li key={sid} className="py-2 flex items-center justify-between">
                      <div className="text-sm">
                        <div className="font-semibold">{sid}</div>
                        <div className="text-xs text-gray-500">
                          Statut : {p.status || '—'} • Payé : {p.is_paid ? 'oui' : 'non'}
                        </div>
                      </div>
                      <button
                        className="text-red-600 hover:underline text-sm"
                        onClick={() => removeStudent(sid)}
                      >
                        Retirer
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="ID élève (users.uid ou students.id)"
              value={newStudentId}
              onChange={(e) => setNewStudentId(e.target.value)}
              className="border rounded px-3 py-2 flex-1"
            />
            <button
              onClick={addStudent}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded"
              disabled={participantIds.length >= (capacity || 1)}
            >
              Ajouter
            </button>
          </div>

          <p className="text-xs text-gray-500">
            Astuce : tu peux coller l’ID élève depuis Firestore.  
            (Recherche/auto-complétion pourra être ajoutée plus tard)
          </p>
        </div>

        <div className="p-4 border-t flex justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded bg-gray-100 hover:bg-gray-200">
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}