import React, { useEffect, useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import { auth, db } from '../lib/firebase';
import { collection, query, where, getDocs, doc, getDoc, onSnapshot, orderBy } from 'firebase/firestore';
import NotifList from '../components/NotifList';

export default function StudentDashboard() {
  const [nextCourse, setNextCourse] = useState(null);
  const [teachers, setTeachers] = useState([]);
  const [totalCourses, setTotalCourses] = useState(0);
  const [notifications, setNotifications] = useState([]);

  // Notifications dynamiques Firestore (LIVE)
  useEffect(() => {
    if (!auth.currentUser) return;
    const notifQ = query(
      collection(db, 'notifications'),
      where('user_id', '==', auth.currentUser.uid),
      orderBy('created_at', 'desc')
    );
    const unsubscribe = onSnapshot(notifQ, (snapshot) => {
      setNotifications(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      // Récupérer tous les cours de l'élève
      const lessonsSnap = await getDocs(query(
        collection(db, 'lessons'),
        where('student_id', '==', auth.currentUser.uid)
      ));
      const allLessons = lessonsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTotalCourses(allLessons.length);

      // Prochain cours (statut confirmé, date future)
      const now = Date.now();
      const futureLessons = allLessons
        .filter(l => l.status === 'confirmed' && l.start_datetime && (l.start_datetime.seconds * 1000) > now)
        .sort((a, b) => a.start_datetime.seconds - b.start_datetime.seconds);

      let nextCourseWithProf = null;
      if (futureLessons[0]) {
        let teacherName = futureLessons[0].teacher_id;
        try {
          const profSnap = await getDoc(doc(db, 'users', futureLessons[0].teacher_id));
          if (profSnap.exists()) teacherName = profSnap.data().fullName || teacherName;
        } catch {}
        nextCourseWithProf = { ...futureLessons[0], teacherName };
      }
      setNextCourse(nextCourseWithProf);

      // Profs favoris = professeurs des derniers cours
      const profIds = [...new Set(allLessons.map(l => l.teacher_id))].slice(0, 2);
      const profs = [];
      for (let pid of profIds) {
        try {
          const profSnap = await getDoc(doc(db, 'users', pid));
          if (profSnap.exists() && profSnap.data().role === "teacher") {
            profs.push(profSnap.data());
          }
        } catch {}
      }
      setTeachers(profs);
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
              ? `${nextCourse.subject_id || 'Cours'} - ${new Date(nextCourse.start_datetime.seconds * 1000).toLocaleString()} avec ${nextCourse.teacherName || nextCourse.teacher_id}`
              : 'Aucun cours à venir'}
          </span>
        </div>
        <div className="bg-white rounded-xl shadow p-6 border-l-4 border-yellow-400 flex flex-col items-start">
          <span className="text-3xl mb-2">👨‍🏫</span>
          <span className="text-xl font-bold text-yellow-600">Profs favoris</span>
          <ul className="text-gray-700 mt-1">
            {teachers.length === 0 && <li>Aucun prof récent.</li>}
            {teachers.map((p, i) => (
              <li key={i}>{p.fullName} {p.subjects && `(${p.subjects})`}</li>
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
        <h3 className="font-bold text-primary mb-3">Notifications</h3>
        <NotifList notifications={notifications} />
      </div>
    </DashboardLayout>
  );
}