import React, { useEffect, useMemo, useRef, useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import DocumentsModal from '../components/lessons/DocumentsModal';
import ReviewModal from '../components/lessons/ReviewModal';
import { auth, db } from '../lib/firebase';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  limit,
  onSnapshot,
  deleteField,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';

/* ---------- Helpers ---------- */

/* ---------- Email helpers (prof) ---------- */
async function getUserEmailById(uid) {
  if (!uid) return null;
  try {
    // users/{uid}
    const s = await getDoc(doc(db, 'users', uid));
    if (s.exists()) {
      const d = s.data();
      return d.email || d.contactEmail || null;
    }
  } catch {}
  // fallback teachers/{uid}
  try {
    const t = await getDoc(doc(db, 'teachers', uid));
    if (t.exists()) {
      const d = t.data();
      return d.email || d.contactEmail || null;
    }
  } catch {}
  return null;
}

async function getMyDisplayName(uid) {
  try {
    const u = await getDoc(doc(db, 'users', uid));
    if (u.exists()) {
      const d = u.data();
      return d.fullName || d.name || d.displayName || 'Élève';
    }
  } catch {}
  return 'Élève';
}

async function emailTeacherAboutInvite(lesson, { accepted }) {
  const teacherId = lesson?.teacher_id;
  const teacherEmail = await getUserEmailById(teacherId);
  if (!teacherEmail) return;

  const me = auth.currentUser;
  const myName = await getMyDisplayName(me?.uid);

  const title = accepted
    ? "Invitation acceptée"
    : "Invitation refusée";

  const message = accepted
    ? `${myName} a accepté l’invitation pour le cours ${lesson.subject_id || ''} (${lesson.slot_day ?? ''} ${String(lesson.slot_hour ?? '').padStart(2,'0')}h).`
    : `${myName} a refusé l’invitation pour le cours ${lesson.subject_id || ''} (${lesson.slot_day ?? ''} ${String(lesson.slot_hour ?? '').padStart(2,'0')}h).`;

  await fetch("/api/notify-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: teacherEmail,
      title,
      message,
      ctaText: "Ouvrir le cours",
      ctaUrl: `${window.location.origin}/teacher/lessons`
    })
  }).catch(() => {});
}

const FR_DAY_CODES = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const codeIndex = (c) => Math.max(0, FR_DAY_CODES.indexOf(c));

function nextOccurrence(slot_day, slot_hour, now = new Date()) {
  if (!FR_DAY_CODES.includes(slot_day)) return null;
  const jsDay = now.getDay();
  const offsetToMonday = ((jsDay + 6) % 7);
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() - offsetToMonday);

  const idx = codeIndex(slot_day);
  const start = new Date(monday);
  start.setDate(monday.getDate() + idx);
  start.setHours(Number(slot_hour) || 0, 0, 0, 0);
  if (start <= now) start.setDate(start.getDate() + 7);
  return start;
}

function formatHour(h) {
  const n = Number(h) || 0;
  return `${String(n).padStart(2, '0')}:00`;
}

function getLessonStartDate(lesson) {
  if (!lesson) return null;
  const hour = Number(lesson.slot_hour ?? 0);

  // 1) Nouveau champ start_datetime OU ancien startAt
  const ts = lesson.start_datetime || lesson.startAt;
  if (ts?.toDate) {
    try {
      const d = ts.toDate();
      d.setHours(hour, d.getMinutes() || 0, 0, 0);
      return d;
    } catch {}
  }
  if (typeof ts?.seconds === 'number') {
    const d = new Date(ts.seconds * 1000);
    d.setHours(hour, d.getMinutes() || 0, 0, 0);
    return d;
  }

  // 2) Champ "date" (YYYY-MM-DD)
  if (lesson.date) {
    try {
      const d = new Date(`${lesson.date}T00:00:00`);
      if (!Number.isNaN(d.getTime())) {
        d.setHours(hour, 0, 0, 0);
        return d;
      }
    } catch {}
  }

  // 3) Champ "week" + slot_day (week = lundi de la semaine)
  if (lesson.week && lesson.slot_day) {
    try {
      const monday = new Date(`${lesson.week}T00:00:00`); // ex: "2025-12-01"
      if (!Number.isNaN(monday.getTime())) {
        const key = String(lesson.slot_day).toLowerCase().slice(0, 3); // lun, mar, ...
        const map = { lun: 0, mar: 1, mer: 2, jeu: 3, ven: 4, sam: 5, dim: 6 };
        const offset = map[key];
        if (typeof offset === 'number') {
          monday.setDate(monday.getDate() + offset);
          monday.setHours(hour, 0, 0, 0);
          return monday;
        }
      }
    } catch {}
  }

  // 4) Très vieux cours : approximation juste pour l'affichage
  if (lesson.slot_day) {
    try {
      return nextOccurrence(lesson.slot_day, lesson.slot_hour, new Date());
    } catch {}
  }

  return null;
}

