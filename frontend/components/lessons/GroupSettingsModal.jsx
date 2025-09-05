import React, { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../../lib/firebase';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  updateDoc,
  where,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  deleteField,
  addDoc,
} from 'firebase/firestore';

// --- utils nom ---
const lc = (s) => (s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
const pickStudentName = (x) =>
  x.full_name ||
  x.name ||
  x.fullName ||
  x.displayName ||
  [x.first_name, x.last_name].filter(Boolean).join(' ') ||
  (x.profile && (x.profile.full_name || x.profile.name)) ||
  'Sans nom';

// --- recherche par nom (priorité students) ---
async function searchStudentsByName(termRaw) {
  const term = lc(termRaw);
  if (!term) return [];
  const MAX = 12;
  const results = [];

  // students (fallbacks inclus)
  try {
    const qs = query(
      collection(db, 'students'),
      where('full_name_lc', '>=', term),
      where('full_name_lc', '<=', term + '\uf8ff'),
      limit(MAX)
    );
    const snap = await getDocs(qs);
    snap.forEach((d) => {
      const x = d.data();
      results.push({ id: d.id, name: pickStudentName(x), source: 'students' });
    });
  } catch {
    const tryKeys = ['full_name', 'name', 'last_name', 'created_at', '__name__'];
    for (const k of tryKeys) {
      if (results.length >= MAX) break;
      try {
        const qs = query(collection(db, 'students'), orderBy(k), limit(200));
        const snap = await getDocs(qs);
        snap.forEach((d) => {
          const x = d.data();
          const nm = pickStudentName(x);
          if (lc(nm).includes(term)) results.push({ id: d.id, name: nm, source: `students(${k})` });
        });
      } catch {}
    }
  }

  // dedup & tri
  const seen = new Set();
  const uniq = [];
  for (const r of results) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    uniq.push(r);
  }
  const withScore = uniq.map((x) => ({ ...x, _s: (lc(x.name).indexOf(term) === -1 ? 999 : lc(x.name).indexOf(term)) + lc(x.name).length * 0.01 }));
  withScore.sort((a, b) => a._s - b._s);
  return withScore.slice(0, MAX).map(({ _s, ...rest }) => rest);
}

// --- compteur acceptés ---
function countAccepted(lesson) {
  const pm = lesson.participantsMap || {};
  const ids = Array.isArray(lesson.participant_ids) ? lesson.participant_ids : [];
  let acc = 0;
  for (const id of ids) if (pm?.[id]?.status === 'accepted') acc += 1;
  return acc;
}

function Chip({ children, onRemove }) {
  return (
    <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gray-100 text-gray-800 text-sm">
      {children}
      {onRemove && (
        <button onClick={onRemove} className="ml-1 rounded-full hover:bg-gray-200 px-2 py-0.5" title="Retirer">
          ✕
        </button>
      )}
    </span>
  );
}

