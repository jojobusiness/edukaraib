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
  limit,
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

// ---------- Résolution profil élève (users ou students) ----------
async function fetchUserProfile(uid) {
  if (!uid) return null;
  // users/{uid}
  try {
    const s = await getDoc(doc(db, 'users', uid));
    if (s.exists()) return { id: uid, ...s.data(), _source: 'users' };
  } catch {}
  // where uid == <uid>
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

/** Essaie users d'abord (élève autonome), puis students (enfant rattaché). */
async function resolveStudentName(studentIdOrUid) {
  // 1) users
  const u = await fetchUserProfile(studentIdOrUid);
  if (u) {
    return u.fullName || u.name || u.displayName || 'Élève';
  }
  // 2) students
  const s = await fetchStudentDoc(studentIdOrUid);
  if (s) {
    return s.full_name || s.name || 'Élève';
  }
  // fallback
  return studentIdOrUid;
}

// ---------- Helpers revenus ----------
function isSameMonth(ts, ref = new Date()) {
  if (!ts) return false;
  const d = ts instanceof Date ? ts : ts?.toDate?.() ? ts.toDate() : null;
  if (!d) return false;
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
}

function coerceAmount(val) {
  // accepte cents ou euros selon le champ
  if (typeof val === 'number') return val;
  if (typeof val === 'string') return Number(val.replace(',', '.')) || 0;
  return 0;
}

export default function TeacherDashboard() {
  const [upcomingCourses, setUpcomingCourses] = useState([]); // confirmés, futur
  const [revenues, setRevenues] = useState(0);
  const [pending, setPending] = useState(0);
  const [reviews, setReviews] = useState([]);
  const [studentMap, setStudentMap] = useState(new Map());

  const userId = auth.currentUser?.uid;

  useEffect(() => {
    if (!userId) return;

    (async () => {
      // 1) Tous les cours du prof
      const lessonsSnap = await getDocs(
        query(collection(db, 'lessons'), where('teacher_id', '==', userId))
      );
      const lessons = lessonsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      // 2) Résoudre les élèves (users OU students) en une passe
      const uniqueIds = Array.from(new Set(lessons.map(l => l.student_id).filter(Boolean)));
      const names = await Promise.all(uniqueIds.map(id => resolveStudentName(id)));
      const sMap = new Map(uniqueIds.map((id, i) => [id, names[i]]));
      setStudentMap(sMap);

      // 3) Cours à venir (confirmés) via slot_day/slot_hour
      const now = new Date();
      const enriched = lessons
        .filter(l => l.status === 'confirmed' && FR_DAY_CODES.includes(l.slot_day))
        .map(l => ({ ...l, startAt: nextOccurrence(l.slot_day, l.slot_hour, now) }))
        .filter(l => l.startAt && l.startAt > now)
        .sort((a, b) => a.startAt - b.startAt);

      setUpcomingCourses(enriched.slice(0, 10)); // petite liste

      // 4) Demandes en attente
      setPending(lessons.filter(l => l.status === 'booked').length);

      // 5) Revenus du mois
      //    - Essaye d'abord via collection "payments" (statut réussi)
      //    - Sinon fallback sur les champs des "lessons" (individuel + groupé)
      let monthRevenue = 0;

      try {
        const paySnap = await getDocs(
          query(collection(db, 'payments'), where('teacher_id', '==', userId))
        );

        const pays = paySnap.docs.map(d => ({ id: d.id, ...d.data() }));
        // Filtrage mois courant et statuts "valides"
        const successLike = new Set(['succeeded', 'paid', 'completed']);
        const monthPays = pays.filter(p => {
          const paidAt = p.paid_at || p.created_at || null;
          const okMonth = isSameMonth(paidAt, now);
          const okStatus = p.status ? successLike.has(String(p.status).toLowerCase()) : true;
          return okMonth && okStatus;
        });

        if (monthPays.length > 0) {
          monthRevenue = monthPays.reduce((sum, p) => {
            // champs possibles : amount_cents, amount, amount_total
            const cents =
              (typeof p.amount_cents === 'number' && p.amount_cents) ||
              (typeof p.amount_total === 'number' && p.amount_total) ||
              0;
            const euros = cents ? cents / 100 : coerceAmount(p.amount);
            return sum + (euros || 0);
          }, 0);
        } else {
          // Pas (encore) de documents "payments" ce mois-ci : fallback sur lessons
          monthRevenue = lessons.reduce((sum, l) => {
            // date de référence pour le mois : paid_at si existe, sinon created_at
            const refDate = l.paid_at || l.created_at || null;
            if (!isSameMonth(refDate, now)) return sum;

            const price = Number(l.price_per_hour || l.price || 0) || 0;

            if (l.is_group) {
              // somme des participants payés
              const map = l.participantsMap || {};
              const paidCount = Object.values(map).filter(
                (p) => p && (p.is_paid || p.paid_at)
              ).length;
              return sum + paidCount * price;
            } else {
              // individuel
              const paid = !!(l.is_paid || l.paid_at);
              return sum + (paid ? price : 0);
            }
          }, 0);
        }
      } catch (e) {
        // Si la collection payments n'existe pas, on passe direct au fallback
        monthRevenue = lessons.reduce((sum, l) => {
          const now = new Date();
          const refDate = l.paid_at || l.created_at || null;
          if (!isSameMonth(refDate, now)) return sum;
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

      setRevenues(monthRevenue);

      // 6) Avis (derniers)
      const reviewsSnap = await getDocs(
        query(collection(db, 'reviews'), where('teacher_id', '==', userId))
      );
      setReviews(reviewsSnap.docs.map(d => d.data()).slice(0, 3));
    })();
  }, [userId]);

  const nextOne = upcomingCourses[0] || null;

  // Liste "cours à venir" prête à afficher
  const upcomingList = useMemo(
    () =>
      upcomingCourses.map(c => ({
        id: c.id,
        label: `${formatDate(c.startAt)} ${formatTime(c.startAt)} : ${c.subject_id || 'Cours'} avec ${studentMap.get(c.student_id) || c.student_id}`,
        when: c.startAt,
      })),
    [upcomingCourses, studentMap]
  );

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
        {/* Prochain cours */}
        <div className="bg-white rounded-xl shadow p-6 border-l-4 border-primary flex flex-col items-start">
          <span className="text-3xl mb-2">📅</span>
          <span className="text-xl font-bold text-primary">Prochain cours</span>
          <span className="text-gray-700 mt-1">
            {nextOne
              ? `${nextOne.subject_id || 'Cours'} - ${formatDate(nextOne.startAt)} ${formatTime(nextOne.startAt)} avec ${studentMap.get(nextOne.student_id) || nextOne.student_id}`
              : 'Aucun cours à venir'}
          </span>
        </div>

        {/* Revenus du mois */}
        <div className="bg-white rounded-xl shadow p-6 border-l-4 border-yellow-400 flex flex-col items-start">
          <span className="text-3xl mb-2">💰</span>
          <span className="text-xl font-bold text-yellow-600">Revenus ce mois</span>
          <span className="text-gray-700 mt-1">{revenues.toFixed(2)} €</span>
        </div>

        {/* Demandes en attente */}
        <div className="bg-white rounded-xl shadow p-6 border-l-4 border-secondary flex flex-col items-start">
          <span className="text-3xl mb-2">📝</span>
          <span className="text-xl font-bold text-secondary">Demandes en attente</span>
          <span className="text-gray-700 mt-1">{pending} cours à valider</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Cours à venir */}
        <div className="bg-white rounded-xl shadow p-5">
          <h3 className="font-bold text-primary mb-3">Cours à venir</h3>
          <ul className="text-gray-700 space-y-2">
            {upcomingList.map((c) => (
              <li key={c.id}>📅 {c.label}</li>
            ))}
            {upcomingList.length === 0 && <li>Aucun cours à venir.</li>}
          </ul>
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
      </div>
    </DashboardLayout>
  );
}