function formatLessonDateTime(lesson) {
  if (!lesson) return '';

  const d = getLessonStartDate(lesson);
  if (!d) {
    // dernier fallback : texte simple "Lun · 09:00"
    const dayLabel = lesson.slot_day || '';
    const hourLabel = lesson.slot_hour != null ? formatHour(lesson.slot_hour) : '';
    return `${dayLabel} · ${hourLabel}`.trim();
  }

  const weekday = d.toLocaleDateString('fr-FR', { weekday: 'short' }); // "lun."
  const day = String(d.getDate()).padStart(2, '0');                    // "24"
  const month = String(d.getMonth() + 1).padStart(2, '0');             // "11"
  const time = d.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });                                                                  // "17:00"

  return `${weekday} ${day}/${month} · ${time}`;
}


const statusColors = {
  booked: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-green-100 text-green-800',
  completed: 'bg-gray-100 text-gray-700',
  rejected: 'bg-red-100 text-red-700',
};

// Statuts “en attente” (pour les cours individuels)
const PENDING_LESSON_STATUSES = new Set([
  'booked',
  'pending',
  'pending_teacher',
  'pending_parent',
  'requested',
  'awaiting',
  'awaiting_confirmation',
  'reinvited',
]);

/* ---------- noms ---------- */
async function fetchUserProfile(uid) {
  if (!uid) return null;
  try {
    const direct = await getDoc(doc(db, 'users', uid));
    if (direct.exists()) return { id: uid, ...direct.data() };
  } catch {}
  try {
    const q = query(collection(db, 'users'), where('uid', '==', uid), limit(1));
    const s = await getDocs(q);
    if (!s.empty) {
      const d = s.docs[0];
      return { id: d.id, ...d.data() };
    }
  } catch {}
  return null;
}
async function resolveTeacherName(id, cache) {
  if (!id) return '';
  if (cache.current.has(id)) return cache.current.get(id);
  const u = await fetchUserProfile(id);
  const nm = (u && (u.fullName || u.name || u.displayName)) || id;
  cache.current.set(id, nm);
  return nm;
}
async function resolvePersonName(id, cache) {
  if (!id) return id;
  if (cache.current.has(id)) return cache.current.get(id);
  // users
  try {
    const u = await getDoc(doc(db, 'users', id));
    if (u.exists()) {
      const d = u.data();
      const nm = d.fullName || d.name || d.displayName || id;
      cache.current.set(id, nm);
      return nm;
    }
  } catch {}
  // students
  try {
    const s = await getDoc(doc(db, 'students', id));
    if (s.exists()) {
      const d = s.data();
      const nm = d.full_name || d.name || id;
      cache.current.set(id, nm);
      return nm;
    }
  } catch {}
  cache.current.set(id, id);
  return id;
}

/* ---------- logique “confirmé/pending” PAR PARTICIPANT ---------- */
// helpers (haut de fichier)
function isGroupLesson(l) { return !!l?.is_group || Array.isArray(l?.participant_ids); }
const isVisio = (l) => String(l?.mode || '').toLowerCase() === 'visio' || l?.is_visio === true;
const hasVisioLink = (l) => !!l?.visio?.joinUrl;

// suppose que currentUserId est l'uid de l'élève courant
function isConfirmedForMe(l, uid) {
  if (!uid || !l) return false;
  if (l.status === 'completed') return false;
  const st = l?.participantsMap?.[uid]?.status;
  return st === 'accepted' || st === 'confirmed' ||
         ((l.status === 'confirmed' || l.status === 'completed') && (l.participant_ids || []).includes(uid));
}
function isRejectedForMe(l, uid) {
  if (!uid || !l) return false;
  const st = l?.participantsMap?.[uid]?.status;
  return st === 'rejected' || l.status === 'rejected';
}

