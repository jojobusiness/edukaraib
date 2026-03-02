import React, { useEffect, useMemo, useRef, useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import { auth, db } from '../lib/firebase';
import {
  collection,
  onSnapshot,
  query,
  where,
  doc,
  getDoc,
  updateDoc,
  addDoc,
  serverTimestamp,
  getDocs,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';

import DocumentsModal from '../components/lessons/DocumentsModal';
import GroupSettingsModal from '../components/lessons/GroupSettingsModal';
import { createPaymentDueNotificationsForLesson } from '../lib/paymentNotifications';

const JAAS_TENANT = 'vpaas-magic-cookie-651cb7a83ef74ca1981d7fdeee7f91ca';
const JAAS_ROOM_PREFIX = `${JAAS_TENANT}/`;

/* ---------- UI helpers ---------- */
const statusColors = {
  booked: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-700',
  completed: 'bg-gray-200 text-gray-700',
};

const fmtTime = (ms) =>
  new Date(ms).toLocaleString('fr-FR', {
    weekday: 'short',   // lun., mar., ...
    day: '2-digit',     // 22
    month: '2-digit',   // 11
    hour: '2-digit',    // 17
    minute: '2-digit',  // 00
  });

const fmtFromSlot = (slot_day, slot_hour) =>
  `${slot_day || ''} ${slot_hour != null ? `• ${String(slot_hour).padStart(2, '0')}:00` : ''}`.trim();

const slotLabel = (l) => fmtFromSlot(l.slot_day, l.slot_hour);

// 🔹 Date/heure RÉELLE d'un cours (logique métier) — pas de fallback approximatif ici
function getLessonStartDate(lesson) {
  if (!lesson) return null;

  const hour = Number(lesson.slot_hour ?? 0);

  // 1) start_datetime Firestore
  const ts = lesson.start_datetime;
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

  // 2) champ "date" (YYYY-MM-DD) — créé par le nouveau BookingModal
  if (lesson.date) {
    try {
      const d = new Date(`${lesson.date}T00:00:00`);
      if (!Number.isNaN(d.getTime())) {
        d.setHours(hour, 0, 0, 0);
        return d;
      }
    } catch {}
  }

  // 3) champ "week" + slot_day (week = lundi de la semaine) — créé par BookingModal/TeacherProfile
  if (lesson.week && lesson.slot_day) {
    try {
      const monday = new Date(`${lesson.week}T00:00:00`); // ex: "2025-12-01"
      if (!Number.isNaN(monday.getTime())) {
        const key = String(lesson.slot_day).toLowerCase().slice(0, 3); // lun, mar, mer...
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

  // ❌ Pas de date absolue fiable -> on renvoie null.
  // On n'utilise PAS nextOccurrence ici pour éviter les faux refus.
  return null;
}


// 🔹 Affichage "lun. 24/11 · 17:00" (on peut utiliser un fallback approximatif uniquement pour l'affichage)
function formatLessonDateTime(lesson) {
  let d = getLessonStartDate(lesson);

  // Pour les vieux cours sans date absolue, on peut afficher une approximation
  if (!d && lesson.slot_day && lesson.slot_hour != null) {
    const approx = nextOccurrence(lesson.slot_day, lesson.slot_hour, new Date());
    if (approx) d = approx;
  }

  if (!d) {
    // Si vraiment rien, on garde un format simple texte
    const dayLabel = lesson?.slot_day || '';
    const hour = lesson?.slot_hour;
    const hourLabel = hour != null ? `${String(hour).padStart(2, '0')}:00` : '';
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

function When({ lesson }) {
  const label = formatLessonDateTime(lesson);
  return label ? <span>📅 {label}</span> : null;
}

function StatusPill({ status }) {
  const label =
    status === 'booked' ? 'En attente' :
    status === 'pending_teacher' ? 'En attente prof' :
    status === 'confirmed' ? 'Confirmé' :
    status === 'rejected' ? 'Refusé' :
    status === 'completed' ? 'Terminé' : status;

  return (
    <span className={`px-3 py-1 rounded-full text-xs font-semibold ml-2 ${statusColors[status] || 'bg-gray-200'}`}>
      {label}
    </span>
  );
}

/* ---------- data helpers ---------- */
async function resolvePersonName(id, cache, opts = {}) {
  const { parentId = null } = opts;
  if (!id) return '';
  if (cache.has(id)) return cache.get(id);

  try {
    const u = await getDoc(doc(db, 'users', id));
    if (u.exists()) {
      const d = u.data();
      const nm = d.fullName || d.name || d.displayName || id;
      cache.set(id, nm);
      return nm;
    }
  } catch {}

  try {
    const s = await getDoc(doc(db, 'students', id));
    if (s.exists()) {
      const d = s.data();
      const nm = d.full_name || d.name || id;
      cache.set(id, nm);
      return nm;
    }
  } catch {}

  // 🔎 fallback 1 : collection globale "children" (si utilisée)
  try {
    const c = await getDoc(doc(db, 'children', id));
    if (c.exists()) {
      const d = c.data();
      const nm = (d.fullName || d.full_name || [d.firstName, d.lastName].filter(Boolean).join(' ') || d.name || '').trim();
      if (nm) {
        cache.set(id, nm);
        return nm;
      }
    }
  } catch {}

  // 🔎 fallback 2 : sous-collection "parents/{parentId}/children/{childId}"
  if (parentId) {
    try {
      const pc = await getDoc(doc(db, 'parents', parentId, 'children', id));
      if (pc.exists()) {
        const d = pc.data();
        const nm = (d.fullName || d.full_name || [d.firstName, d.lastName].filter(Boolean).join(' ') || d.name || '').trim();
        if (nm) {
          cache.set(id, nm);
          return nm;
        }
      }
    } catch {}
  }

  cache.set(id, id);
  return id;
}

async function notifyUsers(userIds = [], payloadBase = {}) {
  const now = serverTimestamp();
  const writes = userIds.filter(Boolean).map((uid) =>
    addDoc(collection(db, 'notifications'), {
      user_id: uid,
      read: false,
      created_at: now,
      ...payloadBase,
    })
  );
  await Promise.all(writes);
}

// --- EMAIL HELPERS ---
async function getEmailFromDoc(pathCol, uid) {
  try {
    const s = await getDoc(doc(db, pathCol, uid));
    if (s.exists()) {
      const d = s.data();
      return d.email || d.contactEmail || d.parentEmail || null;
    }
  } catch {}
  return null;
}
async function getUserEmail(uid) {
  if (!uid) return null;
  return (
    (await getEmailFromDoc("users", uid))     ||
    (await getEmailFromDoc("teachers", uid))  ||
    (await getEmailFromDoc("parents", uid))   ||
    (await getEmailFromDoc("students", uid))
  );
}

/** Envoie aux élèves ET, si nécessaire, à leurs parents */
async function sendEmailsToUsers(userIds = [], { title, message, ctaUrl, ctaText = "Ouvrir" }, lessonCtx = null) {
  const emails = new Set();

  // 1) emails directs
  for (const uid of userIds) {
    const em = await getUserEmail(uid);
    if (em) emails.add(em);
  }

  // 2) fallback parents via participantsMap si dispo
  if (lessonCtx && Array.isArray(lessonCtx.participant_ids)) {
    const pm = lessonCtx.participantsMap || {};
    for (const sid of lessonCtx.participant_ids) {
      if (!emails.size || !(await getUserEmail(sid))) {
        const parentId = pm?.[sid]?.parent_id || pm?.[sid]?.booked_by || null;
        const pem = await getUserEmail(parentId);
        if (pem) emails.add(pem);
      }
    }
  }

  if (!emails.size) return;
  const payload = {
    title,
    message,
    ctaUrl: ctaUrl || `${window.location.origin}/smart-dashboard`,
    ctaText,
  };

  await Promise.all(
    Array.from(emails).map((to) =>
      fetch("/api/notify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, ...payload }),
      }).catch(() => {})
    )
  );
}
// --- /EMAIL HELPERS ---

// --- helper: retrouver le parent d'un élève ---
async function getParentIdForStudent(studentId, lesson) {
  // 1) via participantsMap de la leçon (le plus fiable si tu l’as)
  const pm = lesson?.participantsMap || {};
  const viaMap = pm?.[studentId]?.parent_id || pm?.[studentId]?.booked_by;
  if (viaMap) return viaMap;

  // 2) via collection students/{id}
  try {
    const s = await getDoc(doc(db, "students", studentId));
    if (s.exists()) {
      const d = s.data();
      return d.parent_id || d.parentId || d.booked_by || null;
    }
  } catch {}

  // 3) fallback via users/{id} si tu as stocké parent_id dessus
  try {
    const u = await getDoc(doc(db, "users", studentId));
    if (u.exists()) {
      const d = u.data();
      return d.parent_id || d.parentId || d.booked_by || null;
    }
  } catch {}

  return null;
}
// --- /helper ---

/* ---------- pending helpers ---------- */
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

/* ---------- payment helpers (individuel) ---------- */
const isIndividualPaid = (l) => {
  if (!l || l.is_group) return false;

  // Cas simple : champ is_paid sur la leçon
  if (l.is_paid === true) return true;

  // Cas où le paiement est stocké dans participantsMap
  const pm = l.participantsMap || {};
  for (const sid of Object.keys(pm)) {
    if (pm[sid]?.is_paid === true) return true;
  }

  return false;
};

/* ---------- payment helpers (groupe) ---------- */
const isGroupFullyPaid = (l) => {
  if (!l || !isGroupLessonStrict(l)) return false;

  const pm = l.participantsMap || {};
  const ids = Array.isArray(l.participant_ids) && l.participant_ids.length
    ? l.participant_ids
    : Object.keys(pm);

  if (!ids.length) return false;

  // On considère seulement les participants "actifs" (acceptés / confirmés)
  const activeIds = ids.filter((sid) => {
    const st = String(pm?.[sid]?.status || '').toLowerCase();
    return st === 'accepted' || st === 'confirmed';
  });

  if (!activeIds.length) return false;

  // Tous les participants actifs doivent être is_paid === true
  return activeIds.every((sid) => pm?.[sid]?.is_paid === true);
};

/* ---------- time helpers ---------- */
const getStartMs = (lesson) => {
  const d = getLessonStartDate(lesson);
  return d ? d.getTime() : null;
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

const isVisio = (l) => String(l?.mode || '').toLowerCase() === 'visio' || l?.is_visio === true;
const hasVisioLink = (l) => !!l?.visio?.joinUrl;

// Use your existing nextOccurrence(day, hour). If you don't have it, keep this fallback:
function nextOccurrence(day, hour, base = new Date()) {
  // day like "Lundi" or "2025-11-04", adapt to your format if needed.
  // If you already have nextOccurrence in this file, REMOVE this function.
  try {
    const d = new Date(base);
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(day))) {
      const [Y,M,D] = String(day).split('-').map(Number);
      d.setFullYear(Y, M-1, D);
    } else {
      // basic weekday resolver (Mon..Sun), adjust names to your data
      const map = { 'lundi':1,'mardi':2,'mercredi':3,'jeudi':4,'vendredi':5,'samedi':6,'dimanche':0 };
      const want = map[String(day).toLowerCase()] ?? d.getDay();
      const cur = d.getDay();
      let add = (want - cur + 7) % 7;
      if (add === 0 && (d.getHours() > hour || (d.getHours() === hour && d.getMinutes() > 0))) add = 7;
      d.setDate(d.getDate() + add);
    }
    d.setHours(Number(hour || 0), 0, 0, 0);
    return d;
  } catch { return null; }
}

function computeVisioWindow(lesson) {
  const start = getLessonStartDate(lesson);

  if (!start) {
    return { opensAt: null, expiresAt: null };
  }

  // lien ouvert 10 minutes avant, expiré 2h après le début
  const opensAt = new Date(start.getTime() - 10 * 60 * 1000); // T-10 min
  const expiresAt = new Date(start.getTime() + 2 * 60 * 60 * 1000); // T+2 h

  return { opensAt, expiresAt };
}

// ——— Helpers "rejet" pour les cours groupés ———

// Un élève est-il marqué comme refusé/retiré/supprimé ?
function isParticipantRejectedStatus(st) {
  const s = String(st || '').toLowerCase();
  return s === 'rejected' || s === 'removed' || s === 'deleted';
}

// Retourne la liste des élèves refusés pour un cours groupé
function getRejectedStudents(lesson) {
  const pm = lesson?.participantsMap || {};
  const ids = Array.isArray(lesson?.participant_ids)
    ? lesson.participant_ids
    : Object.keys(pm || {});
  return ids.filter((sid) => isParticipantRejectedStatus(pm?.[sid]?.status));
}

// ===== Helpers pack (détection ultra tolérante) =====
function getPackHoursFromEntry(entry = {}) {
  // on accepte plusieurs schémas possibles
  const v =
    Number(entry?.pack_hours) ||
    Number(entry?.packHours) ||
    Number(entry?.pack?.hours) ||
    (entry?.is_pack10 ? 10 : 0) ||
    (entry?.is_pack5 ? 5 : 0) ||
    (entry?.pack === '10h' ? 10 : 0) ||
    (entry?.pack === '5h' ? 5 : 0);

  if (v >= 10) return 10;
  if (v >= 5) return 5;
  return 0;
}

/** Renvoie l’ID de l’élève pour lequel un pack (5h/10h) est actif, sinon null */
function getPackOwner(lesson) {
  const pm = lesson?.participantsMap || {};
  const ids = Array.isArray(lesson?.participant_ids) && lesson.participant_ids.length
    ? Array.from(new Set(lesson.participant_ids))
    : Object.keys(pm);

  for (const sid of ids) {
    const hours = getPackHoursFromEntry(pm[sid] || {});
    if (hours === 5 || hours === 10) return sid;
  }
  return null;
}

function getPackHoursForOwner(lesson) {
  const pm = lesson?.participantsMap || {};
  const owner = getPackOwner(lesson);
  if (!owner) return 0;
  return getPackHoursFromEntry(pm[owner] || {});
}

function isLessonPartOfPack(lesson) {
  if (lesson?.pack_id) return true;        // cas standard
  return getPackOwner(lesson) !== null;    // cas “pack” stocké dans participantsMap
}

function packKeyTeacher(lesson) {
  // Clé stable d’agrégation: pack_id si dispo, sinon clé “AUTO:…|owner”
  if (lesson?.pack_id) return String(lesson.pack_id);
  const owner = getPackOwner(lesson);
  if (!owner) return null;

  const hours = getPackHoursForOwner(lesson);
  const mode = (String(lesson?.mode || '').toLowerCase() === 'visio' || lesson?.is_visio === true)
    ? 'visio'
    : 'presentiel';

  return `AUTO:${lesson.teacher_id}|${lesson.subject_id || ''}|${mode}|${hours}|${owner}`;
}

// 🔎 même pack que la carte courante (clé pack_id ou clé AUTO:…)
function samePackKey(a, b) {
  const ka = packKeyTeacher(a);
  const kb = packKeyTeacher(b);
  return ka && kb && ka === kb;
}

// helpers au même endroit que tes autres helpers
const REJECTED_SET = new Set(['rejected','removed','deleted']);

function hasPendingParticipant(l) {
  const ids = Array.isArray(l.participant_ids) ? l.participant_ids : Object.keys(l.participantsMap || {});
  for (const sid of ids) {
    const st = String(l?.participantsMap?.[sid]?.status || '');
    if (!REJECTED_SET.has(st) && st !== 'accepted' && st !== 'confirmed') {
      return true; // encore en attente côté participant
    }
  }
  return false;
}

// ——— BADGE PACK pour une leçon, éventuellement ciblé sur un participant (sid) ———
function packLabelForLesson(l, sid = null) {
  const read = (obj) => Number(
    obj?.pack_hours ??
    obj?.packHours ??
    (obj?.pack === '10h' ? 10 : obj?.pack === '5h' ? 5 : 0) ??
    (obj?.is_pack10 ? 10 : obj?.is_pack5 ? 5 : 0) ??
    0
  );

  // priorité au participant si fourni
  if (sid && l?.participantsMap?.[sid]) {
    const v = read(l.participantsMap[sid]);
    if (v >= 10) return 'Pack 10h';
    if (v >= 5) return 'Pack 5h';
  }

  // fallback leçon
  const v = read(l);
  if (v >= 10) return 'Pack 10h';
  if (v >= 5) return 'Pack 5h';
  return '';
}

// --- helpers INDIVIDUEL: status basé sur le participant propriétaire ---
function getOwnerStudentId(l) {
  if (l?.student_id) return l.student_id;
  const ids = Array.isArray(l?.participant_ids) ? l.participant_ids : Object.keys(l?.participantsMap || {});
  return ids.length === 1 ? ids[0] : null;
}

function individualStatus(l) {
  // Priorité au statut du participant propriétaire pour les cours non-groupes
  if (l?.is_group) return String(l?.status || '');
  const sid = getOwnerStudentId(l);
  if (!sid) return String(l?.status || '');

  const pst = String(l?.participantsMap?.[sid]?.status || '').toLowerCase();
  if (['rejected', 'removed', 'deleted'].includes(pst)) return 'rejected';
  if (['accepted', 'confirmed'].includes(pst)) return 'confirmed';
  if (PENDING_SET.has(pst)) return 'booked';
  return String(l?.status || '');
}

function isGroupLessonStrict(l) {
  // vrai seulement si c’est explicitement groupe OU ≥2 participants
  const ids = Array.isArray(l?.participant_ids) && l.participant_ids.length
    ? l.participant_ids
    : Object.keys(l?.participantsMap || {});
  return l?.is_group === true || ids.length >= 2;
}

const isInvitationStatus = (st) => String(st || '').toLowerCase().startsWith('invited_');

function isFreeHourFor(uid, lesson) {
  if (!lesson) return false;
  if (lesson.is_free_hour) return true;
  if (uid && lesson?.participantsMap?.[uid]?.is_free_hour) return true;
  return false;
}

/* =================== PAGE =================== */
export default function TeacherLessons() {
  const [lessons, setLessons] = useState([]);
  const [loading, setLoading] = useState(true);

  // Docs
  const [docOpen, setDocOpen] = useState(false);
  const [docLesson, setDocLesson] = useState(null);

  // Group
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupLesson, setGroupLesson] = useState(null);

  // participants popover
  const [openParticipantsFor, setOpenParticipantsFor] = useState(null);

  // cache noms
  const nameCacheRef = useRef(new Map());

  // Pending group entries (par élève)
  const [pendingGroup, setPendingGroup] = useState([]); // [{lessonId, lesson, studentId, status, studentName, requesterName}]
  const [pendingIndiv, setPendingIndiv] = useState([]); // lessons individuels en attente (enrichis)

  // Demandes "pack" (regroupées par pack_id)
  const [pendingPacks, setPendingPacks] = useState([]); // [{ packId, lesson, slots: [ {day,hour,label} ], modeLabel, packLabel }]

  // ✅ Branche l'écoute Firestore quand auth est prêt
  useEffect(() => {
    let unsubLessons = null;
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (unsubLessons) { unsubLessons(); unsubLessons = null; }

      if (!user) {
        setLessons([]);
        setPendingGroup([]);
        setPendingIndiv([]);
        setLoading(false);
        return;
      }
      const uid = user.uid;

      setLoading(true);
      const qLessons = query(collection(db, 'lessons'), where('teacher_id', '==', uid));

      unsubLessons = onSnapshot(qLessons, async (snap) => {
        const raw = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

        // ----- Construire pendingIndiv (tous statuts “pending”)
        // Demandes individuelles réelles : basé sur le statut du participant propriétaire
        const pIndivRaw = raw.filter((l) => {
          if (l.is_group) return false;                 // on ne veut pas les groupes ici
          if (isLessonPartOfPack(l)) return false;      // ni les packs (gérés ailleurs)

          const indiv = individualStatus(l);            // 'booked' | 'confirmed' | 'rejected' | ...

          // on exclut tout ce qui n'est plus en attente
          if (indiv === 'rejected' || indiv === 'confirmed' || indiv === 'completed') return false;

          // on ne garde que les vrais “pending”
          return PENDING_SET.has(indiv);
        });

        // ----- Construire pendingGroup par élève (tout statut != accepted/confirmed) — exclut PACKS
        const pGroupRaw = [];
        raw
          .filter((l) => !isLessonPartOfPack(l) && isGroupLessonStrict(l))
          .forEach((l) =>  {
            // ⛔ Ignore tout cours dont le statut global est déjà rejeté
            if (String(l.status || '').toLowerCase() === 'rejected') return;
            const ids = Array.isArray(l.participant_ids)
              ? Array.from(new Set(l.participant_ids))
              : Object.keys(l.participantsMap || {});
            const pm = l.participantsMap || {};
            ids.forEach((sid) => {
              const st = String(pm?.[sid]?.status || '');
              // On considère "pending" tout ce qui n’est PAS accepté/confirmé/rejeté/removed/deleted
              if (
                !['accepted', 'confirmed', 'rejected', 'removed', 'deleted'].includes(st) &&
                !isInvitationStatus(st) // ⬅️ on masque les invitations
              ) {
                pGroupRaw.push({
                  lessonId: l.id,
                  lesson: l,
                  studentId: sid,
                  status: st || 'booked',
                });
              }
            });
          });

          // enrichir noms + détails participants (confirmés uniquement pour popover) + requester
          const enriched = await Promise.all(
            raw.map(async (l) => {
              // élève principal (legacy)
              let studentName = '';
              if (l.student_id) studentName = await resolvePersonName(l.student_id, nameCacheRef.current);

              // APRÈS — prend d’abord participantsMap, sinon participant_ids
              const pm = l.participantsMap || {};
              const idsFromMap = Object.keys(pm);
              const baseIds = idsFromMap.length
                ? idsFromMap
                : (Array.isArray(l.participant_ids) ? Array.from(new Set(l.participant_ids)) : []);

              let participantDetails = [];
              if (baseIds.length > 0) {
                participantDetails = await Promise.all(
                  baseIds.map(async (sid) => {
                    const parentId = pm?.[sid]?.parent_id || pm?.[sid]?.booked_by || null;
                    return {
                      id: sid,
                      name: await resolvePersonName(sid, nameCacheRef.current, { parentId }),
                      is_paid: !!pm?.[sid]?.is_paid,
                      // on considère accepted ou confirmed comme "confirmé"
                      status: pm?.[sid]?.status || 'accepted',
                    };
                  })
                );
              }

            // requester (qui a cliqué)
            let requesterName = '';
            const requesterId =
              (l.participantsMap && l.student_id && l.participantsMap[l.student_id]?.parent_id) ||
              l.parent_id ||
              l.booked_by ||
              null;
            if (requesterId) {
              requesterName = await resolvePersonName(requesterId, nameCacheRef.current);
            }

            // fallback : si pas de student_id mais un seul participant (via map OU participant_ids), utiliser son nom
            if (!studentName) {
              const pm = l.participantsMap || {};
              const idsFromMap = Object.keys(pm);
              const soleId =
                (Array.isArray(l.participant_ids) && l.participant_ids.length === 1 && l.participant_ids[0]) ||
                (idsFromMap.length === 1 && idsFromMap[0]) ||
                null;

              if (soleId) {
                const parentId = pm?.[soleId]?.parent_id || pm?.[soleId]?.booked_by || null;
                studentName =
                  participantDetails[0]?.name ||
                  (await resolvePersonName(soleId, nameCacheRef.current, { parentId }));
              }
            }

            return { ...l, studentName, participantDetails, requesterName };
          })
        );
        
        // --- Regroupement visuel des packs : 1 carte par pack_id ---
        const packCount = new Map();
        enriched.forEach((l) => {
          if (l.pack_id) packCount.set(l.pack_id, (packCount.get(l.pack_id) || 0) + 1);
        });
        const seenPack = new Set();
        const compact = [];
        for (const l of enriched) {
          if (l.pack_id) {
            if (seenPack.has(l.pack_id)) continue; // ne garder que la 1ère carte du pack
            seenPack.add(l.pack_id);
            compact.push({ ...l, __packCount: packCount.get(l.pack_id) || (l.pack_hours || 1) });
          } else {
            compact.push(l);
          }
        }

        // enrichir pendingIndiv
        const pIndiv = pIndivRaw.map((pi) => {
          const found = enriched.find((e) => e.id === pi.id);
          return found || pi;
        });
        
        // ❗ Indiv + Pack : 1 seule carte par pack dans "Demandes individuelles"
        const seenIndivPack = new Set();
        const pIndivCollapsed = [];
        for (const l of pIndiv) {
          const isGroup = !!l.is_group || (Array.isArray(l.participant_ids) && l.participant_ids.length > 0);
          if (!isGroup && isLessonPartOfPack(l)) {
            const key = packKeyTeacher(l);
            if (key) {
              if (seenIndivPack.has(key)) continue;   // déjà une carte pour ce pack
              seenIndivPack.add(key);
            }
          }
          pIndivCollapsed.push(l);
        }

        // enrichir pendingGroup avec noms d'élève + "demande faite par"
        const pGroup = await Promise.all(
          pGroupRaw.map(async (g) => {
            const parentIdCtx =
              g.lesson?.participantsMap?.[g.studentId]?.parent_id ||
              g.lesson?.participantsMap?.[g.studentId]?.booked_by ||
              null;
            const nm = await resolvePersonName(g.studentId, nameCacheRef.current, { parentId: parentIdCtx });
            const pm = g.lesson?.participantsMap || {};
            const info = pm[g.studentId] || {};
            const requesterId = info.parent_id || info.booked_by || null;
            const requesterName = requesterId
              ? await resolvePersonName(requesterId, nameCacheRef.current)
              : '';
            return { ...g, studentName: nm, requesterName };
          })
        );

        // tri par date décroissante pour la liste principale
        const enrichedSorted = [...enriched].sort((a, b) => {
          const aTs =
            (a.start_datetime?.toDate?.() && a.start_datetime.toDate().getTime()) ||
            (a.start_datetime?.seconds && a.start_datetime.seconds * 1000) ||
            (a.created_at?.toDate?.() && a.created_at.toDate().getTime()) || 0;
          const bTs =
            (b.start_datetime?.toDate?.() && b.start_datetime.toDate().getTime()) ||
            (b.start_datetime?.seconds && b.start_datetime.seconds * 1000) ||
            (b.created_at?.toDate?.() && b.created_at.toDate().getTime()) || 0;
          return bTs - aTs;
        });
        // --- PENDING PACKS: 1 ligne par pack (avec ou sans pack_id)
        // helper: est-ce que cette séance rend le pack "en attente" ?
        // helper: est-ce que cette séance rend le pack "en attente" ?
        function isLessonPendingForPack(l) {
          const st = String(l.status || '');
          const pendingByStatus = PENDING_SET.has(st) || l.pending_teacher === true;

          // groupe : si AU MOINS un participant n’est pas accepté/confirmé, on considère "pending"
          const pm = l.participantsMap || {};
          const ids = (Array.isArray(l.participant_ids) && l.participant_ids.length)
            ? l.participant_ids
            : Object.keys(pm);

          let pendingByGroup = false;
          if (ids.length) {
            for (const sid of ids) {
              const pst = String(pm?.[sid]?.status || '');
              if (
                !pst ||
                PENDING_SET.has(pst) ||
                (pst !== 'accepted' && pst !== 'confirmed')  // donc pending si ni accepté ni confirmé
              ) {
                // mais on ignore ceux qui sont explicitement refusés/retirés/supprimés
                if (pst !== 'rejected' && pst !== 'removed' && pst !== 'deleted') {
                  pendingByGroup = true;
                  break;
                }
              }
            }
          }
          return pendingByStatus || pendingByGroup;
        }

        // 1) on prend toutes les leçons qui appartiennent à un pack (pack_id OU pack via participantsMap)
        // => on inclut désormais aussi les packs d’individuels
        const packLessons = enriched.filter((l) => isLessonPartOfPack(l));

        // 2) on regroupe avec une clé stable (pack_id sinon AUTO:...|owner)
        const packMap = new Map();
        for (const l of packLessons) {
          if (!isLessonPendingForPack(l)) continue; // n'afficher que si le pack est "en attente"
          const key = packKeyTeacher(l);
          if (!key) continue;

          // 🧠 ignorer le pack si tous les participants sont refusés
          if (!hasPendingParticipant(l)) continue;

          const existing = packMap.get(key);
          const slotObj = { day: l.slot_day, hour: l.slot_hour, label: slotLabel(l) };
          const pLabel = (() => {
            const h = getPackHoursForOwner(l);
            return h >= 10 ? 'Pack 10h' : h >= 5 ? 'Pack 5h' : (packLabel(l) || '');
          })();

          if (!existing) {
            packMap.set(key, {
              packId: key,
              lesson: l, // représentant utilisé par handleStatus
              slots: slotObj.label ? [slotObj] : [],
              modeLabel: modeLabel(l),
              packLabel: pLabel,
            });
          } else {
            if (slotObj.label) existing.slots.push(slotObj);
          }
        }

        // trier les créneaux et la liste
        const sortedPendingPacks = Array.from(packMap.values()).map((p) => ({
          ...p,
          slots: p.slots
            .filter(s => s.label && s.label.trim())
            .sort((a, b) => (a.day || '').localeCompare(b.day || '') || Number(a.hour || 0) - Number(b.hour || 0)),
        }));
        sortedPendingPacks.sort((a, b) => (a.slots[0]?.label || '').localeCompare(b.slots[0]?.label || ''));

        setPendingPacks(sortedPendingPacks);

        setPendingPacks(sortedPendingPacks);
        setLessons(enrichedSorted);
        setPendingIndiv(pIndivCollapsed);
        setPendingGroup(pGroup);
        setLoading(false);
      }, (err) => {
        console.error(err);
        setLessons([]);
        setPendingGroup([]);
        setPendingIndiv([]);
        setLoading(false);
      });
    });

    return () => {
      if (unsubLessons) unsubLessons();
      unsubAuth();
    };
  }, []);

  // Helper : y a-t-il au moins un participant confirmé/accepté ?
  const hasAnyConfirmedParticipantUI = (l) => {
    if (Array.isArray(l.participantDetails) && l.participantDetails.length) {
      return l.participantDetails.some((p) => p.status === 'accepted' || p.status === 'confirmed');
    }
    const pm = l.participantsMap || {};
    return Object.values(pm).some((v) => v?.status === 'accepted' || v?.status === 'confirmed');
  };

  // Confirmés :
  // - INDIV : basé sur individualStatus()
  // - GROUPE : uniquement si au moins 1 participant accepted/confirmed
  const confirmes = useMemo(() => {
    const seen = new Set();
    const out = [];

    for (const l of lessons) {
      if (l.status === 'completed') continue;

      let ok = false;

      if (isGroupLessonStrict(l)) {
        // ✅ un groupe n’est “confirmé” que si au moins 1 élève est accepté/confirmé
        ok = hasAnyConfirmedParticipantUI(l);
      } else {
        ok = individualStatus(l) === 'confirmed';
      }

      if (ok && !seen.has(l.id)) {
        seen.add(l.id);
        out.push(l);
      }
    }
    return out;
  }, [lessons]);

  // 🔴 Refusés : individuel(status global) OU groupe (au moins 1 participant rejeté) OU status global 'rejected'
  const refuses = useMemo(() => {
    return lessons.filter((l) => {
      if (!isGroupLessonStrict(l)) {
        // Individuel : uniquement le statut du participant propriétaire
        return individualStatus(l) === 'rejected';
      }
      // Groupe: au moins un élève rejeté, ou statut global rejeté
      const pm = l.participantsMap || {};
      const ids = Array.isArray(l.participant_ids) && l.participant_ids.length
        ? l.participant_ids
        : Object.keys(pm);
      const anyRejected = ids.some((sid) => ['rejected','removed','deleted'].includes(String(pm?.[sid]?.status || '').toLowerCase()));
      return anyRejected || l.status === 'rejected';
    });
  }, [lessons]);

  const termines = useMemo(() => lessons.filter((l) => l.status === 'completed'), [lessons]);

  const openDocs = (lesson) => { setDocLesson(lesson); setDocOpen(true); };
  const openGroup = (lesson) => { setGroupLesson(lesson); setGroupOpen(true); };

  /* ---------- affichage mode/pack helpers UI ---------- */
  function ModePackPills({ l }) {
    const p = packLabel(l);
    return (
      <>
        <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded ml-1">{modeLabel(l)}</span>
        {p ? (
          <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded ml-1">{p}</span>
        ) : null}
      </>
    );
  }

  async function handleStatus(lesson, status) {
    try {
      const ref = doc(db, 'lessons', lesson.id);

      // --- NEW: if INDIVIDUAL, also update the owner student's participant status
      const isGroup = isGroupLessonStrict(lesson);
      const ownerSid = !isGroup ? getOwnerStudentId(lesson) : null;

      // Build the base update for the lesson
      const baseUpdate = {
        status,
        ...(status === 'completed' ? { completed_at: serverTimestamp() } : {}),
      };

      // If it's an individual and we know who the owner student is, mirror the status in participantsMap
      if (ownerSid) {
        baseUpdate[`participantsMap.${ownerSid}.status`] =
          status === 'confirmed' ? 'confirmed' :
          status === 'rejected'  ? 'rejected'  :
          status; // (completed stays completed on the lesson; participant can remain confirmed)
      }

      await updateDoc(ref, baseUpdate);

      // —— PACK propagation (unchanged)
      try {
        if (lesson.pack_id && (status === 'confirmed' || status === 'rejected' || status === 'completed')) {
          const qPack = query(
            collection(db, 'lessons'),
            where('teacher_id', '==', auth.currentUser.uid),
            where('pack_id', '==', lesson.pack_id)
          );
          const packSnap = await getDocs(qPack);

          for (const d of packSnap.docs) {
            const data = d.data();
            const refDoc = doc(db, 'lessons', d.id);
            const newData = { status, pending_teacher: false };

            // Cours groupe → confirmer chaque élève
            if (data.is_group || Array.isArray(data.participant_ids)) {
              const pm = { ...(data.participantsMap || {}) };
              for (const sid of data.participant_ids || []) {
                pm[sid] = { ...(pm[sid] || {}), status: status === 'rejected' ? 'rejected' : 'accepted' };
              }
              newData.participantsMap = pm;
              newData.participant_ids = Object.keys(pm);
            }
            if (status === 'completed') {
              newData.completed_at = serverTimestamp();
            }
            await updateDoc(refDoc, newData);
          }

          setLessons(prev => prev.map(l => {
            if (!lesson.pack_id) return l.id === lesson.id ? { ...l, status } : l;
            if (l.pack_id !== lesson.pack_id) return l;

            const isGrp = l.is_group || Array.isArray(l.participant_ids);
            let next = { ...l, status, pending_teacher: false };

            if (isGrp) {
              const ids = Array.isArray(l.participant_ids)
                ? l.participant_ids
                : Object.keys(l.participantsMap || {});
              const pm = { ...(l.participantsMap || {}) };
              ids.forEach(sid => {
                pm[sid] = { ...(pm[sid] || {}), status: status === 'rejected' ? 'rejected' : 'accepted' };
              });
              next.participantsMap = pm;
              next.participant_ids = ids;
            }
            return next;
          }));
        }
      } catch (err) {
        console.error('Erreur propagation pack:', err);
      }

      // MAJ optimiste
      setLessons((prev) => prev.map((x) => (x.id === lesson.id ? { ...x, status } : x)));

      // nom prof
      let profName = 'Votre professeur';
      try {
        const me = await getDoc(doc(db, 'users', auth.currentUser.uid));
        if (me.exists()) profName = me.data().fullName || profName;
      } catch {}

      // destinataires
      const recipients = new Set();
      if (lesson.student_id) recipients.add(lesson.student_id);
      (lesson.participant_ids || []).forEach((sid) => recipients.add(sid));

      let notifType = '', message = '';
      if (status === 'confirmed') {
        notifType = 'cours_accepted';
        message = `Votre cours ${lesson.subject_id || ''} avec ${profName} a été accepté.`;
      } else if (status === 'rejected') {
        notifType = 'cours_rejected';
        message = `Votre cours ${lesson.subject_id || ''} avec ${profName} a été refusé.`;
      } else if (status === 'completed') {
        notifType = 'cours_completed';
        message = `Votre cours ${lesson.subject_id || ''} avec ${profName} est terminé.`;
      } else return;

      await notifyUsers(Array.from(recipients), {
        type: notifType,
        with_id: auth.currentUser.uid,
        withName: profName,
        lesson_id: lesson.id,
        message,
      });
      
      // --- ENVOI EMAIL lié au statut (parents uniquement + élèves si mail) ---
      const parentRecipients = new Set();
      for (const sid of (lesson.participant_ids || [])) {
        const pid = await getParentIdForStudent(sid, lesson);
        if (pid) parentRecipients.add(pid);
      }
      if (lesson.booked_by) parentRecipients.add(lesson.booked_by);

      await sendEmailsToUsers(
        Array.from(recipients),
        {
          title:
            status === "confirmed" ? "Cours confirmé" :
            status === "rejected"  ? "Cours refusé"   :
            status === "completed" ? "Cours terminé"  :
            "Notification EduKaraib",
          message,
          ctaUrl: `${window.location.origin}/smart-dashboard`,
          ctaText: "Voir le cours",
        },
        lesson
      );

      if (status === 'confirmed') {
        const snap = await getDoc(ref);
        const current = snap.exists() ? { id: snap.id, ...snap.data() } : { ...lesson, status: 'confirmed' };
        await createPaymentDueNotificationsForLesson(current);
      }
    } catch (e) {
      console.error(e);
      alert("Impossible de modifier le statut.");
    }
  }

  // ✅ Accepter TOUT un pack
  async function acceptWholePack(repLesson) {
    // helper: statut participant “actif en attente”
    const isPendingParticipant = (st) => {
      const s = String(st || '').toLowerCase();
      return !['accepted','confirmed','rejected','removed','deleted'].includes(s);
    };

    // ne cible que les séances du même pack ET réellement encore en attente
    const targets = lessons.filter((l) => {
      if (!samePackKey(l, repLesson)) return false;
      // en attente par statut global ?
      const pendingByStatus = PENDING_SET.has(String(l.status || '')) || l.pending_teacher === true;

      // en attente côté groupe (au moins un participant pas encore accepté/confirmé/ni rejeté)
      const pm  = l.participantsMap || {};
      const ids = (Array.isArray(l.participant_ids) && l.participant_ids.length)
        ? l.participant_ids
        : Object.keys(pm);
      const pendingByGroup = ids.some((sid) => isPendingParticipant(pm?.[sid]?.status));

      return pendingByStatus || pendingByGroup;
    });

    try {
      const notified = new Set();

      for (const l of targets) {
        if (l.is_group || (Array.isArray(l.participant_ids) && l.participant_ids.length > 0)) {
          // confirme uniquement les participants encore “pending”
          const pm  = { ...(l.participantsMap || {}) };
          const ids = (Array.isArray(l.participant_ids) && l.participant_ids.length)
            ? Array.from(new Set(l.participant_ids))
            : Object.keys(pm);

          ids.forEach((sid) => {
            const st = String(pm?.[sid]?.status || '');
            if (!['accepted','confirmed','rejected','removed','deleted'].includes(st)) {
              pm[sid] = { ...(pm[sid] || {}), status: 'confirmed' };
            }
            notified.add(sid);
          });

          await updateDoc(doc(db, 'lessons', l.id), {
            participantsMap: pm,
            participant_ids: ids,
            status: 'confirmed',
            pending_teacher: false,
          });
        } else {
          // individuel : seulement si encore pending
          if (PENDING_SET.has(String(l.status || '')) || l.pending_teacher === true) {
            await updateDoc(doc(db, 'lessons', l.id), {
              status: 'confirmed',
              pending_teacher: false,
            });
            if (l.student_id) notified.add(l.student_id);
          }
        }
      }

      // MAJ UI locale
      setLessons((prev) => prev.map((l) => {
        if (!samePackKey(l, repLesson)) return l;

        const pm  = { ...(l.participantsMap || {}) };
        const ids = (Array.isArray(l.participant_ids) && l.participant_ids.length)
          ? l.participant_ids
          : Object.keys(pm);

        const isGroup = l.is_group || ids.length > 0;

        if (isGroup) {
          let changed = false;
          ids.forEach((sid) => {
            const st = String(pm?.[sid]?.status || '');
            if (!['accepted','confirmed','rejected','removed','deleted'].includes(st)) {
              pm[sid] = { ...(pm[sid] || {}), status: 'confirmed' };
              changed = true;
            }
          });
          if (!changed && l.status !== 'confirmed') return l;
          return { ...l, participantsMap: pm, participant_ids: ids, status: 'confirmed', pending_teacher: false };
        }

        // individuel
        if (PENDING_SET.has(String(l.status || '')) || l.pending_teacher === true) {
          return { ...l, status: 'confirmed', pending_teacher: false };
        }
        return l;
      }));

      setPendingPacks((prev) => prev.filter((p) => !samePackKey(p.lesson, repLesson)));

      // 📧 Emails (élèves + parents)
      await sendEmailsToUsers(
        Array.from(notified),
        {
          title: "Pack accepté",
          message: "Votre demande de pack a été acceptée. Rendez-vous sur votre espace pour les détails.",
          ctaUrl: `${window.location.origin}/smart-dashboard`,
          ctaText: "Voir mes cours",
        },
        repLesson
      );
    } catch (e) {
      console.error(e);
      alert("Impossible d'accepter tout le pack.");
    }
  }

  // ❌ Refuser TOUT un pack (ne change pas le status global du cours)
  async function rejectWholePack(repLesson) {
    const isFinal = (st) => ['accepted','confirmed','rejected','removed','deleted'].includes(String(st || '').toLowerCase());

    const targets = lessons.filter((l) => samePackKey(l, repLesson));

    try {
      const rejectedSet = new Set();

      for (const l of targets) {
        const pm  = { ...(l.participantsMap || {}) };
        const ids = (Array.isArray(l.participant_ids) && l.participant_ids.length)
          ? Array.from(new Set(l.participant_ids))
          : Object.keys(pm);

        if (l.is_group || ids.length > 0) {
          // refuse uniquement ceux qui ne sont pas déjà dans un état final
          ids.forEach((sid) => {
            const st = pm?.[sid]?.status;
            if (!isFinal(st)) {
              pm[sid] = { ...(pm[sid] || {}), status: 'rejected' };
              rejectedSet.add(sid);
            }
          });

          await updateDoc(doc(db, 'lessons', l.id), {
            participantsMap: pm,
            participant_ids: ids,
            pending_teacher: false, // NE PAS mettre status:'rejected' global
          });
        } else {
          // individuel : on ne touche pas au statut global si déjà refusé/confirmé
          const keepStatus = String(l.status || '');
          await updateDoc(doc(db, 'lessons', l.id), {
            pending_teacher: false,
            ...(PENDING_SET.has(keepStatus) ? {} : {}), // rien d’autre
          });
        }
      }

      // MAJ UI locale
      setLessons((prev) => prev.map((l) => {
        if (!samePackKey(l, repLesson)) return l;
        const pm  = { ...(l.participantsMap || {}) };
        const ids = (Array.isArray(l.participant_ids) && l.participant_ids.length)
          ? l.participant_ids
          : Object.keys(pm);

        if (l.is_group || ids.length > 0) {
          ids.forEach((sid) => {
            const st = pm?.[sid]?.status;
            if (!['accepted','confirmed','rejected','removed','deleted'].includes(String(st || '').toLowerCase())) {
              pm[sid] = { ...(pm[sid] || {}), status: 'rejected' };
            }
          });
          return { ...l, participantsMap: pm, participant_ids: ids, pending_teacher: false };
        }
        return { ...l, pending_teacher: false };
      }));

      setPendingPacks((prev) => prev.filter((p) => !samePackKey(p.lesson, repLesson)));

      // 📧 Emails
      await sendEmailsToUsers(
        Array.from(rejectedSet),
        {
          title: "Pack refusé",
          message: "Votre demande de pack a été refusée. Vous pouvez refaire une demande pour d’autres horaires.",
          ctaUrl: `${window.location.origin}/smart-dashboard`,
          ctaText: "Choisir d’autres horaires",
        },
        repLesson
      );
    } catch (e) {
      console.error(e);
      alert("Impossible de refuser tout le pack.");
    }
  }

  // actions groupe (par élève)
  async function acceptGroupStudent(lessonId, studentId) {
    try {
      // 1) valider l'élève dans le groupe
      await updateDoc(doc(db, 'lessons', lessonId), {
        [`participantsMap.${studentId}.status`]: 'confirmed',
        status: 'confirmed', // assure la sortie des "Demandes"
      });

      // 2) MAJ immédiate de l'affichage
      setLessons(prev => prev.map(l => {
        if (l.id !== lessonId) return l;
        const pm = { ...(l.participantsMap || {}) };
        pm[studentId] = { ...(pm[studentId] || {}), status: 'confirmed' };
        const ids = Array.isArray(l.participant_ids)
          ? Array.from(new Set([...l.participant_ids, studentId]))
          : [studentId];

        // si le cours était encore "booked", on met "confirmed" pour qu’il sorte de Demandes
        const nextStatus = l.status === 'booked' ? 'confirmed' : l.status;

        return { ...l, participantsMap: pm, participant_ids: ids, status: nextStatus };
      }));

      // 3) si le statut global est encore "booked", passe-le à "confirmed" en base
      await updateDoc(doc(db, 'lessons', lessonId), { status: 'confirmed' });

      // enlever la ligne de Demandes (UI)
      setPendingGroup(prev => prev.filter(g => !(g.lessonId === lessonId && g.studentId === studentId)));

      // 📧 Emails (élève + parent)
      await sendEmailsToUsers(
        [studentId],
        {
          title: "Cours confirmé (groupe)",
          message: "Votre demande d’intégrer le cours groupé a été acceptée.",
          ctaUrl: `${window.location.origin}/smart-dashboard`,
          ctaText: "Voir le cours",
        }
      );

      try { await createPaymentDueNotificationsForLesson(lessonId, { onlyForStudentId: studentId }); } catch {}
    } catch (e) {
      console.error(e);
      alert("Impossible d'accepter l'élève.");
    }
  }

  async function rejectGroupStudent(lessonId, studentId) {
    try {
      await updateDoc(doc(db, 'lessons', lessonId), {
        [`participantsMap.${studentId}.status`]: 'rejected',
      });

      setPendingGroup(prev => prev.filter(g => !(g.lessonId === lessonId && g.studentId === studentId)));

      setLessons(prev => prev.map(l => {
        if (l.id !== lessonId) return l;
        const pm = { ...(l.participantsMap || {}) };
        pm[studentId] = { ...(pm[studentId] || {}), status: 'rejected' };
        // on conserve participant_ids tel quel pour que les filtres trouvent la ligne
        return { ...l, participantsMap: pm };
      }));

      // 📧 Emails (élève + parent)
      await sendEmailsToUsers(
        [studentId],
        {
          title: "Cours refusé (groupe)",
          message: "Votre demande d’intégrer le cours groupé a été refusée.",
          ctaUrl: `${window.location.origin}/smart-dashboard`,
          ctaText: "Voir mes demandes",
        }
      );
    } catch (e) {
      console.error(e);
      alert("Impossible de refuser l'élève.");
    }
  }

  /* ---------- AUTO-RÈGLES : refus si non accepté / non payé à l’heure ---------- */
  useEffect(() => {
    if (!lessons.length) return;

    const tick = async () => {
      const now = Date.now();

      const updates = lessons.map(async (l) => {
        const startMs = getStartMs(l);
        if (!startMs) return; // on ne force rien si aucune date absolue

        // 1) Si pas accepté avant l'heure prévue → refusé
        if (now >= startMs) {
          const statusStr = String(l.status || '');
          const isAccepted =
            statusStr === 'confirmed' ||
            statusStr === 'completed' ||
            (l.is_group && hasAnyConfirmedParticipantUI(l));

          if (!isAccepted && statusStr !== 'rejected') {
            const isGroup = isGroupLessonStrict(l);
            const owner = !isGroup ? getOwnerStudentId(l) : null;

            if (isGroup) {
              // Groupe → on rejette chaque participant pas accepté
              const pm = { ...(l.participantsMap || {}) };
              for (const sid of Object.keys(pm)) {
                if (!['confirmed','accepted','rejected','removed','deleted'].includes(String(pm[sid]?.status || '')))
                  pm[sid] = { ...(pm[sid] || {}), status: 'rejected' };
              }
              await updateDoc(doc(db, "lessons", l.id), { participantsMap: pm });
            } else if (owner) {
              // Individuel → statut sur participantsMap ET status du cours
              await updateDoc(doc(db, "lessons", l.id), {
                status: "rejected",
                [`participantsMap.${owner}.status`]: "rejected",
              });
            }
          }
        }

        // 2) Cours confirmés mais non payés à l'heure → refus automatiques
        if (String(l.status || '') === 'confirmed' && now >= startMs) {
          const isGroup = isGroupLessonStrict(l);

          if (!isGroup) {
            // 🔹 INDIVIDUEL : on refuse le cours + le participant propriétaire
            if (!isIndividualPaid(l)) {
              const owner = getOwnerStudentId(l);
              const update = { status: 'rejected' };
              if (owner) {
                update[`participantsMap.${owner}.status`] = 'rejected';
              }

              try {
                await updateDoc(doc(db, 'lessons', l.id), update);
              } catch {}

              try {
                const recipients = new Set();
                if (owner) recipients.add(owner);
                if (l.student_id) recipients.add(l.student_id);
                (l.participant_ids || []).forEach((sid) => recipients.add(sid));

                await sendEmailsToUsers(
                  Array.from(recipients),
                  {
                    title: "Cours refusé (paiement manquant)",
                    message:
                      "Votre cours a été automatiquement refusé car il n'a pas été payé à temps. " +
                      "Vous pouvez refaire une demande ou choisir un autre créneau.",
                    ctaUrl: `${window.location.origin}/smart-dashboard`,
                    ctaText: "Voir mes cours",
                  },
                  l
                );
              } catch {}
            }
          } else {
            // 🔹 GROUPE : on NE touche PAS au status global, seulement aux participants non payés
            const pm = { ...(l.participantsMap || {}) };
            const ids = Array.isArray(l.participant_ids) && l.participant_ids.length
              ? l.participant_ids
              : Object.keys(pm);

            const rejectedStudents = [];

            ids.forEach((sid) => {
              const info = pm[sid] || {};
              const st = String(info.status || '').toLowerCase();
              const isAccepted = st === 'accepted' || st === 'confirmed';
              const isPaid = info.is_paid === true;

              // élève accepté/confirmé mais pas payé → rejeté uniquement lui
              if (isAccepted && !isPaid) {
                pm[sid] = { ...info, status: 'rejected' };
                rejectedStudents.push(sid);
              }
            });

            if (rejectedStudents.length) {
              try {
                await updateDoc(doc(db, 'lessons', l.id), {
                  participantsMap: pm,
                  participant_ids: ids,
                });
              } catch {}

              try {
                await sendEmailsToUsers(
                  rejectedStudents,
                  {
                    title: "Participation refusée (paiement manquant)",
                    message:
                      "Votre participation à un cours groupé a été automatiquement refusée " +
                      "car le paiement n'a pas été reçu à temps.",
                    ctaUrl: `${window.location.origin}/smart-dashboard`,
                    ctaText: "Voir mes cours",
                  },
                  l
                );
              } catch {}
            }
          }
        }

        // 3) 30 minutes après la fin : passer automatiquement en "completed" si payé
        // On considère 1h de cours par slot (tu peux ajuster si tu ajoutes un champ de durée)
        const durationMs = 60 * 60 * 1000;           // 1 heure
        const completeAfterMs = 30 * 60 * 1000;      // +30 minutes
        const completeAtMs = startMs + durationMs + completeAfterMs;

        if (now >= completeAtMs && String(l.status || '') === 'confirmed') {
          try {
            if (!isGroupLessonStrict(l)) {
              // 🔹 Cas INDIVIDUEL : élève payé → completed
              if (isIndividualPaid(l)) {
                await updateDoc(doc(db, 'lessons', l.id), {
                  status: 'completed',
                  completed_at: serverTimestamp(),
                });
              }
            } else {
              // 🔹 Cas GROUPE : tous les participants confirmés payés → completed
              if (isGroupFullyPaid(l) && hasAnyConfirmedParticipantUI(l)) {
                await updateDoc(doc(db, 'lessons', l.id), {
                  status: 'completed',
                  completed_at: serverTimestamp(),
                });
              }
            }
          } catch (e) {
            console.error('auto-complete error', e);
          }
        }

        // ✅ NEW: cours groupé confirmé mais plus aucun élève accepté/confirmé -> rejet après l'heure
        if (now >= startMs && String(l.status || '') === 'confirmed' && isGroupLessonStrict(l)) {
          const anyConfirmed = hasAnyConfirmedParticipantUI(l);

          // “vide” = personne accepté/confirmé (ex: tous rejected/removed/deleted)
          if (!anyConfirmed) {
            try {
              await updateDoc(doc(db, 'lessons', l.id), {
                status: 'rejected',
                rejected_at: serverTimestamp(),
                rejected_reason: 'no_students',
                rejected_note: 'Aucun élève',
              });
            } catch {}
          }
        }

      });

      try { await Promise.all(updates); } catch {}
    };

    // premier passage + intervalle régulier
    tick();
    const id = setInterval(tick, 60 * 1000); // chaque minute
    return () => clearInterval(id);
  }, [lessons]);

  async function createVisioLink(lesson) {
    try {
      // token aléatoire côté navigateur
      const token = (len = 32) =>
        Array.from(crypto.getRandomValues(new Uint8Array(len)))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');

      // fenêtre d’ouverture/expiration
      const { opensAt, expiresAt } = computeVisioWindow(lesson);

      const roomSuffix = `jk_${lesson.id}_${token(8)}`; // partie aléatoire
      const payload = {
        joinUrl: `${window.location.origin}/visio/${lesson.id}?k=${token(16)}`,
        created_at: new Date().toISOString(),
        opens_at: opensAt?.toISOString?.() || null,
        expires_at: expiresAt?.toISOString?.() || null,
        revoked: false,
        provider: 'jaas', // pour info
        // Salle complète côté JAAS: "vpaas-magic-cookie-.../jk_<lessonId>_<random>"
        room: `${JAAS_ROOM_PREFIX}${roomSuffix}`,
      };

      // En BD
      await updateDoc(doc(db, 'lessons', lesson.id), { visio: payload });

      // MAJ instantanée de l’UI (👉 ici "setLessons" existe car on est dans le composant)
      setLessons(prev => prev.map(l => (l.id === lesson.id ? { ...l, visio: payload } : l)));
    } catch (e) {
      console.error('createVisioLink error', e);
      alert("Impossible de créer le lien visio.");
    }
  }

  const Card = ({ lesson, showActionsForPending }) => {
    const isGroup = isGroupLessonStrict(lesson);

    const confirmedParticipants = (lesson.participantDetails || []).filter(
      (p) => p.status === 'accepted' || p.status === 'confirmed'
    );

    // capacity: take an explicit capacity/max if present, else default 10 for groups, 1 for individual
    const declaredCap =
      lesson.capacity ??
      lesson.max_group_size ??
      lesson.group_size ??
      (isGroup ? 10 : 1);

    const capacity = declaredCap;
    const used = isGroup ? confirmedParticipants.length : (lesson.student_id ? 1 : 0);

    const showList = openParticipantsFor === lesson.id;

    // ✅ Pastille à afficher
    const displayedStatus = isGroup
      ? (
          (Array.isArray(lesson.participantDetails) && lesson.participantDetails.some(p => p.status === 'accepted' || p.status === 'confirmed'))
            ? 'confirmed'
            : lesson.status
        )
      : individualStatus(lesson); // ⬅️ PRISE EN COMPTE DU participant propriétaire pour un individuel

    // ⬇️ Pastille paiement pour les cours individuels
    const ownerId = getOwnerStudentId(lesson); // tu l’as déjà plus haut
    const isFree = isFreeHourFor(ownerId, lesson);

    const indivPaidPill = (!isGroup && displayedStatus === "confirmed") ? (
      isFree ? (
        <span className="text-[11px] px-2 py-0.5 rounded-full ml-2 bg-pink-50 text-pink-700" title="Heure offerte (pack)">
          🎁 Offert
        </span>
      ) : (
        <span
          className={`text-[11px] px-2 py-0.5 rounded-full ml-2 ${
            isIndividualPaid(lesson) ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-800"
          }`}
          title={isIndividualPaid(lesson) ? "Payé" : "À payer"}
        >
          {isIndividualPaid(lesson) ? "Payé" : "À payer"}
        </span>
      )
    ) : null;

    return (
      <div className="bg-white p-6 rounded-xl shadow border flex flex-col md:flex-row md:items-center gap-4 justify-between relative">
        <div className="flex-1">
          <div className="flex gap-2 items-center mb-1">
            <span className="font-bold text-primary">{lesson.subject_id || 'Matière'}</span>
            <StatusPill status={displayedStatus} />
            {indivPaidPill}
            {/* ——— NOUVEAU : pastilles mode & pack ——— */}
            <ModePackPills l={lesson} />
            {(() => {
              const owner = getPackOwner(lesson);
              const isFree = owner ? !!lesson?.participantsMap?.[owner]?.is_free_hour : false;
              return isFree ? <span className="ml-1 text-xs">🎁</span> : null;
            })()}
            {/* ———————————————————————————————— */}
            {isGroup && (
              <>
                <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded ml-1">👥 {used}/{capacity}</span>
                <button
                  className="text-xs ml-1 bg-indigo-50 text-indigo-700 px-2 py-1 rounded hover:bg-indigo-100"
                  onClick={() => setOpenParticipantsFor(showList ? null : lesson.id)}
                >
                  Participants
                </button>
              </>
            )}
          </div>

          {/* Popover participants + statut paiement */}
          {isGroup && showList && (
            <div className="absolute top-full mt-2 left-6 z-10 bg-white border rounded-lg shadow p-3 w-72">
              <div className="text-xs font-semibold mb-2">Élèves du groupe</div>
              {confirmedParticipants.length ? (
                <ul className="text-sm text-gray-700 space-y-1">
                  {confirmedParticipants.map((p) => (
                    <li key={p.id} className="flex items-center justify-between">
                      <span className="truncate mr-2">{p.name}</span>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${p.is_paid ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                        {p.is_paid ? 'Payé' : 'À payer'}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-xs text-gray-500">Aucun participant confirmé.</div>
              )}
            </div>
          )}

          <div className="text-gray-700 mt-1">
            {isGroup ? (
              'Cours groupé'
            ) : (
              <>
                Élève : <span className="font-semibold">{lesson.studentName || '—'}</span>
                {lesson.requesterName ? (
                  <span className="text-xs text-gray-500 ml-2">(demande faite par {lesson.requesterName})</span>
                ) : null}
              </>
            )}
          </div>
          <div className="text-gray-500 text-sm"><When lesson={lesson} /></div>
        </div>
        {showActionsForPending ? (
          <div className="flex gap-2">
            <button className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded shadow font-semibold" onClick={() => handleStatus(lesson, 'confirmed')}>
              ✅ Accepter
            </button>
            <button className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded shadow font-semibold" onClick={() => handleStatus(lesson, 'rejected')}>
              ❌ Refuser
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {/* Rien si refusé ou en attente */}
            {displayedStatus === 'rejected' || displayedStatus === 'booked' ? null : (
              <>
                {/* Visio */}
                {displayedStatus === 'confirmed' && isVisio(lesson) && (
                  hasVisioLink(lesson) ? (
                    (() => {
                      const now = Date.now();
                      const exp = Date.parse(lesson.visio?.expires_at || "");
                      const rev = !!lesson.visio?.revoked;

                      if (rev || (exp && now > exp)) {
                        return (
                          <button
                            className="bg-amber-600 hover:bg-amber-700 text-white px-3 py-2 rounded shadow font-semibold"
                            onClick={async () => {
                              try {
                                await updateDoc(doc(db, "lessons", lesson.id), { "visio.revoked": true });
                                await createVisioLink(lesson);
                              } catch (e) { console.error(e); }
                            }}
                          >
                            ♻️ Renouveler le lien
                          </button>
                        );
                      }

                      return (
                        <>
                          <button
                            type="button"
                            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded shadow font-semibold"
                            title="Ouvrir la visio"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation(); // ✅ empêche le clic de remonter sur la Card
                              const url = lesson.visio?.joinUrl;
                              if (url) window.open(url, "_blank", "noopener,noreferrer");
                            }}
                          >
                            🎥 Démarrer la visio
                          </button>
                          <button
                            className="bg-gray-100 hover:bg-gray-200 text-gray-800 px-3 py-2 rounded shadow font-semibold"
                            onClick={() => navigator.clipboard.writeText(lesson.visio?.joinUrl || "")}
                            title="Copier le lien"
                          >
                            🔗 Copier le lien
                          </button>
                        </>
                      );
                    })()
                  ) : (
                    <button
                      className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded shadow font-semibold"
                      onClick={() => createVisioLink(lesson)}
                      title="Créer le lien visio"
                    >
                      🎥 Créer lien visio
                    </button>
                  )
                )}

                {/* Documents */}
                <button
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded shadow font-semibold"
                  onClick={() => openDocs(lesson)}
                >
                  📄 Documents
                </button>

                {/* Gérer groupe */}
                <button
                  className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded shadow font-semibold"
                  onClick={() => openGroup(lesson)}
                  title="Gérer capacité et participants"
                >
                  👥 Gérer le groupe
                </button>

                {/* Info : complétion automatique */}
                <p className="text-xs text-gray-500 italic">
                  ✅ Complété automatiquement 30 min après la fin (si le cours est payé).
                </p>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  // Demandes
  const demandesIndividuelles = useMemo(
    () => pendingIndiv, [pendingIndiv]
  );

  const demandesGroupes = useMemo(() => {
    const list = [...pendingGroup]; // ⚠️ ne pas muter le state
    list.sort((a, b) => {
      const aKey = `${a.lesson.slot_day || ''}|${String(a.lesson.slot_hour || 0).padStart(2,'0')}`;
      const bKey = `${b.lesson.slot_day || ''}|${String(b.lesson.slot_hour || 0).padStart(2,'0')}`;
      return aKey.localeCompare(bKey);
    });
    return list;
  }, [pendingGroup]);

  const pendingTotal = useMemo(
    () => demandesIndividuelles.length + demandesGroupes.length + pendingPacks.length,
    [demandesIndividuelles, demandesGroupes, pendingPacks]
  );

  return (
    <DashboardLayout role="teacher">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-2xl font-bold text-primary mb-6">Cours — Professeur</h2>

        {/* Demandes */}
        <section className="mb-10">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-xl font-semibold">Demandes de cours</h3>
              <span className="text-sm text-gray-500">
                {pendingTotal} en attente
              </span>
          </div>

          {loading ? (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Chargement…</div>
          ) : pendingTotal === 0 ? (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">
              Aucune demande de cours pour le moment.
            </div>
          ) : (
            <>
              {demandesIndividuelles.length > 0 && (
                <div className="grid grid-cols-1 gap-5 mb-6">
                {demandesIndividuelles
                  .filter((l) => individualStatus(l) !== 'rejected')
                  .map((l) => (
                    <Card key={l.id} lesson={l} showActionsForPending />
                ))}
                </div>
              )}
              {/* PACKS — demandes groupées */}
              {pendingPacks.length > 0 && (
                <div className="bg-white p-4 rounded-xl shadow border mb-6">
                <div className="font-semibold text-sm mb-3">
                  {
                    pendingPacks.some(p => Array.isArray(p.lesson?.participant_ids) && (p.lesson.participant_ids.length >= 2 || p.lesson?.is_group === true))
                      ? 'Packs — demandes groupées'
                      : 'Packs — demandes individuelles'
                  }
                </div>
                  {/* NOUVEAU */}
                  <ul className="space-y-2">
                    {pendingPacks.map((p) => {
                      const freeCount = p.lesson?.pack_type === 'pack10' ? 2 : p.lesson?.pack_type === 'pack5' ? 1 : 0;

                      return (
                      <li key={p.packId} className="border rounded-lg px-3 py-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* Sous-texte : demandeur */}
                          {p?.lesson?.requesterName ? (
                            <p className="text-xs text-gray-500 mt-1">
                              Demande faite par <span className="font-semibold">{p.lesson.requesterName}</span>
                            </p>
                          ) : null}
                          <span className="text-sm font-medium">{p.lesson.subject_id || 'Cours'}</span>
                          <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">{p.modeLabel}</span>
                          {(() => {
                            const owner = getPackOwner(p.lesson);
                            const free = owner ? isFreeHourFor(owner, p.lesson) : false;
                            return (
                              <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded">
                                {free ? '🎁 ' : ''}{p.packLabel}
                              </span>
                            );
                          })()}
                          <span className="text-xs text-gray-500 ml-1">
                            • {p.slots.length} horaires
                          </span>
                          <div className="ml-auto flex items-center gap-2">
                            <button
                              className="px-3 py-1 rounded bg-green-600 text-white text-xs"
                              onClick={() => acceptWholePack(p.lesson)}
                              title="Accepter tout le pack"
                            >
                              ✅ Accepter tout
                            </button>

                            <button
                              className="px-3 py-1 rounded bg-red-600 text-white text-xs"
                              onClick={() => rejectWholePack(p.lesson)}
                              title="Refuser tout le pack"
                            >
                              ❌ Refuser tout
                            </button>
                          </div>
                        </div>

                        {/* Liste des horaires du pack (visible) */}
                        <div className="mt-2 text-xs text-gray-700">
                          {p.slots.map((s, idx) => (
                            <span key={idx} className="inline-block bg-gray-50 border rounded px-2 py-0.5 mr-1 mb-1">
                              {idx < freeCount ? '🎁 ' : ''}{s.label}
                            </span>
                          ))}
                        </div>
                      </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {demandesGroupes.length > 0 && (
                <div className="bg-white p-4 rounded-xl shadow border">
                  <div className="font-semibold text-sm mb-3">Groupes — demandes par élève</div>
                  <ul className="space-y-2">
                    {demandesGroupes.map(({ lessonId, lesson, studentId, status, studentName, requesterName }) => {
                      const free = isFreeHourFor(studentId, lesson);

                      return (
                      <li key={`${lessonId}:${studentId}`} className="border rounded-lg px-3 py-2 flex items-center gap-3">
                        <span className="text-xs text-gray-600">
                          <When lesson={lesson} />
                        </span>
                        <span className="text-sm font-medium">{lesson.subject_id || 'Cours'}</span>
                        {/* ——— NOUVEAU : pastilles mode & pack ——— */}
                        <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">{modeLabel(lesson)}</span>
                        {(() => {
                          const pack = packLabelForLesson(lesson, studentId) || packLabel(lesson);
                          return pack ? (
                            <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded">
                              {free ? '🎁 ' : ''}{pack}
                            </span>
                          ) : null;
                        })()}
                        {/* ———————————————————————————————— */}
                        <span className="text-xs text-gray-600">
                          • Élève : <span className="font-medium">{studentName || studentId}</span>
                          {requesterName ? <span className="text-gray-500"> (demande faite par {requesterName})</span> : null}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                          {status === 'pending_teacher' ? 'En attente prof' :
                           status === 'pending_parent' ? 'En attente parent' :
                           status === 'invited_student' || status === 'invited_parent' ? 'Invitation envoyée' :
                           'En attente'}
                        </span>
                        <div className="ml-auto flex items-center gap-2">
                          <button className="px-3 py-1 rounded bg-green-600 text-white text-xs" onClick={() => acceptGroupStudent(lessonId, studentId)}>Accepter</button>
                          <button className="px-3 py-1 rounded bg-red-600 text-white text-xs" onClick={() => rejectGroupStudent(lessonId, studentId)}>Refuser</button>
                        </div>
                      </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>

        {/* Confirmés */}
        <section className="mb-10">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-xl font-semibold">Gestion des cours</h3>
            <span className="text-sm text-gray-500">{confirmes.length} confirmés</span>
          </div>
          {loading ? (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Chargement…</div>
          ) : confirmes.length === 0 ? (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Aucun cours confirmé pour le moment.</div>
          ) : (
            <div className="grid grid-cols-1 gap-5">
              {confirmes.map((l) => <Card key={l.id} lesson={l} showActionsForPending={false} />)}
            </div>
          )}
        </section>

        {/* Refusés */}
        <section className="mb-10">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-xl font-semibold text-red-600">Cours refusés</h3>
            <span className="text-sm text-gray-500">{refuses.length} refusé(s)</span>
          </div>
          {loading ? (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Chargement…</div>
          ) : refuses.length === 0 ? (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Aucun cours refusé.</div>
          ) : (
            <div className="grid grid-cols-1 gap-5">
              {refuses.map((l) => {
                const isGroup = isGroupLessonStrict(l); // ⬅️ utilise le même helper partout

                if (!isGroup) {
                  // Individuel refusé → carte standard
                  return <Card key={l.id} lesson={l} showActionsForPending={false} />;
                }

                // ---- Groupe refusé : montrer les élèves refusés + badges ----
                const pm = l?.participantsMap || {};
                const idsSource = (Array.isArray(l?.participant_ids) && l.participant_ids.length)
                  ? l.participant_ids
                  : Object.keys(pm);

                // 1) élève(s) explicitement refusé(s)
                let rejectedIds = idsSource.filter((sid) => {
                  const st = String(pm?.[sid]?.status || '').toLowerCase();
                  return st === 'rejected' || st === 'removed' || st === 'deleted';
                });

                // 2) fallback : si statut global "rejected", afficher tous les participants
                if (rejectedIds.length === 0 && String(l?.status || '').toLowerCase() === 'rejected') {
                  rejectedIds = [...idsSource];
                }

                // 3) dernier fallback : afficher au moins le demandeur (utile packs enfants par parent)
                if (rejectedIds.length === 0) {
                  const sole =
                    (Array.isArray(l?.participant_ids) && l.participant_ids.length === 1 && l.participant_ids[0]) ||
                    (Object.keys(pm).length === 1 && Object.keys(pm)[0]) ||
                    null;
                  if (sole) rejectedIds = [sole];
                }

                const rejectedBadges = rejectedIds.length
                  ? rejectedIds.map((sid) => {
                      const name = (l.participantDetails || []).find((p) => p.id === sid)?.name || sid;
                      // badge “Pack 5h / Pack 10h” pris au niveau participant si présent
                      const hours =
                        Number(pm?.[sid]?.pack_hours ?? pm?.[sid]?.packHours ?? 0) ||
                        (pm?.[sid]?.is_pack10 ? 10 : pm?.[sid]?.is_pack5 ? 5 : 0) ||
                        (pm?.[sid]?.pack === '10h' ? 10 : pm?.[sid]?.pack === '5h' ? 5 : 0);
                      const packBadge = hours >= 10 ? 'Pack 10h' : hours >= 5 ? 'Pack 5h' : '';

                      return (
                        <span key={sid} className="inline-flex items-center mr-2 mb-1">
                          <span className="px-2 py-0.5 rounded bg-red-50 text-red-700 text-xs mr-1">{name}</span>
                          {packBadge && (
                            <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-700 text-[11px]">{packBadge}</span>
                          )}
                        </span>
                      );
                    })
                  : <span className="ml-2 text-gray-500">—</span>;

                // petit helper d’étiquette pack (au niveau leçon) si besoin en plus
                const hoursLesson =
                  Number(l?.pack_hours ?? l?.packHours ?? 0) >= 10 ? 'Pack 10h'
                    : Number(l?.pack_hours ?? l?.packHours ?? 0) >= 5 ? 'Pack 5h'
                    : '';

                return (
                  <div key={l.id} className="bg-white p-6 rounded-xl shadow border">
                    <div className="flex gap-2 items-center mb-1">
                      <span className="font-bold text-primary">{l.subject_id || 'Matière'}</span>
                      {/* 👉 libellé demandé : “Refusé (cours groupé)” */}
                      <span className="px-3 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                        Refusé (cours groupé)
                      </span>
                      {/* Mode + Pack */}
                      <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded ml-1">
                        {(String(l?.mode || '').toLowerCase() === 'visio' || l?.is_visio) ? 'Visio' : 'Présentiel'}
                      </span>
                      {hoursLesson && (
                        <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded ml-1">{hoursLesson}</span>
                      )}
                    </div>

                    {String(l?.rejected_reason || '') === 'no_students' && (
                      <div className="mt-1 text-sm font-semibold text-red-700">
                        Motif : Aucun élève
                      </div>
                    )}

                    {/* Demandeur (parent) si connu */}
                    {l.requesterName ? (
                      <p className="text-sm text-gray-600 mt-1">
                        Demande faite par <span className="font-medium">{l.requesterName}</span>
                      </p>
                    ) : null}

                    <div className="mt-2 text-sm text-gray-700">
                      Élève(s) refusé(s) : <span className="ml-2">{rejectedBadges}</span>
                    </div>

                    <div className="text-gray-500 text-sm mt-1">
                      <When lesson={l} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Terminés */}
        <section>
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-xl font-semibold">Cours terminés</h3>
            <span className="text-sm text-gray-500">{termines.length} terminé(s)</span>
          </div>
          {loading ? (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Chargement…</div>
          ) : termines.length === 0 ? (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Aucun cours terminé récemment.</div>
          ) : (
            <div className="grid grid-cols-1 gap-5">
              {termines.map((l) => {
                const confirmedParticipants = (l.participantDetails || []).filter(
                  (p) => p.status === 'accepted' || p.status === 'confirmed'
                );
                const isGroup = isGroupLessonStrict(l);
                const capacity = l.capacity ?? (isGroup ? 10 : 1);
                return (
                  <div key={l.id} className="bg-white p-6 rounded-xl shadow border flex flex-col md:flex-row md:items-center gap-4 justify-between">
                    <div className="flex-1">
                      <div className="flex gap-2 items-center mb-1">
                        <span className="font-bold text-primary">{l.subject_id || 'Matière'}</span>
                        <StatusPill status="completed" />
                        {/* ——— NOUVEAU : pastilles mode & pack ——— */}
                        <ModePackPills l={l} />
                        {(() => {
                            const owner = l?.is_group ? null : getOwnerStudentId(l);
                            const sid = l?.is_group ? null : owner;
                            const free = sid ? isFreeHourFor(sid, l) : false;
                            return free ? <span className="ml-1 text-xs">🎁</span> : null;
                        })()}
                        {/* ———————————————————————————————— */}
                      </div>
                      <div className="text-gray-700">
                        {isGroup
                        ? `Élèves (👥 ${confirmedParticipants.length}/${capacity})`
                        : <>Élève : <span className="font-semibold">{l.studentName || '—'}</span></>}
                      </div>
                      <div className="text-gray-500 text-sm"><When lesson={l} /></div>
                    </div>
                    <div className="flex gap-2">
                      <button className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded shadow font-semibold" onClick={() => openDocs(l)}>
                        📄 Documents
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Modals */}
      <DocumentsModal open={docOpen} onClose={() => setDocOpen(false)} lesson={docLesson} allowUpload />
      <GroupSettingsModal open={groupOpen} onClose={() => setGroupOpen(false)} lesson={groupLesson} />
    </DashboardLayout>
  );
}