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

// ----- helpers -----
const fmtDateTime = (start_datetime, slot_day, slot_hour) => {
  if (start_datetime?.toDate) {
    try { return start_datetime.toDate().toLocaleString('fr-FR'); } catch {}
  }
  if (typeof start_datetime?.seconds === 'number') {
    return new Date(start_datetime.seconds * 1000).toLocaleString('fr-FR');
  }
  if (slot_day && (slot_hour || slot_hour === 0)) {
    return `${slot_day} • ${String(slot_hour).padStart(2, '0')}:00`;
  }
  return '—';
};

const toNumber = (v) => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const getAmount = (l) =>
  toNumber(l.total_amount) ||
  toNumber(l.total_price) ||
  toNumber(l.amount_paid) ||
  toNumber(l.amount) ||
  toNumber(l.price_per_hour);

// payé pour un enfant donné
const isPaidForStudent = (lesson, studentId) => {
  if (!lesson) return false;
  if (lesson.participantsMap && studentId) {
    const ent = lesson.participantsMap[studentId];
    if (ent && ent.is_paid === true) return true;
  }
  if (lesson.student_id === studentId && lesson.is_paid === true) return true;
  return false;
};

// ----- page -----
export default function ParentPayments() {
  const [toPay, setToPay] = useState([]);   // { lesson, forStudent, teacherName, childName }
  const [paid, setPaid] = useState([]);
  const [loading, setLoading] = useState(true);
  const [payingId, setPayingId] = useState(null);

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

    // students/{id}
    try {
      const s = await getDoc(doc(db, 'students', idOrUid));
      if (s.exists()) {
        const d = s.data();
        const nm = d.full_name || d.name || idOrUid;
        cache.set(idOrUid, nm);
        return nm;
      }
    } catch {}
    // users/{uid}
    try {
      const s = await getDoc(doc(db, 'users', idOrUid));
      if (s.exists()) {
        const d = s.data();
        const nm = d.fullName || d.name || d.displayName || idOrUid;
        cache.set(idOrUid, nm);
        return nm;
      }
    } catch {}
    cache.set(idOrUid, idOrUid);
    return idOrUid;
  };

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) { setLoading(false); return; }
    setLoading(true);

    // 1) Récupère les enfants de ce parent
    (async () => {
      const kidsSnap = await getDocs(
        query(collection(db, 'students'), where('parent_id', '==', user.uid))
      );
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

      // 2) Abonnements : (a) legacy student_id IN chunk(s)
      const chunks = [];
      for (let i = 0; i < childIds.length; i += 10) chunks.push(childIds.slice(i, i + 10));

      let combined = new Map();

      const buildAndRender = async () => {
        // transforme en lignes spécifiques parent (identifier l'enfant concerné)
        const raw = Array.from(combined.values());

        const rows = [];
        for (const l of raw) {
          // trouve l'enfant de CE parent sur cette leçon
          let childForThisParent = null;

          if (Array.isArray(l.participant_ids) && l.participant_ids.length) {
            // le premier enfant de ce parent présent dans la liste
            childForThisParent = l.participant_ids.find((id) => childIds.includes(id)) || null;
          } else if (l.student_id && childIds.includes(l.student_id)) {
            childForThisParent = l.student_id;
          }

          if (!childForThisParent) continue;

          const [teacherName, childName] = await Promise.all([
            teacherNameOf(l.teacher_id),
            childNameOf(childForThisParent),
          ]);

          rows.push({
            lesson: l,
            forStudent: childForThisParent,
            teacherName,
            childName,
          });
        }

        // Filtrer “confirmés”
        const confirmed = rows.filter((r) => r.lesson.status === 'confirmed');

        const unpaid = confirmed.filter((r) => !isPaidForStudent(r.lesson, r.forStudent));
        const alreadyPaid = rows.filter((r) => isPaidForStudent(r.lesson, r.forStudent));

        // Tri par date décroissante
        const getTs = (l) =>
          (l.start_datetime?.toDate?.() && l.start_datetime.toDate().getTime()) ||
          (l.start_datetime?.seconds && l.start_datetime.seconds * 1000) || 0;

        setToPay(unpaid.sort((a, b) => getTs(a.lesson) - getTs(b.lesson)));
        setPaid(alreadyPaid.sort((a, b) => getTs(b.lesson) - getTs(a.lesson)));
        setLoading(false);
      };

      // (a) legacy
      const unsubs = [];
      for (const c of chunks) {
        const qLegacy = query(collection(db, 'lessons'), where('student_id', 'in', c));
        unsubs.push(onSnapshot(qLegacy, (snap) => {
          snap.docs.forEach((d) => combined.set(d.id, { id: d.id, ...d.data() }));
          buildAndRender();
        }, (e) => { console.error(e); setLoading(false); }));
      }

      // (b) groupe : participant_ids array-contains (1 q par enfant)
      childIds.forEach((cid) => {
        const qGroup = query(collection(db, 'lessons'), where('participant_ids', 'array-contains', cid));
        unsubs.push(onSnapshot(qGroup, (snap) => {
          snap.docs.forEach((d) => combined.set(d.id, { id: d.id, ...d.data() }));
          buildAndRender();
        }, (e) => { console.error(e); setLoading(false); }));
      });

      // cleanup
      return () => unsubs.forEach((u) => u && u());
    })();
  }, []);

  const totals = useMemo(() => {
    const sum = (arr) => arr.reduce((acc, r) => acc + getAmount(r.lesson), 0);
    return { due: sum(toPay), paid: sum(paid) };
  }, [toPay, paid]);

  const handlePay = async (row) => {
    try {
      setPayingId(row.lesson.id);

      // diagnostic
      const diag = await fetchWithAuth('/api/pay/diag', {
        method: 'POST',
        body: JSON.stringify({ lessonId: row.lesson.id, forStudent: row.forStudent }),
      });
      if (!diag?.ok) {
        alert('Diagnostic paiement : ' + (diag?.error || 'inconnu'));
        setPayingId(null);
        return;
      }

      // session Stripe
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
      setPayingId(null);
    }
  };

  return (
    <DashboardLayout role="parent">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold text-primary mb-6">💳 Paiements (Parent)</h2>

        {/* À régler */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-secondary">Paiements à effectuer</h3>
            {!loading && (
              <span className="text-xs text-gray-600">Total à régler : {totals.due.toFixed(2)} €</span>
            )}
          </div>

          {loading ? (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Chargement…</div>
          ) : toPay.length === 0 ? (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Aucun paiement en attente !</div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {toPay.map((r) => (
                <div
                  key={`${r.lesson.id}:${r.forStudent}`}
                  className="bg-white p-5 rounded-xl shadow border flex flex-col md:flex-row md:items-center gap-4 justify-between"
                >
                  <div>
                    <div className="font-bold text-primary">
                      {r.lesson.subject_id || 'Matière'}{' '}
                      <span className="text-gray-600 text-xs ml-2">
                        {getAmount(r.lesson) ? `${getAmount(r.lesson).toFixed(2)} €` : ''}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500">Professeur : {r.teacherName || r.lesson.teacher_id}</div>
                    <div className="text-xs text-gray-500">Enfant : {r.childName || r.forStudent}</div>
                    <div className="text-xs text-gray-500">📅 {fmtDateTime(r.lesson.start_datetime, r.lesson.slot_day, r.lesson.slot_hour)}</div>
                  </div>

                  <button
                    className="bg-green-600 hover:bg-green-700 text-white px-5 py-2 rounded font-semibold shadow disabled:opacity-60"
                    onClick={() => handlePay(r)}
                    disabled={payingId === r.lesson.id}
                    aria-busy={payingId === r.lesson.id}
                  >
                    {payingId === r.lesson.id ? 'Redirection…' : 'Payer maintenant'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Historique */}
        <div className="bg-white p-6 rounded-xl shadow border">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-primary">Historique des paiements</h3>
            {!loading && (
              <span className="text-xs text-gray-600">Total payé : {totals.paid.toFixed(2)} €</span>
            )}
          </div>

          {loading ? (
            <div className="text-gray-500">Chargement…</div>
          ) : paid.length === 0 ? (
            <div className="text-gray-400 text-sm">Aucun paiement effectué.</div>
          ) : (
            <div className="flex flex-col gap-3">
              {paid.map((r) => (
                <div
                  key={`${r.lesson.id}:${r.forStudent}`}
                  className="border rounded-lg px-4 py-2 flex flex-col md:flex-row md:items-center gap-2 bg-gray-50"
                >
                  <span className="font-bold text-primary">{r.lesson.subject_id || 'Matière'}</span>
                  <span className="text-xs text-gray-600">
                    {fmtDateTime(r.lesson.start_datetime, r.lesson.slot_day, r.lesson.slot_hour)}
                  </span>
                  <span className="text-xs text-gray-600">Enfant : {r.childName || r.forStudent}</span>
                  <span className="text-xs text-gray-600">Prof : {r.teacherName || r.lesson.teacher_id}</span>
                  <span className="text-green-600 text-xs font-semibold md:ml-auto">Payé</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}