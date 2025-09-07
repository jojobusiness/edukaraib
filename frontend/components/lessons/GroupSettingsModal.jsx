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
  onSnapshot,
} from 'firebase/firestore';

const stripDiacritics = (s = '') => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const lc = (s) => stripDiacritics(String(s || '')).toLowerCase().trim();
const pickStudentName = (x = {}) =>
  x.full_name || x.name || x.fullName || x.displayName ||
  [x.first_name, x.last_name].filter(Boolean).join(' ') ||
  (x.profile && (x.profile.full_name || x.profile.name)) || 'Sans nom';

async function searchStudentsByName(termRaw) {
  const term = lc(termRaw); if (!term) return []; const MAX = 12; const out = [];
  try {
    const qs = query(
      collection(db, 'students'),
      where('full_name_lc', '>=', term),
      where('full_name_lc', '<=', term + '\uf8ff'),
      limit(MAX)
    );
    const snap = await getDocs(qs);
    snap.forEach((d) => out.push({ id: d.id, name: pickStudentName(d.data()), source: 'students' }));
  } catch {}
  if (out.length === 0) {
    try {
      const qs2 = query(collection(db, 'students'), orderBy('full_name'), limit(200));
      const snap2 = await getDocs(qs2);
      snap2.forEach((d) => { const nm = pickStudentName(d.data()); if (lc(nm).includes(term)) out.push({ id: d.id, name: nm, source: 'students(full_name)' }); });
    } catch {}
  }
  try {
    const qu = query(collection(db, 'users'), where('role', 'in', ['student', 'child']), limit(120));
    const snapU = await getDocs(qu);
    snapU.forEach((d) => {
      const x = d.data();
      const nm = x.fullName || x.name || x.displayName || (x.profile && (x.profile.full_name || x.profile.name)) || '';
      if (lc(nm).includes(term)) out.push({ id: d.id, name: nm || 'Sans nom', source: 'users' });
    });
  } catch {}
  const uniq = []; const seen = new Set();
  out.forEach(r => { if (!seen.has(r.id)) { seen.add(r.id); uniq.push(r); } });
  return uniq.slice(0, MAX);
}

function countConfirmed(participant_ids = [], participantsMap = {}) {
  let acc = 0;
  for (const id of participant_ids) {
    const st = participantsMap?.[id]?.status || 'confirmed';
    if (st === 'accepted' || st === 'confirmed') acc += 1;
  }
  return acc;
}

