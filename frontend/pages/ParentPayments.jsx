import React, { useEffect, useMemo, useState } from 'react';
import { auth, db } from '../lib/firebase';
import {
  collection,
  getDocs,
  query,
  where,
  updateDoc,
  doc,
  onSnapshot,
} from 'firebase/firestore';
import DashboardLayout from '../components/DashboardLayout';

// --- helpers ---
function isPaidFlag(v) {
  if (v === true) return true;
  if (typeof v === 'string') {
    const s = v.toLowerCase();
    return s === 'true' || s === 'paid' || s === 'ok' || s === 'yes';
  }
  if (typeof v === 'number') return v === 1;
  return false;
}

// Convertit plein de formats possibles en Date lisible
function toJsDate(any) {
  if (!any) return null;
  // Firestore Timestamp
  if (typeof any.toDate === 'function') {
    try { return any.toDate(); } catch {}
  }
  // { seconds, nanoseconds }
  if (typeof any.seconds === 'number') {
    try { return new Date(any.seconds * 1000); } catch {}
  }
  // Date JS
  if (any instanceof Date) return any;
  // millis
  if (typeof any === 'number') {
    const d = new Date(any);
    if (!isNaN(d.getTime())) return d;
  }
  // ISO string
  if (typeof any === 'string') {
    const d = new Date(any);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

// Fallback d’affichage si on n’a pas de vraie date
function fmtFromSlot(slot_day, slot_hour) {
  const hh = (slot_hour || slot_hour === 0) ? String(slot_hour).padStart(2, '0') + ':00' : '';
  if (slot_day && hh) return `${slot_day} • ${hh}`;
  if (slot_day) return `${slot_day}`;
  if (hh) return hh;
  return null;
}

// Priorité d’affichage : start_datetime → created_at → slot_day/hour → "—"
function fmtLessonWhen(lesson) {
  const d1 = toJsDate(lesson.start_datetime);
  if (d1) return d1.toLocaleString();

  const d2 = toJsDate(lesson.created_at);
  if (d2) return d2.toLocaleString();

  const slot = fmtFromSlot(lesson.slot_day, lesson.slot_hour);
  if (slot) return slot;

  return '—';
}

export default function ParentPayments() {
  const [loading, setLoading] = useState(true);
  const [children, setChildren] = useState([]); // [{id, full_name, user_id?}]
  const [toPay, setToPay] = useState([]);
  const [paid, setPaid] = useState([]);

  // Map enfantId/uid -> label
  const childLabel = useMemo(() => {
    const m = new Map();
    children.forEach((c) => {
      m.set(c.id, c.full_name || c.name || 'Enfant');
      if (c.user_id) m.set(c.user_id, c.full_name || c.name || 'Enfant');
      if (c.uid) m.set(c.uid, c.full_name || c.name || 'Enfant');
    });
    return m;
  }, [children]);

  useEffect(() => {
    let unsubLessons = null;
    (async () => {
      if (!auth.currentUser) return;
      setLoading(true);

      // 1) Enfants du parent
      const qKids = query(
        collection(db, 'students'),
        where('parent_id', '==', auth.currentUser.uid)
      );
      const kidsSnap = await getDocs(qKids);
      const kids = kidsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setChildren(kids);

      // Tous les identifiants possibles vus dans lessons.student_id
      const idsToMatch = new Set();
      kids.forEach((k) => {
        idsToMatch.add(k.id);
        if (k.user_id) idsToMatch.add(k.user_id);
        if (k.uid) idsToMatch.add(k.uid);
      });

      // 2) Écoute temps réel des leçons
      unsubLessons = onSnapshot(collection(db, 'lessons'), (snap) => {
        const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const mine = all.filter((l) => idsToMatch.has(l.student_id));

        const toPayList = mine.filter((l) => !isPaidFlag(l.is_paid));
        const paidList = mine.filter((l) => isPaidFlag(l.is_paid));

        setToPay(toPayList);
        setPaid(paidList);
        setLoading(false);
      }, (err) => {
        console.error(err);
        setLoading(false);
      });
    })();

    return () => {
      if (unsubLessons) unsubLessons();
    };
  }, []);

  const handlePay = async (lessonId) => {
    await updateDoc(doc(db, 'lessons', lessonId), { is_paid: true });
    // Bascule optimiste
    setToPay((prev) => {
      const found = prev.find((l) => l.id === lessonId);
      if (!found) return prev;
      setPaid((p) => [{ ...found, is_paid: true }, ...p]);
      return prev.filter((l) => l.id !== lessonId);
    });
  };

  return (
    <DashboardLayout role="parent">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold text-primary mb-6">💳 Paiements à effectuer</h2>

        {loading ? (
          <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">
            Chargement…
          </div>
        ) : (
          <>
            {/* À payer */}
            <div className="mb-8">
              {toPay.length === 0 ? (
                <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">
                  Aucun paiement en attente !
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {toPay.map((l) => (
                    <div
                      key={l.id}
                      className="bg-white p-5 rounded-xl shadow border flex flex-col md:flex-row md:items-center gap-4 justify-between"
                    >
                      <div>
                        <div className="font-bold text-primary">
                          {l.subject_id || 'Matière'}{' '}
                          <span className="text-gray-600 text-xs ml-2">
                            {l.price_per_hour ? `${l.price_per_hour} €` : ''}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500 mb-1">
                          📅 {fmtLessonWhen(l)}
                        </div>
                        <div className="text-xs text-gray-500">
                          Enfant : {childLabel.get(l.student_id) || l.student_id}
                        </div>
                      </div>
                      <button
                        className="bg-green-600 hover:bg-green-700 text-white px-5 py-2 rounded font-semibold shadow"
                        onClick={() => handlePay(l.id)}
                      >
                        Régler ce cours
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Payé */}
            <div className="bg-white p-6 rounded-xl shadow border">
              <h3 className="font-bold text-primary mb-3">Historique des paiements</h3>
              <div className="flex flex-col gap-3">
                {paid.length === 0 ? (
                  <div className="text-gray-400 text-sm">Aucun paiement effectué.</div>
                ) : (
                  paid
                    .sort((a, b) => {
                      const da = toJsDate(a.start_datetime)?.getTime()
                        ?? toJsDate(a.created_at)?.getTime()
                        ?? 0;
                      const db = toJsDate(b.start_datetime)?.getTime()
                        ?? toJsDate(b.created_at)?.getTime()
                        ?? 0;
                      return (db - da); // plus récent d’abord
                    })
                    .map((l) => (
                      <div
                        key={l.id}
                        className="border rounded-lg px-4 py-2 flex flex-col md:flex-row md:items-center gap-2 bg-gray-50"
                      >
                        <span className="font-bold text-primary">
                          {l.subject_id || 'Matière'}
                        </span>
                        <span className="text-xs text-gray-600">
                          {fmtLessonWhen(l)}
                        </span>
                        <span className="text-xs text-gray-500">
                          Enfant : {childLabel.get(l.student_id) || l.student_id}
                        </span>
                        {l.price_per_hour ? (
                          <span className="text-xs text-gray-700 md:ml-auto">
                            Montant : {l.price_per_hour} €
                          </span>
                        ) : (
                          <span className="text-xs text-green-700 md:ml-auto">Payé</span>
                        )}
                      </div>
                    ))
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}