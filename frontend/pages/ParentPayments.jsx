import React, { useEffect, useMemo, useRef, useState } from 'react';
import { auth, db } from '../lib/firebase';
import {
  collection,
  getDocs,
  onSnapshot,
  query,
  where,
  doc,
  getDoc,
  orderBy,
  limit,
} from 'firebase/firestore';
import DashboardLayout from '../components/DashboardLayout';
import fetchWithAuth from '../utils/fetchWithAuth';

// Convertit slot_day + slot_hour + date/start_datetime en objet Date complet
const buildStartDate = (lesson) => {
  const hour = Number(lesson.slot_hour ?? 0);

  // 1) Prend start_datetime Firestore si présent
  const ts = lesson.start_datetime || lesson.startAt;
  if (ts?.toDate) {
    const d = ts.toDate();
    d.setHours(hour, 0, 0, 0);
    return d;
  }
  if (typeof ts?.seconds === 'number') {
    const d = new Date(ts.seconds * 1000);
    d.setHours(hour, 0, 0, 0);
    return d;
  }

  // 2) Prend la date "YYYY-MM-DD" (pour semaines futures)
  if (lesson.date) {
    const d = new Date(`${lesson.date}T00:00:00`);
    d.setHours(hour, 0, 0, 0);
    return d;
  }

  return null;
};

// Format final : "📅 Lun 24/11 • 10:00"
const formatFullDate = (lesson) => {
  const d = buildStartDate(lesson);
  if (!d) return '—';

  const weekday = d
    .toLocaleDateString('fr-FR', { weekday: 'short' })
    .replace('.', ''); // lun → lun

  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const time = d.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return `📅 ${weekday} ${day}/${month} • ${time}`;
};

const fmtDateTime = (start_datetime, slot_day, slot_hour) => {
  if (start_datetime?.toDate) { try { return start_datetime.toDate().toLocaleString('fr-FR'); } catch {} }
  if (typeof start_datetime?.seconds === 'number') return new Date(start_datetime.seconds * 1000).toLocaleString('fr-FR');
  if (slot_day && (slot_hour || slot_hour === 0)) return `${slot_day} • ${String(slot_hour).padStart(2, '0')}:00`;
  return '—';
};

const isPaidForStudent = (lesson, studentId) => {
  if (!lesson) return false;
  if (lesson.participantsMap && studentId) {
    const ent = lesson.participantsMap[studentId];
    if (ent && ent.is_paid === true) return true;
  }
  if (lesson.student_id === studentId && lesson.is_paid === true) return true;
  return false;
};

// --- le prof doit avoir validé (pas "pending_teacher"/"booked"/"pending")
const notPendingTeacher = (row) => {
  const l = row?.lesson;
  const sid = row?.forStudent;
  if (!l) return false;

  if (l.is_group) {
    const st = l?.participantsMap?.[sid]?.status || '';
    return !['pending_teacher', 'requested', 'pending', 'booked'].includes(String(st));
  }

  const st = String(l.status || '');
  return !['pending_teacher', 'requested', 'pending', 'booked'].includes(st);
};

// --- Helpers d'étiquette ---
const lessonMode = (l) => (String(l.mode) === 'visio' || l.is_visio === true ? 'visio' : 'presentiel');
const labelMode = (l) => (lessonMode(l) === 'visio' ? 'Visio' : 'Présentiel');
const detectSource = (l) => {
  const modeLabel = labelMode(l);
  const packType = String(l.pack_type || l.booking_kind || l.type || '').toLowerCase();
  if (packType === 'pack5' || String(l.pack_hours) === '5' || l.is_pack5 === true) return `Pack 5h · ${modeLabel}`;
  if (packType === 'pack10' || String(l.pack_hours) === '10' || l.is_pack10 === true) return `Pack 10h · ${modeLabel}`;
  return modeLabel;
};

// ==== Helpers par élève (participant) ====
const entryFor = (l, sid) => l?.participantsMap?.[sid] || null;

const packHoursFor = (l, sid) => {
  const e = entryFor(l, sid);
  if (!e) return 1;
  if (e.is_pack10 === true || String(e.pack?.hours) === '10') return 10;
  if (e.is_pack5 === true  || String(e.pack?.hours) === '5')  return 5;
  if (String(e.pack_hours) === '10') return 10;
  if (String(e.pack_hours) === '5')  return 5;
  return 1;
};

