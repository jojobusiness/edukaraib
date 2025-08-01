import React, { useEffect, useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import { auth, db } from '../lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';

export default function StudentDashboard() {
  const [nextCourse, setNextCourse] = useState(null);
  const [teachers, setTeachers] = useState([]);
  const [totalCourses, setTotalCourses] = useState(0);
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      // Récupérer tous les cours de l'élève
      const lessonsSnap = await getDocs(query(
        collection(db, 'lessons'),
        where('student_id', '==', auth.currentUser.uid)
      ));
      const allLessons = lessonsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTotalCourses(allLessons.length);

      // Prochain cours
      const futureLessons = allLessons
        .filter(l => l.status === 'confirmed' && l.start_datetime && new Date(l.start_datetime.seconds * 1000) > new Date())
        .sort((a, b) => a.start_datetime.seconds - b.start_datetime.seconds);
      setNextCourse(futureLessons[0] || null);

      // Profs favoris = professeurs des derniers cours
      const profIds = [...new Set(allLessons.map(l => l.teacher_id))].slice(0, 2);
      const profs = [];
      for (let pid of profIds) {
        const profSnap = await getDocs(query(collection(db, 'teachers'), where('user_id', '==', pid)));
        if (!profSnap.empty) {
          profs.push(profSnap.docs[0].data());
        }
      }
      setTeachers(profs);

      // Notifications (simu, à adapter selon ta structure)
      setNotifications([
        { text: "Nouveau cours accepté par un professeur.", date: new Date().toLocaleDateString() },
        { text: "Un avis laissé sur ton dernier prof.", date: new Date().toLocaleDateString() }
      ]);
    };

    if (auth.currentUser) fetchData();
  }, []);

  return (
    <DashboardLayout role="student">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-primary mb-2 flex items-center gap-2">
          <span role="img" aria-label="Élève">🧑‍🎓</span>
          Tableau de bord Élève
        </h2>
        <p className="text-gray-600">Bienvenue sur ton espace EduKaraib !</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        <div className="bg-white rounded-xl shadow p-6 border-l-4 border-primary flex flex-col items-start">
          <span className="text-3xl mb-2">📅</span>
          <span className="text-xl font-bold text-primary">Prochain cours</span>
          <span className="text-gray-700 mt-1">
            {nextCourse
              ? `${nextCourse.subject_id || 'Cours'} - ${new Date(nextCourse.start_datetime.seconds * 1000).toLocaleString()} avec ${nextCourse.teacher_id}`
              : 'Aucun cours à venir'}
          </span>
        </div>
        <div className="bg-white rounded-xl shadow p-6 border-l-4 border-yellow-400 flex flex-col items-start">
          <span className="text-3xl mb-2">👨‍🏫</span>
          <span className="text-xl font-bold text-yellow-600">Profs favoris</span>
          <ul className="text-gray-700 mt-1">
            {teachers.length === 0 && <li>Aucun prof récent.</li>}
            {teachers.map((p, i) => (
              <li key={i}>{p.fullName} ({p.subjects})</li>
            ))}
          </ul>
        </div>
        <div className="bg-white rounded-xl shadow p-6 border-l-4 border-secondary flex flex-col items-start">
          <span className="text-3xl mb-2">📚</span>
          <span className="text-xl font-bold text-secondary">Cours suivis</span>
          <span className="text-gray-700 mt-1">{totalCourses} cette année</span>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow p-5">
        <h3 className="font-bold text-primary mb-3">Notifications récentes</h3>
        <ul className="text-gray-700 space-y-2">
          {notifications.length === 0 && <li>Pas de notification récente.</li>}
          {notifications.map((n, idx) => (
            <li key={idx}>📢 {n.text} <span className="text-xs text-gray-400">{n.date}</span></li>
          ))}
        </ul>
      </div>
    </DashboardLayout>
  );
}