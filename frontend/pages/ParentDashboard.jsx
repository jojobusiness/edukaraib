import React, { useEffect, useMemo, useRef, useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import { auth, db } from '../lib/firebase';
import {
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  orderBy,
  doc,
  getDoc,
} from 'firebase/firestore';
import NotifList from '../components/NotifList';
import { autoClearPaymentDueNotifications } from '../lib/paymentNotifications';

const FR_DAY_CODES = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const codeIndex = (c) => Math.max(0, FR_DAY_CODES.indexOf(c));
function mondayOfWeek(base = new Date()) { const d=new Date(base); const jsDay=d.getDay(); const offset=((jsDay+6)%7); d.setHours(0,0,0,0); d.setDate(d.getDate()-offset); return d; }
function nextOccurrence(slot_day, slot_hour, now = new Date()) { if(!FR_DAY_CODES.includes(slot_day)) return null; const mon=mondayOfWeek(now); const idx=codeIndex(slot_day); const start=new Date(mon); start.setDate(mon.getDate()+idx); start.setHours(Number(slot_hour)||0,0,0,0); if(start<=now) start.setDate(start.getDate()+7); return start; }
function chunk(arr, size = 10){ const out=[]; for(let i=0;i<arr.length;i+=size) out.push(arr.slice(i,i+size)); return out; }

async function resolveName(id) {
  try { const s = await getDoc(doc(db,'users', id)); if (s.exists()) { const d=s.data(); return d.fullName||d.name||d.displayName||'Élève'; } } catch {}
  try {
    const st = await getDoc(doc(db, 'students', id));
    if (st.exists()) { const d=st.data(); return d.full_name||d.name||'Élève'; }
  } catch {}
  return 'Élève';
}

// --- helper : un enfant est confirmé/accepté sur un cours groupé ? ---
function isKidConfirmed(lesson, kidId) {
  const st = lesson?.participantsMap?.[kidId]?.status;
  return st === 'accepted' || st === 'confirmed';
}
// --- helper : payé pour cet enfant ? ---
function isPaidForKid(lesson, kidId) {
  if (!lesson) return false;
  if (lesson.is_group) {
    return !!lesson?.participantsMap?.[kidId]?.is_paid || !!lesson?.participantsMap?.[kidId]?.paid_at;
  }
  if (lesson.student_id && String(lesson.student_id) === String(kidId)) {
    return !!lesson.is_paid || !!lesson.paid_at;
  }
  return false;
}

export default function ParentDashboard() {
  const [children, setChildren] = useState([]);
  const [courses, setCourses] = useState([]);
  const [unpaid, setUnpaid] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [groupNamesByLesson, setGroupNamesByLesson] = useState(new Map());
  const [openRowId, setOpenRowId] = useState(null);

  const userId = auth.currentUser?.uid;

  // 🔔 Notifications LIVE + auto-clean paiement
  useEffect(() => {
    if (!userId) return;
    const qNotif = query(
      collection(db, 'notifications'),
      where('user_id', '==', userId),
      orderBy('created_at', 'desc')
    );
    const unsub = onSnapshot(qNotif, async snap => {
      setNotifications(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      await autoClearPaymentDueNotifications(userId);
    });
    autoClearPaymentDueNotifications(userId).catch(() => {});
    return () => unsub();
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    (async () => {
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

      const kidIds = kids.map(k => k.id);
      let allLessons = [];

      // Leçons individuelles
      for (const ids of chunk(kidIds, 10)) {
        const qLessons = query(collection(db, 'lessons'), where('student_id', 'in', ids));
        const snap = await getDocs(qLessons);
        allLessons = allLessons.concat(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }
      // Leçons groupées (participant)
      for (const ids of chunk(kidIds, 10)) {
        const qLessonsGrp = query(collection(db, 'lessons'), where('participant_ids', 'array-contains-any', ids));
        const snap = await getDocs(qLessonsGrp);
        allLessons = allLessons.concat(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }

      // dédup
      const seen = new Set();
      const lessons = [];
      for (const l of allLessons) {
        if (seen.has(l.id)) continue;
        seen.add(l.id);
        lessons.push(l);
      }

      // startAt pour affichage
      const now = new Date();
      const enriched = lessons
        .filter(l => l.slot_day && (l.slot_hour !== undefined))
        .map(l => ({ ...l, startAt: nextOccurrence(l.slot_day, l.slot_hour, now) }))
        .filter(l => l.startAt);
      setCourses(enriched);

      // Compteur "à régler" — aligné avec ParentPayments :
      // - exclut `pending_teacher`
      // - groupé : enfants acceptés/confirmés ET non payés (compté par enfant)
      // - individuel : (confirmed OU completed) ET non payé (par enfant)
      const unpaidCount = lessons.reduce((acc, l) => {
        if (l.status === 'pending_teacher') return acc;

        if (l.is_group) {
          const pm = l.participantsMap || {};
          const ids = Array.isArray(l.participant_ids) ? l.participant_ids : [];
          let addForThisLesson = 0;

          ids.forEach((cid) => {
            if (!kidIds.includes(cid)) return;
            const st = pm?.[cid]?.status;
            const kidIsConfirmed = st === 'accepted' || st === 'confirmed';
            if (!kidIsConfirmed) return;
            const paid = !!pm?.[cid]?.is_paid || !!pm?.[cid]?.paid_at;
            if (!paid) addForThisLesson += 1;
          });

          return acc + addForThisLesson;
        }

        // Individuel
        if (kidIds.includes(l.student_id)) {
          const isEligible = (l.status === 'confirmed' || l.status === 'completed'); // ✅ inclut completed
          const paid = !!l.is_paid || !!l.paid_at;
          return acc + (isEligible && !paid ? 1 : 0);
        }

        return acc;
      }, 0);
      setUnpaid(unpaidCount);

      // Noms pour bouton 👥
      const idSet = new Set();
      lessons.forEach(l => {
        if (l.is_group) {
          (Array.isArray(l.participant_ids) ? l.participant_ids : []).forEach(id => id && idSet.add(id));
          if (l.student_id) idSet.add(l.student_id);
        }
      });
      const pairs = await Promise.all(Array.from(idSet).map(async (id) => [id, await resolveName(id)]));
      const idToName = new Map(pairs);
      const gMap = new Map();
      lessons.forEach(l => {
        if (!l.is_group) return;
        const idsForLesson = [
          ...(Array.isArray(l.participant_ids) ? l.participant_ids : []),
          ...(l.student_id ? [l.student_id] : []),
        ];
        const uniq = Array.from(new Set(idsForLesson));
        gMap.set(l.id, uniq.map(id => idToName.get(id) || 'Élève'));
      });
      setGroupNamesByLesson(gMap);
    })();
  }, [userId]);

  // Prochain cours (seul) — inclure groupe si au moins un enfant est accepté/confirmé
  const nextOne = useMemo(() => {
    const now = new Date();
    const kidIds = children.map(c => c.id);
    const kidSet = new Set(kidIds);

    const eligible = courses.filter((l) => {
      if (!FR_DAY_CODES.includes(l.slot_day) || !(l.startAt > now)) return false;

      if (l.is_group) {
        const ids = Array.isArray(l.participant_ids) ? l.participant_ids : [];
        return ids.some((sid) => kidSet.has(sid) && isKidConfirmed(l, sid));
      }
      // individuel
      return l.status === 'confirmed' && kidSet.has(l.student_id);
    });

    const sorted = eligible.sort((a, b) => a.startAt - b.startAt);
    return sorted[0] || null;
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

      {/* Cartes de stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        <div className="bg-white rounded-2xl shadow p-6 border border-gray-100 border-l-4 border-primary flex flex-col items-start">
          <span className="text-3xl mb-2">👧</span>
          <span className="text-xl font-bold text-primary">Enfants enregistrés</span>
          <ul className="text-gray-700 mt-1">
            {children.length === 0 && <li>Aucun enfant enregistré.</li>}
            {children.map((c) => (
              <li key={c.id}>{c.full_name || c.fullName || c.name} ({c.school_level || "Niveau inconnu"})</li>
            ))}
          </ul>
        </div>

        <div className="bg-white rounded-2xl shadow p-6 border border-gray-100 border-l-4 border-secondary flex flex-col items-start md:col-span-2">
          <span className="text-3xl mb-2">💳</span>
          <span className="text-xl font-bold text-secondary">Paiements à régler</span>
          <span className="text-gray-700 mt-1">{unpaid} cours à régler</span>
        </div>
      </div>

      {/* Prochain cours — même forme que l'élève (carte blanche, bordure, bouton Participants) */}
      <div className="bg-white rounded-2xl shadow p-6 border border-gray-100 border-l-4 border-primary mb-6">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-3xl">📅</span>
          <h3 className="font-bold text-primary text-lg">Prochain cours</h3>
        </div>
        <div className="text-gray-700">
          {nextOne
            ? (() => {
                const datePart = nextOne.startAt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
                const timePart = nextOne.startAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
                const who = nextOne.is_group ? 'Groupe' : 'Cours';
                return `${who} (${nextOne.subject_id || 'Matière'}) — ${datePart} ${timePart}`;
              })()
            : 'Aucun cours confirmé à venir'}
        </div>
        {nextOne?.is_group && (
          <div className="mt-3">
            <button
              onClick={() => setOpenRowId(openRowId === nextOne.id ? null : nextOne.id)}
              className="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded hover:bg-indigo-100"
            >
              👥 Participants
            </button>
            {openRowId === nextOne.id && (
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

      <div className="bg-white rounded-2xl shadow p-6 border border-gray-100">
        <h3 className="font-bold text-primary mb-3">Notifications</h3>
        <NotifList notifications={notifications} />
      </div>
    </DashboardLayout>
  );
}