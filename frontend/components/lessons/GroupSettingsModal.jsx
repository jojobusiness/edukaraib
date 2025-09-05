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

/* ========== utils noms & normalisation ========== */
const stripDiacritics = (s = '') =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const lc = (s) => stripDiacritics(String(s || '')).toLowerCase().trim();

const pickStudentName = (x = {}) =>
  x.full_name ||
  x.name ||
  x.fullName ||
  x.displayName ||
  [x.first_name, x.last_name].filter(Boolean).join(' ') ||
  (x.profile && (x.profile.full_name || x.profile.name)) ||
  'Sans nom';

/* ========== recherche élèves (priorité students) ========== */
async function searchStudentsByName(termRaw) {
  const term = lc(termRaw);
  if (!term) return [];
  const MAX = 12;
  const out = [];

  // 1) Essai index prefix sur students.full_name_lc
  try {
    const qs = query(
      collection(db, 'students'),
      where('full_name_lc', '>=', term),
      where('full_name_lc', '<=', term + '\uf8ff'),
      limit(MAX)
    );
    const snap = await getDocs(qs);
    snap.forEach((d) => out.push({ id: d.id, name: pickStudentName(d.data()), source: 'students' }));
  } catch {
    /* ignore */
  }

  // 2) fallback si 1) vide ou pas d’index : petit scan client
  if (out.length === 0) {
    // a) tenter un order simple si possible
    let filled = false;
    for (const key of ['full_name', 'name', '__name__']) {
      if (filled) break;
      try {
        const qs2 = query(collection(db, 'students'), orderBy(key), limit(200));
        const snap2 = await getDocs(qs2);
        snap2.forEach((d) => {
          const nm = pickStudentName(d.data());
          if (lc(nm).includes(term)) {
            out.push({ id: d.id, name: nm, source: `students(${key})` });
          }
        });
        filled = out.length > 0;
      } catch {
        /* ignore */
      }
    }

    // b) si toujours rien, simple limit(200) + filtre client
    if (out.length === 0) {
      try {
        const qs3 = query(collection(db, 'students'), limit(200));
        const snap3 = await getDocs(qs3);
        snap3.forEach((d) => {
          const nm = pickStudentName(d.data());
          if (lc(nm).includes(term)) {
            out.push({ id: d.id, name: nm, source: 'students(limit200)' });
          }
        });
      } catch {
        /* ignore */
      }
    }
  }

  // déduplique + tri
  const seen = new Set();
  const uniq = [];
  for (const r of out) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    uniq.push(r);
  }
  const withScore = uniq.map((x) => {
    const n = lc(x.name);
    const i = n.indexOf(term);
    const score = (i === -1 ? 999 : i) + n.length * 0.01;
    return { ...x, _s: score };
  });
  withScore.sort((a, b) => a._s - b._s);
  return withScore.slice(0, MAX).map(({ _s, ...rest }) => rest);
}

/* ========== comptages acceptés (occupent une place) ========== */
function countAccepted(lesson) {
  const pm = lesson?.participantsMap || {};
  const ids = Array.isArray(lesson?.participant_ids) ? lesson.participant_ids : [];
  let acc = 0;
  for (const id of ids) if ((pm[id]?.status || 'accepted') === 'accepted') acc += 1;
  return acc;
}

