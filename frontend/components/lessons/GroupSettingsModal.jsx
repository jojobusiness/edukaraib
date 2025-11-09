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

/* ---------------- utils noms / recherche ---------------- */
const stripDiacritics = (s = '') => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const lc = (s) => stripDiacritics(String(s || '')).toLowerCase().trim();
const pickStudentName = (x = {}) =>
  x.full_name || x.name || x.fullName || x.displayName ||
  [x.first_name, x.last_name].filter(Boolean).join(' ') ||
  (x.profile && (x.profile.full_name || x.profile.name)) || 'Sans nom';

async function searchStudentsByName(termRaw) {
  const term = lc(termRaw);
  if (!term) return [];
  const MAX = 12;
  const out = [];
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
      snap2.forEach((d) => {
        const nm = pickStudentName(d.data());
        if (lc(nm).includes(term)) out.push({ id: d.id, name: nm, source: 'students(full_name)' });
      });
    } catch {}
  }
  try {
    const qu = query(collection(db, 'users'), where('role', 'in', ['student', 'child']), limit(120));
    const snapU = await getDocs(qu);
    snapU.forEach((d) => {
      const x = d.data();
      const nm =
        x.fullName ||
        x.name ||
        x.displayName ||
        (x.profile && (x.profile.full_name || x.profile.name)) ||
        '';
      if (lc(nm).includes(term)) out.push({ id: d.id, name: nm || 'Sans nom', source: 'users' });
    });
  } catch {}
  const uniq = [];
  const seen = new Set();
  out.forEach((r) => {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      uniq.push(r);
    }
  });
  return uniq.slice(0, MAX);
}

function countConfirmed(participant_ids = [], participantsMap = {}) {
  let acc = 0;
  for (const id of participant_ids) {
    const st = String(participantsMap?.[id]?.status || 'pending');
    if (st === 'accepted' || st === 'confirmed') acc += 1;
  }
  return acc;
}

