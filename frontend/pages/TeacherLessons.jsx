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
  arrayRemove,
  deleteField,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';

import DocumentsModal from '../components/lessons/DocumentsModal';
import GroupSettingsModal from '../components/lessons/GroupSettingsModal';
import { createPaymentDueNotificationsForLesson } from '../lib/paymentNotifications';

/* ---------- UI helpers ---------- */
const statusColors = {
  booked: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-700',
  completed: 'bg-gray-200 text-gray-700',
};

const fmtTime = (ms) =>
  new Date(ms).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

const fmtFromSlot = (slot_day, slot_hour) =>
  `${slot_day || ''} ${slot_hour != null ? `• ${String(slot_hour).padStart(2, '0')}:00` : ''}`.trim();

const slotLabel = (l) => fmtFromSlot(l.slot_day, l.slot_hour);

function When({ lesson }) {
  const ts = lesson?.start_datetime;
  if (ts?.toDate) {
    try {
      return <span>📅 {ts.toDate().toLocaleString('fr-FR')}</span>;
    } catch {}
  }
  if (typeof ts?.seconds === 'number') return <span>📅 {fmtTime(ts.seconds * 1000)}</span>;
  if (lesson.slot_day || lesson.slot_hour != null) return <span>📅 {fmtFromSlot(lesson.slot_day, lesson.slot_hour)}</span>;
  return null;
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
const isIndividualPaid = (l) => l && !l.is_group && (l.is_paid === true);

/* ---------- time helpers ---------- */
const getStartMs = (lesson) => {
  const ts = lesson?.start_datetime;
  if (ts?.toDate) {
    try { return ts.toDate().getTime(); } catch { return null; }
  }
  if (typeof ts?.seconds === 'number') return ts.seconds * 1000;
  return null; // si seulement slot_day/slot_hour (pas de date) → pas d’auto-règle
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
  // Window: open right away if you want immediate join, or from 15 min before start
  const start = nextOccurrence(lesson.slot_day, lesson.slot_hour, new Date());
  const opensAt = start ? new Date(start.getTime() - 15 * 60 * 1000) : new Date();
  const durationH = Number(lesson.duration_hours) > 0 ? Number(lesson.duration_hours) : 1; // par défaut 1h
  const expiresAt = start ? new Date(start.getTime() + durationH * 60 * 60 * 1000) : new Date(Date.now() + durationH * 60 * 60 * 1000);
  return { opensAt, expiresAt };
}

function makeJitsiVisio(lesson) {
  const base = lesson.pack_id ? lesson.pack_id : lesson.id;
  const slug = `EduKaraib-${base}-${Math.random().toString(36).slice(2,8)}`;
  const { opensAt, expiresAt } = computeVisioWindow(lesson);
  return {
    provider: "jitsi",
    roomId: slug,
    joinUrl: `https://meet.jit.si/${slug}`,
    opens_at: opensAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    created_by: auth.currentUser?.uid || null,
    created_at: serverTimestamp(),
    revoked: false, // we can flip this later if you click "Renew"
  };
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

// true si TOUS les élèves d’un cours groupé sont rejetés/retirés/supprimés
function isGroupFullyRejected(lesson) {
  const pm = lesson?.participantsMap || {};
  const ids = Array.isArray(lesson?.participant_ids)
    ? lesson.participant_ids
    : Object.keys(pm || {});
  if (!ids.length) return false;
  return ids.every((sid) => isParticipantRejectedStatus(pm?.[sid]?.status));
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

/** Retourne le nom lisible de la personne qui a fait la demande (parent ou élève) */
function requesterName(lesson, { userMap, parentMap, studentMap } = {}) {
  // on essaye dans l'ordre le plus courant
  const uid =
    lesson?.booked_by ||
    lesson?.requested_by ||
    lesson?.created_by ||
    lesson?.parent_id ||
    null;

  // 1) si on a une map complète des users
  if (userMap && uid && userMap.get(uid)) {
    const u = userMap.get(uid);
    return u.displayName || u.name || u.fullName || u.email || "Parent";
  }

  // 2) sinon on essaie parentMap / studentMap si tu les as déjà
  if (parentMap && uid && parentMap.get(uid)) {
    const p = parentMap.get(uid);
    return p.name || p.fullName || p.email || "Parent";
  }
  if (studentMap && uid && studentMap.get(uid)) {
    const s = studentMap.get(uid);
    return s.name || s.fullName || s.email || "Élève";
  }

  // 3) dernier recours: libellé générique
  return "Parent";
}

// ✅ confirme tous les participants d’une leçon groupée
function confirmAllParticipantsLocal(lesson) {
  const ids = Array.isArray(lesson.participant_ids) && lesson.participant_ids.length
    ? Array.from(new Set(lesson.participant_ids))
    : Object.keys(lesson.participantsMap || {});
  const pm = { ...(lesson.participantsMap || {}) };
  ids.forEach((sid) => {
    pm[sid] = { ...(pm[sid] || {}), status: 'confirmed' };
  });
  return { ids, pm };
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
        const pIndivRaw = raw.filter(
          (l) => !l.is_group && !l.pack_id && PENDING_SET.has(String(l.status || ''))
        );

      // ----- Construire pendingGroup par élève (tout statut != accepted/confirmed) — exclut PACKS
      const pGroupRaw = [];
      raw
        .filter((l) =>
          // ⛔️ exclure tout ce qui est un pack (pack_id OU participantsMap avec pack 5/10h)
          !isLessonPartOfPack(l) && (
            !!l.is_group ||
            (Array.isArray(l.participant_ids) && l.participant_ids.length > 0) ||
            (l.participantsMap && Object.keys(l.participantsMap).length > 0)
          )
        )
        .forEach((l) => {
          const ids = Array.isArray(l.participant_ids)
            ? Array.from(new Set(l.participant_ids))
            : Object.keys(l.participantsMap || {});
          const pm = l.participantsMap || {};
          ids.forEach((sid) => {
            const st = String(pm?.[sid]?.status || '');
            // On considère "pending" tout ce qui n’est PAS accepté/confirmé/rejeté/removed/deleted
            if (!['accepted', 'confirmed', 'rejected', 'removed', 'deleted'].includes(st)) {
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

            // fallback : si pas de student_id mais un seul participant, utiliser son nom
            if (!studentName && Array.isArray(l.participant_ids) && l.participant_ids.length === 1) {
              const onlyId = l.participant_ids[0];
              const pm = l.participantsMap || {};
              const parentId = pm?.[onlyId]?.parent_id || pm?.[onlyId]?.booked_by || null;
              studentName = participantDetails[0]?.name
                || await resolvePersonName(onlyId, nameCacheRef.current, { parentId });
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
        setPendingIndiv(pIndiv);
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

  // Confirmés : inclut groupes si au moins 1 participant est accepté/confirmé
  const confirmes = useMemo(() => {
    return lessons.filter((l) => {
      if (l.status === 'completed') return false; // pas ici
      if (l.is_group || (Array.isArray(l.participant_ids) && l.participant_ids.length)) {
        const pm = l.participantsMap || {};
        // confirmé si au moins un élève est accepté/confirmé OU si status global 'confirmed'
        return (l.participant_ids || []).some((sid) => {
          const st = pm?.[sid]?.status;
          return st === 'accepted' || st === 'confirmed';
        }) || l.status === 'confirmed';
      }
      return l.status === 'confirmed';
    });
  }, [lessons]);

  // 🔴 Refusés : individuel(status global) OU groupe (au moins 1 participant rejeté) OU status global 'rejected'
  const refuses = useMemo(() => {
    return lessons.filter((l) => {
      // Individuel
      if (!l.is_group && l.status === 'rejected') return true;

      // Groupe : un seul élève rejeté suffit, ou statut global rejeté
      const pm = l.participantsMap || {};
      const ids = Array.isArray(l.participant_ids) && l.participant_ids.length
        ? l.participant_ids
        : Object.keys(pm);

      const anyRejected = ids.some((sid) => {
        const st = String(pm?.[sid]?.status || '').toLowerCase();
        return st === 'rejected' || st === 'removed' || st === 'deleted';
      });

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
      await updateDoc(ref, { status, ...(status === 'completed' ? { completed_at: serverTimestamp() } : {}) });

      // Si c'est un pack : propager le même statut à toutes les séances du pack
      // Si c'est un pack : propager le même statut à toutes les séances du pack
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
                pm[sid] = { ...(pm[sid] || {}), status: 'accepted' };
              }
              newData.participantsMap = pm;
              newData.participant_ids = Object.keys(pm);
            }

            if (status === 'completed') {
              newData.completed_at = serverTimestamp();
            }

            await updateDoc(refDoc, newData);
          }
          // ✅ Met à jour le state local (affichage) tout de suite
          setLessons(prev => prev.map(l => {
            if (!lesson.pack_id) {
              // Cours simple
              return l.id === lesson.id ? { ...l, status } : l;
            }
            if (l.pack_id !== lesson.pack_id) return l;

            const isGrp = l.is_group || Array.isArray(l.participant_ids);
            let next = { ...l, status, pending_teacher: false };

            if (isGrp) {
              const ids = Array.isArray(l.participant_ids)
                ? l.participant_ids
                : Object.keys(l.participantsMap || {});
              const pm = { ...(l.participantsMap || {}) };
              ids.forEach(sid => {
                pm[sid] = { ...(pm[sid] || {}), status: 'accepted' };
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

  // ✅ Accepter TOUT un pack : on confirme les participants de CHAQUE séance du pack,
  // on met status='confirmed' + pending_teacher=false (comme une demande de groupe classique)
  async function acceptWholePack(repLesson) {
    try {
      // cible toutes les séances du même pack (avec l’état local, c’est plus rapide et suffisant)
      const targets = lessons.filter((l) => samePackKey(l, repLesson));
      // MAJ Firestore
      for (const l of targets) {
        const { ids, pm } = confirmAllParticipantsLocal(l);
        await updateDoc(doc(db, 'lessons', l.id), {
          participantsMap: pm,
          participant_ids: ids,
          status: 'confirmed',
          pending_teacher: false,
        });
      }
      // MAJ UI
      setLessons((prev) => prev.map((l) => {
        if (!samePackKey(l, repLesson)) return l;
        const { ids, pm } = confirmAllParticipantsLocal(l);
        return { ...l, participantsMap: pm, participant_ids: ids, status: 'confirmed', pending_teacher: false };
      }));
      // Retire la ligne pack de la section "Demandes"
      setPendingPacks((prev) => prev.filter((p) => !samePackKey(p.lesson, repLesson)));
    } catch (e) {
      console.error(e);
      alert("Impossible d'accepter tout le pack.");
    }
  }

  // ❌ Refuser TOUT un pack : NE PAS mettre le cours en "rejected".
  // On rejette uniquement les élèves (participantsMap), on enlève "pending_teacher"
  // et on laisse le statut du cours tel quel (ou "booked" si tu préfères le figer).
  async function rejectWholePack(repLesson) {
    const targets = lessons.filter((l) => samePackKey(l, repLesson));

    for (const l of targets) {
      const pm = { ...(l.participantsMap || {}) };
      const ids = Array.isArray(l.participant_ids) && l.participant_ids.length
        ? Array.from(new Set(l.participant_ids))
        : Object.keys(pm);

      ids.forEach((sid) => {
        pm[sid] = { ...(pm[sid] || {}), status: 'rejected' };
      });

      await updateDoc(doc(db, 'lessons', l.id), {
        participantsMap: pm,
        participant_ids: ids,
        pending_teacher: false,
        // ⛔ pas de status:'rejected' ici
      });
    }

    setLessons(prev => prev.map((l) => {
      if (!samePackKey(l, repLesson)) return l;
      const pm = { ...(l.participantsMap || {}) };
      const ids = Array.isArray(l.participant_ids) && l.participant_ids.length
        ? Array.from(new Set(l.participant_ids))
        : Object.keys(pm);
      ids.forEach((sid) => {
        pm[sid] = { ...(pm[sid] || {}), status: 'rejected' };
      });
      return { ...l, participantsMap: pm, participant_ids: ids, pending_teacher: false };
    }));

    setPendingPacks(prev => prev.filter(p => !samePackKey(p.lesson, repLesson)));
  }

  async function createVisioLink(lesson) {
    if (!isVisio(lesson)) { alert("Ce cours n'est pas en visio."); return; }
    if (hasVisioLink(lesson)) { alert("Le lien visio existe déjà."); return; }
    try {
      const payload = makeJitsiVisio(lesson);
      await updateDoc(doc(db, 'lessons', lesson.id), { visio: payload });
      setLessons(prev => prev.map(x => x.id === lesson.id ? { ...x, visio: { ...payload, created_at: new Date() } } : x));
    } catch (e) { console.error(e); alert("Impossible de créer le lien visio."); }
  }

  // actions groupe (par élève)
  async function acceptGroupStudent(lessonId, studentId) {
    try {
      // 1) valider l'élève dans le groupe
      await updateDoc(doc(db, 'lessons', lessonId), {
        [`participantsMap.${studentId}.status`]: 'confirmed',
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
            try {
              await updateDoc(doc(db, 'lessons', l.id), { status: 'rejected' });
            } catch {}
            return;
          }
        }

        // 2) Individuel accepté mais non payé à l'heure → refusé
        if (!l.is_group && String(l.status || '') === 'confirmed') {
          if (now >= startMs && !isIndividualPaid(l)) {
            try {
              await updateDoc(doc(db, 'lessons', l.id), { status: 'rejected' });
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

  const Card = ({ lesson, showActionsForPending }) => {
  const isGroup = !!lesson.is_group ||
    (Array.isArray(lesson.participant_ids) && lesson.participant_ids.length > 0) ||
    (lesson.participantsMap && Object.keys(lesson.participantsMap).length > 0);

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

    // ✅ Si la leçon est terminée, la pastille doit être "Terminé", même si des participants étaient confirmés
    const displayedStatus = lesson.status === 'completed'
      ? 'completed'
      : (Array.isArray(lesson.participantDetails) && lesson.participantDetails.some(p => p.status === 'accepted' || p.status === 'confirmed'))
        ? 'confirmed'
        : lesson.status;

    // ⬇️ Pastille paiement pour les cours individuels
    const indivPaidPill = !isGroup ? (
      <span
        className={`text-[11px] px-2 py-0.5 rounded-full ml-2 ${
          isIndividualPaid(lesson) ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800'
        }`}
        title={isIndividualPaid(lesson) ? 'Payé' : 'À payer'}
      >
        {isIndividualPaid(lesson) ? 'Payé' : 'À payer'}
      </span>
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
                          <a
                            href={lesson.visio?.joinUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded shadow font-semibold"
                            title="Ouvrir la visio"
                          >
                            🎥 Démarrer la visio
                          </a>
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

                {/* Terminer */}
                <button
                  className="bg-gray-800 hover:bg-gray-900 text-white px-4 py-2 rounded shadow font-semibold"
                  onClick={() => handleStatus(lesson, 'completed')}
                  disabled={lesson.status === 'completed'}
                  title={lesson.status === 'completed' ? 'Déjà terminé' : 'Marquer comme terminé'}
                >
                  ✅ Terminé
                </button>
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
                  {demandesIndividuelles.map((l) => (
                    <Card key={l.id} lesson={l} showActionsForPending />
                  ))}
                </div>
              )}
              {/* PACKS — demandes groupées */}
              {pendingPacks.length > 0 && (
                <div className="bg-white p-4 rounded-xl shadow border mb-6">
                  <div className="font-semibold text-sm mb-3">Packs — demandes groupées</div>
                  {/* NOUVEAU */}
                  <p className="text-sm text-gray-600">
                    Demande faite par <span className="font-medium">
                      {requesterName(item.lesson || l, { userMap, parentMap, studentMap })}
                    </span>
                  </p>
                  <ul className="space-y-2">
                    {pendingPacks.map((p) => (
                      <li key={p.packId} className="border rounded-lg px-3 py-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">{p.lesson.subject_id || 'Cours'}</span>
                          <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">{p.modeLabel}</span>
                          <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded">{p.packLabel}</span>
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
                              {s.label}
                            </span>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {demandesGroupes.length > 0 && (
                <div className="bg-white p-4 rounded-xl shadow border">
                  <div className="font-semibold text-sm mb-3">Groupes — demandes par élève</div>
                  <ul className="space-y-2">
                    {demandesGroupes.map(({ lessonId, lesson, studentId, status, studentName, requesterName }) => (
                      <li key={`${lessonId}:${studentId}`} className="border rounded-lg px-3 py-2 flex items-center gap-3">
                        <span className="text-xs text-gray-600">
                          {lesson.slot_day} {String(lesson.slot_hour).padStart(2, '0')}h
                        </span>
                        <span className="text-sm font-medium">{lesson.subject_id || 'Cours'}</span>
                        {/* ——— NOUVEAU : pastilles mode & pack ——— */}
                        <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">{modeLabel(lesson)}</span>
                        <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded">{packLabel(lesson)}</span>
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
                    ))}
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
                const isGroup =
                  !!l.is_group ||
                  (Array.isArray(l.participant_ids) && l.participant_ids.length > 0) ||
                  (l.participantsMap && Object.keys(l.participantsMap).length > 0);

                if (!isGroup) {
                  // cours individuel refusé => ta card standard
                  return <Card key={l.id} lesson={l} showActionsForPending={false} />;
                }

                // groupe : on n’affiche que les élèves refusés
                // ... à la place du rendu groupe existant :
                const rejectedIds = getRejectedStudents(l);
                const rejectedNames = rejectedIds.map((sid) => {
                  const pd = (l.participantDetails || []).find((p) => p.id === sid);
                  return pd?.name || sid;
                });

                return (
                  <div key={l.id} className="bg-white p-6 rounded-xl shadow border">
                    <div className="flex gap-2 items-center mb-1">
                      <span className="font-bold text-primary">{l.subject_id || 'Matière'}</span>
                      <span className="px-3 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                        Refusé (cours groupé)
                      </span>
                      {/* Pastilles mode & pack */}
                      <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded ml-1">
                        {String(l?.mode || '').toLowerCase() === 'visio' || l?.is_visio ? 'Visio' : 'Présentiel'}
                      </span>
                      {(() => {
                        const h = Number(l?.pack_hours ?? l?.packHours ?? 0);
                        return h >= 10 ? (
                          <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded ml-1">Pack 10h</span>
                        ) : h >= 5 ? (
                          <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded ml-1">Pack 5h</span>
                        ) : null;
                      })()}
                    </div>

                    {/* ✅ Afficher qui a fait la demande (utile pour les packs) */}
                    {l.requesterName ? (
                      <p className="text-sm text-gray-600 mt-1">
                        Demande faite par <span className="font-medium">
                          {requesterName(l, { userMap, parentMap, studentMap })}
                        </span>
                      </p>
                    ) : null}

                    <div className="text-gray-700">
                      Élève(s) refusé(s) :
                      {rejectedNames.length ? (
                        <span className="ml-2">
                          {rejectedNames.map((nm, i) => (
                            <span key={i} className="inline-block text-xs bg-red-50 text-red-700 px-2 py-0.5 rounded mr-1">
                              {nm}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="ml-2 text-sm text-gray-500">—</span>
                      )}
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
                const capacity = l.capacity || (Array.isArray(l.participant_ids) ? l.participant_ids.length : 1);
                return (
                  <div key={l.id} className="bg-white p-6 rounded-xl shadow border flex flex-col md:flex-row md:items-center gap-4 justify-between">
                    <div className="flex-1">
                      <div className="flex gap-2 items-center mb-1">
                        <span className="font-bold text-primary">{l.subject_id || 'Matière'}</span>
                        <StatusPill status="completed" />
                        {/* ——— NOUVEAU : pastilles mode & pack ——— */}
                        <ModePackPills l={l} />
                        {/* ———————————————————————————————— */}
                      </div>
                      <div className="text-gray-700">
                        {(Array.isArray(l.participant_ids) && l.participant_ids.length > 0)
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