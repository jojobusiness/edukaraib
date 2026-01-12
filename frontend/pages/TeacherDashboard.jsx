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
  onSnapshot,
  orderBy,
} from 'firebase/firestore';

// ---------- Helpers jours/heures ----------
const FR_DAY_CODES = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const codeIndex = (c) => Math.max(0, FR_DAY_CODES.indexOf(c));

function mondayOfWeek(base = new Date()) {
  const d = new Date(base);
  const jsDay = d.getDay(); // 0=Dim..6=Sam
  const offsetToMonday = ((jsDay + 6) % 7);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - offsetToMonday);
  return d;
}

function nextOccurrence(slot_day, slot_hour, now = new Date()) {
  if (!FR_DAY_CODES.includes(slot_day)) return null;
  const mon = mondayOfWeek(now);
  const idx = codeIndex(slot_day);
  const start = new Date(mon);
  start.setDate(mon.getDate() + idx);
  start.setHours(Number(slot_hour) || 0, 0, 0, 0);
  if (start <= now) start.setDate(start.getDate() + 7); // semaine suivante si déjà passé
  return start;
}

function formatDate(dt) {
  return dt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
}
function formatTime(dt) {
  return dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
function formatDT(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString('fr-FR');
  } catch { return ''; }
}

function isFreeFor(lesson, uid) {
  return !!lesson?.participantsMap?.[uid]?.is_free;
}

// ---------- Résolution profil (users / students) ----------
async function fetchUserProfile(uid) {
  if (!uid) return null;
  try {
    const s = await getDoc(doc(db, 'users', uid));
    if (s.exists()) return { id: uid, ...s.data(), _source: 'users' };
  } catch {}
  try {
    const q = query(collection(db, 'users'), where('uid', '==', uid), limit(1));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const d = snap.docs[0];
      return { id: d.id, ...d.data(), _source: 'users-query' };
    }
  } catch {}
  return null;
}
async function fetchStudentDoc(id) {
  if (!id) return null;
  try {
    const s = await getDoc(doc(db, 'students', id));
    if (s.exists()) return { id, ...s.data(), _source: 'students' };
  } catch {}
  return null;
}
async function resolvePersonName(id, cacheRef) {
  if (!id) return '';
  if (cacheRef.current.has(id)) return cacheRef.current.get(id);
  let nm = null;
  const u = await fetchUserProfile(id);
  if (u) nm = u.fullName || u.name || u.displayName;
  if (!nm) {
    const s = await fetchStudentDoc(id);
    if (s) nm = s.full_name || s.name;
  }
  if (!nm) nm = 'Élève';
  cacheRef.current.set(id, nm);
  return nm;
}

// ---------- Helpers revenus ----------
function toDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val;
  if (val?.toDate) return val.toDate();
  return new Date(val);
}
function isSameMonth(ts, ref = new Date()) {
  const d = toDate(ts);
  if (!d || Number.isNaN(d.getTime())) return false;
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
}
function coerceAmount(val) {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') return Number(val.replace(',', '.')) || 0;
  return 0;
}

// --- helper confirmation groupe (au moins un accepté/confirmé) ---
function hasAnyConfirmedParticipant(lesson) {
  const pm = lesson?.participantsMap || {};
  const ids = Array.isArray(lesson?.participant_ids) ? lesson.participant_ids : [];
  return ids.some((sid) => {
    const st = pm?.[sid]?.status;
    return st === 'accepted' || st === 'confirmed';
  });
}

// --- helpers "demandes en attente" ---
const PENDING_SET = new Set([
  'booked',
  'pending_teacher',
  'pending_parent',
  'invited_student',
  'invited_parent',
  'requested',
  'pending',
  'awaiting_confirmation',
  'reinvited',
  'awaiting',
]);
function countPendingRequests(lessons) {
  let count = 0;
  for (const l of lessons) {
    if (l.is_group) {
      const ids = Array.isArray(l.participant_ids) ? l.participant_ids : [];
      const pm = l.participantsMap || {};
      ids.forEach((sid) => {
        const st = pm?.[sid]?.status;
        if (!st || PENDING_SET.has(String(st))) count += 1;
      });
    } else {
      if (l.status === 'booked' || l.status === 'pending_teacher') count += 1;
    }
  }
  return count;
}

