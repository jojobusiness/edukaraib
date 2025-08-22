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

const chunk10 = (arr) => {
  const out = [];
  for (let i = 0; i < arr.length; i += 10) out.push(arr.slice(i, i + 10));
  return out;
};

async function fetchUserProfile(uid) {
  if (!uid) return null;
  try {
    const d = await getDoc(doc(db, 'users', uid));
    if (d.exists()) return { id: uid, ...d.data() };
  } catch {}
  return null;
}

export default function useParentCourses() {
  const [courses, setCourses] = useState([]);
  const [children, setChildren] = useState([]);  // {id, ...}
  const [loading, setLoading] = useState(true);

  const teacherCacheRef = useRef(new Map());
  const lessonsMapRef = useRef(new Map());       // id -> lesson
  const reviewedIdsRef = useRef(new Set());      // Set(lesson_id)

  useEffect(() => {
    let unsubAuth = () => {};
    let unsubChildren = () => {};
    let unsubLessonsArr = []; // multiples listeners sur chunks
    let unsubReviewsArr = []; // un listener par enfant

    const clearLessonsSubs = () => { unsubLessonsArr.forEach(u => u()); unsubLessonsArr = []; };
    const clearReviewsSubs = () => { unsubReviewsArr.forEach(u => u()); unsubReviewsArr = []; };

    const recompute = () => {
      const arr = Array.from(lessonsMapRef.current.values()).map((lesson) => {
        const t = teacherCacheRef.current.get(lesson.teacher_id) || {};
        return {
          ...lesson,
          teacherName: t.name || lesson.teacher_id,
          teacherAvatar: t.avatar || '',
          hasReview: reviewedIdsRef.current.has(lesson.id),
        };
      });
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
      // cleanup
      unsubChildren(); unsubChildren = () => {};
      clearLessonsSubs();
      clearReviewsSubs();
      lessonsMapRef.current.clear();
      reviewedIdsRef.current = new Set();
      setChildren([]);
      setCourses([]);
      setLoading(true);

      if (!user?.uid) { setLoading(false); return; }

      // LIVE enfants du parent
      const qChildren = query(collection(db, 'students'), where('parent_id', '==', user.uid));
      unsubChildren = onSnapshot(qChildren, (snap) => {
        const kids = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setChildren(kids);

        // rebranche listeners leçons
        clearLessonsSubs();
        lessonsMapRef.current.clear();

        const ids = kids.map(k => k.id);
        if (ids.length === 0) {
          recompute();
          setLoading(false);
          return;
        }

        const chunks = chunk10(ids);
        chunks.forEach((chunk) => {
          const qLessons = query(collection(db, 'lessons'), where('student_id', 'in', chunk));
          const u = onSnapshot(qLessons, async (snap2) => {
            const seenTeacher = new Set();
            snap2.docChanges().forEach((ch) => {
              const data = { id: ch.doc.id, ...ch.doc.data() };
              if (ch.type === 'removed') {
                lessonsMapRef.current.delete(ch.doc.id);
              } else {
                lessonsMapRef.current.set(ch.doc.id, data);
                if (data.teacher_id) seenTeacher.add(data.teacher_id);
              }
            });
            await Promise.all(Array.from(seenTeacher).map(ensureTeacherProfile));
            recompute();
            setLoading(false);
          }, (err) => {
            console.error(err);
            setLoading(false);
          });
          unsubLessonsArr.push(u);
        });

        // rebranche listeners reviews (un par enfant)
        clearReviewsSubs();
        reviewedIdsRef.current = new Set();
        kids.forEach((k) => {
          const qReviews = query(collection(db, 'reviews'), where('student_id', '==', k.id));
          const u = onSnapshot(qReviews, (rsnap) => {
            const setNew = new Set(reviewedIdsRef.current);
            rsnap.docs.forEach(r => setNew.add(r.data().lesson_id));
            reviewedIdsRef.current = setNew;
            recompute();
          });
          unsubReviewsArr.push(u);
        });
      });
    });

    return () => {
      unsubAuth();
      unsubChildren();
      clearLessonsSubs();
      clearReviewsSubs();
    };
  }, []);

  return { courses, children, loading };
}