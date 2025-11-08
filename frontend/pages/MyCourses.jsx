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
  onSnapshot
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
function formatHour(h) { const n = Number(h) || 0; return `${String(n).padStart(2, '0')}:00`; }

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
const isIndividualPaid = (l) => l && !l.is_group && (l.is_paid === true);
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

  // 2) fallback si pas de bornes stockées: -15min / +1h autour du créneau
  const start = nextOccurrence(l.slot_day, l.slot_hour, new Date());
  if (!start) return 'open'; // si pas de slot exploitable, on n'empêche pas
  const startMs = start.getTime();
  const now = Date.now();
  const windowStart = startMs - 15 * 60 * 1000;   // 15 min avant
  const windowEnd   = startMs + 60 * 60 * 1000;   // +1h après (obsolète passé 1h)
  if (now < windowStart) return 'before';
  if (now > windowEnd)   return 'expired';
  return 'open';
}

const myParticipantStatus = (l, uid) =>
  (l?.participantsMap?.[uid]?.status) || null;

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
        if (now >= startMs) {
          const statusStr = String(l.status || '');
          const isAccepted =
            statusStr === 'confirmed' ||
            statusStr === 'completed' ||
            (l.is_group && hasAnyConfirmedParticipant(l));

          if (!isAccepted && statusStr !== 'rejected') {
            try { await updateDoc(doc(db, 'lessons', l.id), { status: 'rejected' }); } catch {}
            return;
          }
        }

        // 2) Individuel accepté mais non payé à l'heure → rejeté
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
      if (Array.isArray(c.participant_ids) && c.participant_ids.includes(uid)) {
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

  // 🟢 Confirmés (exclure terminés)
  const confirmed = useMemo(() => {
    if (!uid) return [];
    const out = [];
    for (const c of courses) {
      if (c.status === 'completed') continue; // ✨ exclure les terminés
      if (Array.isArray(c.participant_ids) && c.participant_ids.includes(uid)) {
        const st = c?.participantsMap?.[uid]?.status;
        // ✨ groupe : accepted OU confirmed par participant, OU confirmed global
        if (st === 'accepted' || st === 'confirmed' || c.status === 'confirmed') {
          out.push(c);
        }
      } else if (c.student_id === uid && c.status === 'confirmed') {
        out.push(c);
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
        [`participantsMap.${uid}`]: null,
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

  function paymentBadgeForMe(c) {
    const uid = auth.currentUser?.uid;
    const group = isGroupLesson(c);
    const paid = group ? !!c.participantsMap?.[uid]?.is_paid : !!c.is_paid;
    return (
      <span className={`text-[11px] px-2 py-0.5 rounded-full ${paid ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
        {paid ? 'Payé' : 'À payer'}
      </span>
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
    const when = (c.slot_day || c.slot_hour != null) ? `${c.slot_day} ${formatHour(c.slot_hour)}` : '';
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
            {/* ——— NOUVEAU : pastilles mode & pack ——— */}
            <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">{modeLabel(c)}</span>
            <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded">{packLabel(c)}</span>
            {/* ———————————————————————————————— */}
            {group && displayedStatus === 'confirmed' && <ParticipantsPopover c={c} />}
          </div>
          <div className="text-gray-700 text-sm">Professeur : <span className="font-semibold">{teacherNameFor(c.teacher_id)}</span></div>
          <div className="text-gray-500 text-xs">{when}</div>
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
                  rel="noreferrer"
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
              ? `${nextCourse.subject_id || 'Cours'} · ${nextCourse.slot_day} ${formatHour(nextCourse.slot_hour)} · ${modeLabel(nextCourse)} • ${packLabel(nextCourse)} · avec ${teacherNameFor(nextCourse.teacher_id)}`
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
                          {/* ——— NOUVEAU : pastilles mode & pack ——— */}
                          <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">{modeLabel(c)}</span>
                          <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded">{packLabel(c)}</span>
                          {/* ———————————————————————————————— */}
                        </div>
                        <div className="text-gray-700 text-sm">Professeur : <span className="font-semibold">{teacherNameFor(c.teacher_id)}</span></div>
                        <div className="text-gray-500 text-xs">{c.slot_day} {formatHour(c.slot_hour)}</div>
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
