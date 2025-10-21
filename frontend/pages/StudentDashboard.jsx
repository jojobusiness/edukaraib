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
  onSnapshot,
  orderBy,
  setDoc,
  deleteDoc,
  limit,
} from 'firebase/firestore';
import { autoClearPaymentDueNotifications } from '../lib/paymentNotifications';

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
  if (start <= now) start.setDate(start.getDate() + 7);
  return start;
}

// ---------- Fetch helpers ----------
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
async function resolveNamesForParticipants(lessons) {
  const setIds = new Set();
  lessons.forEach(l => {
    if (l.student_id) setIds.add(l.student_id);
    if (l.is_group && Array.isArray(l.participant_ids)) l.participant_ids.forEach(id => id && setIds.add(id));
  });
  const ids = Array.from(setIds);
  const map = new Map();
  for (const id of ids) {
    // users d'abord
    let nm = null;
    try {
      const s = await getDoc(doc(db, 'users', id));
      if (s.exists()) {
        const d = s.data();
        nm = d.fullName || d.name || d.displayName;
      }
    } catch {}
    if (!nm) {
      try {
        const s = await getDoc(doc(db, 'students', id));
        if (s.exists()) {
          const d = s.data();
          nm = d.full_name || d.name;
        }
      } catch {}
    }
    map.set(id, nm || 'Élève');
  }
  return map;
}

// --- helper : confirmé pour MOI (élève) ---
function isConfirmedForMe(l, uid) {
  if (!uid) return false;
  if (l?.is_group) {
    const st = l?.participantsMap?.[uid]?.status;
    return st === 'accepted' || st === 'confirmed';
  }
  return l?.status === 'confirmed';
}

function formatDT(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString('fr-FR');
  } catch { return ''; }
}

