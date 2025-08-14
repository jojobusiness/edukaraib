import React, { useEffect, useMemo, useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import { auth, db } from '../lib/firebase';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  setDoc,
  deleteDoc,
  limit,
} from 'firebase/firestore';
import NotifList from '../components/NotifList';

// ---------- Helpers temps ----------
const FR_DAY_CODES = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const codeIndex = (c) => Math.max(0, FR_DAY_CODES.indexOf(c));

function weekMonday(base = new Date()) {
  const d = new Date(base);
  const jsDay = d.getDay(); // 0=Dim..6=Sam
  const offsetToMonday = ((jsDay + 6) % 7);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - offsetToMonday);
  return d;
}

function nextOccurrence(slot_day, slot_hour, now = new Date()) {
  if (!FR_DAY_CODES.includes(slot_day)) return null;
  const mon = weekMonday(now);
  const idx = codeIndex(slot_day);
  const start = new Date(mon);
  start.setDate(mon.getDate() + idx);
  start.setHours(Number(slot_hour) || 0, 0, 0, 0);
  // si l'horaire de cette semaine est déjà passé, prendre la semaine suivante
  if (start <= now) {
    start.setDate(start.getDate() + 7);
  }
  return start;
}

// ---------- Helpers data ----------
async function fetchUserProfile(uid) {
  if (!uid) return null;
  // users/{uid}
  try {
    const s = await getDoc(doc(db, 'users', uid));
    if (s.exists()) return { id: uid, ...s.data() };
  } catch {}
  // where uid == <uid>
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

export default function StudentDashboard() {
  const [nextCourse, setNextCourse] = useState(null);
  const [recentTeachers, setRecentTeachers] = useState([]); // profs rencontrés récemment (pour choisir favoris)
  const [favoriteTeachers, setFavoriteTeachers] = useState([]); // profils des favoris
  const [favoriteIds, setFavoriteIds] = useState(new Set()); // set d'UID prof favoris
  const [totalCourses, setTotalCourses] = useState(0);
  const [notifications, setNotifications] = useState([]);

  const userId = auth.currentUser?.uid;

  // -------- Notifications (LIVE) --------
  useEffect(() => {
    if (!userId) return;
    const notifQ = query(
      collection(db, 'notifications'),
      where('user_id', '==', userId),
      orderBy('created_at', 'desc')
    );
    const unsub = onSnapshot(notifQ, (snapshot) => {
      setNotifications(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsub();
  }, [userId]);

  // -------- Favoris: chargement --------
  useEffect(() => {
    if (!userId) return;
    (async () => {
      const favSnap = await getDocs(query(collection(db, 'favorites'), where('user_id', '==', userId)));
      const ids = favSnap.docs.map(d => d.data().teacher_id).filter(Boolean);
      setFavoriteIds(new Set(ids));

      // charger profils des favoris
      const profiles = await Promise.all(ids.map(uid => fetchUserProfile(uid)));
      setFavoriteTeachers(
        profiles
          .filter(Boolean)
          .map(p => ({
            uid: p.uid || p.id,
            name: p.fullName || p.name || p.displayName || 'Professeur',
            avatar: p.avatarUrl || p.avatar_url || p.photoURL || '',
            subjects: p.subjects || '',
          }))
      );
    })();
  }, [userId]);

  // -------- Cours / Prochain cours / Profs rencontrés --------
  useEffect(() => {
    if (!userId) return;
    (async () => {
      // 1) Tous les cours de l'élève
      const lessonsSnap = await getDocs(query(
        collection(db, 'lessons'),
        where('student_id', '==', userId)
      ));
      const lessons = lessonsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTotalCourses(lessons.length);

      // 2) Calcul du prochain cours (confirmed & futur) avec slot_day/slot_hour
      const now = new Date();
      const enriched = lessons
        .filter(l => l.status === 'confirmed' && FR_DAY_CODES.includes(l.slot_day))
        .map(l => ({
          ...l,
          startAt: nextOccurrence(l.slot_day, l.slot_hour, now),
        }))
        .filter(l => l.startAt && l.startAt > now)
        .sort((a, b) => a.startAt - b.startAt);

      let nextCourseWithProf = null;
      if (enriched[0]) {
        const t = await fetchUserProfile(enriched[0].teacher_id);
        nextCourseWithProf = {
          ...enriched[0],
          teacherName: t?.fullName || t?.name || t?.displayName || enriched[0].teacher_id,
        };
      }
      setNextCourse(nextCourseWithProf);

      // 3) Profs rencontrés récemment (sur base des cours triés par proximité temporelle)
      const uniqueTeacherIds = Array.from(
        new Set(
          enriched
            .map(l => l.teacher_id)
            .concat(lessons.map(l => l.teacher_id)) // fallback si pas de confirmed à venir
        )
      ).slice(0, 5);

      const teacherProfiles = await Promise.all(uniqueTeacherIds.map(uid => fetchUserProfile(uid)));
      setRecentTeachers(
        teacherProfiles
          .filter(Boolean)
          .map(p => ({
            uid: p.uid || p.id,
            name: p.fullName || p.name || p.displayName || 'Professeur',
            avatar: p.avatarUrl || p.avatar_url || p.photoURL || '',
            subjects: Array.isArray(p.subjects) ? p.subjects.join(', ') : (p.subjects || ''),
          }))
      );
    })();
  }, [userId]);

  // -------- Toggle favori --------
  const toggleFavorite = async (teacherUid) => {
    if (!userId || !teacherUid) return;
    const key = `${userId}_${teacherUid}`;
    const isFav = favoriteIds.has(teacherUid);

    if (isFav) {
      // retirer
      await deleteDoc(doc(db, 'favorites', key)).catch(() => {});
      const next = new Set(favoriteIds);
      next.delete(teacherUid);
      setFavoriteIds(next);
      setFavoriteTeachers(prev => prev.filter(p => p.uid !== teacherUid));
    } else {
      // ajouter
      await setDoc(doc(db, 'favorites', key), {
        user_id: userId,
        teacher_id: teacherUid,
        created_at: new Date(),
      }, { merge: true });

      const p = await fetchUserProfile(teacherUid);
      const profile = {
        uid: teacherUid,
        name: p?.fullName || p?.name || p?.displayName || 'Professeur',
        avatar: p?.avatarUrl || p?.avatar_url || p?.photoURL || '',
        subjects: Array.isArray(p?.subjects) ? p.subjects.join(', ') : (p?.subjects || ''),
      };

      const next = new Set(favoriteIds);
      next.add(teacherUid);
      setFavoriteIds(next);
      setFavoriteTeachers(prev => {
        const exists = prev.some(t => t.uid === teacherUid);
        return exists ? prev : [profile, ...prev];
      });
    }
  };

  const FavoriteStar = ({ teacherUid }) => {
    const active = favoriteIds.has(teacherUid);
    return (
      <button
        onClick={() => toggleFavorite(teacherUid)}
        className={`ml-2 text-sm px-2 py-1 rounded ${active ? 'bg-yellow-100 text-yellow-700 border border-yellow-300' : 'bg-gray-100 text-gray-600 border'}`}
        title={active ? 'Retirer des favoris' : 'Ajouter aux favoris'}
      >
        {active ? '★ Favori' : '☆ Favori'}
      </button>
    );
  };

  const ProchainCoursText = useMemo(() => {
    if (!nextCourse) return 'Aucun cours à venir';
    const datePart = nextCourse.startAt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
    const timePart = nextCourse.startAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    return `${nextCourse.subject_id || 'Cours'} - ${datePart} ${timePart} avec ${nextCourse.teacherName}`;
  }, [nextCourse]);

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
        {/* Prochain cours */}
        <div className="bg-white rounded-xl shadow p-6 border-l-4 border-primary flex flex-col items-start">
          <span className="text-3xl mb-2">📅</span>
          <span className="text-xl font-bold text-primary">Prochain cours</span>
          <span className="text-gray-700 mt-1">
            {ProchainCoursText}
          </span>
        </div>

        {/* Profs favoris (sélectionnable) */}
        <div className="bg-white rounded-xl shadow p-6 border-l-4 border-yellow-400 flex flex-col items-start">
          <span className="text-3xl mb-2">👨‍🏫</span>
          <span className="text-xl font-bold text-yellow-600">Profs favoris</span>

          {/* Liste des favoris actuels */}
          <ul className="text-gray-700 mt-2 w-full">
            {favoriteTeachers.length === 0 && <li className="text-gray-500">Aucun favori pour l’instant.</li>}
            {favoriteTeachers.map((p) => (
              <li key={p.uid} className="flex items-center justify-between py-1">
                <div className="truncate">
                  <span className="font-semibold">{p.name}</span>
                  {p.subjects ? <span className="text-gray-500"> — {p.subjects}</span> : null}
                </div>
                <FavoriteStar teacherUid={p.uid} />
              </li>
            ))}
          </ul>

          {/* Choisir parmi les profs récents */}
          <div className="mt-4 w-full">
            <div className="text-sm text-gray-500 mb-1">Récemment contactés</div>
            <ul className="space-y-1">
              {recentTeachers.length === 0 && <li className="text-gray-500">Aucun professeur récent.</li>}
              {recentTeachers.map((p) => (
                <li key={p.uid} className="flex items-center justify-between">
                  <div className="truncate">
                    <span className="font-medium">{p.name}</span>
                    {p.subjects ? <span className="text-gray-500"> — {p.subjects}</span> : null}
                  </div>
                  <FavoriteStar teacherUid={p.uid} />
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Stats rapides */}
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