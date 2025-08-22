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

async function fetchUserProfile(uid) {
  if (!uid) return null;
  try {
    const d = await getDoc(doc(db, 'users', uid));
    if (d.exists()) return { id: uid, ...d.data() };
  } catch {}
  return null;
}

export default function useStudentCourses() {
  const [courses, setCourses] = useState([]);          // cours enrichis
  const [loading, setLoading] = useState(true);
  const teacherCacheRef = useRef(new Map());           // uid -> {name, avatar}
  const reviewedIdsRef = useRef(new Set());            // Set(lesson_id)
  const lessonsMapRef = useRef(new Map());             // id -> lesson

  useEffect(() => {
    let unsubAuth = () => {};
    let unsubLessons = () => {};
    let unsubReviews = () => {};

    const recompute = () => {
      const arr = Array.from(lessonsMapRef.current.values()).map((course) => {
        const t = teacherCacheRef.current.get(course.teacher_id) || {};
        return {
          ...course,
          teacherName: t.name || course.teacher_id,
          teacherAvatar: t.avatar || '',
          hasReview: reviewedIdsRef.current.has(course.id),
        };
      });
      // tri (récent -> ancien si date)
      arr.sort((a, b) => {
        const as = a.start_datetime?.seconds || a.start_datetime?.toMillis?.() || 0;
        const bs = b.start_datetime?.seconds || b.start_datetime?.toMillis?.() || 0;
        return bs - as;
      });
      setCourses(arr);
    };

    const ensureTeacherProfile = async (uid) => {
      if (!uid || teacherCacheRef.current.has(uid)) return;
      const p = await fetchUserProfile(uid);
      if (p) {
        teacherCacheRef.current.set(uid, {
          name: p.fullName || p.name || p.displayName || 'Professeur',
          avatar: p.avatarUrl || p.avatar_url || p.photoURL || '',
        });
        recompute();
      }
    };

    unsubAuth = onAuthStateChanged(auth, (user) => {
      // cleanup anciens subs
      unsubLessons(); unsubLessons = () => {};
      unsubReviews(); unsubReviews = () => {};
      lessonsMapRef.current.clear();
      reviewedIdsRef.current = new Set();
      setCourses([]);
      setLoading(true);

      if (!user?.uid) { setLoading(false); return; }

      // Listen cours de l'élève
      const qLessons = query(collection(db, 'lessons'), where('student_id', '==', user.uid));
      unsubLessons = onSnapshot(qLessons, async (snap) => {
        const seenTeacher = new Set();
        snap.docChanges().forEach((ch) => {
          const data = { id: ch.doc.id, ...ch.doc.data() };
          if (ch.type === 'removed') {
            lessonsMapRef.current.delete(ch.doc.id);
          } else {
            lessonsMapRef.current.set(ch.doc.id, data);
            if (data.teacher_id) seenTeacher.add(data.teacher_id);
          }
        });

        // fetch profils profs manquants
        await Promise.all(Array.from(seenTeacher).map(ensureTeacherProfile));
        recompute();
        setLoading(false);
      }, (err) => {
        console.error(err);
        setLoading(false);
      });

      // Listen avis de l'élève
      const qReviews = query(collection(db, 'reviews'), where('student_id', '==', user.uid));
      unsubReviews = onSnapshot(qReviews, (snap) => {
        reviewedIdsRef.current = new Set(snap.docs.map(r => r.data().lesson_id));
        recompute();
      });
    });

    return () => {
      unsubLessons();
      unsubReviews();
      unsubAuth();
    };
  }, []);

  return { courses, loading, setCourses };
}