/* ========== UI ========== */
function Chip({ children, onRemove }) {
  return (
    <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gray-100 text-gray-800 text-sm">
      {children}
      {onRemove && (
        <button
          onClick={onRemove}
          className="ml-1 rounded-full hover:bg-gray-200 px-2 py-0.5"
          title="Retirer"
        >
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

  /* -------- ouverture : migration legacy + préchargement noms -------- */
  useEffect(() => {
    if (!open || !lesson) return;

    setCapacity(lesson.capacity || 1);
    setParticipantIds(Array.isArray(lesson.participant_ids) ? lesson.participant_ids : []);
    setParticipantsMap(lesson.participantsMap || {});

    (async () => {
      const nm = { ...nameMap };

      /* MIGRATION LEGACY
         Si is_group === true et que student_id est encore renseigné
         mais pas présent dans participant_ids → on le bascule proprement. */
      try {
        if (lesson.is_group && lesson.student_id && !lesson.participant_ids?.includes(lesson.student_id)) {
          const legacyId = lesson.student_id;

          // 1) nom pour l’UI
          let legacyName = legacyId;
          try {
            const s = await getDoc(doc(db, 'students', legacyId));
            if (s.exists()) legacyName = pickStudentName(s.data());
            else {
              const u = await getDoc(doc(db, 'users', legacyId));
              if (u.exists()) legacyName = pickStudentName(u.data());
            }
          } catch { /* ignore */ }

          // 2) patch Firestore (participants + participantsMap + student_id=null)
          await updateDoc(doc(db, 'lessons', lesson.id), {
            participant_ids: arrayUnion(legacyId),
            [`participantsMap.${legacyId}`]: {
              parent_id: null,
              booked_by: lesson.booked_by || null,
              is_paid: false,
              paid_by: null,
              paid_at: null,
              status: 'accepted', // le fondateur compte comme accepté
              added_at: serverTimestamp(),
            },
            student_id: null,
          });

          // 3) patch UI local
          setParticipantIds((prev) => (prev.includes(legacyId) ? prev : [...prev, legacyId]));
          setParticipantsMap((prev) => ({
            ...prev,
            [legacyId]: {
              parent_id: null,
              booked_by: lesson.booked_by || null,
              is_paid: false,
              paid_by: null,
              paid_at: null,
              status: 'accepted',
              added_at: new Date(),
            },
          }));
          nm[legacyId] = legacyName;
        }
      } catch (e) {
        console.error('Migration legacy group failed:', e);
      }

      // Précharger les noms de la liste actuelle
      const ids = Array.isArray(lesson.participant_ids) ? lesson.participant_ids : [];
      for (const id of ids) {
        if (nm[id]) continue;
        try {
          const s = await getDoc(doc(db, 'students', id));
          if (s.exists()) {
            nm[id] = pickStudentName(s.data());
            continue;
          }
        } catch { /* ignore */ }
        try {
          const u = await getDoc(doc(db, 'users', id));
          if (u.exists()) nm[id] = pickStudentName(u.data());
        } catch { /* ignore */ }
        if (!nm[id]) nm[id] = id;
      }

      setNameMap(nm);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lesson?.id]);

  /* -------- recherche (debounce) -------- */
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const term = (search || '').trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
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

  const acceptedCount = useMemo(
    () => countAccepted({ participant_ids: participantIds, participantsMap }),
    [participantIds, participantsMap]
  );
  const free = Math.max((Number(capacity) || 0) - acceptedCount, 0);

  /* -------- actions -------- */
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

  // Inviter un élève (passe en invited_student)
  async function addByPick(p) {
    if (!p?.id) return;
    const id = p.id;
    if (participantIds.includes(id)) {
      alert('Déjà présent (même en attente).');
      return;
    }

    const patch = {
      parent_id: null,
      booked_by: null,
      is_paid: false,
      paid_by: null,
      paid_at: null,
      status: 'invited_student', // en attente de réponse élève
      added_at: serverTimestamp(),
    };

    try {
      await updateDoc(doc(db, 'lessons', lesson.id), {
        is_group: true,
        participant_ids: arrayUnion(id),
        [`participantsMap.${id}`]: patch,
      });

      // notification élève
      try {
        await addDoc(collection(db, 'notifications'), {
          user_id: id,
          read: false,
          created_at: serverTimestamp(),
          type: 'group_invite',
          lesson_id: lesson.id,
          message: `Invitation à rejoindre le cours ${lesson.subject_id || ''} (${lesson.slot_day} ${lesson.slot_hour}h)`,
        });
      } catch { /* ignore */ }

      setParticipantIds((prev) => [...prev, id]);
      setParticipantsMap((prev) => ({ ...prev, [id]: { ...patch, added_at: new Date() } }));
      setNameMap((prev) => ({ ...prev, [id]: p.name }));
      setSearch('');
      setResults([]);
    } catch (e) {
      console.error(e);
      alert("Impossible d'inviter l'élève.");
    }
  }

  // Accepter une DEMANDE (pending_teacher → accepted)
  async function acceptStudent(id) {
    const pm = participantsMap || {};
    const current = pm[id] || {};
    const alreadyAccepted = Object.keys(pm).filter((k) => (pm[k]?.status || 'accepted') === 'accepted').length;
    if (alreadyAccepted >= (Number(capacity) || 0)) {
      alert('Capacité atteinte, impossible d’accepter.');
      return;
    }
    try {
      await updateDoc(doc(db, 'lessons', lesson.id), {
        [`participantsMap.${id}.status`]: 'accepted',
      });
      setParticipantsMap((prev) => ({ ...prev, [id]: { ...current, status: 'accepted' } }));

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
      } catch { /* ignore */ }
    } catch (e) {
      console.error(e);
      alert("Impossible d'accepter.");
    }
  }

  // Refuser une DEMANDE / Annuler une INVITATION (→ suppression)
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

  /* -------- grouping par statut pour l’affichage -------- */
  const groups = useMemo(() => {
    const g = { accepted: [], pending_teacher: [], invited_student: [], declined: [], other: [] };
    const ids = Array.isArray(participantIds) ? participantIds : [];
    for (const id of ids) {
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
        {/* header */}
        <div className="p-5 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">👥 Groupe — {lesson.subject_id || 'Cours'}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        {/* body */}
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
            Acceptés : <b>{acceptedCount}</b> / {capacity} — Places libres : <b>{free}</b>
          </div>

          {/* Recherche → invitation */}
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
                    title={r.source}
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
            {/* Demandes à valider (prof) */}
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

            {/* Invitations envoyées (attente élève) */}
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

        {/* footer */}
        <div className="p-4 border-t flex justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded bg-gray-100 hover:bg-gray-200">Fermer</button>
        </div>
      </div>
    </div>
  );
}