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

export default function ParentPayments() {
  const [toPay, setToPay] = useState([]);
  const [paid, setPaid] = useState([]);
  const [loading, setLoading] = useState(true);

  // -- helpers --
  const formatDateTime = (start_datetime, slot_day, slot_hour) => {
    if (start_datetime?.seconds) {
      return new Date(start_datetime.seconds * 1000).toLocaleString();
    }
    if (typeof start_datetime?.toDate === 'function') {
      try { return start_datetime.toDate().toLocaleString(); } catch {}
    }
    if (slot_day && (slot_hour || slot_hour === 0)) {
      return `${slot_day} • ${String(slot_hour).padStart(2, '0')}:00`;
    }
    return 'Date/heure —';
  };

  const resolveTeacherName = async (uid) => {
    if (!uid) return '';
    try {
      const s = await getDoc(doc(db, 'users', uid));
      if (s.exists()) {
        const d = s.data();
        return d.fullName || d.name || d.displayName || uid;
      }
    } catch {}
    return uid;
  };

  const resolveChildName = async (idOrUid) => {
    if (!idOrUid) return 'Enfant';
    // 1) students/{id}
    try {
      const s = await getDoc(doc(db, 'students', idOrUid));
      if (s.exists()) {
        const d = s.data();
        return d.full_name || d.name || idOrUid;
      }
    } catch {}
    // 2) users/{uid} (si l’enfant est autonome et a un user)
    try {
      const s = await getDoc(doc(db, 'users', idOrUid));
      if (s.exists()) {
        const d = s.data();
        return d.fullName || d.name || d.displayName || idOrUid;
      }
    } catch {}
    return idOrUid;
  };

  useEffect(() => {
    const fetch = async () => {
      if (!auth.currentUser) return;
      setLoading(true);

      // 1) Enfants du parent
      const kidsSnap = await getDocs(
        query(collection(db, 'students'), where('parent_id', '==', auth.currentUser.uid))
      );
      const kids = kidsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      // Identifiants possibles présents dans lessons.student_id
      // (id du doc students + éventuellement user_id/uid si tu les stockes)
      const childIds = [];
      kids.forEach((k) => {
        childIds.push(k.id);
        if (k.user_id) childIds.push(k.user_id);
        if (k.uid) childIds.push(k.uid);
      });

      if (childIds.length === 0) {
        setToPay([]);
        setPaid([]);
        setLoading(false);
        return;
      }

      // 2) Récupère les leçons des enfants (chunk de 10 pour where('in', ...))
      const chunks = [];
      for (let i = 0; i < childIds.length; i += 10) {
        chunks.push(childIds.slice(i, i + 10));
      }

      const lessons = [];
      for (const c of chunks) {
        const snap = await getDocs(
          query(collection(db, 'lessons'), where('student_id', 'in', c))
        );
        snap.docs.forEach((d) => lessons.push({ id: d.id, ...d.data() }));
      }

      // 3) Enrichit avec noms prof & enfant (comme StudentPayments → teacherName)
      const enriched = await Promise.all(
        lessons.map(async (l) => {
          const [teacherName, childName] = await Promise.all([
            resolveTeacherName(l.teacher_id),
            resolveChildName(l.student_id),
          ]);
          return { ...l, teacherName, childName };
        })
      );

      setToPay(enriched.filter((l) => !l.is_paid));
      setPaid(enriched.filter((l) => l.is_paid));
      setLoading(false);
    };

    fetch();
  }, []);

  const handlePay = async (lessonId) => {
    await updateDoc(doc(db, 'lessons', lessonId), { is_paid: true });
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
        <h2 className="text-2xl font-bold text-primary mb-6">💳 Paiements (Parent)</h2>

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
                      Professeur : {l.teacherName || l.teacher_id}
                    </div>
                    <div className="text-xs text-gray-500">
                      Enfant : {l.childName || l.student_id}
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
              {paid
                .sort((a, b) => {
                  const ta =
                    (a.start_datetime?.seconds && a.start_datetime.seconds * 1000) ||
                    (typeof a.start_datetime?.toDate === 'function' && a.start_datetime.toDate().getTime()) ||
                    0;
                  const tb =
                    (b.start_datetime?.seconds && b.start_datetime.seconds * 1000) ||
                    (typeof b.start_datetime?.toDate === 'function' && b.start_datetime.toDate().getTime()) ||
                    0;
                  return tb - ta;
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
                      {formatDateTime(l.start_datetime, l.slot_day, l.slot_hour)}
                    </span>
                    <span className="text-xs text-gray-600">
                      Enfant : {l.childName || l.student_id}
                    </span>
                    <span className="text-xs text-gray-600">
                      Prof : {l.teacherName || l.teacher_id}
                    </span>
                    <span className="text-green-600 text-xs font-semibold md:ml-auto">
                      Payé {l.price_per_hour ? `• ${l.price_per_hour} €` : ''}
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