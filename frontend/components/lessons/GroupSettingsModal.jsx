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
} from 'firebase/firestore';

// --- Recherche unifiée d'élèves par NOM ---
// - Cherche dans `students` (full_name / full_name_lc)
// - Cherche dans `users` (fullName / name / displayName) avec role in ['student','child']
// - Fallback si index absents : petit lot + filtre client
async function searchStudentsByName(termRaw) {
  const term = (termRaw || '').trim().toLowerCase();
  if (!term) return [];

  const MAX = 12;
  const res = [];

  // STUDENTS
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
      res.push({ id: d.id, name: x.full_name || x.name || 'Sans nom', source: 'students' });
    });
  } catch {
    try {
      const qs = query(collection(db, 'students'), orderBy('full_name'), limit(60));
      const snap = await getDocs(qs);
      snap.forEach((d) => {
        const x = d.data();
        const n = (x.full_name || x.name || '').toLowerCase();
        if (n.includes(term)) res.push({ id: d.id, name: x.full_name || x.name || 'Sans nom', source: 'students' });
      });
    } catch {}
  }

  // USERS (élèves/children)
  try {
    const qu = query(collection(db, 'users'), where('role', 'in', ['student', 'child']), limit(60));
    const snapU = await getDocs(qu);
    snapU.forEach((d) => {
      const x = d.data();
      const name = x.fullName || x.name || x.displayName || (x.profile && x.profile.name) || 'Sans nom';
      if ((name || '').toLowerCase().includes(term)) {
        res.push({ id: d.id, name, source: 'users' });
      }
    });
  } catch {
    try {
      const qu = query(collection(db, 'users'), limit(80));
      const snapU = await getDocs(qu);
      snapU.forEach((d) => {
        const x = d.data();
        if (!['student', 'child'].includes(x.role)) return;
        const name = x.fullName || x.name || x.displayName || (x.profile && x.profile.name) || 'Sans nom';
        if ((name || '').toLowerCase().includes(term)) {
          res.push({ id: d.id, name, source: 'users' });
        }
      });
    } catch {}
  }

  // déduplique par id
  const seen = new Set();
  const unique = [];
  for (const r of res) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    unique.push(r);
  }

  // tri simple par pertinence
  const withScore = unique.map((x) => {
    const idx = (x.name || '').toLowerCase().indexOf(term);
    const score = (idx === -1 ? 999 : idx) + (x.name || '').length * 0.01;
    return { ...x, _score: score };
  });
  withScore.sort((a, b) => a._score - b._score);

  return withScore.slice(0, MAX).map(({ _score, ...rest }) => rest);
}

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
  // états principaux
  const [capacity, setCapacity] = useState(lesson?.capacity || 1);
  const [participantIds, setParticipantIds] = useState(lesson?.participant_ids || []);
  const [participantsMap, setParticipantsMap] = useState(lesson?.participantsMap || {}); // conservé pour compat
  const [nameMap, setNameMap] = useState({}); // {id: name} pour affichage

  // recherche
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef(null);

