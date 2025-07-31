import React, { useEffect, useState } from 'react';
import { auth, db } from '../lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import DashboardLayout from '../components/DashboardLayout';

export default function ParentDashboard() {
  const [children, setChildren] = useState([]);
  const [courses, setCourses] = useState([]);
  const [unpaid, setUnpaid] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      const q = query(collection(db, 'students'), where('parent_id', '==', auth.currentUser.uid));
      const snapshot = await getDocs(q);
      const kids = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setChildren(kids);

      const lessonsSnap = await getDocs(collection(db, 'lessons'));
      const allLessons = lessonsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const relatedCourses = allLessons.filter(l => kids.map(k => k.id).includes(l.student_id));
      setCourses(relatedCourses);

      const notPaid = relatedCourses.filter(c => !c.is_paid);
      setUnpaid(notPaid);
    };

    fetchData();
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-white via-gray-50 to-primary/5 px-4 py-10">
      <div className="w-full max-w-3xl">
        <DashboardLayout role="parent">
        <h2 className="text-3xl font-bold text-primary mb-8 text-center font-sans tracking-tight">
          👨‍👩‍👧 Espace Parent
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
          {/* Carte enfants */}
          <div className="bg-white border border-primary/20 rounded-2xl shadow-lg p-7 flex flex-col items-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-3">
              <span className="text-3xl text-primary">👧</span>
            </div>
            <span className="font-bold text-primary text-lg mb-1">Enfants enregistrés</span>
            <span className="text-3xl font-semibold">{children.length}</span>
            <ul className="text-xs text-gray-600 mt-3 mb-2 max-h-24 overflow-y-auto w-full">
              {children.map(child => (
                <li key={child.id}>
                  {child.full_name} — {child.school_level || "Niveau ?"}
                </li>
              ))}
            </ul>
            <Link to="/parent/children" className="text-xs text-primary font-semibold hover:underline">➕ Gérer mes enfants</Link>
          </div>
          {/* Carte cours */}
          <div className="bg-white border border-secondary/20 rounded-2xl shadow-lg p-7 flex flex-col items-center">
            <div className="w-16 h-16 rounded-full bg-secondary/10 flex items-center justify-center mb-3">
              <span className="text-3xl text-secondary">📚</span>
            </div>
            <span className="font-bold text-primary text-lg mb-1">Cours réservés</span>
            <span className="text-3xl font-semibold">{courses.length}</span>
            <ul className="text-xs text-gray-600 mt-3 mb-2 max-h-24 overflow-y-auto w-full">
              {courses.slice(0, 3).map(c => (
                <li key={c.id}>
                  Enfant: {c.student_id} — Prof: {c.teacher_id} — Statut: {c.status}
                </li>
              ))}
            </ul>
            <Link to="/parent/courses" className="text-xs text-primary font-semibold hover:underline">🔎 Voir tous les cours</Link>
          </div>
          {/* Carte paiements */}
          <div className="bg-white border border-yellow-400/20 rounded-2xl shadow-lg p-7 flex flex-col items-center">
            <div className="w-16 h-16 rounded-full bg-yellow-400/10 flex items-center justify-center mb-3">
              <span className="text-3xl text-yellow-500">💳</span>
            </div>
            <span className="font-bold text-primary text-lg mb-1">Paiements à régler</span>
            <span className="text-3xl font-semibold">{unpaid.length}</span>
            <span className="text-xs text-gray-600 mt-3 mb-2">
              {unpaid.length > 0
                ? <>Vous avez <strong>{unpaid.length}</strong> cours à régler (simulation).</>
                : <>Aucun paiement en attente.</>
              }
            </span>
          </div>
        </div>
        </DashboardLayout>
      </div>
    </div>
  );
}