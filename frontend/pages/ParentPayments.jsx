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
} from 'firebase/firestore';
import DashboardLayout from '../components/DashboardLayout';
import fetchWithAuth from '../utils/fetchWithAuth';

const SITE_FEE_EUR = 10; // +10 € frais plateforme (affichage & totaux)

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

// confirmé POUR L’ENFANT concerné :
// - individuel => lesson.status === 'confirmed'
// - groupé     => status du participant ∈ {accepted, confirmed}
const isConfirmedForChild = (lesson, childId) => {
  if (!childId || !lesson) return false;
  if (lesson.is_group) {
    const st = lesson?.participantsMap?.[childId]?.status;
    return st === 'accepted' || st === 'confirmed';
  }
  return lesson.status === 'confirmed' && lesson.student_id === childId;
};

export default function ParentPayments() {
  const [toPay, setToPay] = useState([]);   // [{ lesson, forStudent, teacherName, childName }]
  const [paid, setPaid] = useState([]);
  const [loading, setLoading] = useState(true);

  // ✅ clé par (leçon, enfant) — évite le bug sur groupes simultanés
  const [payingKey, setPayingKey] = useState(null);

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
      const childIds = [];
      kids.forEach((k) => {
        childIds.push(k.id);
        if (k.user_id) childIds.push(k.user_id);
        if (k.uid) childIds.push(k.uid);
      });

      if (childIds.length === 0) {
        setToPay([]); setPaid([]); setLoading(false);
        return;
      }

      // 2) Abonnements live → legacy student_id IN (par lot) + groupes array-contains (par enfant)
      const chunks = []; for (let i = 0; i < childIds.length; i += 10) chunks.push(childIds.slice(i, i + 10));
      let combined = new Map();

      const rebuildRows = async () => {
        const lessons = Array.from(combined.values());
        const rows = [];

        for (const l of lessons) {
          // IDs des enfants de CE parent dans cette leçon
          const presentIds = new Set();
          if (l.student_id && childIds.includes(l.student_id)) presentIds.add(l.student_id);
          if (Array.isArray(l.participant_ids)) {
            l.participant_ids.forEach((id) => { if (childIds.includes(id)) presentIds.add(id); });
          }
          // Une ligne PAR enfant présent
          for (const sid of presentIds) {
            const [teacherName, childName] = await Promise.all([
              teacherNameOf(l.teacher_id),
              childNameOf(sid),
            ]);
            rows.push({ lesson: l, forStudent: sid, teacherName, childName });
          }
        }

        const notPendingTeacher = (r) => r.lesson.status !== 'pending_teacher';

        // À régler : confirmé pour l'enfant (inclut groupe accepté/confirmé), non payé, pas pending_teacher
        const unpaid = rows.filter((r) =>
          isConfirmedForChild(r.lesson, r.forStudent) &&
          !isPaidForStudent(r.lesson, r.forStudent) &&
          notPendingTeacher(r)
        );

        // Payé : payé pour l'enfant, pas pending_teacher
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
      // Groupes: array-contains par enfant
      childIds.forEach((cid) => {
        const qGroup = query(collection(db, 'lessons'), where('participant_ids', 'array-contains', cid));
        const unsub = onSnapshot(qGroup, (snap) => {
          snap.docs.forEach((d) => combined.set(d.id, { id: d.id, ...d.data() }));
          rebuildRows();
        }, (e) => { console.error(e); setLoading(false); });
        unsubscribers.push(unsub);
      });
    })();

    // 🔁 cleanup des subscriptions
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
          <div className="text-[11px] text-gray-500 mb-3">Le montant affiché inclut <strong>10 € de frais plateforme</strong>.</div>

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
                      <div className="text-xs text-gray-500">Enfant : {r.childName || r.forStudent}</div>
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
                    className="border rounded-lg px-4 py-2 flex flex-col md:flex-row md:items-center gap-2 bg-gray-50"
                  >
                    <span className="font-bold text-primary">{r.lesson.subject_id || 'Matière'}</span>
                    <span className="text-xs text-gray-600">{fmtDateTime(r.lesson.start_datetime, r.lesson.slot_day, r.lesson.slot_hour)}</span>
                    <span className="text-xs text-gray-600">Enfant : {r.childName || r.forStudent}</span>
                    <span className="text-xs text-gray-600">Prof : {r.teacherName || r.lesson.teacher_id}</span>
                    <span className="text-green-600 text-xs font-semibold md:ml-auto">Payé</span>
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