function isConfirmedForUser(l, uid) { return isConfirmedForMe(l, uid); }

/* ---------- helpers auto-règles (globaux) ---------- */
const isIndividualPaid = (l) => {
  if (!l || l.is_group) return false;
  if (l.is_paid === true) return true;
  // Cas où le paiement est stocké dans participantsMap
  const pm = l.participantsMap || {};
  return Object.values(pm).some(entry => entry?.is_paid === true);
};
const hasAnyConfirmedParticipant = (l) => {
  if (!Array.isArray(l?.participant_ids)) return false;
  const pm = l?.participantsMap || {};
  return l.participant_ids.some((sid) => {
    const st = pm?.[sid]?.status;
    return st === 'accepted' || st === 'confirmed';
  });
};
const getStartMs = (lesson) => {
  const ts = lesson?.start_datetime;
  if (ts?.toDate) {
    try { return ts.toDate().getTime(); } catch { return null; }
  }
  if (typeof ts?.seconds === 'number') return ts.seconds * 1000;
  return null;
};

/* ---------- affichage mode / pack ---------- */
function modeLabel(c) {
  const m = String(c?.mode || '').toLowerCase();
  const isVisio = m === 'visio' || c?.is_visio === true;
  return isVisio ? 'Visio' : 'Présentiel';
}

function packLabel(c) {
  const hours = Number(c?.pack_hours ?? c?.packHours ?? 0);
  if (hours >= 10) return 'Pack 10h';
  if (hours >= 5) return 'Pack 5h';
  return ''; // pas d’étiquette "Horaire"
}

// --- NOUVEAU : payé pour moi ? ---
const isPaidForMe = (l, uid) => {
  if (!l) return false;
  return l.is_group
    ? !!l?.participantsMap?.[uid]?.is_paid
    : !!l?.is_paid;
};

// remplace l'ancienne canJoinNow par ces deux helpers
function getJoinState(l) {
  // 1) si le prof a posé des bornes -> on s'y fie
  const opensAtIso = l?.visio?.opens_at;
  const expiresAtIso = l?.visio?.expires_at;

  if (opensAtIso || expiresAtIso) {
    const now = Date.now();
    const openMs = opensAtIso ? Date.parse(opensAtIso) : 0;
    const endMs  = expiresAtIso ? Date.parse(expiresAtIso) : 0;
    if (openMs && now < openMs) return 'before';
    if (endMs  && now > endMs ) return 'expired';
    return 'open';
  }

  // 2) fallback A : s'il y a une date absolue (start_datetime), on s’y fie
  const startMsAbs = getStartMs(l);
  if (startMsAbs) {
    const now = Date.now();
    const windowStart = startMsAbs - 15 * 60 * 1000; // 15 min avant
    const windowEnd   = startMsAbs + 60 * 60 * 1000; // +1h après
    if (now < windowStart) return 'before';
    if (now > windowEnd)   return 'expired';
    return 'open';
  }

  // 2) fallback B : pas de date absolue → on estime via slot_day/slot_hour
  // ✅ On vérifie d'abord l'occurrence de CETTE semaine (pas uniquement la prochaine)
  const nowDate = new Date();
  const thisPast = nextOccurrence(l.slot_day, l.slot_hour, new Date(nowDate.getTime() - 7 * 24 * 60 * 60 * 1000));
  const startThisWeek = thisPast ? thisPast.getTime() : null;
  if (startThisWeek) {
    const nowMs = Date.now();
    const windowStartTW = startThisWeek - 15 * 60 * 1000;
    const windowEndTW   = startThisWeek + 2 * 60 * 60 * 1000; // T+2h (aligne avec visio)
    if (nowMs >= windowStartTW && nowMs <= windowEndTW) {
      return 'open';
    }
    if (nowMs > windowEndTW && nowMs < startThisWeek + 7 * 24 * 60 * 60 * 1000) {
      // Le cours de cette semaine est terminé, et la prochaine occurrence n'est pas encore ouverte
      return 'expired';
    }
  }
  const start = nextOccurrence(l.slot_day, l.slot_hour, nowDate);
  if (!start) return 'open'; // si pas de slot exploitable, on n'empêche pas
  const startMs = start.getTime();
  const now = Date.now();
  const windowStart = startMs - 15 * 60 * 1000;   // 15 min avant
  const windowEnd   = startMs + 2 * 60 * 60 * 1000; // T+2h (aligné avec expiration visio)
  if (now < windowStart) return 'before';
  if (now > windowEnd)   return 'expired';
  return 'open';
}