const detectSourceFor = (l, sid) => {
  if (isPackForChild(l, sid)) {
    return packHoursFor(l, sid) === 10
      ? 'Pack 10h · ' + (String(l.mode)==='visio'||l.is_visio?'Visio':'Présentiel')
      : 'Pack 5h · '   + (String(l.mode)==='visio'||l.is_visio?'Visio':'Présentiel');
  }
  return (String(l.mode) === 'visio' || l.is_visio === true) ? 'Visio' : 'Présentiel';
};

// == Helpers pack/étiquettes par ENFANT ==
const entryForChild = (l, sid) => l?.participantsMap?.[sid] || null;

const isFreeHourForChild = (l, sid) => {
  if (!l) return false;
  if (l.is_free_hour) return true;
  if (sid && l?.participantsMap?.[sid]?.is_free_hour) return true;
  return false;
};

const isPackForChild = (l, sid) => {
  const e = entryForChild(l, sid);
  return !!e && (
    e.is_pack5 === true || e.is_pack10 === true ||
    String(e.pack_hours) === '5' || String(e.pack_hours) === '10' ||
    (e.pack?.enabled === true)
  );
};

const packHoursForChild = (l, sid) => {
  const e = entryForChild(l, sid);
  if (!e) return 1;
  if (e.is_pack10 === true || String(e.pack_hours) === '10' || String(e.pack?.hours) === '10') return 10;
  if (e.is_pack5 === true  || String(e.pack_hours) === '5'  || String(e.pack?.hours) === '5')  return 5;
  return 1;
};

const packKeyForChild = (l, sid) => {
  if (!isPackForChild(l, sid)) return `lesson:${l.id}:${sid}`;
  const hours = packHoursForChild(l, sid);
  const mode  = (String(l.mode) === 'visio' || l.is_visio) ? 'visio' : 'presentiel';
  return `STABLE:${l.teacher_id}|${sid}|${mode}|${hours}`;
};

const isEligibleForChildPayment = (lesson, sid) => {
  if (isFreeHourForChild(lesson, sid)) return false;
  if (lesson?.is_group) {
    const st = lesson?.participantsMap?.[sid]?.status;
    return st === 'accepted' || st === 'confirmed';
  }
  return ['confirmed','completed','scheduled'].includes(lesson?.status);
};

// affichage montant PAR ENFANT (applique -10% pack + frais plateforme)
const toNumber = (v) => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const getDisplayAmountForChild = (l, childId) => {
  if (isFreeHourForChild(l, childId)) return 0;
  const isVisio = String(l.mode) === 'visio' || l.is_visio === true;
  const baseRate = isVisio && l.visio_enabled && l.visio_same_rate === false
    ? toNumber(l.visio_price_per_hour)
    : toNumber(l.price_per_hour);

  const hours = packHoursForChild(l, childId) > 1
    ? packHoursForChild(l, childId)
    : (Number(l.duration_hours) > 0 ? Math.floor(Number(l.duration_hours)) : 1);

  const isPack = isPackForChild(l, childId);
  const base = isPack ? Number((baseRate * hours * 0.9).toFixed(2))
                      : (toNumber(l.total_amount) || toNumber(l.total_price) || toNumber(l.amount) || baseRate);

  const fee = hours * 10; // 10€ / h
  return (base || 0) + fee;
};

// --- Helpers paiements pack (par PARTICIPANT) ---
const pmFor = (lesson, uid) => {
  const pm = lesson?.participantsMap || {};
  if (Array.isArray(lesson?.participant_ids)) return pm?.[uid] || null;        // groupe
  if (lesson?.student_id && String(lesson.student_id) === String(uid)) {
    return pm?.[uid] || { is_paid: !!lesson.is_paid, status: lesson.status };
  }
  return pm?.[uid] || null;
};