export default function TeacherDashboard() {
  const [upcomingCourses, setUpcomingCourses] = useState([]); // confirmés, futur (incl. groupes confirmés côté participants)
  const [revenues, setRevenues] = useState(0);
  const [pending, setPending] = useState(0);
  const [reviews, setReviews] = useState([]);
  const [studentMap, setStudentMap] = useState(new Map());
  const [groupNamesByLesson, setGroupNamesByLesson] = useState(new Map()); // lessonId -> [names]
  const [openGroupId, setOpenGroupId] = useState(null); // ✅ unique & cohérent
  const [notifications, setNotifications] = useState([]);

  // ✅ tick horaire pour faire « expirer » visuellement les notifs à J+2
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const userId = auth.currentUser?.uid;
  const nameCacheRef = useRef(new Map());

  useEffect(() => {
    if (!userId) return;

    (async () => {
      // 1) Tous les cours du prof
      const lessonsSnap = await getDocs(
        query(collection(db, 'lessons'), where('teacher_id', '==', userId))
      );
      const lessons = lessonsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      // 2) Résoudre les noms (élève principal & participants)
      const idSet = new Set();
      lessons.forEach(l => {
        if (l.student_id) idSet.add(l.student_id);
        if (l.is_group && Array.isArray(l.participant_ids)) {
          l.participant_ids.forEach((sid) => sid && idSet.add(sid));
        }
      });
      const ids = Array.from(idSet);
      const names = await Promise.all(ids.map(id => resolvePersonName(id, nameCacheRef)));
      const sMap = new Map(ids.map((id, i) => [id, names[i]]));
      setStudentMap(sMap);

      // 3) Map noms par cours (pour le bouton 👥)
      const gMap = new Map();
      lessons.forEach(l => {
        if (!l.is_group) return;
        const idsForLesson = [
          ...(Array.isArray(l.participant_ids) ? l.participant_ids : []),
          ...(l.student_id ? [l.student_id] : []),
        ];
        const uniq = Array.from(new Set(idsForLesson));
        gMap.set(l.id, uniq.map(id => sMap.get(id) || 'Élève'));
      });
      setGroupNamesByLesson(gMap);

      // 4) Cours à venir
      const now = new Date();
      const enriched = lessons
        .filter((l) =>
          FR_DAY_CODES.includes(l.slot_day) &&
          (
            (!l.is_group && l.status === 'confirmed') ||
            (l.is_group && hasAnyConfirmedParticipant(l))
          )
        )
        .map(l => ({ ...l, startAt: nextOccurrence(l.slot_day, l.slot_hour, now) }))
        .filter(l => l.startAt && l.startAt > now)
        .sort((a, b) => a.startAt - b.startAt);

      setUpcomingCourses(enriched.slice(0, 10));

      // 5) Demandes en attente
      setPending(countPendingRequests(lessons));

      // 6) Revenus du mois
      let monthRevenue = 0;
      try {
        const paySnap = await getDocs(
          query(collection(db, 'payments'), where('teacher_id', '==', userId))
        );
        const pays = paySnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const successLike = new Set(['succeeded', 'paid', 'completed']);
        const nowD = new Date();
        const monthPays = pays.filter(p => {
          const paidAt = p.paid_at || p.created_at || null;
          const okMonth = isSameMonth(paidAt, nowD);
          const okStatus = p.status ? successLike.has(String(p.status).toLowerCase()) : true;
          return okMonth && okStatus;
        });

        if (monthPays.length > 0) {
          monthRevenue = monthPays.reduce((sum, p) => {
            const cents =
              (typeof p.amount_cents === 'number' && p.amount_cents) ||
              (typeof p.amount_total === 'number' && p.amount_total) ||
              0;
            const euros = cents ? cents / 100 : coerceAmount(p.amount);
            return sum + (euros || 0);
          }, 0);
        } else {
          // Fallback sur lessons payées ce mois
          monthRevenue = lessons.reduce((sum, l) => {
            const refDate = l.paid_at || l.created_at || null;
            if (!isSameMonth(refDate, nowD)) return sum;
            const price = Number(l.price_per_hour || l.price || 0) || 0;
            if (l.is_group) {
              const map = l.participantsMap || {};
              const paidCount = Object.values(map).filter(
                (p) => p && (p.is_paid || p.paid_at)
              ).length;
              return sum + paidCount * price;
            } else {
              const paid = !!(l.is_paid || l.paid_at);
              return sum + (paid ? price : 0);
            }
          }, 0);
        }
      } catch (e) {
        // Si pas de collection payments
        const nowD = new Date();
        monthRevenue = lessons.reduce((sum, l) => {
          const refDate = l.paid_at || l.created_at || null;
          if (!isSameMonth(refDate, nowD)) return sum;
          const price = Number(l.price_per_hour || l.price || 0) || 0;
          if (l.is_group) {
            const map = l.participantsMap || {};
            const paidCount = Object.values(map).filter(
              (p) => p && (p.is_paid || p.paid_at)
            ).length;
            return sum + paidCount * price;
          } else {
            const paid = !!(l.is_paid || l.paid_at);
            return sum + (paid ? price : 0);
          }
        }, 0);
      }

      if (!Number.isFinite(monthRevenue)) monthRevenue = 0;
      setRevenues(monthRevenue);

      // 7) Avis (derniers)
      const reviewsSnap = await getDocs(
        query(collection(db, 'reviews'), where('teacher_id', '==', userId))
      );
      setReviews(reviewsSnap.docs.map(d => d.data()).slice(0, 3));
    })();
  }, [userId]);

  // 🔔 Notifications pour le PROF (LIVE)
  useEffect(() => {
    if (!userId) return;
    const qNotif = query(
      collection(db, 'notifications'),
      where('user_id', '==', userId),
      orderBy('created_at', 'desc')
    );
    const unsub = onSnapshot(qNotif, (snap) => {
      setNotifications(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
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

  const nextOne = upcomingCourses[0] || null;

  return (
    <DashboardLayout role="teacher">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-primary mb-2 flex items-center gap-2">
          <span role="img" aria-label="Prof">🎓</span>
          Tableau de bord Professeur
        </h2>
        <p className="text-gray-600">Bienvenue sur votre espace professeur, retrouvez ici vos infos clés.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        {/* Prochain cours (gros bloc conservé) */}
        <div className="bg-white rounded-xl shadow p-6 border-l-4 border-primary flex flex-col items-start">
          <span className="text-3xl mb-2">📅</span>
          <span className="text-xl font-bold text-primary">Prochain cours</span>
          <span className="text-gray-700 mt-1">
            {nextOne
              ? (() => {
                  const isGroup = !!nextOne.is_group;
                  const size = (Array.isArray(nextOne.participant_ids) ? nextOne.participant_ids.length : 0) + (nextOne.student_id ? 1 : 0);
                  const cap = nextOne.capacity || (isGroup ? size : 1);
                  const who = isGroup
                    ? `Groupe (${size}/${cap})`
                    : (studentMap.get(nextOne.student_id) || 'Élève');
                  const pm = nextOne?.participantsMap || {};
                  let freeCount = 0;

                  if (nextOne?.is_group) {
                    const ids = Array.isArray(nextOne.participant_ids) ? nextOne.participant_ids : [];
                    ids.forEach((sid) => {
                      if (pm?.[sid]?.status === 'accepted' || pm?.[sid]?.status === 'confirmed') {
                        if (pm?.[sid]?.is_free) freeCount += 1;
                      }
                    });
                  } else if (nextOne?.student_id) {
                    if (pm?.[nextOne.student_id]?.is_free) freeCount = 1;
                  }

                  const giftTag = freeCount > 0 ? ` 🎁${freeCount > 1 ? ` x${freeCount}` : ''}` : '';

                  return `${nextOne.subject_id || 'Cours'} - ${formatDate(nextOne.startAt)} ${formatTime(nextOne.startAt)} — ${who}${giftTag}`;
                })()
              : 'Aucun cours à venir'}
          </span>
          {nextOne?.is_group && (
            <div className="mt-3">
              <button
                onClick={() => setOpenGroupId(openGroupId === nextOne.id ? null : nextOne.id)}
                className="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded hover:bg-indigo-100"
              >
                👥 Participants
              </button>
              {openGroupId === nextOne.id && (
                <div className="mt-2 bg-white border rounded-lg shadow p-3 w-72">
                  <div className="text-xs font-semibold mb-1">Élèves du groupe</div>
                  {(groupNamesByLesson.get(nextOne.id) || []).length ? (
                    <ul className="text-sm text-gray-700 list-disc pl-4 space-y-1">
                      {(groupNamesByLesson.get(nextOne.id) || []).map((nm, i) => <li key={i}>{nm}</li>)}
                    </ul>
                  ) : (
                    <div className="text-xs text-gray-500">Aucun participant.</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Revenus du mois */}
        <div className="bg-white rounded-xl shadow p-6 border-l-4 border-yellow-400 flex flex-col items-start">
          <span className="text-3xl mb-2">💰</span>
          <span className="text-xl font-bold text-yellow-600">Revenus ce mois</span>
          <span className="text-gray-700 mt-1">{Number(revenues || 0).toFixed(2)} €</span>
        </div>

        {/* Demandes en attente */}
        <div className="bg-white rounded-xl shadow p-6 border-l-4 border-secondary flex flex-col items-start">
          <span className="text-3xl mb-2">📝</span>
          <span className="text-xl font-bold text-secondary">Demandes en attente</span>
          <span className="text-gray-700 mt-1">{pending} cours à valider</span>
        </div>
      </div>

      {/* 🔔 Notifications (placées au-dessus des avis) */}
      <div className="bg-white rounded-xl shadow p-5 mb-6">
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

      {/* Derniers avis reçus */}
      <div className="bg-white rounded-xl shadow p-5">
        <h3 className="font-bold text-primary mb-3">Derniers avis reçus</h3>
        <ul className="text-gray-700 space-y-2">
          {reviews.map((r, idx) => (
            <li key={idx}>
              {"🌟".repeat(r.stars || r.rating || 5)} “{r.comment || 'Pas d\'avis.'}”
            </li>
          ))}
          {reviews.length === 0 && <li>Aucun avis pour le moment.</li>}
        </ul>
      </div>
    </DashboardLayout>
  );
}