function Chip({ children, onRemove, title }) {
  return (
    <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gray-100 text-gray-800 text-sm">
      <span title={title}>{children}</span>
      {onRemove && (
        <button onClick={onRemove} className="ml-1 rounded-full hover:bg-gray-200 px-2 py-0.5" title="Retirer">✕</button>
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
  const [loading, setLoading] = useState(false);
  const [migrated, setMigrated] = useState(false);

  useEffect(() => {
    if (!open || !lesson?.id) return;
    const ref = doc(db, 'lessons', lesson.id);
    setLoading(true);
    const unsub = onSnapshot(ref, async (snap) => {
      setLoading(false);
      if (!snap.exists()) return;
      const data = snap.data();

      if (!migrated && data.is_group && data.student_id && !Array.isArray(data.participant_ids)?.includes(data.student_id)) {
        try {
          await updateDoc(ref, {
            participant_ids: arrayUnion(data.student_id),
            [`participantsMap.${data.student_id}`]: {
              parent_id: null, booked_by: data.booked_by || null,
              is_paid: false, paid_by: null, paid_at: null,
              status: 'confirmed', added_at: serverTimestamp(),
            },
            student_id: null,
          });
          setMigrated(true);
          return;
        } catch (e) { console.error('Legacy migration failed:', e); }
      }

      const pIds = Array.isArray(data.participant_ids) ? Array.from(new Set(data.participant_ids)) : [];
      setCapacity(Number(data.capacity || 1));
      setParticipantIds(pIds);
      setParticipantsMap(data.participantsMap || {});

      const nm = {};
      for (const id of pIds) { nm[id] = await resolveName(id); }
      setNameMap(nm);
    }, (err) => { setLoading(false); console.error('onSnapshot(lesson) error:', err); });
    return () => unsub();
  }, [open, lesson?.id, migrated]);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const term = (search || '').trim();
    if (term.length < 2) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try { setResults(await searchStudentsByName(term)); }
      finally { setSearching(false); }
    }, 250);
  }, [search, open]);

  const confirmedCount = useMemo(() => countConfirmed(participantIds, participantsMap), [participantIds, participantsMap]);
  const free = Math.max((Number(capacity) || 0) - confirmedCount, 0);

  async function resolveName(id) {
    if (!id) return '';
    try { const s = await getDoc(doc(db, 'students', id)); if (s.exists()) return pickStudentName(s.data()); } catch {}
    try { const u = await getDoc(doc(db, 'users', id)); if (u.exists()) return pickStudentName(u.data()); } catch {}
    return id;
  }
  async function saveCapacity() {
    try {
      await updateDoc(doc(db, 'lessons', lesson.id), { capacity: Number(capacity) || 1, is_group: true });
      alert('Capacité mise à jour.');
    } catch (e) { console.error(e); alert("Impossible d'enregistrer la capacité."); }
  }

  // Invitation — plus d’optimistic update local (évite doublons)
  async function addByPick(p) {
    if (!p?.id) return;
    const id = p.id;
    if (participantIds.includes(id)) { alert('Déjà présent dans la liste.'); return; }
    const patch = { parent_id: null, booked_by: null, is_paid: false, paid_by: null, paid_at: null, status: 'invited_student', added_at: serverTimestamp() };
    try {
      await updateDoc(doc(db, 'lessons', lesson.id), {
        is_group: true,
        participant_ids: arrayUnion(id),
        [`participantsMap.${id}`]: patch,
      });
      // notif élève
      try {
        await addDoc(collection(db, 'notifications'), {
          user_id: id, read: false, created_at: serverTimestamp(),
          type: 'group_invite', lesson_id: lesson.id,
          message: `Invitation à rejoindre le cours ${lesson.subject_id || ''} (${lesson.slot_day} ${lesson.slot_hour}h).`,
        });
      } catch {}
      // on ne touche PAS aux états locaux → on laisse onSnapshot rafraîchir (évite les doublons)
      setSearch(''); setResults([]);
    } catch (e) { console.error(e); alert("Impossible d'inviter l'élève."); }
  }

  async function removeStudent(id) {
    const ok = window.confirm('Retirer cet élève de la liste ?');
    if (!ok) return;
    try {
      await updateDoc(doc(db, 'lessons', lesson.id), {
        participant_ids: arrayRemove(id),
        [`participantsMap.${id}`]: deleteField(),
      });
    } catch (e) { console.error(e); alert("Impossible de retirer l'élève."); }
  }

  const allIds = participantIds || [];
  const acceptedOrConfirmed = Array.from(new Set(allIds.filter((sid) => {
    const st = participantsMap?.[sid]?.status || 'confirmed';
    return st === 'accepted' || st === 'confirmed';
  })));
  const invited = Array.from(new Set(allIds.filter((sid) => participantsMap?.[sid]?.status === 'invited_student')));

  if (!open || !lesson) return null;

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl">
        <div className="p-5 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">👥 Groupe — {lesson.subject_id || 'Cours'}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        <div className="p-5 space-y-6">
          {loading && <div className="text-sm text-gray-500">Chargement du groupe…</div>}

          <div className="flex items-center gap-3">
            <label className="font-medium">Capacité (places max)</label>
            <input type="number" min={1} className="border rounded px-2 py-1 w-24" value={capacity} onChange={(e) => setCapacity(Number(e.target.value || 1))}/>
            <button onClick={saveCapacity} className="bg-gray-800 hover:bg-gray-900 text-white px-3 py-1 rounded">Enregistrer</button>
          </div>
          <div className="text-sm text-gray-600">
            Confirmés : <b>{confirmedCount}</b> / {capacity} — Places libres : <b>{Math.max(free, 0)}</b>
          </div>

          {/* Recherche → Invitation */}
          <div>
            <label className="block text-sm font-medium mb-1">Inviter un élève (par nom)</label>
            <input
              type="text" placeholder="Rechercher un élève…" className="w-full border rounded-lg px-3 py-2"
              value={search} onChange={(e) => setSearch(e.target.value)}
            />
            {searching && <div className="text-sm text-gray-500 mt-2">Recherche…</div>}
            {!searching && results.length > 0 && (
              <div className="mt-2 border rounded-lg max-h-56 overflow-auto divide-y">
                {results.map((r) => (
                  <button
                    key={`pick:${r.id}`} className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center justify-between"
                    onClick={() => addByPick(r)} disabled={allIds.includes(r.id)} title={r.source}
                  >
                    <span>{r.name}</span>
                    {allIds.includes(r.id) && <span className="text-xs text-green-600">déjà listé</span>}
                  </button>
                ))}
              </div>
            )}
            {search.length >= 2 && !searching && results.length === 0 && (
              <div className="text-sm text-gray-500 mt-2">Aucun résultat.</div>
            )}
          </div>

          {/* Participants (acceptés/confirmés) */}
          <div className="border rounded-lg p-3">
            <div className="font-medium mb-2">Participants</div>
            {acceptedOrConfirmed.length === 0 ? (
              <div className="text-sm text-gray-500">Aucun participant confirmé/accepté.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {acceptedOrConfirmed.map((sid) => {
                  const ent = participantsMap?.[sid] || {};
                  const paid = !!ent.is_paid;
                  const payLabel = paid ? '€ payé' : '€ à payer';
                  const payTitle = paid ? 'Paiement reçu' : 'Paiement non réglé';
                  return (
                    <Chip key={`ac:${sid}`} onRemove={() => removeStudent(sid)} title={payTitle}>
                      {nameMap[sid] || sid} · <span className={paid ? 'text-green-700' : 'text-amber-700'}>{payLabel}</span>
                    </Chip>
                  );
                })}
              </div>
            )}
          </div>

          {/* Invitations envoyées (uniques) */}
          <div className="border rounded-lg p-3">
            <div className="font-medium mb-2">Invitations envoyées</div>
            {invited.length === 0 ? (
              <div className="text-sm text-gray-500">Aucune invitation en cours.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {invited.map((sid) => (
                  <Chip key={`inv:${sid}`} onRemove={() => removeStudent(sid)}>
                    {nameMap[sid] || sid} · <span className="text-indigo-700">invité</span>
                  </Chip>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="p-4 border-t flex justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded bg-gray-100 hover:bg-gray-200">Fermer</button>
        </div>
      </div>
    </div>
  );
}