export default function StudentDashboard() {
  const [nextCourse, setNextCourse] = useState(null);
  const [confirmedList, setConfirmedList] = useState([]); // gardé pour les noms de participants du "gros bloc"
  const [groupNamesByLesson, setGroupNamesByLesson] = useState(new Map());
  const [openRowId, setOpenRowId] = useState(null);

  const [recentTeachers, setRecentTeachers] = useState([]);
  const [favoriteTeachers, setFavoriteTeachers] = useState([]);
  const [favoriteIds, setFavoriteIds] = useState(new Set());
  const [totalCourses, setTotalCourses] = useState(0);
  const [notifications, setNotifications] = useState([]);

  // ✅ tick horaire pour faire « expirer » visuellement les notifs à J+2
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const userId = auth.currentUser?.uid;

  // 🔔 Notifications (LIVE) + auto-clean paiement
  useEffect(() => {
    if (!userId) return;
    const notifQ = query(
      collection(db, 'notifications'),
      where('user_id', '==', userId),
      orderBy('created_at', 'desc')
    );
    const unsub = onSnapshot(notifQ, async (snapshot) => {
      setNotifications(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      // nettoyage silencieux des "payment_due" devenues obsolètes
      await autoClearPaymentDueNotifications(userId);
    });
    // premier passage: clean
    autoClearPaymentDueNotifications(userId).catch(() => {});
    return () => unsub();
  }, [userId]);

  // 👉 Filtre J+2 (48h) – visibilité seulement
  const recentNotifications = useMemo(() => {
    const cutoffMs = 2 * 24 * 60 * 60 * 1000;
    return notifications.filter(n => {
      const ts = n?.created_at;
      let d = null;
      try {
        d = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
      } catch { d = null; }
      if (!d || Number.isNaN(d.getTime())) return true;
      return (nowTick - d.getTime()) < cutoffMs;
    });
  }, [notifications, nowTick]);

  // -------- Favoris --------
  useEffect(() => {
    if (!userId) return;
    (async () => {
      const favSnap = await getDocs(query(collection(db, 'favorites'), where('user_id', '==', userId)));
      const ids = favSnap.docs.map(d => d.data().teacher_id).filter(Boolean);
      setFavoriteIds(new Set(ids));

      const profiles = await Promise.all(ids.map(uid => fetchUserProfile(uid)));
      setFavoriteTeachers(
        profiles
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

  // -------- Cours / Prochain cours (incl. groupes) + Profs récents --------
  useEffect(() => {
    if (!userId) return;
    (async () => {
      // Individuels (legacy)
      const snapSolo = await getDocs(query(
        collection(db, 'lessons'),
        where('student_id', '==', userId)
      ));
      // Groupes où je suis participant
      const snapGroup = await getDocs(query(
        collection(db, 'lessons'),
        where('participant_ids', 'array-contains', userId)
      ));
      const lessons = [...snapSolo.docs, ...snapGroup.docs]
        .map(doc => ({ id: doc.id, ...doc.data() }));

      // dédup
      const seen = new Set();
      const allLessons = [];
      for (const l of lessons) {
        if (seen.has(l.id)) continue;
        seen.add(l.id);
        allLessons.push(l);
      }

      setTotalCourses(allLessons.length);

      // Prochain cours confirmé POUR MOI (groupe accepté/confirmé OU individuel confirmé)
      const now = new Date();
      const enriched = allLessons
        .filter(l => FR_DAY_CODES.includes(l.slot_day) && isConfirmedForMe(l, userId))
        .map(l => ({ ...l, startAt: nextOccurrence(l.slot_day, l.slot_hour, now) }))
        .filter(l => l.startAt && l.startAt > now)
        .sort((a, b) => a.startAt - b.startAt);

      let nextCourseWithProf = null;
      if (enriched[0]) {
        const t = await fetchUserProfile(enriched[0].teacher_id);
        nextCourseWithProf = {
          ...enriched[0],
          teacherName: t?.fullName || t?.name || t?.displayName || 'Professeur',
        };
      }
      setNextCourse(nextCourseWithProf);

      // Liste confirmés pour l’affichage des participants (même règle que ci-dessus)
      const confirmed = allLessons
        .filter(l => FR_DAY_CODES.includes(l.slot_day) && isConfirmedForMe(l, userId))
        .map(l => ({ ...l, startAt: nextOccurrence(l.slot_day, l.slot_hour, now) }))
        .filter(l => l.startAt)
        .sort((a, b) => a.startAt - b.startAt);

      setConfirmedList(confirmed);

      // Noms pour les groupes (requis par le bouton 👥 du gros bloc)
      const namesMap = await resolveNamesForParticipants(confirmed);
      const gMap = new Map();
      confirmed.forEach(l => {
        if (!l.is_group) return;
        const ids = [
          ...(Array.isArray(l.participant_ids) ? l.participant_ids : []),
          ...(l.student_id ? [l.student_id] : []),
        ];
        const uniq = Array.from(new Set(ids));
        gMap.set(l.id, uniq.map(id => namesMap.get(id) || 'Élève'));
      });
      setGroupNamesByLesson(gMap);

      // === Profs récents ===
      const teacherIds = new Set();
      allLessons.forEach((l) => {
        if (!l.teacher_id) return;
        if (l.status === 'completed' || isConfirmedForMe(l, userId)) {
          teacherIds.add(l.teacher_id);
        }
      });
      const teacherProfiles = await Promise.all(Array.from(teacherIds).map(uid => fetchUserProfile(uid)));
      const recents = teacherProfiles
        .filter(Boolean)
        .map(p => ({
          uid: p.uid || p.id,
          name: p.fullName || p.name || p.displayName || 'Professeur',
          avatar: p.avatarUrl || p.avatar_url || p.photoURL || '',
          subjects: Array.isArray(p.subjects) ? p.subjects.join(', ') : (p.subjects || ''),
        }));
      setRecentTeachers(recents);
    })();
  }, [userId]);

  // -------- Toggle favori --------
  const toggleFavorite = async (teacherUid) => {
    if (!userId || !teacherUid) return;
    const key = `${userId}_${teacherUid}`;
    const isFav = favoriteIds.has(teacherUid);

    if (isFav) {
      await deleteDoc(doc(db, 'favorites', key)).catch(() => {});
      const next = new Set(favoriteIds);
      next.delete(teacherUid);
      setFavoriteIds(next);
      setFavoriteTeachers(prev => prev.filter(p => p.uid !== teacherUid));
    } else {
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
    if (!nextCourse) return 'Aucun cours confirmé à venir';
    const datePart = nextCourse.startAt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
    const timePart = nextCourse.startAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const who = nextCourse.is_group
      ? 'Groupe'
      : 'Cours';
    return `${who} ${nextCourse.subject_id ? `(${nextCourse.subject_id}) ` : ''}- ${datePart} ${timePart} avec ${nextCourse.teacherName}`;
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
        {/* Prochain cours (gros bloc conservé) */}
        <div className="bg-white rounded-xl shadow p-6 border-l-4 border-primary flex flex-col items-start">
          <span className="text-3xl mb-2">📅</span>
          <span className="text-xl font-bold text-primary">Prochain cours</span>
          <span className="text-gray-700 mt-1">
            {ProchainCoursText}
          </span>
          {nextCourse?.is_group && (
            <div className="mt-3">
              <button
                onClick={() => setOpenRowId(openRowId === nextCourse.id ? null : nextCourse.id)}
                className="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded hover:bg-indigo-100"
              >
                👥 Participants
              </button>
              {openRowId === nextCourse.id && (
                <div className="mt-2 bg-white border rounded-lg shadow p-3 w-72">
                  <div className="text-xs font-semibold mb-1">Élèves du groupe</div>
                  {(groupNamesByLesson.get(nextCourse.id) || []).length ? (
                    <ul className="text-sm text-gray-700 list-disc pl-4 space-y-1">
                      {(groupNamesByLesson.get(nextCourse.id) || []).map((nm, i) => <li key={i}>{nm}</li>)}
                    </ul>
                  ) : (
                    <div className="text-xs text-gray-500">Aucun participant.</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Profs favoris */}
        <div className="bg-white rounded-xl shadow p-6 border-l-4 border-yellow-400 flex flex-col items-start">
          <span className="text-3xl mb-2">👨‍🏫</span>
          <span className="text-xl font-bold text-yellow-600">Profs favoris</span>
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

        {/* Stats */}
        <div className="bg-white rounded-xl shadow p-6 border-l-4 border-secondary flex flex-col items-start">
          <span className="text-3xl mb-2">📚</span>
          <span className="text-xl font-bold text-secondary">Cours suivis</span>
          <span className="text-gray-700 mt-1">{totalCourses} cette année</span>
        </div>
      </div>

      {/* Notifications (titre + message + date) */}
      <div className="bg-white rounded-xl shadow p-5 mt-6">
        <h3 className="font-bold text-primary mb-3">Notifications</h3>
        {recentNotifications.length === 0 ? (
          <div className="text-gray-500 text-sm">Aucune notification.</div>
        ) : (
          <ul className="divide-y">
            {recentNotifications.map(n => (
              <li key={n.id} className="py-2">
                <div className="text-sm font-semibold">{n.title || n.type || 'Notification'}</div>
                {n.message ? (
                  <div className="text-sm text-gray-700">{n.message}</div>
                ) : null}
                <div className="text-xs text-gray-500 mt-0.5">{formatDT(n.created_at)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </DashboardLayout>
  );
}