export default function ParentPayments() {
  const [toPay, setToPay] = useState([]);   // [{ lesson, forStudent, teacherName, childName, __slots? }]
  const [paid, setPaid] = useState([]);
  const [loading, setLoading] = useState(true);

  const [payingKey, setPayingKey] = useState(null);
  const [refundingKey, setRefundingKey] = useState(null);

  const teacherCacheRef = useRef(new Map());
  const childNameCacheRef = useRef(new Map());

  const teacherNameOf = async (uid) => {
    if (!uid) return 'Professeur';
    const cache = teacherCacheRef.current;
    if (cache.has(uid)) return cache.get(uid);
    try {
      const s = await getDoc(doc(db, 'users', uid));
      let name = uid;
      if (s.exists()) {
        const d = s.data();
        name = d.fullName || d.name || d.displayName || uid;
      }
      cache.set(uid, name);
      return name;
    } catch { return uid; }
  };
  const childNameOf = async (idOrUid) => {
    if (!idOrUid) return 'Enfant';
    const cache = childNameCacheRef.current;
    if (cache.has(idOrUid)) return cache.get(idOrUid);
    try {
      const s = await getDoc(doc(db, 'students', idOrUid));
      if (s.exists()) {
        const d = s.data(); const nm = d.full_name || d.name || idOrUid;
        cache.set(idOrUid, nm); return nm;
      }
    } catch {}
    try {
      const s = await getDoc(doc(db, 'users', idOrUid));
      if (s.exists()) {
        const d = s.data(); const nm = d.fullName || d.name || d.displayName || idOrUid;
        cache.set(idOrUid, nm); return nm;
      }
    } catch {}
    cache.set(idOrUid, idOrUid);
    return idOrUid;
  };

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) { setLoading(false); return; }
    setLoading(true);

    let unsubscribers = [];

    (async () => {
      // 1) Enfants du parent
      const kidsSnap = await getDocs(query(collection(db, 'students'), where('parent_id', '==', user.uid)));
      const kids = kidsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      // IDs suivis = enfants + le parent lui-même
      const childIds = Array.from(
        new Set(
          [user.uid, ...kids.flatMap(k => [k.id, k.user_id, k.uid])]
            .filter(Boolean)
            .map(String)
        )
      );

      // 2) Abonnements live
      const chunks = []; for (let i = 0; i < childIds.length; i += 10) chunks.push(childIds.slice(i, i + 10));
      let combined = new Map();
      const parentUid = user.uid;

      const rebuildRows = async () => {
        const lessons = Array.from(combined.values());
        const rows = [];

        // -- Construire d'abord rows --
        for (const l of lessons) {
          const presentIds = new Set();
          if (l.student_id && childIds.includes(String(l.student_id))) presentIds.add(String(l.student_id));
          if (Array.isArray(l.participant_ids)) {
            l.participant_ids.forEach((id) => {
              const sid = String(id);
              if (childIds.includes(sid)) presentIds.add(sid);
            });
          }
          for (const sid of presentIds) {
            const [teacherName, childNameResolved] = await Promise.all([
              teacherNameOf(l.teacher_id),
              sid === parentUid ? Promise.resolve('Moi (parent)') : childNameOf(sid),
            ]);
            rows.push({ lesson: l, forStudent: sid, teacherName, childName: childNameResolved });
          }
        }

        // -- Ensuite, construire la map des créneaux PAR pack/enfant --
        const slotsByKey = new Map();
        for (const r of rows) {
          const key = packKeyForChild(r.lesson, r.forStudent);
          if (!slotsByKey.has(key)) slotsByKey.set(key, []);

          const d = buildStartDate(r.lesson);
          if (!d) continue;

          slotsByKey.get(key).push({
            ts: d.getTime(),
            label: formatFullDate(r.lesson),
            isGift: isFreeHourForChild(r.lesson, r.forStudent),
          });
        }
        // (optionnel) dédoublonner + tri
        for (const [k, arr] of slotsByKey) {
          // dédoublonnage par timestamp + tri
          const map = new Map();
          arr.forEach((x) => map.set(x.ts, x));
          const uniq = Array.from(map.values()).sort((a, b) => a.ts - b.ts);
          slotsByKey.set(k, uniq);
        }

        // --- Regroupement pack : 1 bloc pack par enfant ---
        const groupMap = new Map();
        for (const r of rows) {
          const key = packKeyForChild(r.lesson, r.forStudent);
          const isPack = isPackForChild(r.lesson, r.forStudent);
          if (!groupMap.has(key)) {
            groupMap.set(key, { ...r, __groupCount: isPack ? 1 : 0, __slots: slotsByKey.get(key) || [] });
          } else if (isPack) {
            const rep = groupMap.get(key);
            rep.__groupCount += 1;
            groupMap.set(key, rep);
          }
        }
        const groupedRows = Array.from(groupMap.values());

        const paidEligible = groupedRows.filter(r => isPaidForStudent(r.lesson, r.forStudent));

        const unpaid = groupedRows.filter(r =>
          isEligibleForChildPayment(r.lesson, r.forStudent) &&
          !isPaidForStudent(r.lesson, r.forStudent) &&
          notPendingTeacher(r)
        );

        const getTs = (r) =>
          (r.lesson.start_datetime?.toDate?.() && r.lesson.start_datetime.toDate().getTime()) ||
          (r.lesson.start_datetime?.seconds && r.lesson.start_datetime.seconds * 1000) || 0;

        setToPay(unpaid.sort((a, b) => getTs(a) - getTs(b)));
        setPaid(paidEligible.sort((a, b) => getTs(b) - getTs(a)));
        setLoading(false);
      };

      // Legacy: student_id IN
      for (const c of chunks) {
        const qLegacy = query(collection(db, 'lessons'), where('student_id', 'in', c));
        const unsub = onSnapshot(qLegacy, (snap) => {
          snap.docs.forEach((d) => combined.set(d.id, { id: d.id, ...d.data() }));
          rebuildRows();
        }, (e) => { console.error(e); setLoading(false); });
        unsubscribers.push(unsub);
      }
      // Groupes: array-contains
      childIds.forEach((cid) => {
        const qGroup = query(collection(db, 'lessons'), where('participant_ids', 'array-contains', cid));
        const unsub = onSnapshot(qGroup, (snap) => {
          snap.docs.forEach((d) => combined.set(d.id, { id: d.id, ...d.data() }));
          rebuildRows();
        }, (e) => { console.error(e); setLoading(false); });
        unsubscribers.push(unsub);
      });
    })();

    return () => {
      unsubscribers.forEach((u) => u && u());
    };
  }, []);

  const totals = useMemo(() => {
    const sum = (arr) =>
      arr.reduce((acc, r) => acc + getDisplayAmountForChild(r.lesson, r.forStudent), 0);
    return { due: sum(toPay), paid: sum(paid) };
  }, [toPay, paid]);

  const handlePay = async (row) => {
    const key = `${row.lesson.id}:${row.forStudent}`;
    try {
      setPayingKey(key);

      const diag = await fetchWithAuth('/api/pay/diag', {
        method: 'POST',
        body: JSON.stringify({ lessonId: row.lesson.id, forStudent: row.forStudent }),
      });
      if (!diag?.ok) {
        alert('Diagnostic paiement : ' + (diag?.error || 'inconnu'));
        setPayingKey(null);
        return;
      }

      const data = await fetchWithAuth('/api/pay/create-checkout-session', {
        method: 'POST',
        body: JSON.stringify({
          lessonId: row.lesson.id,
          forStudent: row.forStudent,
          packKey: isPackForChild(row.lesson, row.forStudent)
            ? packKeyForChild(row.lesson, row.forStudent)
            : null,
        }),
      });

      if (!data?.url) throw new Error('Lien de paiement introuvable.');
      window.location.href = data.url;
    } catch (e) {
      console.error(e);
      alert(e.message || 'Impossible de démarrer le paiement.');
    } finally {
      setPayingKey(null);
    }
  };

  // --- Remboursement ---
  const resolvePaymentId = async (lessonId, forStudent) => {
    try {
      let qBase = query(
        collection(db, 'payments'),
        where('lesson_id', '==', String(lessonId)),
        where('for_student', '==', String(forStudent)),
        where('status', 'in', ['held', 'released'])
      );
      qBase = query(qBase, orderBy('created_at', 'desc'), limit(1));
      const snap = await getDocs(qBase);
      if (!snap.empty) return snap.docs[0].id;

      return null;
    } catch (e) {
      console.error('resolvePaymentId error', e);
      return null;
    }
  };

  const handleRefund = async (row) => {
    const key = `${row.lesson.id}:${row.forStudent}`;
    try {
      setRefundingKey(key);
      const paymentId = await resolvePaymentId(row.lesson.id, row.forStudent);
      if (!paymentId) {
        alert("Impossible de retrouver le paiement pour ce cours.");
        return;
      }

      const resp = await fetchWithAuth('/api/refund', {
        method: 'POST',
        body: JSON.stringify({ paymentId }),
      });
      if (!resp || resp.error) {
        throw new Error(resp?.error || 'Échec du remboursement');
      }
      alert('Demande de remboursement envoyée.');
    } catch (e) {
      console.error(e);
      alert(e.message || 'Remboursement impossible.');
    } finally {
      setRefundingKey(null);
    }
  };

  return (
    <DashboardLayout role="parent">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold text-primary mb-6">💳 Paiements (Parent)</h2>

        {/* À régler */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-bold text-secondary">Paiements à effectuer</h3>
            {!loading && <span className="text-xs text-gray-600">Total à régler : {totals.due.toFixed(2)} €</span>}
          </div>

          {loading ? (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Chargement…</div>
          ) : toPay.length === 0 ? (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Aucun paiement en attente !</div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {toPay.map((r) => {
                const rowKey = `${r.lesson.id}:${r.forStudent}`;
                return (
                  <div
                    key={rowKey}
                    className="bg-white p-5 rounded-xl shadow border flex flex-col md:flex-row md:items-center gap-4 justify-between"
                  >
                    <div>
                      <div className="font-bold text-primary">
                        {r.lesson.subject_id || 'Matière'}{' '}
                        <span className="text-gray-600 text-xs ml-2">
                          {getDisplayAmountForChild(r.lesson, r.forStudent)
                            ? `${getDisplayAmountForChild(r.lesson, r.forStudent).toFixed(2)} €`
                            : ''}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500">Professeur : {r.teacherName || r.lesson.teacher_id}</div>
                      <div className="text-xs text-gray-500">
                        {r.forStudent === auth.currentUser?.uid ? 'Parent' : 'Enfant'} : {r.childName || r.forStudent}
                      </div>
                      <div className="text-xs text-gray-500">Type : {detectSourceFor(r.lesson, r.forStudent)}</div>
                      
                      {isPackForChild(r.lesson, r.forStudent) ? (
                        r.__slots?.length > 0 && (
                          <div className="text-xs text-gray-600 mt-1">
                            <div className="text-xs text-gray-600 mt-1">
                              Horaires du pack :
                              <ul className="ml-2 mt-1 space-y-1">
                                {(r.__slots || []).map((x) => (
                                  <li key={x.ts}>
                                    {x.isGift ? '🎁 ' : ''}{x.label}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        )
                      ) : (
                        <div className="text-xs text-gray-500">
                          {formatFullDate(r.lesson)}
                        </div>
                      )}
                    </div>

                    <button
                      className="bg-green-600 hover:bg-green-700 text-white px-5 py-2 rounded font-semibold shadow disabled:opacity-60"
                      onClick={() => handlePay(r)}
                      disabled={payingKey === rowKey}
                      aria-busy={payingKey === rowKey}
                    >
                      {payingKey === rowKey ? 'Redirection…' : 'Payer maintenant'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Historique */}
        <div className="bg-white p-6 rounded-xl shadow border">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-primary">Historique des paiements</h3>
            {!loading && <span className="text-xs text-gray-600">Total payé : {totals.paid.toFixed(2)} €</span>}
          </div>

          {loading ? (
            <div className="text-gray-500">Chargement…</div>
          ) : paid.length === 0 ? (
            <div className="text-gray-400 text-sm">Aucun paiement effectué.</div>
          ) : (
            <div className="flex flex-col gap-3">
              {paid.map((r) => {
                const rowKey = `${r.lesson.id}:${r.forStudent}`;
                return (
                  <div
                    key={rowKey}
                    className="border rounded-lg px-4 py-3 flex flex-col gap-2 bg-gray-50"
                  >
                    <div className="flex flex-col md:flex-row md:items-center gap-2">
                      <span className="font-bold text-primary">{r.lesson.subject_id || 'Matière'}</span>
                      <span className="text-xs text-gray-600">{fmtDateTime(r.lesson.start_datetime, r.lesson.slot_day, r.lesson.slot_hour)}</span>
                      <span className="text-xs text-gray-600">
                        {r.forStudent === auth.currentUser?.uid ? 'Parent' : 'Enfant'} : {r.childName || r.forStudent}
                      </span>
                      <span className="text-xs text-gray-600">Type : {detectSource(r.lesson)}</span>
                      <span className="text-xs text-gray-600">Prof : {r.teacherName || r.lesson.teacher_id}</span>
                      <span className="text-green-600 text-xs font-semibold md:ml-auto">Payé</span>
                    </div>

                    <div className="flex justify-end">
                      <button
                        className="text-sm px-3 py-1.5 rounded border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-60"
                        onClick={() => handleRefund(r)}
                        disabled={refundingKey === rowKey}
                      >
                        {refundingKey === rowKey ? 'Demande en cours…' : 'Demander un remboursement'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}