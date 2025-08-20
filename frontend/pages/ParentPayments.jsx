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
  // Normalise plusieurs façons d'encoder "payé"
  if (v === true) return true;
  if (typeof v === 'string') {
    const s = v.toLowerCase();
    return s === 'true' || s === 'paid' || s === 'ok' || s === 'yes';
  }
  if (typeof v === 'number') return v === 1;
  return false;
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
      // doc id (students) et, si présent, user_id de l'enfant autonome
      m.set(c.id, c.full_name || c.name || 'Enfant');
      if (c.user_id) m.set(c.user_id, c.full_name || c.name || 'Enfant');
      if (c.uid) m.set(c.uid, c.full_name || c.name || 'Enfant');
    });
    return m;
  }, [children]);

  useEffect(() => {
    let unsubLessons = null;
    (async () => {
      if (!auth.currentUser) return; // sécurité
      setLoading(true);

      // 1) Récupère les enfants de ce parent
      const qKids = query(
        collection(db, 'students'),
        where('parent_id', '==', auth.currentUser.uid)
      );
      const kidsSnap = await getDocs(qKids);
      const kids = kidsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setChildren(kids);

      // Construire la liste d'identifiants qui peuvent apparaître dans lessons.student_id
      const idsToMatch = new Set();
      kids.forEach((k) => {
        idsToMatch.add(k.id);         // id du doc students
        if (k.user_id) idsToMatch.add(k.user_id); // uid user enfant si stocké
        if (k.uid) idsToMatch.add(k.uid);
      });

      // 2) Ecoute temps réel sur lessons (plus simple que de multiplier les 'in' par chunks)
      unsubLessons = onSnapshot(collection(db, 'lessons'), (snap) => {
        const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

        // Ne garder que les cours des enfants de ce parent
        const mine = all.filter((l) => idsToMatch.has(l.student_id));

        const toPayList = mine.filter((l) => !isPaidFlag(l.is_paid));
        const paidList = mine.filter((l) => isPaidFlag(l.is_paid));

        setToPay(toPayList);
        setPaid(paidList);
        setLoading(false);
      });
    })();

    return () => {
      if (unsubLessons) unsubLessons();
    };
  }, []);

  const handlePay = async (lessonId) => {
    // Simule le paiement → passe is_paid à true
    await updateDoc(doc(db, 'lessons', lessonId), { is_paid: true });
    // Déplacement optimiste de l'item vers "payé"
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
                          {l.start_datetime && (
                            <>📅 {new Date(l.start_datetime.seconds * 1000).toLocaleString()}</>
                          )}
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
                      // Du plus récent au plus ancien si on a la date
                      const da = a.start_datetime?.seconds || 0;
                      const db = b.start_datetime?.seconds || 0;
                      return db - da;
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
                          {l.start_datetime
                            ? new Date(l.start_datetime.seconds * 1000).toLocaleString()
                            : 'Date ?'}
                        </span>
                        <span className="text-xs text-gray-500">
                          Enfant : {childLabel.get(l.student_id) || l.student_id}
                        </span>
                        {l.price_per_hour ? (
                          <span className="text-xs text-gray-700 ml-auto">
                            Montant : {l.price_per_hour} €
                          </span>
                        ) : (
                          <span className="text-xs text-gray-700 ml-auto">Payé</span>
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