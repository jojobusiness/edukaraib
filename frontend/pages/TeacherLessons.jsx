import React, { useEffect, useRef, useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import { auth, db } from '../lib/firebase';
import {
  collection,
  getDocs,
  query,
  where,
  doc,
  getDoc,
  updateDoc,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';

// --- helpers ---
const statusColors = {
  booked: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-700',
  completed: 'bg-gray-200 text-gray-700',
};

const FR_DAY_CODES = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const fmtTime = (ms) =>
  new Date(ms).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const fmtFromSlot = (slot_day, slot_hour) =>
  `${slot_day || ''} ${slot_hour != null ? `• ${String(slot_hour).padStart(2, '0')}:00` : ''}`.trim();

/** essaie users/{uid} puis students/{id} pour obtenir le nom */
async function resolveStudentName(studentId) {
  if (!studentId) return 'Élève';

  // 1) users/{uid}
  try {
    const u = await getDoc(doc(db, 'users', studentId));
    if (u.exists()) {
      const d = u.data();
      return d.fullName || d.name || d.displayName || studentId;
    }
  } catch {}

  // 2) students/{id}
  try {
    const s = await getDoc(doc(db, 'students', studentId));
    if (s.exists()) {
      const d = s.data();
      return d.full_name || d.name || studentId;
    }
  } catch {}

  return studentId;
}

export default function TeacherLessons() {
  const [lessons, setLessons] = useState([]);
  const [loading, setLoading] = useState(true);
  const nameCacheRef = useRef(new Map());

  useEffect(() => {
    const fetch = async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;

      setLoading(true);
      const qLessons = query(collection(db, 'lessons'), where('teacher_id', '==', uid));
      const snapshot = await getDocs(qLessons);

      const raw = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

      // enrichissement avec studentName (users OU students) avec cache
      const enriched = await Promise.all(
        raw.map(async (l) => {
          const sid = l.student_id;
          if (!sid) return { ...l, studentName: 'Élève' };
          if (nameCacheRef.current.has(sid)) {
            return { ...l, studentName: nameCacheRef.current.get(sid) };
          }
          const name = await resolveStudentName(sid);
          nameCacheRef.current.set(sid, name);
          return { ...l, studentName: name };
        })
      );

      setLessons(enriched);
      setLoading(false);
    };

    fetch();
  }, []);

  const handleStatus = async (id, status) => {
    // MAJ Firestore
    await updateDoc(doc(db, 'lessons', id), { status });
    // MAJ UI optimiste
    setLessons((prev) => prev.map((l) => (l.id === id ? { ...l, status } : l)));

    // Trouver la leçon et infos prof pour notif
    const lesson = lessons.find((l) => l.id === id);
    if (!lesson) return;

    let profName = 'Votre professeur';
    try {
      const profSnap = await getDoc(doc(db, 'users', auth.currentUser.uid));
      if (profSnap.exists()) profName = profSnap.data().fullName || profName;
    } catch {}

    // Préparer la notif
    let notifText = '';
    let notifType = '';
    if (status === 'confirmed') {
      notifText = `Votre cours avec ${profName} a été accepté !`;
      notifType = 'cours_accepted';
    } else if (status === 'rejected') {
      notifText = `Votre cours avec ${profName} a été refusé.`;
      notifType = 'cours_rejected';
    } else {
      return; // autres statuts: pas de notif
    }

    // Créer la notification côté élève
    await addDoc(collection(db, 'notifications'), {
      user_id: lesson.student_id,   // destinataire = élève
      type: notifType,              // <- ne plus hardcoder
      with_id: auth.currentUser.uid,
      withName: profName,
      lesson_id: lesson.id,
      message: notifText,
      created_at: serverTimestamp(),
      read: false,
    });
  };

  const renderWhen = (l) => {
    if (l.start_datetime?.seconds) {
      return `📅 ${fmtTime(l.start_datetime.seconds * 1000)}`;
    }
    if (l.slot_day || l.slot_hour != null) {
      return `📅 ${fmtFromSlot(l.slot_day, l.slot_hour)}`;
    }
    return '';
    // Si tu souhaites convertir slot_day/slot_hour en vraie Date,
    // dis-moi et on reprendra la même logique que dans TeacherCalendar.
  };

  return (
    <DashboardLayout role="teacher">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-2xl font-bold text-primary mb-6">Demandes de cours</h2>

        {loading ? (
          <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">
            Chargement…
          </div>
        ) : lessons.length === 0 ? (
          <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">
            Aucune demande de cours pour le moment.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5">
            {lessons.map((l) => (
              <div
                key={l.id}
                className="bg-white p-6 rounded-xl shadow border flex flex-col md:flex-row md:items-center gap-4 justify-between"
              >
                <div className="flex-1">
                  <div className="flex gap-2 items-center mb-1">
                    <span className="font-bold text-primary">
                      {l.subject_id || 'Matière'}
                    </span>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-semibold ml-2 ${
                        statusColors[l.status] || 'bg-gray-200'
                      }`}
                    >
                      {l.status === 'booked'
                        ? 'En attente'
                        : l.status === 'confirmed'
                        ? 'Confirmé'
                        : l.status === 'rejected'
                        ? 'Refusé'
                        : l.status === 'completed'
                        ? 'Terminé'
                        : l.status}
                    </span>
                  </div>

                  <div className="text-gray-700">
                    Élève : <span className="font-semibold">{l.studentName}</span>
                  </div>

                  <div className="text-gray-500 text-sm">{renderWhen(l)}</div>
                </div>

                {l.status === 'booked' && (
                  <div className="flex gap-2">
                    <button
                      className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded shadow font-semibold"
                      onClick={() => handleStatus(l.id, 'confirmed')}
                    >
                      ✅ Accepter
                    </button>
                    <button
                      className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded shadow font-semibold"
                      onClick={() => handleStatus(l.id, 'rejected')}
                    >
                      ❌ Refuser
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}