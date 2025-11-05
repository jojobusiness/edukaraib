import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { auth, db } from '../lib/firebase';
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import DashboardLayout from '../components/DashboardLayout';

// --- Helpers ---
function formatDateMaybe(ts) {
  if (!ts) return '';
  if (typeof ts?.toDate === 'function') return ts.toDate().toLocaleString('fr-FR');
  if (typeof ts?.seconds === 'number') return new Date(ts.seconds * 1000).toLocaleString('fr-FR');
  if (typeof ts === 'number') return new Date(ts).toLocaleString('fr-FR');
  if (typeof ts === 'string') {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? '' : d.toLocaleString('fr-FR');
  }
  return '';
}

function pad2(n) {
  try { return String(n).padStart(2, '0'); } catch { return n; }
}

/**
 * Rend une info date/heure lisible pour une leçon
 */
function renderWhen(lesson) {
  if (lesson?.start_datetime) {
    const s = formatDateMaybe(lesson.start_datetime);
    if (s) return `📅 ${s}`;
  }
  if (lesson?.slot_day || lesson?.slot_hour != null) {
    const d = lesson.slot_day || '';
    const h = lesson?.slot_hour != null ? `${pad2(lesson.slot_hour)}:00` : '';
    const sep = d && h ? ' • ' : '';
    return `📅 ${d}${sep}${h}`.trim();
  }
  return '📅 Date ?';
}

const statusStyles = {
  booked: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  confirmed: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  completed: 'bg-gray-50 text-gray-700 ring-1 ring-gray-200',
  rejected: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
};

export default function ChildDetails() {
  const { childId } = useParams();
  const [child, setChild] = useState(null);
  const [courses, setCourses] = useState([]);
  const [loadingChild, setLoadingChild] = useState(true);
  const [loadingCourses, setLoadingCourses] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchChild = async () => {
      if (!childId) return;
      setLoadingChild(true);
      try {
        const childSnap = await getDoc(doc(db, 'students', childId));
        if (childSnap.exists()) {
          setChild({ id: childSnap.id, ...childSnap.data() });
        } else {
          navigate('/parent/children');
        }
      } catch (e) {
        console.error(e);
        navigate('/parent/children');
      } finally {
        setLoadingChild(false);
      }
    };

    const fetchCourses = async () => {
      if (!childId) return;
      setLoadingCourses(true);
      try {
        const qLessons = query(collection(db, 'lessons'), where('student_id', '==', childId));
        const snapshot = await getDocs(qLessons);
        const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

        // tri
        data.sort((a, b) => {
          const aTs = a.start_datetime?.seconds || a.start_datetime?.toMillis?.() || 0;
          const bTs = b.start_datetime?.seconds || b.start_datetime?.toMillis?.() || 0;
          if (bTs !== aTs) return bTs - aTs;
          const ah = typeof a.slot_hour === 'number' ? a.slot_hour : -1;
          const bh = typeof b.slot_hour === 'number' ? b.slot_hour : -1;
          return bh - ah;
        });

        setCourses(data);
      } catch (e) {
        console.error(e);
        setCourses([]);
      } finally {
        setLoadingCourses(false);
      }
    };

    fetchChild();
    fetchCourses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childId]);

  return (
    <DashboardLayout role="parent">
      <div className="max-w-3xl mx-auto container-fluid py-4">
        <Link
          to="/parent/children"
          className="inline-flex items-center gap-2 text-sm text-primary hover:text-primary-dark transition mb-4"
        >
          <span>←</span> Retour à la liste
        </Link>

        {/* Carte enfant */}
        {loadingChild ? (
          <div className="bg-white border rounded-2xl shadow-sm p-6 mb-8">
            <div className="animate-pulse flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-gray-100" />
              <div className="flex-1 space-y-3">
                <div className="h-4 bg-gray-100 rounded w-1/2" />
                <div className="h-3 bg-gray-100 rounded w-1/3" />
                <div className="h-3 bg-gray-100 rounded w-1/4" />
              </div>
            </div>
          </div>
        ) : child ? (
          <div className="relative overflow-hidden bg-white border rounded-3xl shadow-sm mb-8">
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-emerald-500 to-primary" />
            <div className="p-6 md:p-8 flex flex-col items-center text-center">
              <div className="w-20 h-20 rounded-2xl bg-primary/10 ring-1 ring-primary/20 flex items-center justify-center text-3xl text-primary mb-3">
                👦
              </div>
              <div className="text-2xl font-extrabold text-gray-900">{child.full_name}</div>
              <div className="text-sm text-gray-600 mt-1">
                <span className="inline-flex items-center gap-1">
                  🎓 <b>{child.school_level || "?"}</b>
                </span>
              </div>
              <div className="text-xs text-gray-500 mt-1">
                🎂 Né(e) le {child.birth_date || "?"}
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white border rounded-2xl shadow-sm p-6 mb-8 text-center text-gray-600">
            Enfant introuvable.
          </div>
        )}

        {/* Historique des cours */}
        <div className="bg-white/90 backdrop-blur border rounded-2xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-gray-900">Historique des cours</h3>
            {!loadingCourses && courses?.length > 0 && (
              <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600 ring-1 ring-gray-200">
                {courses.length} cours
              </span>
            )}
          </div>

          {loadingCourses ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="animate-pulse border rounded-xl p-4 bg-gray-50">
                  <div className="h-4 bg-gray-100 rounded w-1/3 mb-2" />
                  <div className="h-3 bg-gray-100 rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {courses.length === 0 && (
                <div className="text-gray-500 text-sm bg-gray-50 border rounded-xl p-4 text-center">
                  Aucun cours réservé pour cet enfant.
                </div>
              )}

              {courses.map((c) => (
                <div
                  key={c.id}
                  className="border rounded-xl px-4 py-3 flex flex-col md:flex-row md:items-center gap-2 bg-gray-50 hover:bg-white transition shadow-sm"
                >
                  <span className="font-semibold text-gray-900">
                    {c.subject_id || "Matière"}
                  </span>

                  <span className="text-gray-600 text-sm md:ml-auto">
                    {renderWhen(c)}
                  </span>

                  <span
                    className={`text-xs px-3 py-1 rounded-full font-semibold ${statusStyles[c.status] || 'bg-gray-50 text-gray-700 ring-1 ring-gray-200'}`}
                    title={c.status}
                  >
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
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}