export default function GroupSettingsModal({ open, onClose, lesson }) {
  const [capacity, setCapacity] = useState(lesson?.capacity || 1);
  const [participantIds, setParticipantIds] = useState(lesson?.participant_ids || []);
  const [participantsMap, setParticipantsMap] = useState(lesson?.participantsMap || {});
  const [nameMap, setNameMap] = useState({});

  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef(null);

  // charge noms + normalise legacy
  useEffect(() => {
    if (!open || !lesson) return;

    setCapacity(lesson.capacity || 1);
    setParticipantIds(Array.isArray(lesson.participant_ids) ? lesson.participant_ids : []);
    setParticipantsMap(lesson.participantsMap || {});

    (async () => {
      const nm = {};
      // noms
      const ids = Array.isArray(lesson.participant_ids) ? lesson.participant_ids : [];
      for (const id of ids) {
        try {
          const s = await getDoc(doc(db, 'students', id));
          if (s.exists()) { nm[id] = pickStudentName(s.data()); continue; }
        } catch {}
        try {
          const u = await getDoc(doc(db, 'users', id));
          if (u.exists()) nm[id] = pickStudentName(u.data());
        } catch {}
        if (!nm[id]) nm[id] = id;
      }
      setNameMap(nm);
    })();
  }, [open, lesson]);

  // recherche (debounce)
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const term = (search || '').trim();
    if (term.length < 2) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await searchStudentsByName(term);
        setResults(r);
      } finally {
        setSearching(false);
      }
    }, 250);
  }, [search, open]);

  const acceptedCount = useMemo(() => countAccepted({ participant_ids: participantIds, participantsMap, capacity }), [participantIds, participantsMap]);
  const free = Math.max((capacity || 0) - acceptedCount, 0);

  // actions
  async function saveCapacity() {
    try {
      await updateDoc(doc(db, 'lessons', lesson.id), {
        capacity: Number(capacity) || 1,
        is_group: true,
      });
      alert('Capacité mise à jour.');
    } catch (e) {
      console.error(e);
      alert("Impossible d'enregistrer la capacité.");
    }
  }

  // inviter un élève (statut: invited_student)
  async function addByPick(p) {
    if (!p?.id) return;
    const id = p.id;
    if (participantIds.includes(id)) return alert('Déjà présent (même en attente).');

    const ref = doc(db, 'lessons', lesson.id);
    const patch = {
      parent_id: null,
      booked_by: null,
      is_paid: false,
      paid_by: null,
      paid_at: null,
      status: 'invited_student', // <<< invitation envoyée, en attente réponse élève
      added_at: serverTimestamp(),
    };

    try {
      await updateDoc(ref, {
        is_group: true,
        participant_ids: arrayUnion(id),
        [`participantsMap.${id}`]: patch,
      });

      // notif élève
      try {
        await addDoc(collection(db, 'notifications'), {
          user_id: id,
          read: false,
          created_at: serverTimestamp(),
          type: 'group_invite',
          lesson_id: lesson.id,
          message: `Invitation à rejoindre le cours ${lesson.subject_id || ''} (${lesson.slot_day} ${lesson.slot_hour}h)`,
        });
      } catch {}

      setParticipantIds((prev) => [...prev, id]);
      setParticipantsMap((prev) => ({ ...prev, [id]: patch }));
      setNameMap((prev) => ({ ...prev, [id]: p.name }));
      setSearch('');
      setResults([]);
    } catch (e) {
      console.error(e);
      alert("Impossible d'inviter l'élève.");
    }
  }

  // accepter une DEMANDE (pending_teacher → accepted)
  async function acceptStudent(id) {
    const pm = participantsMap || {};
    const current = pm[id] || {};
    const newStatus = 'accepted';

    // contrôle capacité (sur acceptés uniquement)
    const accepted = Object.keys(pm).filter((k) => pm[k]?.status === 'accepted').length;
    if (accepted >= (capacity || 0)) {
      alert('Capacité atteinte, impossible d’accepter.');
      return;
    }

    try {
      await updateDoc(doc(db, 'lessons', lesson.id), {
        [`participantsMap.${id}.status`]: newStatus,
      });

      setParticipantsMap((prev) => ({
        ...prev,
        [id]: { ...current, status: newStatus },
      }));

      // notif élève
      try {
        await addDoc(collection(db, 'notifications'), {
          user_id: id,
          read: false,
          created_at: serverTimestamp(),
          type: 'group_request_accepted',
          lesson_id: lesson.id,
          message: `Votre participation a été acceptée (${lesson.slot_day} ${lesson.slot_hour}h).`,
        });
      } catch {}
    } catch (e) {
      console.error(e);
      alert("Impossible d'accepter.");
    }
  }

  // refuser une DEMANDE / annuler une INVITATION (→ remove)
  async function declineOrRemove(id) {
    const ok = window.confirm('Retirer cet élève de la liste (invitation/demande incluse) ?');
    if (!ok) return;
    try {
      await updateDoc(doc(db, 'lessons', lesson.id), {
        participant_ids: arrayRemove(id),
        [`participantsMap.${id}`]: deleteField(),
      });
      setParticipantIds((prev) => prev.filter((x) => x !== id));
      setParticipantsMap((prev) => {
        const cp = { ...prev };
        delete cp[id];
        return cp;
      });
      setNameMap((prev) => {
        const cp = { ...prev };
        delete cp[id];
        return cp;
      });
    } catch (e) {
      console.error(e);
      alert("Impossible de retirer l'élève.");
    }
  }

  // groupes par statut
  const groups = useMemo(() => {
    const g = { accepted: [], pending_teacher: [], invited_student: [], declined: [], other: [] };
    for (const id of participantIds) {
      const st = participantsMap?.[id]?.status || 'accepted';
      if (st === 'accepted') g.accepted.push(id);
      else if (st === 'pending_teacher') g.pending_teacher.push(id);
      else if (st === 'invited_student') g.invited_student.push(id);
      else if (st === 'declined') g.declined.push(id);
      else g.other.push(id);
    }
    return g;
  }, [participantIds, participantsMap]);

  if (!open || !lesson) return null;

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl">
        <div className="p-5 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">👥 Groupe — {lesson.subject_id || 'Cours'}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        <div className="p-5 space-y-6">
          {/* Capacité */}
          <div className="flex items-center gap-3">
            <label className="font-medium">Capacité (places max)</label>
            <input
              type="number"
              min={1}
              className="border rounded px-2 py-1 w-24"
              value={capacity}
              onChange={(e) => setCapacity(Number(e.target.value || 1))}
            />
            <button onClick={saveCapacity} className="bg-gray-800 hover:bg-gray-900 text-white px-3 py-1 rounded">
              Enregistrer
            </button>
          </div>
          <div className="text-sm text-gray-600">
            Acceptés : <b>{acceptedCount}</b> / {capacity} — Places libres : <b>{Math.max(capacity - acceptedCount, 0)}</b>
          </div>

          {/* Recherche par nom → invitation */}
          <div>
            <label className="block text-sm font-medium mb-1">Inviter un élève (par nom)</label>
            <input
              type="text"
              placeholder="Rechercher un élève…"
              className="w-full border rounded-lg px-3 py-2"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {searching && <div className="text-sm text-gray-500 mt-2">Recherche…</div>}
            {!searching && results.length > 0 && (
              <div className="mt-2 border rounded-lg max-h-56 overflow-auto divide-y">
                {results.map((r) => (
                  <button
                    key={`pick:${r.id}`}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center justify-between"
                    onClick={() => addByPick(r)}
                    disabled={participantIds.includes(r.id)}
                  >
                    <span>{r.name}</span>
                    {participantIds.includes(r.id) && <span className="text-xs text-green-600">déjà listé</span>}
                  </button>
                ))}
              </div>
            )}
            {search.length >= 2 && !searching && results.length === 0 && (
              <div className="text-sm text-gray-500 mt-2">Aucun résultat.</div>
            )}
          </div>

          {/* Listes par statut */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* En attente de validation PROF */}
            <div className="border rounded-lg p-3">
              <div className="font-medium mb-2">Demandes à valider (par vous)</div>
              {groups.pending_teacher.length === 0 ? (
                <div className="text-sm text-gray-500">Aucune demande.</div>
              ) : (
                <div className="space-y-2">
                  {groups.pending_teacher.map((id) => (
                    <div key={`pt:${id}`} className="flex items-center justify-between">
                      <span>{nameMap[id] || id}</span>
                      <div className="flex gap-2">
                        <button className="px-3 py-1 rounded bg-green-600 text-white" onClick={() => acceptStudent(id)}>Accepter</button>
                        <button className="px-3 py-1 rounded bg-red-600 text-white" onClick={() => declineOrRemove(id)}>Refuser</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Invitations envoyées (en attente côté élève) */}
            <div className="border rounded-lg p-3">
              <div className="font-medium mb-2">Invitations envoyées (attente élève)</div>
              {groups.invited_student.length === 0 ? (
                <div className="text-sm text-gray-500">Aucune invitation en attente.</div>
              ) : (
                <div className="space-y-2">
                  {groups.invited_student.map((id) => (
                    <div key={`is:${id}`} className="flex items-center justify-between">
                      <span>{nameMap[id] || id}</span>
                      <div className="flex gap-2">
                        <button className="px-3 py-1 rounded bg-gray-200" onClick={() => declineOrRemove(id)}>Annuler l’invitation</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Acceptés */}
            <div className="border rounded-lg p-3 md:col-span-2">
              <div className="font-medium mb-2">Participants (acceptés)</div>
              {groups.accepted.length === 0 ? (
                <div className="text-sm text-gray-500">Aucun élève accepté.</div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {groups.accepted.map((sid) => (
                    <Chip key={`acc:${sid}`} onRemove={() => declineOrRemove(sid)}>
                      {nameMap[sid] || sid}
                    </Chip>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="p-4 border-t flex justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded bg-gray-100 hover:bg-gray-200">Fermer</button>
        </div>
      </div>
    </div>
  );
}