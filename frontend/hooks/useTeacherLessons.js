import { useEffect, useRef, useState } from 'react';
import { auth, db } from '../lib/firebase';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  getDoc,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';

async function resolveStudentName(studentId) {
  if (!studentId) return 'Élève';
  try {
    const u = await getDoc(doc(db, 'users', studentId));
    if (u.exists()) {
      const d = u.data();
      return d.fullName || d.name || d.displayName || studentId;
    }
  } catch {}
  try {
    const s = await getDoc(doc(db, 'students', studentId));
    if (s.exists()) {
      const d = s.data();
      return d.full_name || d.name || studentId;
    }
  } catch {}
  return studentId;
}

export default function useTeacherLessons() {
  const [lessons, setLessons] = useState([]);
  const [loading, setLoading] = useState(true);
  const nameCacheRef = useRef(new Map());

  useEffect(() => {
    let unsubLessons = null;

    const attach = (uid) => {
      if (!uid) return;
      const qLessons = query(collection(db, 'lessons'), where('teacher_id', '==', uid));
      unsubLessons = onSnapshot(qLessons, async (snap) => {
        const raw = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        // enrichir noms élèves
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
        // tri par date si dispo
        enriched.sort((a, b) => {
          const as = a.start_datetime?.seconds || a.start_datetime?.toMillis?.() || 0;
          const bs = b.start_datetime?.seconds || b.start_datetime?.toMillis?.() || 0;
          return bs - as;
        });
        setLessons(enriched);
        setLoading(false);
      }, (err) => {
        console.error(err);
        setLessons([]);
        setLoading(false);
      });
    };

    // attendre l'état d'auth puis s'abonner
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (unsubLessons) { unsubLessons(); unsubLessons = null; }
      if (user?.uid) attach(user.uid);
      else setLessons([]);
    });

    return () => {
      if (unsubLessons) unsubLessons();
      unsubAuth();
    };
  }, []);

  return { lessons, setLessons, loading };
}