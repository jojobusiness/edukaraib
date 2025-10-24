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

const SITE_FEE_EUR = 10; // montant ajouté au prix prof pour l'affichage & le total

const fmtDateTime = (start_datetime, slot_day, slot_hour) => {
  if (start_datetime?.toDate) { try { return start_datetime.toDate().toLocaleString('fr-FR'); } catch {} }
  if (typeof start_datetime?.seconds === 'number') return new Date(start_datetime.seconds * 1000).toLocaleString('fr-FR');
  if (slot_day && (slot_hour || slot_hour === 0)) return `${slot_day} • ${String(slot_hour).padStart(2, '0')}:00`;
  return '—';
};
const toNumber = (v) => { const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v); return Number.isFinite(n) ? n : 0; };
const getBaseAmount = (l) =>
  toNumber(l.total_amount) || toNumber(l.total_price) || toNumber(l.amount_paid) || toNumber(l.amount) || toNumber(l.price_per_hour);
const getDisplayAmount = (l) => {
  const base = getBaseAmount(l);
  return (Number.isFinite(base) ? base : 0) + SITE_FEE_EUR;
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

// éligible au paiement pour l’enfant/parent concerné
const isEligibleForChildPayment = (lesson, childId) => {
  if (!childId || !lesson) return false;
  if (lesson.is_group) {
    const st = lesson?.participantsMap?.[childId]?.status;
    return st === 'accepted' || st === 'confirmed';
  }
  return (lesson.status === 'confirmed' || lesson.status === 'completed') && lesson.student_id === childId;
};

export default function ParentPayments() {
  const [toPay, setToPay] = useState([]);   // [{ lesson, forStudent, teacherName, childName }]
  const [paid, setPaid] = useState([]);
  const [loading, setLoading] = useState(true);

  // clés d’action par ligne
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

      // IDs suivis = enfants + le parent lui-même (✅ pour voir ses propres paiements)
      const childIds = [user.uid];
      kids.forEach((k) => {
        childIds.push(k.id);
        if (k.user_id) childIds.push(k.user_id);
        if (k.uid) childIds.push(k.uid);
      });

      // 2) Abonnements live → legacy student_id IN (par lot) + groupes array-contains (par id suivi)
      const chunks = []; for (let i = 0; i < childIds.length; i += 10) chunks.push(childIds.slice(i, i + 10));
      let combined = new Map();
      const parentUid = user.uid;

      const rebuildRows = async () => {
        const lessons = Array.from(combined.values());
        const rows = [];

        for (const l of lessons) {
          // IDs (enfants + parent) présents dans cette leçon
          const presentIds = new Set();
          if (l.student_id && childIds.includes(l.student_id)) presentIds.add(l.student_id);
          if (Array.isArray(l.participant_ids)) {
            l.participant_ids.forEach((id) => { if (childIds.includes(id)) presentIds.add(id); });
          }
          // Une ligne PAR id présent
          for (const sid of presentIds) {
            const [teacherName, childNameResolved] = await Promise.all([
              teacherNameOf(l.teacher_id),
              // Affichage “Moi (parent)” pour le parent
              sid === parentUid ? Promise.resolve('Moi (parent)') : childNameOf(sid),
            ]);
            rows.push({ lesson: l, forStudent: sid, teacherName, childName: childNameResolved });
          }
        }

        const notPendingTeacher = (r) => r.lesson.status !== 'pending_teacher';

        const unpaid = rows.filter((r) =>
          isEligibleForChildPayment(r.lesson, r.forStudent) &&
          !isPaidForStudent(r.lesson, r.forStudent) &&
          notPendingTeacher(r)
        );

        const paidEligible = rows.filter((r) =>
          isPaidForStudent(r.lesson, r.forStudent) &&
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
      // Groupes: array-contains par id suivi (enfants + parent)
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
    const sum = (arr) => arr.reduce((acc, r) => acc + getDisplayAmount(r.lesson), 0);
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
        body: JSON.stringify({ lessonId: row.lesson.id, forStudent: row.forStudent }),
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

  // --- Résolution du paymentId (payments) pour rembourser ---
  const resolvePaymentId = async (lessonId, forStudent) => {
    try {
      // On récupère le plus récent paiement non remboursé pour cet élève/parent et cette leçon
      let qBase = query(
        collection(db, 'payments'),
        where('lesson_id', '==', String(lessonId)),
        where('for_student', '==', String(forStudent)),
        where('status', 'in', ['held', 'released'])
      );
      // si les règles ne permettent pas 'in', on peut faire 2 requêtes (held puis released)

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
                          {getDisplayAmount(r.lesson) ? `${getDisplayAmount(r.lesson).toFixed(2)} €` : ''}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500">Professeur : {r.teacherName || r.lesson.teacher_id}</div>
                      <div className="text-xs text-gray-500">
                        {r.forStudent === auth.currentUser?.uid ? 'Parent' : 'Enfant'} : {r.childName || r.forStudent}
                      </div>
                      <div className="text-xs text-gray-500">📅 {fmtDateTime(r.lesson.start_datetime, r.lesson.slot_day, r.lesson.slot_hour)}</div>
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
                      <span className="text-xs text-gray-600">Prof : {r.teacherName || r.lesson.teacher_id}</span>
                      <span className="text-green-600 text-xs font-semibold md:ml-auto">Payé</span>
                    </div>

                    {/* Bouton remboursement */}
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