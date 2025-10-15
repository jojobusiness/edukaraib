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

function statusLabel(st) {
  switch (st) {
    case 'confirmed':
    case 'accepted':
      return 'Confirmé';
    case 'invited_student':
    case 'invited_parent':
      return 'Invité';
    case 'rejected':
      return 'Refusé';
    case 'removed':
    case 'deleted':
      return 'Retiré';
    case 'booked':
    case 'pending_teacher':
    case 'pending_parent':
    case 'requested':
    case 'pending':
    case 'awaiting_confirmation':
    case 'reinvited':
    case 'awaiting':
    default:
      return 'En attente';
  }
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
  const [singleStudentName, setSingleStudentName] = useState(''); // 👈 nom élève pour cours individuel

  useEffect(() => {
    if (!open || !lesson?.id) return;
    const ref = doc(db, 'lessons', lesson.id);
    setLoading(true);
    const unsub = onSnapshot(ref, async (snap) => {
      setLoading(false);
      if (!snap.exists()) return;
      const data = snap.data();

      // 🔁 Migration legacy éventuelle
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

      // 🔎 Résoudre noms : participants + élève individuel éventuel
      const nm = {};
      for (const id of pIds) {
        nm[id] = await resolveName(id);
      }
      setNameMap(nm);

      if (!data.is_group && data.student_id) {
        const nmStudent = await resolveName(data.student_id);
        setSingleStudentName(nmStudent);
      } else {
        setSingleStudentName('');
      }
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

  // Invitation — pas d’optimistic update (onSnapshot fait foi)
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
  const pendingIds = Array.from(new Set(allIds.filter((sid) => {
    const st = participantsMap?.[sid]?.status || 'pending';
    return st !== 'accepted' && st !== 'confirmed' && st !== 'rejected' && st !== 'removed' && st !== 'deleted';
  })));
  const invited = Array.from(new Set(allIds.filter((sid) => participantsMap?.[sid]?.status === 'invited_student')));

  if (!open || !lesson) return null;

  const isGroup = !!lesson.is_group;

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl">
        <div className="p-5 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            {isGroup ? '👥 Groupe' : '👤 Cours individuel'} — {lesson.subject_id || 'Cours'}
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        <div className="p-5 space-y-6">
          {loading && <div className="text-sm text-gray-500">Chargement…</div>}

          {/* 🎯 Cours individuel : afficher l'élève */}
          {!isGroup && (
            <div className="border rounded-lg p-3">
              <div className="font-medium mb-2">Élève du cours</div>
              <div className="flex flex-wrap gap-2">
                <Chip title={`Statut : ${statusLabel(lesson.status)}`}>
                  {singleStudentName || lesson.student_id || '—'} · <span className="text-gray-700">{statusLabel(lesson.status)}</span>
                </Chip>
              </div>
            </div>
          )}

          {/* ⚙️ Réglages de groupe */}
          {isGroup && (
            <>
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

              {/* Participants confirmés/acceptés */}
              <div className="border rounded-lg p-3">
                <div className="font-medium mb-2">Participants confirmés/acceptés</div>
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

              {/* En attente (booked/pending/invited...) */}
              <div className="border rounded-lg p-3">
                <div className="font-medium mb-2">Élèves en attente</div>
                {pendingIds.length === 0 ? (
                  <div className="text-sm text-gray-500">Aucun élève en attente.</div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {pendingIds.map((sid) => {
                      const ent = participantsMap?.[sid] || {};
                      const st = ent.status || 'pending';
                      return (
                        <Chip key={`pd:${sid}`} onRemove={() => removeStudent(sid)} title={`Statut : ${statusLabel(st)}`}>
                          {nameMap[sid] || sid} · <span className="text-amber-700">{statusLabel(st)}</span>
                        </Chip>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Vue complète (tous les élèves avec leur statut) */}
              <div className="border rounded-lg p-3">
                <div className="font-medium mb-2">Tous les élèves (avec statut)</div>
                {allIds.length === 0 ? (
                  <div className="text-sm text-gray-500">Aucun élève dans ce cours.</div>
                ) : (
                  <ul className="text-sm text-gray-800 space-y-1">
                    {allIds.map((sid) => {
                      const ent = participantsMap?.[sid] || {};
                      const st = ent.status || 'confirmed';
                      const paid = !!ent.is_paid;
                      return (
                        <li key={`all:${sid}`} className="flex items-center gap-2">
                          <span className="font-medium">{nameMap[sid] || sid}</span>
                          <span className={`text-[11px] px-2 py-0.5 rounded-full ${
                            (st === 'accepted' || st === 'confirmed') ? 'bg-green-100 text-green-700'
                            : (st === 'invited_student' || st === 'invited_parent') ? 'bg-indigo-100 text-indigo-700'
                            : 'bg-amber-100 text-amber-700'
                          }`}>
                            {statusLabel(st)}
                          </span>
                          {(st === 'accepted' || st === 'confirmed') && (
                            <span className={`text-[11px] px-2 py-0.5 rounded-full ${paid ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                              {paid ? 'Payé' : 'À payer'}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>

        <div className="p-4 border-t flex justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded bg-gray-100 hover:bg-gray-200">Fermer</button>
        </div>
      </div>
    </div>
  );
}