import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { db } from '../lib/firebase';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import DashboardLayout from '../components/DashboardLayout';

export default function ChildDetails() {
  const { childId } = useParams();
  const [child, setChild] = useState(null);
  const [courses, setCourses] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchChild = async () => {
      const childSnap = await getDoc(doc(db, 'students', childId));
      if (childSnap.exists()) setChild({ id: childSnap.id, ...childSnap.data() });
      else navigate('/parent/children');
    };

    const fetchCourses = async () => {
      const q = query(collection(db, 'lessons'), where('student_id', '==', childId));
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setCourses(data);
    };

    if (childId) {
      fetchChild();
      fetchCourses();
    }
    // eslint-disable-next-line
  }, [childId]);

  return (
    <DashboardLayout role="parent">
      <div className="max-w-2xl mx-auto">
        <Link to="/parent/children" className="text-primary hover:underline text-sm mb-4 inline-block">← Retour à la liste</Link>
        {child ? (
          <div className="bg-white p-8 rounded-2xl shadow-xl border mb-8 flex flex-col items-center">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center text-3xl text-primary mb-3">
              👦
            </div>
            <div className="text-2xl font-bold text-primary mb-1">{child.full_name}</div>
            <div className="text-sm text-gray-600 mb-2">Niveau : <b>{child.school_level || "?"}</b></div>
            <div className="text-xs text-gray-500">Né(e) le {child.birth_date || "?"}</div>
          </div>
        ) : (
          <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center mb-8">
            Chargement...
          </div>
        )}

        <div className="bg-white p-6 rounded-xl shadow border">
          <h3 className="font-bold text-primary mb-4">Historique des cours</h3>
          <div className="flex flex-col gap-3">
            {courses.length === 0 && (
              <div className="text-gray-400 text-sm">Aucun cours réservé pour cet enfant.</div>
            )}
            {courses.map((c, idx) => (
              <div key={c.id} className="border rounded-lg px-4 py-3 flex flex-col md:flex-row md:items-center gap-2 bg-gray-50">
                <span className="font-bold text-primary">{c.subject_id || "Matière"}</span>
                <span className="text-gray-600 text-sm">
                  {c.start_datetime ? new Date(c.start_datetime.seconds * 1000).toLocaleString() : "Date ?"}
                </span>
                <span className={`text-xs px-3 py-1 rounded-full font-semibold
                  ${
                    c.status === 'confirmed' ? 'bg-green-100 text-green-800' :
                    c.status === 'booked' ? 'bg-yellow-100 text-yellow-800' :
                    c.status === 'completed' ? 'bg-gray-100 text-gray-700' :
                    c.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-gray-200'
                  }
                `}>
                  {c.status === 'booked'
                    ? 'En attente'
                    : c.status === 'confirmed'
                    ? 'Confirmé'
                    : c.status === 'rejected'
                    ? 'Refusé'
                    : c.status === 'completed'
                    ? 'Terminé'
                    : c.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}