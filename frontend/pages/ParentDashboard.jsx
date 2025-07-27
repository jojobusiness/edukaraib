import React, { useEffect, useState } from 'react';
import { auth, db } from '../lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { Link } from 'react-router-dom';

export default function ParentDashboard() {
  const [children, setChildren] = useState([]);
  const [courses, setCourses] = useState([]);
  const [unpaid, setUnpaid] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      // Récupérer les enfants
      const q = query(collection(db, 'students'), where('parent_id', '==', auth.currentUser.uid));
      const snapshot = await getDocs(q);
      const kids = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setChildren(kids);

      // Récupérer les cours associés aux enfants
      const lessonsSnap = await getDocs(collection(db, 'lessons'));
      const allLessons = lessonsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const relatedCourses = allLessons.filter(l => kids.map(k => k.id).includes(l.student_id));
      setCourses(relatedCourses);

      // Filtrer les cours non payés
      const notPaid = relatedCourses.filter(c => !c.is_paid);
      setUnpaid(notPaid);
    };

    fetchData();
  }, []);

  return (
    <div>
      <h2>Bienvenue dans votre espace Parent 👨‍👩‍👧</h2>

      <section>
        <h3>👧 Enfants enregistrés : {children.length}</h3>
        <ul>
          {children.map(child => (
            <li key={child.id}>
              {child.full_name} — {child.school_level}
            </li>
          ))}
        </ul>
        <Link to="/parent/children">➕ Gérer mes enfants</Link>
      </section>

      <section>
        <h3>📚 Cours réservés : {courses.length}</h3>
        <ul>
          {courses.slice(0, 3).map(c => (
            <li key={c.id}>
              Enfant: {c.student_id} — Prof: {c.teacher_id} — Statut: {c.status}
            </li>
          ))}
        </ul>
        <Link to="/parent/courses">🔎 Voir tous les cours</Link>
      </section>

      <section>
        <h3>💳 Paiements en attente : {unpaid.length}</h3>
        {unpaid.length > 0 ? (
          <p>Vous avez {unpaid.length} cours à régler (simulation pour l’instant).</p>
        ) : (
          <p>Aucun paiement en attente.</p>
        )}
      </section>
    </div>
  );
}