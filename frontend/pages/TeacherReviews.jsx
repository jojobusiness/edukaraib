import React, { useEffect, useState } from 'react';
import { auth, db } from '../lib/firebase';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import DashboardLayout from '../components/DashboardLayout';

export default function TeacherReviews() {
  const [reviews, setReviews] = useState([]);

  useEffect(() => {
    const fetch = async () => {
      // On récupère les avis où teacher_id == prof courant
      const q = query(collection(db, 'reviews'), where('teacher_id', '==', auth.currentUser.uid));
      const snapshot = await getDocs(q);

      // Pour chaque avis, on essaie de trouver le nom de l'élève (optionnel)
      const enriched = await Promise.all(snapshot.docs.map(async d => {
        const review = { id: d.id, ...d.data() };
        let studentName = review.student_id;
        try {
          const snap = await getDoc(doc(db, 'users', review.student_id));
          if (snap.exists()) studentName = snap.data().fullName || studentName;
        } catch {}
        return { ...review, studentName };
      }));
      // Les plus récents en premier
      setReviews(enriched.sort((a, b) => (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0)));
    };
    fetch();
  }, []);

  return (
    <DashboardLayout role="teacher">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-2xl font-bold text-primary mb-6">🌟 Mes avis reçus</h2>
        <div className="grid grid-cols-1 gap-5">
          {reviews.length === 0 && (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">
              Aucun avis reçu pour l’instant.
            </div>
          )}
          {reviews.map((r, idx) => (
            <div key={r.id} className="bg-white p-5 rounded-xl shadow border flex flex-col gap-2">
              <div className="flex gap-2 items-center mb-1">
                <span className="font-bold text-primary">{r.studentName || "Élève"}</span>
                <span className="text-yellow-500 text-lg">{'★'.repeat(r.rating || 5)}</span>
                <span className="text-xs text-gray-400 ml-auto">
                  {r.created_at?.seconds && new Date(r.created_at.seconds * 1000).toLocaleDateString()}
                </span>
              </div>
              <div className="text-gray-700 text-sm italic">"{r.comment}"</div>
            </div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}