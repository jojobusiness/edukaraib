import React, { useEffect, useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import { auth, db } from '../lib/firebase';
import { collection, query, where, getDocs, onSnapshot } from 'firebase/firestore';
import NotifList from '../components/NotifList';

export default function ParentDashboard() {
  const [children, setChildren] = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [unpaid, setUnpaid] = useState(0);
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    if (!auth.currentUser) return;

    // 🔵 Notifications dynamiques Firestore (parent)
    const notifQ = query(
      collection(db, 'notifications'),
      where('user_id', '==', auth.currentUser.uid)
    );
    const unsubscribe = onSnapshot(notifQ, (snapshot) => {
      setNotifications(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      // Enfants de ce parent
      const kidsSnap = await getDocs(query(
        collection(db, 'students'),
        where('parent_id', '==', auth.currentUser.uid)
      ));
      const kids = kidsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setChildren(kids);

      // Cours des enfants
      const lessonsSnap = await getDocs(collection(db, 'lessons'));
      const allLessons = lessonsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const courses = allLessons.filter(l => kids.map(k => k.id).includes(l.student_id));
      // Prochains cours
      const next = courses
        .filter(l => l.status === 'confirmed' && l.start_datetime && new Date(l.start_datetime.seconds * 1000) > new Date())
        .map(l => ({
          name: kids.find(k => k.id === l.student_id)?.full_name || "Inconnu",
          info: `${l.subject_id} le ${new Date(l.start_datetime.seconds * 1000).toLocaleString()}`
        }));
      setUpcoming(next);

      // Paiements en attente
      setUnpaid(courses.filter(c => !c.is_paid).length);
    };

    if (auth.currentUser) fetchData();
  }, []);

  return (
    <DashboardLayout role="parent">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-primary mb-2 flex items-center gap-2">
          <span role="img" aria-label="Parent">👨‍👩‍👧</span>
          Tableau de bord Parent
        </h2>
        <p className="text-gray-600">Bienvenue sur votre espace parent. Suivez vos enfants, leurs cours et paiements ici.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        <div className="bg-white rounded-xl shadow p-6 border-l-4 border-primary flex flex-col items-start">
          <span className="text-3xl mb-2">👧</span>
          <span className="text-xl font-bold text-primary">Enfants enregistrés</span>
          <ul className="text-gray-700 mt-1">
            {children.length === 0 && <li>Aucun enfant enregistré.</li>}
            {children.map((c, i) => (
              <li key={i}>{c.full_name} ({c.school_level || "Niveau inconnu"})</li>
            ))}
          </ul>
        </div>
        <div className="bg-white rounded-xl shadow p-6 border-l-4 border-yellow-400 flex flex-col items-start">
          <span className="text-3xl mb-2">📅</span>
          <span className="text-xl font-bold text-yellow-600">Prochains cours</span>
          <ul className="text-gray-700 mt-1">
            {upcoming.length === 0 && <li>Aucun cours à venir.</li>}
            {upcoming.map((c, i) => (
              <li key={i}>{c.name} : {c.info}</li>
            ))}
          </ul>
        </div>
        <div className="bg-white rounded-xl shadow p-6 border-l-4 border-secondary flex flex-col items-start">
          <span className="text-3xl mb-2">💳</span>
          <span className="text-xl font-bold text-secondary">Paiements à régler</span>
          <span className="text-gray-700 mt-1">{unpaid} en attente</span>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow p-5">
        <h3 className="font-bold text-primary mb-3">Notifications</h3>
        <NotifList notifications={notifications} />
      </div>
    </DashboardLayout>
  );
}