const myParticipantStatus = (l, uid) =>
  (l?.participantsMap?.[uid]?.status) || null;

function packLabelForMe(c) {
  const uid = auth.currentUser?.uid;
  const hours = Number(
    c?.participantsMap?.[uid]?.pack_hours ??
    c?.participantsMap?.[uid]?.packHours ??
    c?.pack_hours ?? c?.packHours ?? 0
  );
  if (hours >= 10) return 'Pack 10h';
  if (hours >= 5) return 'Pack 5h';
  return '';
}

function isFreeHourFor(uid, lesson) {
  if (!lesson) return false;
  if (lesson.is_free_hour) return true;
  if (uid && lesson?.participantsMap?.[uid]?.is_free_hour) return true;
  return false;
}

/* =================== PAGE =================== */
export default function MyCourses() {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [namesTick, setNamesTick] = useState(0);

  // Modals
  const [docOpen, setDocOpen] = useState(false);
  const [docLesson, setDocLesson] = useState(null);

  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewLesson, setReviewLesson] = useState(null);

  const nameCache = useRef(new Map());

  // ✅ Branche les listeners Firestore quand l'utilisateur est prêt
  useEffect(() => {
    let unsubA = null;
    let unsubB = null;
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      // Nettoyage des anciens listeners si on change d'utilisateur
      if (unsubA) { unsubA(); unsubA = null; }
      if (unsubB) { unsubB(); unsubB = null; }

      if (!user) {
        setCourses([]);
        setLoading(false);
        return;
      }
      const uid = user.uid;
      setLoading(true);

      const map = new Map();
      const upsert = (id, data) => { map.set(id, { id, ...data }); setCourses(Array.from(map.values())); };
      const remove = (id) => { map.delete(id); setCourses(Array.from(map.values())); };

      // A) Cours où je suis l'élève principal (individuel)
      const qA = query(collection(db, 'lessons'), where('student_id', '==', uid));
      // B) Cours où je suis listé dans participant_ids (groupé)
      const qB = query(collection(db, 'lessons'), where('participant_ids', 'array-contains', uid));

      unsubA = onSnapshot(qA, (snap) => {
        snap.docChanges().forEach((ch) => (
          ch.type === 'removed' ? remove(ch.doc.id) : upsert(ch.doc.id, ch.doc.data())
        ));
        setLoading(false);
      }, () => setLoading(false));

      unsubB = onSnapshot(qB, (snap) => {
        snap.docChanges().forEach((ch) => (
          ch.type === 'removed' ? remove(ch.doc.id) : upsert(ch.doc.id, ch.doc.data())
        ));
        setLoading(false);
      }, () => setLoading(false));
    });

    return () => {
      if (unsubA) unsubA();
      if (unsubB) unsubB();
      unsubAuth();
    };
  }, []);

  // ⚙️ Précharger les noms des profs quand la liste de cours change
  useEffect(() => {
    let alive = true;
    (async () => {
      const ids = Array.from(new Set(courses.map(c => c.teacher_id).filter(Boolean)));
      if (ids.length === 0) return;
      await Promise.all(ids.map((id) => resolveTeacherName(id, nameCache)));
      if (alive) setNamesTick(t => t + 1); // force un re-render pour rafraîchir l'affichage
    })();
    return () => { alive = false; };
  }, [courses]);

  // ✅ Auto-règles globales (pour tout le monde, en continu)
  useEffect(() => {
    if (!courses.length) return;

    const tick = async () => {
      const now = Date.now();
      const updates = courses.map(async (l) => {
        const startMs = getStartMs(l);
        if (!startMs) return; // pas de date absolue → on ne force rien

        // 1) Si pas accepté avant l'heure prévue → rejeté
        // Note: ce tick côté client est un filet de sécurité UI.
        // La logique principale doit vivre dans un Cloud Function pour éviter
        // les écritures concurrentes si plusieurs onglets sont ouverts.
        if (now >= startMs) {
          const statusStr = String(l.status || '');
          // Ne jamais re-traiter un cours déjà terminé ou refusé
          if (statusStr === 'completed' || statusStr === 'rejected') return;
          const isAccepted =
            statusStr === 'confirmed' ||
            (l.is_group && hasAnyConfirmedParticipant(l));

          if (!isAccepted) {
            try { await updateDoc(doc(db, 'lessons', l.id), { status: 'rejected' }); } catch {}
            return;
          }
        }

        // 2) Individuel confirmé mais non payé à l'heure → rejeté
        if (!l.is_group && String(l.status || '') === 'confirmed') {
            if (now >= startMs && !isIndividualPaid(l)) {
              try { await updateDoc(doc(db, 'lessons', l.id), { status: 'rejected' }); } catch {}
            }
        }
      });

      try { await Promise.all(updates); } catch {}
    };

    // premier passage + intervalle régulier
    tick();
    const id = setInterval(tick, 60 * 1000);
    return () => clearInterval(id);
  }, [courses]);

  // prochain confirmé (toi) — basé sur “confirmé pour moi” (participantsMap OU status global)
  const nextCourse = useMemo(() => {
    const now = new Date();
    const uid = auth.currentUser?.uid;
    const list = courses
      .filter(l => isConfirmedForMe(l, uid) && FR_DAY_CODES.includes(l.slot_day))
      .map(l => ({ ...l, startAt: nextOccurrence(l.slot_day, l.slot_hour, now) } ))
      .filter(l => l.startAt && l.startAt > now)
      .sort((a, b) => a.startAt - b.startAt);
    return list[0] || null;
  }, [courses]);

  // Invitations reçues (prof t’a invité)
  const invitations = useMemo(() => {
    const uid = auth.currentUser?.uid;
    return courses.filter(l => {
      const pm = l.participantsMap || {};
      return isGroupLesson(l)
        && (l.participant_ids || []).includes(uid)
        && pm?.[uid]?.status === 'invited_student';
    });
  }, [courses]);

  // ====== LISTES POUR L'UI (élève courant) ======
  const uid = auth.currentUser?.uid;

  // 🟡 En attente
  const booked = useMemo(() => {
    if (!uid) return [];
    const out = [];
    for (const c of courses) {
      // ✅ 1) jamais "en attente" si terminé
      if (String(c?.status || '') === 'completed') continue;

      // ✅ 2) Groupe uniquement si is_group === true
      if (c?.is_group === true && Array.isArray(c.participant_ids) && c.participant_ids.includes(uid)) {
        const st = String(c?.participantsMap?.[uid]?.status || '');
        if (!['accepted', 'confirmed', 'rejected', 'removed', 'deleted'].includes(st)) {
          out.push(c);
        }
      } else if (c.student_id === uid && PENDING_LESSON_STATUSES.has(String(c.status || ''))) {
        out.push(c);
      }
    }
    return out;
  }, [courses, uid]);

  // 🟢 Confirmés (dédupliqué)
  const confirmed = useMemo(() => {
    if (!uid) return [];
    const seen = new Set();
    const out = [];

    for (const c of courses) {
      if (c.status === 'completed') continue;

      if (Array.isArray(c.participant_ids) && c.participant_ids.includes(uid)) {
        // Groupe : confirmé si moi (uid) accepté/confirmé
        const st = c?.participantsMap?.[uid]?.status;
        if (st === 'accepted' || st === 'confirmed') {
          const key = `${c.id}:${uid}`;
          if (!seen.has(key)) { seen.add(key); out.push(c); }
        }
      } else if (c.student_id === uid && c.status === 'confirmed') {
        // Individuel
        const key = `${c.id}:${uid}`;
        if (!seen.has(key)) { seen.add(key); out.push(c); }
      }
    }
    return out;
  }, [courses, uid]);

  // 🔴 Refusés
  const rejected = useMemo(() => {
    if (!uid) return [];
    const out = [];
    for (const c of courses) {
      if (Array.isArray(c.participant_ids) && c.participant_ids.includes(uid)) {
        const pst = String(c?.participantsMap?.[uid]?.status || '');
        if (['rejected', 'removed', 'deleted'].includes(pst) || c.status === 'rejected') {
          out.push(c);
        }
      } else if (c.student_id === uid && c.status === 'rejected') {
        out.push(c);
      }
    }
    return out;
  }, [courses, uid]);

  const completed = useMemo(() => courses.filter(c => c.status === 'completed'), [courses]);

  function teacherNameFor(id) {
    return nameCache.current.get(id) || id;
  }

  async function acceptInvite(lesson) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      await updateDoc(doc(db, 'lessons', lesson.id), {
        [`participantsMap.${uid}.status`]: 'accepted',
      });
      // local
      setCourses(prev => prev.map(c => c.id === lesson.id
        ? { ...c, participantsMap: { ...(c.participantsMap||{}), [uid]: { ...(c.participantsMap?.[uid]||{}), status: 'accepted' } } }
        : c
      ));
      // 🔔 Email au professeur
      await emailTeacherAboutInvite(lesson, { accepted: true });
    } catch (e) {
      console.error(e);
      alert("Impossible d'accepter l'invitation.");
    }
  }

  async function declineInvite(lesson) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      await updateDoc(doc(db, 'lessons', lesson.id), {
        participant_ids: (lesson.participant_ids || []).filter(x => x !== uid),
        [`participantsMap.${uid}`]: deleteField(),
      });
      setCourses(prev => prev.filter(c => !(c.id === lesson.id && (c.participant_ids||[]).includes(uid))));
      // 🔔 Email au professeur
      await emailTeacherAboutInvite(lesson, { accepted: false });      
    } catch (e) {
      console.error(e);
      alert("Impossible de refuser l'invitation.");
    }
  }

  const statusBadge = (st) => (
    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColors[st] || 'bg-gray-200'}`}>
      {st === 'booked' ? 'En attente' : st === 'confirmed' ? 'Confirmé' : st === 'completed' ? 'Terminé' : st === 'rejected' ? 'Refusé' : st}
    </span>
  );

  // Affiche la pastille paiement pour l’utilisateur courant uniquement si la séance est confirmée
  function paymentBadgeForMe(c) {
    const uid = auth.currentUser?.uid;

    // 1) statut effectif pour moi (groupe -> participantsMap; sinon status global)
    const st = (c?.participantsMap?.[uid]?.status) || c?.status || 'pending';
    if (st !== 'confirmed') return null; // rien si en attente / refusé

    if (isFreeHourFor(uid, c)) {
      return (
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-pink-50 text-pink-700">
          🎁 Offert
        </span>
      );
    }

    // 2) payé ?
    const isPaid = (v) => v === true || v === 'paid' || v === 'succeeded';
    const p = c?.participantsMap?.[uid];
    const paid =
      isPaid(p?.is_paid) ||
      isPaid(p?.paid) ||
      isPaid(p?.payment_status) ||
      isPaid(c?.is_paid) ||
      isPaid(c?.paid) ||
      isPaid(c?.payment_status);

    // 3) badge
    return paid ? (
      <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-100 text-green-700">Payé</span>
    ) : (
      <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">À payer</span>
    );
  }

  function ParticipantsPopover({ c }) {
    const [open, setOpen] = useState(false);
    const [names, setNames] = useState([]);
    useEffect(() => {
      if (!open) return;
      (async () => {
        const ids = (c.participant_ids || []).slice(0, 50);
        const nm = await Promise.all(ids.map((id) => resolvePersonName(id, nameCache)));
        setNames(nm);
      })();
    }, [open, c]);
    return (
      <>
        <button
          className="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded hover:bg-indigo-100"
          onClick={() => setOpen(v => !v)}
          title="Voir les élèves du groupe"
        >
          👥 {(c.participant_ids || []).length}
        </button>
        {open && (
          <div className="mt-2 bg-white border rounded-lg shadow p-3 w-64">
            <div className="text-xs font-semibold mb-1">Élèves du groupe</div>
            {names.length ? (
              <ul className="text-sm text-gray-700 list-disc pl-4 space-y-1">
                {names.map((nm, i) => (
                  <li key={i}>{nm}</li>
                ))}
              </ul>
            ) : (
              <div className="text-xs text-gray-500">Aucun participant.</div>
            )}
          </div>
        )}
      </>
    );
  }

  function CourseCard({ c, showDocs = true, showReview = false }) {
    const when = formatLessonDateTime(c);
    const group = isGroupLesson(c);

    // ✅ priorité “Terminé”, puis statut PAR PARTICIPANT pour les groupes
    const displayedStatus = (() => {
      if (c.status === 'completed') return 'completed';

      const uid = auth.currentUser?.uid;
      if (isGroupLesson(c) && uid) {
        const pst = myParticipantStatus(c, uid);
        if (pst === 'rejected' || pst === 'removed' || pst === 'deleted') return 'rejected';
        if (pst === 'accepted' || pst === 'confirmed') return 'confirmed';
        return 'booked'; // encore en attente pour toi
      }

      // cours individuel : on garde le statut global
      return c.status || 'booked';
    })();

    return (
      <div className="bg-white p-6 rounded-xl shadow border flex flex-col md:flex-row md:items-center gap-4 justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-bold text-primary">{c.subject_id || 'Matière'}</span>
            {statusBadge(displayedStatus)}
            {/* ——— Pastilles mode & pack ——— */}
            <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
              {modeLabel(c)}
            </span>

            {(() => {
              const lab = packLabelForMe(c);
              const free = isFreeHourFor(uid, c);
              return lab ? (
                <span className="text-[11px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded ml-1">
                  {free ? "🎁 " : ""}{lab}
                </span>
              ) : null;
            })()}
            {/* ———————————————————————————————— */}
            {group && displayedStatus === 'confirmed' && <ParticipantsPopover c={c} />}
          </div>
          <div className="text-gray-700 text-sm">Professeur : <span className="font-semibold">{teacherNameFor(c.teacher_id)}</span></div>
          <div className="text-gray-500 text-xs">📅 {when}</div>
          <div className="mt-1">{paymentBadgeForMe(c)}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Visio */}
          {displayedStatus === 'confirmed' && isVisio(c) && (
            (() => {
              const uid = auth.currentUser?.uid;
              const isPaid = isPaidForMe(c, uid);

              if (!hasVisioLink(c)) {
                return (
                  <span className="px-3 py-2 rounded bg-gray-100 text-gray-600 font-semibold">
                    🔒 En attente du lien visio
                  </span>
                );
              }

              if (!isPaid) {
                return (
                  <span
                    className="px-3 py-2 rounded bg-amber-100 text-amber-800 font-semibold"
                    title="Réglez le cours pour débloquer la visio"
                  >
                    🔒 Paiement requis
                  </span>
                );
              }

              const state = getJoinState(c);
              const disabled = state !== 'open';
              const title =
                state === 'before' ? "Le lien sera actif à l'heure du cours"
                : state === 'expired' ? "Lien expiré"
                : "Rejoindre la visio";

              return (
                <a
                  href={disabled ? undefined : c.visio.joinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`px-4 py-2 rounded shadow font-semibold text-white ${
                    disabled ? 'bg-gray-400 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                  title={title}
                  onClick={(e) => { if (disabled) e.preventDefault(); }}
                >
                  🎥 Rejoindre la visio
                </a>
              );
            })()
          )}

          {/* Documents — pas en refusé */}
          {(displayedStatus === 'confirmed' || displayedStatus === 'completed') && (
            <button
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded shadow font-semibold"
              onClick={() => { setDocLesson(c); setDocOpen(true); }}
            >
              📄 Documents
            </button>
          )}

          {/* Avis */}
          {c.status === 'completed' && (
            <button
              className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded shadow font-semibold"
              onClick={() => { setReviewLesson(c); setReviewOpen(true); }}
            >
              ⭐ Laisser un avis
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <DashboardLayout role="student">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-2xl font-bold text-primary mb-6">📚 Mes cours</h2>

        {/* Prochain cours */}
        <div className="bg-white rounded-xl shadow p-6 border-l-4 border-primary mb-6">
          <div className="text-3xl mb-2">📅</div>
          <div className="text-xl font-bold text-primary">Prochain cours</div>
          <div className="text-gray-700 mt-1">
            {nextCourse
              ? `${nextCourse.subject_id || 'Cours'} · 📅 ${formatLessonDateTime(nextCourse)} · ${modeLabel(nextCourse)} • ${packLabelForMe(nextCourse)} · avec ${teacherNameFor(nextCourse.teacher_id)}`
              : 'Aucun cours confirmé à venir'}
          </div>
        </div>

        {loading ? (
          <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Chargement…</div>
        ) : (
          <>
            {/* Invitations reçues */}
            <section className="mb-8">
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-lg font-semibold">Invitations reçues</h3>
                <span className="text-sm text-gray-500">{invitations.length}</span>
              </div>
              {invitations.length === 0 ? (
                <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Aucune invitation.</div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {invitations.map((c) => (
                    <div key={c.id} className="bg-white p-6 rounded-xl shadow border flex flex-col md:flex-row md:items-center gap-4 justify-between">
                      <div className="flex-1">
                        <div className="flex gap-2 items-center mb-1">
                          <span className="font-bold text-primary">{c.subject_id || 'Matière'}</span>
                          <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded">Invitation</span>
                          {/* ——— Pastilles mode & pack ——— */}
                          <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
                            {modeLabel(c)}
                          </span>

                          {(() => {
                            const lab = packLabelForMe(c);
                            return lab ? (
                              <span className="text-[11px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded ml-1">
                                {lab}
                              </span>
                            ) : null;
                          })()}
                          {/* ———————————————————————————————— */}
                        </div>
                        <div className="text-gray-700 text-sm">Professeur : <span className="font-semibold">{teacherNameFor(c.teacher_id)}</span></div>
                        <div className="text-gray-500 text-xs">📅 {formatLessonDateTime(c)}</div>
                      </div>
                      <div className="flex gap-2">
                        <button className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded shadow font-semibold" onClick={() => acceptInvite(c)}>
                          ✅ Accepter
                        </button>
                        <button className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded shadow font-semibold" onClick={() => declineInvite(c)}>
                          ❌ Refuser
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* En attente (pour MOI) */}
            <section className="mb-8">
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-lg font-semibold">En attente de confirmation</h3>
                <span className="text-sm text-gray-500">{booked.length}</span>
              </div>
              {booked.length === 0 ? (
                <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Aucun cours en attente.</div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {booked.map((c) => <CourseCard key={c.id} c={c} />)}
                </div>
              )}
            </section>

            {/* Confirmés (pour MOI) */}
            <section className="mb-8">
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-lg font-semibold">Cours confirmés</h3>
                <span className="text-sm text-gray-500">{confirmed.length}</span>
              </div>
              {confirmed.length === 0 ? (
                <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Aucun cours confirmé.</div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {confirmed.map((c) => <CourseCard key={c.id} c={c} />)}
                </div>
              )}
            </section>

            {/* Refusés */}
            <section className="mb-8">
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-lg font-semibold">Cours refusés</h3>
                <span className="text-sm text-gray-500">{rejected.length}</span>
              </div>
              {rejected.length === 0 ? (
                <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Aucun cours refusé.</div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {rejected.map((c) => <CourseCard key={c.id} c={c} />)}
                </div>
              )}
            </section>

            {/* Terminés */}
            <section className="mb-8">
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-lg font-semibold">Cours terminés</h3>
                <span className="text-sm text-gray-500">{completed.length}</span>
              </div>
              {completed.length === 0 ? (
                <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Aucun cours terminé.</div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {completed.map((c) => <CourseCard key={c.id} c={c} showReview />)}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {/* Modals */}
      <DocumentsModal open={docOpen} onClose={() => setDocOpen(false)} lesson={docLesson} allowUpload={false} />
      {/* 👉 permet plusieurs avis sur le même cours */}
      <ReviewModal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        lesson={reviewLesson}
        allowMultiple={true}
        lessonId={reviewLesson?.id || null}
        teacherId={reviewLesson?.teacher_id || null}
        reviewerId={auth.currentUser?.uid || null}
        key={reviewLesson?.id || 'review-modal'}
        onSent={() => {}}
      />
    </DashboardLayout>
  );
}