function Chip({ children, onRemove, title }) {
  return (
    <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gray-100 text-gray-800 text-sm">
      <span title={title}>{children}</span>
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

function statusLabel(st) {
  switch (st) {
    case 'accepted':
    case 'confirmed':
      return 'Confirmé';
    case 'rejected':
      return 'Refusé';
    case 'removed':
    case 'deleted':
      return 'Retiré';
    case 'invited_student':
    case 'invited_parent':
      return 'Invité';
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

/* ---------------- composant principal ---------------- */
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

  // ✅ élève d’un cours individuel (pour l’affichage + bascules auto)
  const [singleStudentId, setSingleStudentId] = useState(null);

  // 🔒 anti-boucle downgrade
  const guardRef = useRef({
    downgrading: false,
    justPromotedUntil: 0, // horodatage pour ignorer le downgrade juste après une promotion en groupe
  });

  useEffect(() => {
    if (!open || !lesson?.id) return;
    const ref = doc(db, 'lessons', lesson.id);
    setLoading(true);
    const unsub = onSnapshot(
      ref,
      async (snap) => {
        setLoading(false);
        if (!snap.exists()) return;
        const data = snap.data();

        const pIds = Array.isArray(data.participant_ids)
          ? Array.from(new Set(data.participant_ids))
          : [];
        setCapacity(Number(data.capacity || 1));
        setParticipantIds(pIds);
        setParticipantsMap(data.participantsMap || {});
        setSingleStudentId(!data.is_group && data.student_id ? data.student_id : null);

        const nm = {};
        for (const id of pIds) nm[id] = await resolveName(id);
        if (!data.is_group && data.student_id) {
          nm[data.student_id] = await resolveName(data.student_id);
        }
        setNameMap(nm);

        // 🔁 Auto-downgrade : si le cours est groupé et qu’il ne reste
        // **aucun autre participant actif** que l’élève individuel → redevenir individuel.
        if (
          data.is_group &&
          data.student_id &&
          Number(data.capacity || 1) <= 1 &&                         // ✅ ne downgrade que si la capacité est 1
          !(guardRef.current?.justPromotedUntil && Date.now() < guardRef.current.justPromotedUntil)
        ) {
          const baseStudent = data.student_id; // élève d’origine (individuel)
          const pm = data.participantsMap || {};
          const activeOthers = (pIds || []).filter((sid) => {
            if (sid === baseStudent) return false;
            const st = String(pm?.[sid]?.status || 'pending');
            return !['rejected', 'removed', 'deleted'].includes(st);
          });

          if (!guardRef.current.downgrading && activeOthers.length === 0) {
            try {
              guardRef.current.downgrading = true;

              // 👉 Nettoyage complet des participants (on revient en pur individuel)
              const patch = {
                is_group: false,
                capacity: 1,
                participant_ids: [],
              };
              // supprimer toutes les entrées participantsMap.*
              for (const sid of pIds) {
                patch[`participantsMap.${sid}`] = deleteField();
              }
              await updateDoc(ref, patch);
            } catch (e) {
              console.error('Auto-downgrade failed:', e);
            } finally {
              setTimeout(() => { guardRef.current.downgrading = false; }, 500);
            }
          }
        }
      },
      (err) => {
        setLoading(false);
        console.error('onSnapshot(lesson) error:', err);
      }
    );
    return () => unsub();
  }, [open, lesson?.id]);

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
        setResults(await searchStudentsByName(term));
      } finally {
        setSearching(false);
      }
    }, 250);
  }, [search, open]);

  const confirmedBase = useMemo(
    () => countConfirmed(participantIds, participantsMap),
    [participantIds, participantsMap]
  );
  // ➕ afficher +1 si cours individuel (bandeau)
  const confirmedDisplayed = useMemo(() => {
    let base = confirmedBase;

    if (singleStudentId) {
      const alreadyInList = (participantIds || []).includes(singleStudentId);
      // statut du "propriétaire" (si absent du map on le traite comme confirmé pour l'individuel pur)
      const ownerSt = String(participantsMap?.[singleStudentId]?.status || 'confirmed');

      // n'ajouter +1 que si l'élève individuel n'est PAS dans participant_ids
      // et seulement s'il est réellement confirmé/accepté
      if (!alreadyInList && (ownerSt === 'accepted' || ownerSt === 'confirmed')) {
        base += 1;
      }
    }
    return base;
  }, [confirmedBase, singleStudentId, participantIds, participantsMap]);

  const freeDisplayed = useMemo(
    () => Math.max((Number(capacity) || 0) - confirmedDisplayed, 0),
    [capacity, confirmedDisplayed]
  );

  async function resolveName(id) {
    if (!id) return '';
    try {
      const s = await getDoc(doc(db, 'students', id));
      if (s.exists()) return pickStudentName(s.data());
    } catch {}
    try {
      const u = await getDoc(doc(db, 'users', id));
      if (u.exists()) return pickStudentName(u.data());
    } catch {}
    return id;
  }

  async function saveCapacity() {
    const cap = Number(capacity) || 1;
    const ref = doc(db, 'lessons', lesson.id);

    const patch = { capacity: cap };

    if (cap <= 1) {
      // 👉 Revenir/forcer INDIVIDUEL
      patch.is_group = false;
      // nettoyage complet des participants de groupe
      patch.participant_ids = [];
      if ((participantIds || []).length) {
        (participantIds || []).forEach((sid) => {
          patch[`participantsMap.${sid}`] = deleteField();
        });
      }
    } else {
      // 👉 Forcer GROUPE si capacité > 1
      patch.is_group = true;

      if (singleStudentId && !(participantIds || []).includes(singleStudentId)) {
        patch.participant_ids = arrayUnion(singleStudentId);
        patch[`participantsMap.${singleStudentId}`] = {
          parent_id: lesson.parent_id || null,
          booked_by: lesson.booked_by || null,
          is_paid: !!lesson.is_paid,
          paid_by: null,
          paid_at: null,
          status: 'confirmed',
          added_at: serverTimestamp(),
        };
      }

      // ⛳️ anti-auto-downgrade immédiat (4s de grâce après promotion)
      try {
        guardRef.current.justPromotedUntil = Date.now() + 4000;
      } catch {}
    }


    try {
      await updateDoc(ref, patch);
      alert('Capacité mise à jour.');
    } catch (e) {
      console.error(e);
      alert("Impossible d'enregistrer la capacité.");
    }
  }

  // ✅ INVITER : passe en groupé, +1 capacité (min 2), garde l’élève d’origine confirmé
  // L’invité est marqué "invited_student" ⇒ **visible uniquement dans “Invitations”** (pas “Participants”).
  async function addByPick(p) {
    if (!p?.id) return;
    const id = p.id;
    if (participantIds.includes(id)) {
      alert('Déjà présent dans la liste.');
      return;
    }

    const ref = doc(db, 'lessons', lesson.id);

    // Capacité à +1 (minimum 2)
    const newCap = Math.max((Number(capacity) || 1) + 1, 2);

    // invited payload
    const invitedPayload = {
      parent_id: null,
      booked_by: null,
      is_paid: false,
      paid_by: null,
      paid_at: null,
      status: 'invited_student',
      added_at: serverTimestamp(),
    };

    const patch = {
      is_group: true,
      capacity: newCap,
      participant_ids: singleStudentId ? arrayUnion(id, singleStudentId) : arrayUnion(id),
      [`participantsMap.${id}`]: invitedPayload,
    };

    if (singleStudentId) {
      patch[`participantsMap.${singleStudentId}`] = {
        parent_id: lesson.parent_id || null,
        booked_by: lesson.booked_by || null,
        is_paid: !!lesson.is_paid,
        paid_by: null,
        paid_at: null,
        status: 'confirmed',
        added_at: serverTimestamp(),
      };
    }

    try {
      await updateDoc(ref, patch);

      // notif élève invité
      try {
        await addDoc(collection(db, 'notifications'), {
          user_id: id,
          read: false,
          created_at: serverTimestamp(),
          type: 'group_invite',
          lesson_id: lesson.id,
          message: `Invitation à rejoindre le cours ${lesson.subject_id || ''} (${lesson.slot_day} ${lesson.slot_hour}h).`,
        });
      } catch {}

      setSearch('');
      setResults([]);
    } catch (e) {
      console.error(e);
      alert("Impossible d'inviter l'élève.");
    }
  }

  // 🗑️ Retirer un invité/participant :
  // si après retrait il ne reste que l’élève d’origine ⇒ on repasse en individuel (géré par onSnapshot + auto-downgrade).
  async function removeStudent(id) {
    const ok = window.confirm("Retirer cet élève de la liste ?");
    if (!ok) return;
    try {
      await updateDoc(doc(db, 'lessons', lesson.id), {
        participant_ids: arrayRemove(id),
        [`participantsMap.${id}`]: deleteField(),
      });
      // Le onSnapshot détectera s’il faut downgrade (aucun “autre” actif).
    } catch (e) {
      console.error(e);
      alert("Impossible de retirer l'élève.");
    }
  }

  /* === Participants à afficher ===
     - TOUS les participant_ids **sauf** ceux en statut "invited_*"
     - + l'élève individuel (si présent), UNIQUEMENT dans l'affichage Participants
       (donc pas de doublon avec la section “Invitations”) */
  const participantsForRender = useMemo(() => {
    const base = Array.from(new Set(participantIds || []))
      .filter((sid) => {
        const st = participantsMap?.[sid]?.status;
        return st !== 'invited_student' && st !== 'invited_parent';
      });
    if (singleStudentId && !base.includes(singleStudentId)) base.push(singleStudentId);
    return base;
  }, [participantIds, participantsMap, singleStudentId]);

  if (!open || !lesson) return null;

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl">
        <div className="p-5 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            👥 Groupe — {lesson?.subject_id || 'Cours'}
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            ✕
          </button>
        </div>

        <div className="p-5 space-y-6">
          {loading && <div className="text-sm text-gray-500">Chargement…</div>}

          {/* Réglages de groupe */}
          <div className="flex items-center gap-3">
            <label className="font-medium">Capacité (places max)</label>
            <input
              type="number"
              min={1}
              className="border rounded px-2 py-1 w-24"
              value={capacity}
              onChange={(e) => setCapacity(Number(e.target.value) || 1)}
            />
            <button
              onClick={saveCapacity}
              className="bg-gray-800 hover:bg-gray-900 text-white px-3 py-1 rounded"
            >
              Enregistrer
            </button>
          </div>
          <div className="text-sm text-gray-600">
            Confirmés : <b>{confirmedDisplayed}</b> / {capacity} — Places libres : <b>{freeDisplayed}</b>
          </div>

          {/* Recherche / invitation */}
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
                    disabled={(participantIds || []).includes(r.id)}
                    title={r.source}
                  >
                    <span>{r.name}</span>
                    {(participantIds || []).includes(r.id) && (
                      <span className="text-xs text-green-600">déjà listé</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {search.length >= 2 && !searching && results.length === 0 && (
              <div className="text-sm text-gray-500 mt-2">Aucun résultat.</div>
            )}
          </div>

          {/* Participants (sans les "invited_*") */}
          <div className="border rounded-lg p-3">
            <div className="font-medium mb-2">Participants</div>
            {participantsForRender.length === 0 ? (
              <div className="text-sm text-gray-500">Aucun participant.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {participantsForRender.map((sid) => {
                  const ent = participantsMap?.[sid] || {};
                  const isVirtualIndividual = singleStudentId === sid && !(participantIds || []).includes(sid);
                  const st = isVirtualIndividual ? 'confirmed' : (ent.status || 'pending');
                  const paid = isVirtualIndividual ? !!lesson?.is_paid : !!ent.is_paid;

                  return (
                    <Chip
                      key={`pt:${sid}`}
                      onRemove={isVirtualIndividual ? undefined : () => removeStudent(sid)}
                      title={`Statut : ${statusLabel(st)}`}
                    >
                      {nameMap[sid] || sid}
                      {' · '}
                      <span className="text-gray-700">{statusLabel(st)}</span>
                      {(st === 'accepted' || st === 'confirmed') && (
                        <>
                          {' · '}
                          <span className={paid ? 'text-green-700' : 'text-amber-700'}>
                            {paid ? '€ payé' : '€ à payer'}
                          </span>
                        </>
                      )}
                    </Chip>
                  );
                })}
              </div>
            )}
          </div>

          {/* Invitations envoyées */}
          <div className="border rounded-lg p-3">
            <div className="font-medium mb-2">Invitations envoyées</div>
            {(() => {
              const invitedIds = Array.from(
                new Set(
                  (participantIds || []).filter(
                    (sid) => {
                      const st = participantsMap?.[sid]?.status;
                      return st === 'invited_student' || st === 'invited_parent';
                    }
                  )
                )
              );
              return invitedIds.length === 0 ? (
                <div className="text-sm text-gray-500">Aucune invitation en cours.</div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {invitedIds.map((sid) => (
                    <Chip key={`inv:${sid}`} onRemove={() => removeStudent(sid)}>
                      {nameMap[sid] || sid} · <span className="text-indigo-700">invité</span>
                    </Chip>
                  ))}
                </div>
              );
            })()}
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