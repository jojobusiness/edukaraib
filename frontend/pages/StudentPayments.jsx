import React, { useEffect, useState } from 'react';
import { auth, db } from '../lib/firebase';
import {
  collection,
  getDocs,
  query,
  where,
  updateDoc,
  doc,
  getDoc,
} from 'firebase/firestore';
import DashboardLayout from '../components/DashboardLayout';

export default function StudentPayments() {
  const [toPay, setToPay] = useState([]);
  const [paid, setPaid] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      if (!auth.currentUser) return;
      setLoading(true);

      // 1) Récupère tous les cours de l’élève connecté
      const lessonsQ = query(
        collection(db, 'lessons'),
        where('student_id', '==', auth.currentUser.uid)
      );
      const lessonsSnap = await getDocs(lessonsQ);

      // 2) Enrichit avec le nom du professeur
      const lessons = await Promise.all(
        lessonsSnap.docs.map(async (d) => {
          const l = { id: d.id, ...d.data() };
          let teacherName = l.teacher_id;
          try {
            const tSnap = await getDoc(doc(db, 'users', l.teacher_id));
            if (tSnap.exists()) {
              teacherName = tSnap.data().fullName || tSnap.data().name || teacherName;
            }
          } catch {}
          return { ...l, teacherName };
        })
      );

      setToPay(lessons.filter((l) => !l.is_paid));
      setPaid(lessons.filter((l) => l.is_paid));
      setLoading(false);
    };

    fetch();
  }, []);

  const handlePay = async (lessonId) => {
    // Simulation paiement: bascule is_paid à true
    await updateDoc(doc(db, 'lessons', lessonId), { is_paid: true });
    setToPay((prev) => prev.filter((l) => l.id !== lessonId));
    // Optionnel: on peut aussi pousser dans "paid" pour feedback instantané
    // Mais comme on n’a pas rechargé le doc, on garde simple ici.
  };

  const formatDateTime = (start_datetime, slot_day, slot_hour) => {
    if (start_datetime?.seconds) {
      return new Date(start_datetime.seconds * 1000).toLocaleString();
    }
    if (slot_day && (slot_hour || slot_hour === 0)) {
      return `${slot_day} • ${String(slot_hour).padStart(2, '0')}:00`;
    }
    return 'Date/heure —';
  };

  return (
    <DashboardLayout role="student">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold text-primary mb-6">💳 Mes paiements</h2>

        {/* À régler */}
        <div className="mb-8">
          <h3 className="font-bold text-secondary mb-3">Paiements à effectuer</h3>

          {loading ? (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">
              Chargement…
            </div>
          ) : toPay.length === 0 ? (
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
                    <div className="text-xs text-gray-500">
                      Professeur&nbsp;: {l.teacherName || l.teacher_id}
                    </div>
                    <div className="text-xs text-gray-500">
                      📅 {formatDateTime(l.start_datetime, l.slot_day, l.slot_hour)}
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

        {/* Historique */}
        <div className="bg-white p-6 rounded-xl shadow border">
          <h3 className="font-bold text-primary mb-3">Historique des paiements</h3>
          {loading ? (
            <div className="text-gray-500">Chargement…</div>
          ) : paid.length === 0 ? (
            <div className="text-gray-400 text-sm">Aucun paiement effectué.</div>
          ) : (
            <div className="flex flex-col gap-3">
              {paid.map((l) => (
                <div
                  key={l.id}
                  className="border rounded-lg px-4 py-2 flex flex-col md:flex-row md:items-center gap-2 bg-gray-50"
                >
                  <span className="font-bold text-primary">
                    {l.subject_id || 'Matière'}
                  </span>
                  <span className="text-xs text-gray-600">
                    {formatDateTime(l.start_datetime, l.slot_day, l.slot_hour)}
                  </span>
                  <span className="text-xs text-gray-600">
                    Prof&nbsp;: {l.teacherName || l.teacher_id}
                  </span>
                  <span className="text-green-600 text-xs font-semibold md:ml-auto">
                    Payé
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}