import React, { useEffect, useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import { auth, db } from '../lib/firebase';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';

export default function TeacherDashboard() {
  const [nextCourses, setNextCourses] = useState([]);
  const [revenues, setRevenues] = useState(0);
  const [pending, setPending] = useState(0);
  const [reviews, setReviews] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      // Cours où teacher_id == user.uid
      const lessonsSnap = await getDocs(query(
        collection(db, 'lessons'),
        where('teacher_id', '==', auth.currentUser.uid)
      ));
      const allLessons = lessonsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Prochains cours (statut confirmé, date future)
      const now = Date.now();
      const futureLessons = await Promise.all(
        allLessons
          .filter(l => l.status === 'confirmed' && l.start_datetime && (l.start_datetime.seconds * 1000) > now)
          .sort((a, b) => a.start_datetime.seconds - b.start_datetime.seconds)
          .slice(0, 3)
          .map(async l => {
            // Récupère le nom de l'élève
            let studentName = l.student_id;
            try {
              const sSnap = await getDoc(doc(db, 'users', l.student_id));
              if (sSnap.exists()) studentName = sSnap.data().fullName || studentName;
            } catch {}
            return { ...l, studentName };
          })
      );
      setNextCourses(futureLessons);

      // Revenus du mois (paiements confirmés)
      const thisMonth = new Date().getMonth();
      const earned = allLessons
        .filter(l => l.is_paid && l.start_datetime && new Date(l.start_datetime.seconds * 1000).getMonth() === thisMonth)
        .reduce((sum, l) => sum + (l.price_per_hour || 0), 0);
      setRevenues(earned);

      // Demandes en attente
      const pendingCount = allLessons.filter(l => l.status === 'booked').length;
      setPending(pendingCount);

      // Avis reçus (collection "reviews", où teacher_id == user.uid)
      const reviewsSnap = await getDocs(query(
        collection(db, 'reviews'),
        where('teacher_id', '==', auth.currentUser.uid)
      ));
      const reviewsList = reviewsSnap.docs.map(doc => doc.data()).slice(0, 3);
      setReviews(reviewsList);
    };

    if (auth.currentUser) fetchData();
  }, []);

  return (
    <DashboardLayout role="teacher">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-primary mb-2 flex items-center gap-2">
          <span role="img" aria-label="Prof">🎓</span>
          Tableau de bord Professeur
        </h2>
        <p className="text-gray-600">Bienvenue sur votre espace professeur, retrouvez ici vos infos clés.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        <div className="bg-white rounded-xl shadow p-6 border-l-4 border-primary flex flex-col items-start">
          <span className="text-3xl mb-2">📅</span>
          <span className="text-xl font-bold text-primary">Prochain cours</span>
          <span className="text-gray-700 mt-1">
            {nextCourses[0]
              ? `${nextCourses[0].subject_id || 'Cours'} - ${new Date(nextCourses[0].start_datetime.seconds * 1000).toLocaleString()} avec ${nextCourses[0].studentName}`
              : 'Aucun cours à venir'}
          </span>
        </div>
        <div className="bg-white rounded-xl shadow p-6 border-l-4 border-yellow-400 flex flex-col items-start">
          <span className="text-3xl mb-2">💰</span>
          <span className="text-xl font-bold text-yellow-600">Revenus ce mois</span>
          <span className="text-gray-700 mt-1">{revenues.toFixed(2)} €</span>
        </div>
        <div className="bg-white rounded-xl shadow p-6 border-l-4 border-secondary flex flex-col items-start">
          <span className="text-3xl mb-2">📝</span>
          <span className="text-xl font-bold text-secondary">Demandes en attente</span>
          <span className="text-gray-700 mt-1">{pending} cours à valider</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow p-5">
          <h3 className="font-bold text-primary mb-3">Cours à venir</h3>
          <ul className="text-gray-700 space-y-2">
            {nextCourses.map((c, idx) => (
              <li key={idx}>
                📅 {new Date(c.start_datetime.seconds * 1000).toLocaleString()} : {c.subject_id || 'Cours'} avec {c.studentName}
              </li>
            ))}
            {nextCourses.length === 0 && <li>Aucun cours à venir.</li>}
          </ul>
        </div>
        <div className="bg-white rounded-xl shadow p-5">
          <h3 className="font-bold text-primary mb-3">Derniers avis reçus</h3>
          <ul className="text-gray-700 space-y-2">
            {reviews.map((r, idx) => (
              <li key={idx}>
                {"🌟".repeat(r.stars || r.rating || 5)} “{r.comment || 'Pas d\'avis.'}”
              </li>
            ))}
            {reviews.length === 0 && <li>Aucun avis pour le moment.</li>}
          </ul>
        </div>
      </div>
    </DashboardLayout>
  );
}