import React, { useEffect, useMemo, useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import { auth, db } from '../lib/firebase';
import {
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  orderBy,
} from 'firebase/firestore';
import NotifList from '../components/NotifList';

// ---- Helpers jours/heures ----
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

function chunk(arr, size = 10) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export default function ParentDashboard() {
  const [children, setChildren] = useState([]);
  const [courses, setCourses] = useState([]);
  const [unpaid, setUnpaid] = useState(0);
  const [notifications, setNotifications] = useState([]);

  const userId = auth.currentUser?.uid;

  // 🔔 Notifications LIVE
  useEffect(() => {
    if (!userId) return;
    const qNotif = query(
      collection(db, 'notifications'),
      where('user_id', '==', userId),
      orderBy('created_at', 'desc')
    );
    const unsub = onSnapshot(qNotif, snap => {
      setNotifications(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      // 👧 Enfants
      const kidsSnap = await getDocs(
        query(collection(db, 'students'), where('parent_id', '==', userId))
      );
      const kids = kidsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      setChildren(kids);

      if (kids.length === 0) {
        setCourses([]);
        setUnpaid(0);
        return;
      }

      // 📚 Leçons des enfants (where in par lots de 10)
      const kidIds = kids.map(k => k.id);
      const batches = chunk(kidIds, 10);
      let allLessons = [];
      for (const ids of batches) {
        const qLessons = query(collection(db, 'lessons'), where('student_id', 'in', ids));
        const snap = await getDocs(qLessons);
        allLessons = allLessons.concat(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }

      // 💳 Paiements en attente
      setUnpaid(allLessons.filter(l => !l.is_paid).length);

      // 🗓️ Enrichir avec startAt (prochaine occurrence à partir de slot_day/slot_hour)
      const now = new Date();
      const enriched = allLessons
        .filter(l => l.slot_day && (l.slot_hour !== undefined))
        .map(l => ({ ...l, startAt: nextOccurrence(l.slot_day, l.slot_hour, now) }))
        .filter(l => l.startAt); // garde uniquement ceux mappables

      setCourses(enriched);
    })();
  }, [userId]);

  // 🎯 Prochains cours (confirmés et futurs), limités à 5
  const upcoming = useMemo(() => {
    const now = new Date();
    return courses
      .filter(l => l.status === 'confirmed' && l.startAt > now)
      .sort((a, b) => a.startAt - b.startAt)
      .slice(0, 5)
      .map(l => {
        const child = children.find(k => k.id === l.student_id);
        const childName = child?.full_name || child?.fullName || child?.name || 'Enfant';
        const datePart = l.startAt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
        const timePart = l.startAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        return {
          id: l.id,
          name: childName,
          info: `${l.subject_id || 'Cours'} — ${datePart} ${timePart}`,
        };
      });
  }, [courses, children]);

  return (
    <DashboardLayout role="parent">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-primary mb-2 flex items-center gap-2">
          <span role="img" aria-label="Parent">👨‍👩‍👧</span>
          Tableau de bord Parent
        </h2>
        <p className="text-gray-600">Bienvenue sur votre espace parent. Suivez vos enfants, leurs cours et paiements ici.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        <div className="bg-white rounded-xl shadow p-6 border-l-4 border-primary flex flex-col items-start">
          <span className="text-3xl mb-2">👧</span>
          <span className="text-xl font-bold text-primary">Enfants enregistrés</span>
          <ul className="text-gray-700 mt-1">
            {children.length === 0 && <li>Aucun enfant enregistré.</li>}
            {children.map((c) => (
              <li key={c.id}>{c.full_name || c.fullName || c.name} ({c.school_level || "Niveau inconnu"})</li>
            ))}
          </ul>
        </div>

        <div className="bg-white rounded-xl shadow p-6 border-l-4 border-yellow-400 flex flex-col items-start">
          <span className="text-3xl mb-2">📅</span>
          <span className="text-xl font-bold text-yellow-600">Prochains cours</span>
          <ul className="text-gray-700 mt-1">
            {upcoming.length === 0 && <li>Aucun cours à venir.</li>}
            {upcoming.map((c) => (
              <li key={c.id}>{c.name} : {c.info}</li>
            ))}
          </ul>
        </div>

        <div className="bg-white rounded-xl shadow p-6 border-l-4 border-secondary flex flex-col items-start">
          <span className="text-3xl mb-2">💳</span>
          <span className="text-xl font-bold text-secondary">Paiements à régler</span>
          <span className="text-gray-700 mt-1">{unpaid} en attente</span>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow p-5">
        <h3 className="font-bold text-primary mb-3">Notifications</h3>
        <NotifList notifications={notifications} />
      </div>
    </DashboardLayout>
  );
}