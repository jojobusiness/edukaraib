import React, { useEffect, useState } from 'react';
import { auth, db } from '../lib/firebase';
import { collection, getDocs, query, where, updateDoc, doc } from 'firebase/firestore';
import DashboardLayout from '../components/DashboardLayout';

export default function ParentPayments() {
  const [toPay, setToPay] = useState([]);
  const [paid, setPaid] = useState([]);

  useEffect(() => {
    const fetch = async () => {
      // 1. Récupère les enfants du parent
      const childrenQuery = query(collection(db, 'students'), where('parent_id', '==', auth.currentUser.uid));
      const childrenSnap = await getDocs(childrenQuery);
      const childIds = childrenSnap.docs.map(doc => doc.id);

      // 2. Récupère tous les cours liés à ces enfants
      const lessonQuery = query(collection(db, 'lessons'));
      const lessonsSnap = await getDocs(lessonQuery);
      const lessons = lessonsSnap.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(l => childIds.includes(l.student_id));

      setToPay(lessons.filter(l => !l.is_paid));
      setPaid(lessons.filter(l => l.is_paid));
    };
    fetch();
  }, []);

  const handlePay = async (id) => {
    // Simule le paiement (MAJ Firestore)
    await updateDoc(doc(db, 'lessons', id), { is_paid: true });
    setToPay(prev => prev.filter(l => l.id !== id));
    // Optionnel: tu peux ajouter dans paid le lesson payé si besoin
  };

  return (
    <DashboardLayout role="parent">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold text-primary mb-6">💳 Paiements à effectuer</h2>

        <div className="mb-8">
          {toPay.length === 0 ? (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">
              Aucun paiement en attente !
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {toPay.map(l => (
                <div key={l.id} className="bg-white p-5 rounded-xl shadow border flex flex-col md:flex-row md:items-center gap-4 justify-between">
                  <div>
                    <div className="font-bold text-primary">{l.subject_id || 'Matière'} <span className="text-gray-600 text-xs ml-2">{l.price_per_hour} €</span></div>
                    <div className="text-xs text-gray-500 mb-1">
                      {l.start_datetime && <>📅 {new Date(l.start_datetime.seconds * 1000).toLocaleString()}</>}
                    </div>
                    <div className="text-xs text-gray-500">Enfant : {l.student_id}</div>
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

        <div className="bg-white p-6 rounded-xl shadow border">
          <h3 className="font-bold text-primary mb-3">Historique des paiements</h3>
          <div className="flex flex-col gap-3">
            {paid.length === 0 ? (
              <div className="text-gray-400 text-sm">Aucun paiement effectué.</div>
            ) : (
              paid.map(l => (
                <div key={l.id} className="border rounded-lg px-4 py-2 flex flex-col md:flex-row md:items-center gap-2 bg-gray-50">
                  <span className="font-bold text-primary">{l.subject_id || 'Matière'}</span>
                  <span className="text-xs text-gray-600">
                    {l.start_datetime ? new Date(l.start_datetime.seconds * 1000).toLocaleString() : "Date ?"}
                  </span>
                  <span className="text-green-600 text-xs font-semibold ml-auto">Payé</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}