// sync à l’ouverture
useEffect(() => {
  if (!open || !lesson) return;

  // Base
  setCapacity(lesson.capacity || 1);
  setParticipantIds(Array.isArray(lesson.participant_ids) ? lesson.participant_ids : []);
  setParticipantsMap(lesson.participantsMap || {});

  (async () => {
    const nm = {};

    // ---------------------------
    // MIGRATION LEGACY (si besoin)
    // ---------------------------
    // Cas: is_group = true, student_id défini, participant_ids ne le contient pas encore.
    try {
      if (lesson.is_group && lesson.student_id && !lesson.participant_ids?.includes(lesson.student_id)) {
        const legacyId = lesson.student_id;

        // Récup nom pour UI
        let legacyName = legacyId;
        try {
          const s = await getDoc(doc(db, 'students', legacyId));
          if (s.exists()) {
            const d = s.data();
            legacyName = d.full_name || d.name || legacyId;
          } else {
            const u = await getDoc(doc(db, 'users', legacyId));
            if (u.exists()) {
              const d = u.data();
              legacyName = d.fullName || d.name || d.displayName || legacyId;
            }
          }
        } catch {}

        // Patch Firestore : pousse le legacyId dans participant_ids, crée entrée map, vide student_id
        await updateDoc(doc(db, 'lessons', lesson.id), {
          participant_ids: arrayUnion(legacyId),
          [`participantsMap.${legacyId}`]: {
            parent_id: null,
            booked_by: lesson.booked_by || null,
            is_paid: false,
            paid_by: null,
            paid_at: null,
            status: lesson.status || 'booked',
            added_at: serverTimestamp(),
          },
          student_id: null,
        });

        // Patch UI local
        setParticipantIds((prev) => (prev.includes(legacyId) ? prev : [...prev, legacyId]));
        setParticipantsMap((prev) => ({
          ...prev,
          [legacyId]: {
            parent_id: null,
            booked_by: lesson.booked_by || null,
            is_paid: false,
            paid_by: null,
            paid_at: null,
            status: lesson.status || 'booked',
            added_at: new Date(), // purement visuel
          },
        }));
        nm[legacyId] = legacyName;
      }
    } catch (e) {
      console.error('Migration legacy group failed:', e);
    }

    // Précharger les noms de tous les participants
    for (const id of (lesson.participant_ids || [])) {
      try {
        const s = await getDoc(doc(db, 'students', id));
        if (s.exists()) {
          const d = s.data();
          nm[id] = d.full_name || d.name || id;
          continue;
        }
      } catch {}
      try {
        const u = await getDoc(doc(db, 'users', id));
        if (u.exists()) {
          const d = u.data();
          nm[id] = d.fullName || d.name || d.displayName || id;
        }
      } catch {}
    }

    setNameMap((prev) => ({ ...prev, ...nm }));
  })();
}, [open, lesson]);

  // recherche (debounce)
  useEffect(() => {
    if (!open) return;
    const term = (search || '').trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
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

  const selectedSet = useMemo(() => new Set(participantIds), [participantIds]);

  // actions
  async function saveCapacity() {
    try {
      await updateDoc(doc(db, 'lessons', lesson.id), { capacity: Number(capacity) || 1, is_group: true });
      alert('Capacité mise à jour.');
    } catch (e) {
      console.error(e);
      alert("Impossible d'enregistrer la capacité.");
    }
  }

  async function addByPick(p) {
    if (!p?.id) return;
    if (selectedSet.has(p.id)) return alert('Déjà dans la liste.');
    if (participantIds.length >= (capacity || 1)) return alert('Capacité atteinte.');

    const ref = doc(db, 'lessons', lesson.id);

    // Patch minimal côté participantsMap pour compat (tu peux le retirer si inutile)
    const participantPatch = {
      parent_id: null,
      booked_by: null,
      is_paid: false,
      paid_by: null,
      paid_at: null,
      status: 'confirmed',
      added_at: serverTimestamp(),
    };

    try {
      await updateDoc(ref, {
        is_group: true,
        participant_ids: arrayUnion(p.id),
        [`participantsMap.${p.id}`]: participantPatch,
      });

      setParticipantIds((prev) => [...prev, p.id]);
      setParticipantsMap((prev) => ({ ...prev, [p.id]: participantPatch }));
      setNameMap((prev) => ({ ...prev, [p.id]: p.name }));
      setSearch('');
      setResults([]);
    } catch (e) {
      console.error(e);
      alert("Impossible d'ajouter l'élève.");
    }
  }

  async function removeStudent(id) {
    const ok = window.confirm('Retirer cet élève du cours ?');
    if (!ok) return;
    const ref = doc(db, 'lessons', lesson.id);
    try {
      await updateDoc(ref, {
        participant_ids: arrayRemove(id),
        [`participantsMap.${id}`]: deleteField(),
      });
      setParticipantIds((p) => p.filter((x) => x !== id));
      setParticipantsMap((m) => {
        const copy = { ...m };
        delete copy[id];
        return copy;
      });
      setNameMap((n) => {
        const copy = { ...n };
        delete copy[id];
        return copy;
      });
    } catch (e) {
      console.error(e);
      alert("Impossible de retirer l'élève.");
    }
  }

  const used = participantIds.length;
  const free = Math.max((capacity || 0) - used, 0);

  if (!open || !lesson) return null;

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl">
        <div className="p-5 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">👥 Groupe — {lesson.subject_id || 'Cours'}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        <div className="p-5 space-y-5">
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
            <button
              onClick={saveCapacity}
              className="bg-gray-800 hover:bg-gray-900 text-white px-3 py-1 rounded"
            >
              Enregistrer
            </button>
          </div>

          <div className="text-sm text-gray-600">
            Occupées : <b>{used}</b> / {capacity} — Places libres : <b>{free}</b>
          </div>

          {/* Recherche par nom */}
          <div>
            <label className="block text-sm font-medium mb-1">Ajouter un élève (par nom)</label>
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
                    key={`${r.source}:${r.id}`}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center justify-between"
                    onClick={() => addByPick(r)}
                    title={r.source === 'users' ? 'Depuis users' : 'Depuis students'}
                    disabled={participantIds.length >= (capacity || 1)}
                  >
                    <span>{r.name}</span>
                    {participantIds.includes(r.id) && (
                      <span className="text-xs text-green-600">déjà ajouté</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {search.length >= 2 && !searching && results.length === 0 && (
              <div className="text-sm text-gray-500 mt-2">Aucun résultat.</div>
            )}

            {/*<p className="text-xs text-gray-400 mt-2">
              (Optionnel) Pour des recherches plus rapides : ajoute <code>full_name_lc</code> (minuscule)
              dans <code>students</code> et <code>fullName_lc</code> dans <code>users</code>, puis crée
              les index demandés par Firestore.
            </p>*/}
          </div>

          {/* Participants (noms uniquement) */}
          <div className="border rounded-lg p-3">
            <div className="font-medium mb-2">Participants</div>
            {participantIds.length === 0 ? (
              <div className="text-gray-500 text-sm">Aucun élève dans ce cours.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {participantIds.map((sid) => (
                  <Chip key={sid} onRemove={() => removeStudent(sid)}>
                    {nameMap[sid] || sid}
                  </Chip>
                ))}
              </div>
            )}
          </div>
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