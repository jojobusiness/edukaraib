import React, { useEffect, useMemo, useRef, useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import { auth, db } from '../lib/firebase';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  limit,
} from 'firebase/firestore';

const statusColors = {
  booked: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-green-100 text-green-800',
  completed: 'bg-gray-100 text-gray-700',
  rejected: 'bg-red-100 text-red-700',
};

async function fetchUserProfile(uid) {
  if (!uid) return null;
  try {
    const s = await getDoc(doc(db, 'users', uid));
    if (s.exists()) return { id: uid, ...s.data() };
  } catch {}
  try {
    const q = query(collection(db, 'users'), where('uid', '==', uid), limit(1));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const d = snap.docs[0];
      return { id: d.id, ...d.data() };
    }
  } catch {}
  return null;
}
async function fetchStudentDoc(id) {
  if (!id) return null;
  try {
    const s = await getDoc(doc(db, 'students', id));
    if (s.exists()) return { id, ...s.data() };
  } catch {}
  return null;
}
async function resolvePersonName(id, cacheRef) {
  if (!id) return '';
  if (cacheRef.current.has(id)) return cacheRef.current.get(id);
  try {
    const u = await getDoc(doc(db, 'users', id));
    if (u.exists()) {
      const d = u.data();
      const nm = d.fullName || d.name || d.displayName || id;
      cacheRef.current.set(id, nm);
      return nm;
    }
  } catch {}
  const s = await fetchStudentDoc(id);
  if (s) {
    const nm = s.full_name || s.name || id;
    cacheRef.current.set(id, nm);
    return nm;
  }
  cacheRef.current.set(id, id);
  return id;
}

export default function MyCourses() {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);

  const [openGroupId, setOpenGroupId] = useState(null);
  const [groupNamesByLesson, setGroupNamesByLesson] = useState(new Map());
  const nameCacheRef = useRef(new Map());

  useEffect(() => {
    const run = async () => {
      if (!auth.currentUser) return;
      setLoading(true);
      const uid = auth.currentUser.uid;

      // A) je suis dans student_id
      const qA = query(collection(db, 'lessons'), where('student_id', '==', uid));
      const sA = await getDocs(qA);

      // B) je suis dans participant_ids
      const qB = query(collection(db, 'lessons'), where('participant_ids', 'array-contains', uid));
      const sB = await getDocs(qB);

      const map = new Map();
      sA.docs.forEach(d => map.set(d.id, { id: d.id, ...d.data() }));
      sB.docs.forEach(d => map.set(d.id, { id: d.id, ...d.data() }));

      // On montre confirmés + terminés
      const data = Array.from(map.values()).filter(
        l => l.status === 'confirmed' || l.status === 'completed'
      );

      setCourses(data);

      // participants
      const idSet = new Set();
      data.forEach(l => {
        if (l.is_group) {
          (Array.isArray(l.participant_ids) ? l.participant_ids : []).forEach(id => id && idSet.add(id));
          if (l.student_id) idSet.add(l.student_id);
        }
      });
      const ids = Array.from(idSet);
      const names = await Promise.all(ids.map(id => resolvePersonName(id, nameCacheRef)));
      const idToName = new Map(ids.map((id, i) => [id, names[i]]));

      const mapByLesson = new Map();
      data.forEach(l => {
        if (!l.is_group) return;
        const idsForLesson = [
          ...(Array.isArray(l.participant_ids) ? l.participant_ids : []),
          ...(l.student_id ? [l.student_id] : []),
        ];
        const uniq = Array.from(new Set(idsForLesson));
        const nmList = uniq.map(id => idToName.get(id) || id);
        mapByLesson.set(l.id, nmList);
      });
      setGroupNamesByLesson(mapByLesson);

      if (openGroupId && !data.some(x => x.id === openGroupId)) {
        setOpenGroupId(null);
      }

      setLoading(false);
    };

    run();
  }, []);

  return (
    <DashboardLayout role="student">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-2xl font-bold text-primary mb-6">📚 Mes cours</h2>

        {loading ? (
          <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Chargement…</div>
        ) : (
          <div className="grid grid-cols-1 gap-5">
            {courses.length === 0 && (
              <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">
                Aucun cours confirmé/terminé pour l’instant.
              </div>
            )}

            {courses.map((c) => {
              const isGroup = !!c.is_group;
              const groupNames = groupNamesByLesson.get(c.id) || [];
              const open = openGroupId === c.id;

              return (
                <div
                  key={c.id}
                  className="bg-white p-6 rounded-xl shadow border flex flex-col md:flex-row md:items-center gap-4 justify-between relative"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex gap-2 items-center mb-1">
                      <span className="font-bold text-primary">{c.subject_id || 'Matière'}</span>
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ml-2 ${statusColors[c.status] || 'bg-gray-200'}`}>
                        {c.status === 'confirmed' ? 'Confirmé' : c.status === 'completed' ? 'Terminé' : c.status}
                      </span>

                      {isGroup && (
                        <button
                          className="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded hover:bg-indigo-100"
                          onClick={() => setOpenGroupId(open ? null : c.id)}
                          title="Voir les élèves du groupe"
                        >
                          👥 {groupNames.length}
                        </button>
                      )}
                    </div>

                    <div className="text-gray-700 text-sm">
                      Professeur : <span className="font-semibold">{c.teacher_id}</span>
                    </div>
                    <div className="text-gray-500 text-xs mb-1">
                      {(c.slot_day || c.slot_hour !== undefined) && `${c.slot_day} ${String(c.slot_hour).padStart(2, '0')}:00`}
                    </div>
                  </div>

                  {/* Mini-fenêtre participants */}
                  {isGroup && open && (
                    <div className="absolute top-full mt-2 left-6 z-10 bg-white border rounded-lg shadow p-3 w-64">
                      <div className="text-xs font-semibold mb-1">Élèves du groupe</div>
                      {groupNames.length ? (
                        <ul className="text-sm text-gray-700 list-disc pl-4 space-y-1">
                          {groupNames.map((nm, i) => (
                            <li key={i}>{nm}</li>
                          ))}
                        </ul>
                      ) : (
                        <div className="text-xs text-gray-500">Aucun participant.</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}