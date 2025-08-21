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
  // Firestore Timestamp
  if (typeof ts?.toDate === 'function') return ts.toDate().toLocaleString('fr-FR');
  // Objet { seconds, nanoseconds }
  if (typeof ts?.seconds === 'number') return new Date(ts.seconds * 1000).toLocaleString('fr-FR');
  // Nombre (ms)
  if (typeof ts === 'number') return new Date(ts).toLocaleString('fr-FR');
  // String ISO
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
 * Rend une info date/heure lisible pour une leçon selon ton schéma :
 * - si start_datetime existe => on l’affiche formaté
 * - sinon si slot_day/slot_hour existent => "Lun • 10:00"
 */
function renderWhen(lesson) {
  if (lesson?.start_datetime) {
    const s = formatDateMaybe(lesson.start_datetime);
    if (s) return `📅 ${s}`;
  }
  if (lesson?.slot_day || lesson?.slot_hour != null) {
    const d = lesson.slot_day || '';
    const h = lesson.slot_hour != null ? `${pad2(lesson.slot_hour)}:00` : '';
    const sep = d && h ? ' • ' : '';
    return `📅 ${d}${sep}${h}`.trim();
  }
  return '📅 Date ?';
}

const statusColors = {
  booked: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-green-100 text-green-800',
  completed: 'bg-gray-100 text-gray-700',
  rejected: 'bg-red-100 text-red-700',
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

        // tri (les plus récents en premier si start_datetime, sinon par slot_hour)
        data.sort((a, b) => {
          const aTs = a.start_datetime?.seconds
            || a.start_datetime?.toMillis?.()
            || 0;
          const bTs = b.start_datetime?.seconds
            || b.start_datetime?.toMillis?.()
            || 0;
          if (bTs !== aTs) return bTs - aTs;

          // fallback sur slot_hour si pas de start_datetime
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
      <div className="max-w-2xl mx-auto">
        <Link
          to="/parent/children"
          className="text-primary hover:underline text-sm mb-4 inline-block"
        >
          ← Retour à la liste
        </Link>

        {/* Carte enfant */}
        {loadingChild ? (
          <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center mb-8">
            Chargement...
          </div>
        ) : child ? (
          <div className="bg-white p-8 rounded-2xl shadow-xl border mb-8 flex flex-col items-center">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center text-3xl text-primary mb-3">
              👦
            </div>
            <div className="text-2xl font-bold text-primary mb-1">{child.full_name}</div>
            <div className="text-sm text-gray-600 mb-2">
              Niveau : <b>{child.school_level || "?"}</b>
            </div>
            <div className="text-xs text-gray-500">
              Né(e) le {child.birth_date || "?"}
            </div>
          </div>
        ) : (
          <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center mb-8">
            Enfant introuvable.
          </div>
        )}

        {/* Historique des cours */}
        <div className="bg-white p-6 rounded-xl shadow border">
          <h3 className="font-bold text-primary mb-4">Historique des cours</h3>

          {loadingCourses ? (
            <div className="text-gray-500">Chargement…</div>
          ) : (
            <div className="flex flex-col gap-3">
              {courses.length === 0 && (
                <div className="text-gray-400 text-sm">
                  Aucun cours réservé pour cet enfant.
                </div>
              )}

              {courses.map((c) => (
                <div
                  key={c.id}
                  className="border rounded-lg px-4 py-3 flex flex-col md:flex-row md:items-center gap-2 bg-gray-50"
                >
                  <span className="font-bold text-primary">{c.subject_id || "Matière"}</span>

                  <span className="text-gray-600 text-sm">
                    {renderWhen(c)}
                  </span>

                  <span
                    className={`text-xs px-3 py-1 rounded-full font-semibold ${
                      statusColors[c.status] || 'bg-gray-200'
                    }`}
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