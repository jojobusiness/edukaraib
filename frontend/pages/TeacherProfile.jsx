import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { auth, db } from '../lib/firebase';
import {
  doc, getDoc, collection, query, where, getDocs, addDoc, updateDoc,
  serverTimestamp, arrayUnion, onSnapshot, deleteField,
} from 'firebase/firestore';
import BookingModal from '../components/BookingModal';

const DAYS_ORDER = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function pickDisplayName(x = {}) {
  return (
    x.fullName || x.full_name || x.name || x.displayName ||
    [x.first_name, x.last_name].filter(Boolean).join(' ') ||
    (x.profile && (x.profile.full_name || x.profile.name)) || ''
  );
}
function pickAvatar(x = {}) {
  return x.avatarUrl || x.avatar_url || x.photoURL || (x.profile && x.profile.avatar) || '';
}
function getReviewerId(r = {}) {
  return r.reviewer_id || r.author_id || r.user_id || r.student_id || r.created_by || null;
}

const mondayOf = (d) => {
  const x = new Date(d);
  const js = x.getDay();           // 0=Dim..6=Sam
  const off = (js + 6) % 7;        // 0=Lun..6=Dim
  x.setHours(0,0,0,0);
  x.setDate(x.getDate() - off);
  return x;
};
const weekKeyOf = (d) => mondayOf(d).toISOString().slice(0,10); // "YYYY-MM-DD" du lundi

// Date -> "YYYY-MM-DD" en heure locale
const formatLocalDate = (d) => {
  if (!d) return null;
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export default function TeacherProfile() {
  const { teacherId } = useParams();
  const navigate = useNavigate();

  const [teacher, setTeacher] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [reviewerInfo, setReviewerInfo] = useState({});

  const [bookedSlots, setBookedSlots] = useState([]);
  const [remainingBySlot, setRemainingBySlot] = useState({});

  const [showBooking, setShowBooking] = useState(false);
  const [isBooking, setIsBooking] = useState(false);
  const [confirmationMsg, setConfirmationMsg] = useState('');

  const [currentRole, setCurrentRole] = useState(null); // 'student' | 'teacher' | 'parent'
  const [children, setChildren] = useState([]);
  const [selectedStudentId, setSelectedStudentId] = useState('');

  // ➕ Options de réservation (mode + pack)
  const [bookMode, setBookMode] = useState('presentiel'); // 'presentiel' | 'visio'
  const [packHours, setPackHours] = useState(1);          // 1 | 5 | 10
  
  // Charger prof
  useEffect(() => {
    const unsubTeacher = onSnapshot(doc(db, 'users', teacherId), (snap) => {
      if (snap.exists()) {
        const t = { ...snap.data(), id: teacherId };
        setTeacher(t);
        setBookMode(t.visio_enabled && !t.presentiel_enabled ? 'visio' : 'presentiel');
      } else {
        setTeacher(null);
      }
    });
    return () => unsubTeacher();
  }, [teacherId]);

  useEffect(() => {
    if (!teacher) return;

    const mainSubjectRaw = teacher.subjects || '';
    const mainSubject = String(mainSubjectRaw).split(',')[0].trim(); // "Maths" si "Maths, Physique"

    if (!mainSubject) {
      setSimilarTeachers([]);
      return;
    }

    let cancelled = false;

    (async () => {
      setLoadingSimilar(true);
      try {
        // 1) On récupère des profs qui ont la même matière (subjects)
        const qTeachers = query(
          collection(db, 'users'),
          where('role', '==', 'teacher'),
          where('subjects', '==', mainSubject)
        );

        const snap = await getDocs(qTeachers);
        const candidates = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(t => t.id !== teacherId);

        // Limite raisonnable
        const shortlist = candidates.slice(0, 10);

        // 2) Calcul notes/nb avis par prof (client-side, petit volume)
        const withRatings = await Promise.all(
          shortlist.map(async (t) => {
            const qRev = query(collection(db, 'reviews'), where('teacher_id', '==', t.id));
            const revSnap = await getDocs(qRev);
            const ratings = revSnap.docs.map(x => Number(x.data()?.rating || 0)).filter(n => !Number.isNaN(n));
            const count = ratings.length;
            const avg = count ? (ratings.reduce((a,b)=>a+b,0) / count) : 0;

            return {
              ...t,
              avgRating: avg,
              reviewsCount: count,
            };
          })
        );

        // 3) On tri : meilleurs en premier (note puis nb avis)
        withRatings.sort((a, b) => {
          if ((b.avgRating || 0) !== (a.avgRating || 0)) return (b.avgRating || 0) - (a.avgRating || 0);
          return (b.reviewsCount || 0) - (a.reviewsCount || 0);
        });

        if (!cancelled) setSimilarTeachers(withRatings.slice(0, 8));
      } catch (e) {
        console.error('similar teachers error:', e);
        if (!cancelled) setSimilarTeachers([]);
      } finally {
        if (!cancelled) setLoadingSimilar(false);
      }
    })();

    return () => { cancelled = true; };
  }, [teacher, teacherId]);

  // Avis
  useEffect(() => {
    const qReviews = query(collection(db, 'reviews'), where('teacher_id', '==', teacherId));
    const unsub = onSnapshot(qReviews, (snap) => {
      setReviews(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [teacherId]);

  // Dispos + infos de réservation (par date)
  useEffect(() => {
    if (!teacher) return;

    const qLessons = query(
      collection(db, 'lessons'),
      where('teacher_id', '==', teacherId)
    );

    const unsubLessons = onSnapshot(qLessons, (snap) => {
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

      const booked = [];
      const remaining = {};

      const teacherGroupEnabled = !!teacher.group_enabled;
      const defaultCap =
        teacherGroupEnabled && Number(teacher.group_capacity) > 1
          ? Math.floor(Number(teacher.group_capacity))
          : 1;

      docs.forEach((l) => {
        const day  = l.slot_day;
        const hour = l.slot_hour;
        if (!day || typeof hour !== 'number') return;

        // status global de la leçon
        const globalStatus = String(l.status || '').toLowerCase();
        if (['removed', 'deleted'].includes(globalStatus)) return;

        // date locale du cours
        let dateStr = l.date || null;
        if (!dateStr && l.startAt) {
          const d = new Date(l.startAt);
          if (!Number.isNaN(d.getTime())) {
            dateStr = formatLocalDate(d);
          }
        }

        // clé semaine (lundi)
        let weekStr = l.week || null;
        if (!weekStr && dateStr) {
          const d = new Date(`${dateStr}T00:00:00`);
          weekStr = weekKeyOf(d);
        }

        // infos pour BookingModal (isBooked + pastilles enfants)
        booked.push({
          day,
          hour,
          date: dateStr || null,
          week: weekStr || null,
          startAt: l.startAt || null,
          participant_ids: Array.isArray(l.participant_ids) ? l.participant_ids : [],
          student_id: l.student_id || null,
          participantsMap: l.participantsMap || {},
          is_group: !!l.is_group,
          capacity: l.capacity,
          status: l.status,
        });

        // places restantes pour les groupes (par DATE)
        if (l.is_group) {
          const ids = Array.isArray(l.participant_ids) ? l.participant_ids : [];
          const pm  = l.participantsMap || {};
          let occupied = 0;
          const uniq = new Set(ids);
          uniq.forEach((sid) => {
            const st = String(pm?.[sid]?.status || l.status || 'pending').toLowerCase();
            if (!['rejected','removed','deleted'].includes(st)) occupied += 1;
          });

          const cap = Number(l.capacity || 0) > 0 ? Number(l.capacity) : defaultCap;
          const remains = Math.max(0, cap - occupied);

          if (remains > 0) {
            // si on a une date précise, on la privilégie
            if (dateStr) {
              const k = `${day}:${hour}:${dateStr}`;
              remaining[k] = Math.max(remaining[k] || 0, remains);
            } else {
              const kPlain = `${day}:${hour}`;
              remaining[kPlain] = Math.max(remaining[kPlain] || 0, remains);
            }
          }
          // --- AJOUT : placer la capacité en clé DATE d'abord, puis SEMAINE puis SIMPLE ---
          if (remains > 0) {
              if (dateStr) {
                  // clé par date précise
                  remaining[`${day}:${hour}:${dateStr}`] = Math.max(remaining[`${day}:${hour}:${dateStr}`] || 0, remains);
              }
              if (weekStr) {
                  // clé par semaine
                  remaining[`${day}:${hour}:${weekStr}`] = Math.max(remaining[`${day}:${hour}:${weekStr}`] || 0, remains);
              }
              // clé simple fallback
              remaining[`${day}:${hour}`] = Math.max(remaining[`${day}:${hour}`] || 0, remains);
          }
        }
      });

      // ➕ capacité par défaut pour les créneaux sans groupe
      const avail = teacher.availability || {};
      const hasWeekKeys = Object.keys(avail).some((k) =>
        /^\d{4}-\d{2}-\d{2}$/.test(k)
      );

      if (!hasWeekKeys) {
        // 🧷 Ancien format : { 'Lun': [9,10], ... }
        Object.entries(avail).forEach(([day, hours]) => {
          (hours || []).forEach((h) => {
            const plainKey = `${day}:${h}`;
            if (remaining[plainKey] == null) {
              remaining[plainKey] = defaultCap;
            }
          });
        });
      } else {
        // 🆕 Nouveau format :
        // { 'YYYY-MM-DD' (lundi): { 'Lun': [9,10], ... }, ... }
        Object.entries(avail).forEach(([weekKey, days]) => {
          if (!days || typeof days !== 'object' || Array.isArray(days)) return;

          Object.entries(days).forEach(([day, hours]) => {
            (hours || []).forEach((h) => {
              const plainKey = `${day}:${h}`;
              const weekK    = `${day}:${h}:${weekKey}`;

              // fallback global pour tous les lundis 9h, etc.
              if (remaining[plainKey] == null) {
                remaining[plainKey] = defaultCap;
              }
              // clé spécifique à la semaine (2025-12-01, 2025-12-08, ...)
              if (remaining[weekK] == null) {
                remaining[weekK] = defaultCap;
              }
            });
          });
        });
      }

      setBookedSlots(booked);
      setRemainingBySlot(remaining);
    });

    return () => unsubLessons();
  }, [teacherId, teacher]);

  // Infos auteurs d’avis (nom + avatar)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ids = Array.from(
        new Set(reviews.map((r) => getReviewerId(r)).filter(Boolean))
      ).filter((id) => !(id in reviewerInfo));

      if (ids.length === 0) return;

      const entries = await Promise.all(ids.map(async (id) => {
        try {
          const u = await getDoc(doc(db, 'users', id));
          if (u.exists()) {
            const ux = u.data();
            return [id, { name: pickDisplayName(ux) || 'Utilisateur', avatar: pickAvatar(ux) || '' }];
          }
        } catch {}
        try {
          const s = await getDoc(doc(db, 'students', id));
          if (s.exists()) {
            const sx = s.data();
            return [id, { name: pickDisplayName(sx) || 'Élève', avatar: pickAvatar(sx) || '' }];
          }
        } catch {}
        return [id, { name: 'Utilisateur', avatar: '' }];
      }));

      if (!cancelled) {
        setReviewerInfo((prev) => {
          const next = { ...prev };
          entries.forEach(([id, val]) => { next[id] = val; });
          return next;
        });
      }
    })();

    return () => { cancelled = true; };
  }, [reviews]); // eslint-disable-line

  // Rôle courant + enfants
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const me = auth.currentUser;
      if (!me) return;

      // <<< AJOUT : variable partagée pour retenir le rôle lu >>>
      let computedRole = null;

      try {
        const meSnap = await getDoc(doc(db, 'users', me.uid));
        const role = meSnap.exists() ? meSnap.data()?.role : null;
        if (!cancelled) setCurrentRole(role || null);
        computedRole = meSnap.exists() ? meSnap.data()?.role : null;
        if (!cancelled) setCurrentRole(computedRole || null);
      } catch { if (!cancelled) setCurrentRole(null); }

      try {
        const kidsQ = query(collection(db, 'students'), where('parent_id', '==', me.uid));
        const kidsSnap = await getDocs(kidsQ);
        const kids = kidsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (!cancelled) setChildren(kids);

        // ➕ Sélection par défaut PLUS INTELLIGENTE pour les parents :
        if (!cancelled) {
          setSelectedStudentId((prev) => {
            // <<< on utilise computedRole, PAS "role" >>>
            if ((computedRole || null) === 'parent' && kids.length > 0) return kids[0].id;
            return prev || me.uid;
          });
        }
      } catch {
        if (!cancelled) {
         // En cas d’erreur de lecture des enfants, repli : soi-même
         setSelectedStudentId((prev) => prev || me.uid);
        } 
      }
    })();
    return () => { cancelled = true; };
  }, []);
 
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)'); // lg+
    const TOP_OFFSET = 24; // = top-6

    const compute = () => {
      if (!mq.matches) {
        setStickyMode('sticky');
        setStickyTopPx(0);
        return;
      }
      const layoutEl = layoutRef.current;
      const stickyEl = stickyRef.current;
      const stopEl = stopRef.current;
      if (!layoutEl || !stickyEl || !stopEl) return;

      const layoutTop = layoutEl.getBoundingClientRect().top + window.scrollY;
      const stopTop = stopEl.getBoundingClientRect().top + window.scrollY;

      const stickyHeight = stickyEl.offsetHeight;
      const maxScrollTop = stopTop - stickyHeight - TOP_OFFSET; // scrollY max avant collision

      // si on dépasse => on stoppe (position absolute dans le layout)
      if (window.scrollY >= maxScrollTop) {
        setStickyMode('stopped');
        setStickyTopPx(maxScrollTop - layoutTop);
      } else {
        setStickyMode('sticky');
        setStickyTopPx(0);
      }
    };

    const onScroll = () => compute();
    const onResize = () => compute();

    compute();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    mq.addEventListener?.('change', compute);

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      mq.removeEventListener?.('change', compute);
    };
  }, []);

  const meUid = auth.currentUser?.uid;
  const isTeacherUser = currentRole === 'teacher';
  const isOwnProfile = teacherId === auth.currentUser?.uid;
  const canBook = !isTeacherUser && !isOwnProfile;

  const effectiveVisioPrice = (t) => {
    if (!t?.visio_enabled) return null;
    return t.visio_same_rate ? Number(t.price_per_hour || 0) : Number(t.visio_price_per_hour || 0);
  };
  const pack5Display = (t) => {
    const base = Number(t?.price_per_hour || 0);
    const v = t?.pack5_price;
    return (v !== undefined && v !== '' && v !== null)
      ? Number(v)
      : (base > 0 ? Number((5 * base * 0.9).toFixed(2)) : null);
  };
  const pack10Display = (t) => {
    const base = Number(t?.price_per_hour || 0);
    const v = t?.pack10_price;
    return (v !== undefined && v !== '' && v !== null)
      ? Number(v)
      : (base > 0 ? Number((10 * base * 0.9).toFixed(2)) : null);
  };

// ...imports et tout ton code au-dessus inchangé...

  const handleBooking = async (selected) => {
    if (!auth.currentUser) return navigate('/login');
    if (!canBook) {
      setShowBooking(false);
      setConfirmationMsg("Les comptes professeurs ne peuvent pas réserver de cours.");
      return;
    }

    const me = auth.currentUser;
    const targetStudentId = selectedStudentId || me.uid;
    const bookingFor =
      currentRole === "parent" && targetStudentId !== me.uid ? "child" : "self";
    const slots = Array.isArray(selected) ? selected : [selected];
    // --- helpers pack (au NIVEAU PARTICIPANT) ---
    const wipePackParticipant = (sid) => ({
      [`participantsMap.${sid}.pack`]: deleteField(),
      [`participantsMap.${sid}.is_pack`]: deleteField(),
      [`participantsMap.${sid}.pack_id`]: deleteField(),
      [`participantsMap.${sid}.pack_type`]: deleteField(),
      [`participantsMap.${sid}.pack_mode`]: deleteField(),
      [`participantsMap.${sid}.pack_hours`]: deleteField(),
      [`participantsMap.${sid}.pack_hours_total`]: deleteField(),
      [`participantsMap.${sid}.pack_hours_remaining`]: deleteField(),
      [`participantsMap.${sid}.require_accept_all`]: deleteField(),
    });

    // Poser un pack propre pour un participant
    const putPackParticipant = (sid, hours, mode, forcedPackId) => {
      if (!(hours === 5 || hours === 10)) return {};
      return {
        [`participantsMap.${sid}.pack`]: true,
        [`participantsMap.${sid}.pack_id`]: forcedPackId || `${auth.currentUser.uid}_${teacherId}_${Date.now()}_${hours}_${mode}`,
        [`participantsMap.${sid}.pack_type`]: (hours === 5 ? 'pack5' : 'pack10'),
        [`participantsMap.${sid}.pack_mode`]: mode,       // 'presentiel' | 'visio'
        [`participantsMap.${sid}.pack_hours`]: hours,     // (pour compat avec ton front actuel)
        [`participantsMap.${sid}.require_accept_all`]: true,
      };
    };

    // --- Définition du pack (par PARTICIPANT) ---
    const isPack = packHours === 5 || packHours === 10;
    const packId = isPack
      ? `${auth.currentUser.uid}_${teacherId}_${Date.now()}_${packHours}_${bookMode}`
      : null;
    // champs pack pour le participant ciblé UNIQUEMENT
    const packFieldsForParticipant = (sid) => (isPack ? {
      pack: true,
      pack_id: packId,
      pack_hours: packHours,
      pack_type: packHours === 5 ? 'pack5' : 'pack10',
      pack_mode: bookMode, // presentiel|visio
      require_accept_all: true,
    } : {});

    // ❗️Toujours dériver ces 2 constantes ici (avant tout usage en dessous)
    const wantSingle = !isPack; // l’utilisateur (re)demande 1 seul créneau => pas un pack
    const participantPack = packFieldsForParticipant(targetStudentId); // {} si wantSingle

    // 🧮 tarif à appliquer selon mode & packs
    const base = Number(teacher?.price_per_hour || 0);
    const visio = effectiveVisioPrice(teacher);
    const hourly =
      bookMode === "visio" && visio !== null ? visio : base;

    setIsBooking(true);
    setConfirmationMsg("");
    try {
      const results = [];
      for (const slot of slots) {
        try {
          // Vérifier doublons + réactiver si précédemment "rejected"
          const dupIndQ = query(
            collection(db, "lessons"),
            where("teacher_id", "==", teacherId),
            where("slot_day", "==", slot.day),
            where("slot_hour", "==", slot.hour),
            where("date", "==", slot.date),          // 🔸 différence de semaine
            where("is_group", "==", false),
            where("student_id", "==", targetStudentId)
          );
          const dupGrpQ = query(
            collection(db, "lessons"),
            where("teacher_id", "==", teacherId),
            where("slot_day", "==", slot.day),
            where("slot_hour", "==", slot.hour),
            where("date", "==", slot.date),          // 🔸 différence de semaine
            where("is_group", "==", true),
            where("participant_ids", "array-contains", targetStudentId)
          );

          const [dupIndSnap, dupGrpSnap] = await Promise.all([getDocs(dupIndQ), getDocs(dupGrpQ)]);

          // 1) INDIVIDUEL : s'il existe un cours non rejeté -> DUPLICATE
          const existingInd = dupIndSnap.docs[0]?.data();
          const existingIndId = dupIndSnap.docs[0]?.id;

          if (existingInd) {
            // 🔎 Regarder d'abord le statut du PARTICIPANT visé
            const partSt = String(
              existingInd?.participantsMap?.[targetStudentId]?.status ||
              existingInd?.status || ''
            ).toLowerCase();

            // S'il est encore actif (pas rejeté/supprimé) ⇒ c'est bien un doublon
            if (!['rejected', 'removed', 'deleted'].includes(partSt)) {
              results.push({ slot, status: 'duplicate', message: `Déjà inscrit(e) sur ${slot.day} ${slot.hour}h.` });
              continue;
            }

            // 💡 “Réactiver” l’ancien individuel rejeté pour CET élève, sans pack si wantSingle
            await updateDoc(doc(db, 'lessons', existingIndId), {
              status: 'booked',
              student_id: targetStudentId,
              date: slot.date,
              week: slot.week,
              startAt: new Date(slot.startAt),
              // sécurité : enlever tout vieux champ pack posé par le passé AU NIVEAU LEÇON
              is_pack: deleteField(),
              pack_hours: deleteField(),
              pack_type: deleteField(),
              pack_mode: deleteField(),
              pack_hours_total: deleteField(),
              pack_hours_remaining: deleteField(),

              participant_ids: Array.from(new Set([...(existingInd.participant_ids || []), targetStudentId])),

              // on repart sur une demande “unitaire” => on efface tout Pack du participant
              ...wipePackParticipant(targetStudentId),

              [`participantsMap.${targetStudentId}.parent_id`]: (bookingFor === 'child' ? me.uid : null),
              [`participantsMap.${targetStudentId}.booked_by`]: me.uid,
              [`participantsMap.${targetStudentId}.is_paid`]: false,
              [`participantsMap.${targetStudentId}.paid_by`]: null,
              [`participantsMap.${targetStudentId}.paid_at`]: null,
              [`participantsMap.${targetStudentId}.status`]: 'pending_teacher',
              [`participantsMap.${targetStudentId}.added_at`]: serverTimestamp(),
            });
            await addDoc(collection(db, 'notifications'), {
              user_id: teacherId,
              read: false,
              created_at: serverTimestamp(),
              type: 'lesson_request',
              lesson_id: existingIndId,
              requester_id: targetStudentId,
              message: `Relance de demande (individuel) ${slot.day} ${slot.hour}h.`,
            });
            results.push({ slot, status: 'revived_individual', message: `Demande réactivée (individuel) ${slot.day} ${slot.hour}h.` });
            continue;
          }

          // 2) GROUPE : s'il existe un groupe où je suis déjà "actif" -> DUPLICATE
          let alreadyActiveInGroup = false;
          let rejectedInGroupDoc = null; // doc à "réactiver" si statut rejeté
          for (const d of dupGrpSnap.docs) {
            const g = d.data();
            const pm = g.participantsMap || {};
            const pst = String(pm?.[targetStudentId]?.status || "pending").toLowerCase();
            if (!["rejected", "removed", "deleted"].includes(pst)) {
              // actif (pending/accepted/confirmed) -> duplicate
              alreadyActiveInGroup = true;
              break;
            }
            if (["rejected", "removed", "deleted"].includes(pst)) {
              rejectedInGroupDoc = { id: d.id, data: g };
              // on ne break pas ici : on préfère d'abord vérifier s'il y a un actif
            }
          }

          if (alreadyActiveInGroup) {
            results.push({ slot, status: "duplicate", message: `Déjà inscrit(e) sur ${slot.day} ${slot.hour}h.` });
            continue;
          }

          //    b) groupe où je suis "rejected" -> passer ce participant en pending_teacher
          if (rejectedInGroupDoc) {
            const { id: gId, data: g } = rejectedInGroupDoc;
            const wantSingle = !(packHours === 5 || packHours === 10);

            const basePayload = {
              participant_ids: Array.from(new Set([...(g.participant_ids || []), targetStudentId])),
              [`participantsMap.${targetStudentId}.parent_id`]: (bookingFor === 'child' ? me.uid : null),
              [`participantsMap.${targetStudentId}.booked_by`]: me.uid,
              [`participantsMap.${targetStudentId}.is_paid`]: false,
              [`participantsMap.${targetStudentId}.paid_by`]: null,
              [`participantsMap.${targetStudentId}.paid_at`]: null,
              [`participantsMap.${targetStudentId}.status`]: 'pending_teacher',
              [`participantsMap.${targetStudentId}.added_at`]: serverTimestamp(),
            };

            await updateDoc(doc(db, 'lessons', gId), {
              ...basePayload,
              ...(wantSingle
                ? wipePackParticipant(targetStudentId)               // unitaire => on enlève tout Pack
                : putPackParticipant(targetStudentId, packHours, bookMode) // nouveau pack => on écrase proprement
              ),
            });
            await addDoc(collection(db, "notifications"), {
              user_id: teacherId,
              read: false,
              created_at: serverTimestamp(),
              type: "lesson_request",
              lesson_id: gId,
              requester_id: targetStudentId,
              message: `Relance de demande (groupe) ${slot.day} ${slot.hour}h.`,
            });
            results.push({ slot, status: "revived_group", message: `Demande réactivée (groupe) ${slot.day} ${slot.hour}h.` });
            continue;
          }

          // 4) Si pas de réactivation possible : logique précédente
          // Rejoindre un groupe existant (packs autorisés aussi)
          {
            const qExisting = query(
              collection(db, "lessons"),
              where("teacher_id", "==", teacherId),
              where("slot_day", "==", slot.day),
              where("slot_hour", "==", slot.hour),
              where("date", "==", slot.date),
              where("is_group", "==", true)
            );
            const existSnap = await getDocs(qExisting);
            let joined = false;
            for (const d of existSnap.docs) {
              const l = d.data();
              const current = Array.isArray(l.participant_ids) ? l.participant_ids : [];
              if (current.includes(targetStudentId)) {
                results.push({ slot, status: "duplicate", message: `Déjà inscrit(e) sur ${slot.day} ${slot.hour}h.` });
                joined = true;
                break;
              }
              await updateDoc(doc(db, 'lessons', d.id), {
                participant_ids: arrayUnion(targetStudentId),

                // infos communes
                [`participantsMap.${targetStudentId}.parent_id`]: (bookingFor === 'child' ? me.uid : null),
                [`participantsMap.${targetStudentId}.booked_by`]: me.uid,
                [`participantsMap.${targetStudentId}.is_paid`]: false,
                [`participantsMap.${targetStudentId}.paid_by`]: null,
                [`participantsMap.${targetStudentId}.paid_at`]: null,
                [`participantsMap.${targetStudentId}.status`]: 'pending_teacher',
                [`participantsMap.${targetStudentId}.added_at`]: serverTimestamp(),

                // pack : soit on met un pack propre, soit on nettoie tout
                ...((packHours === 5 || packHours === 10)
                    ? putPackParticipant(targetStudentId, packHours, bookMode)
                    : wipePackParticipant(targetStudentId)),
              });
              await addDoc(collection(db, "notifications"), {
                user_id: teacherId,
                read: false,
                created_at: serverTimestamp(),
                type: "lesson_request",
                lesson_id: d.id,
                requester_id: targetStudentId,
                message: `Demande d'ajout au groupe (${slot.day} ${slot.hour}h).`,
              });
              results.push({ slot, status: "joined_group", message: `Ajout au groupe demandé pour ${slot.day} ${slot.hour}h.` });
              joined = true;
              break;
            }
            if (joined) continue;
          }

          // 4) Si pas de réactivation possible : création correcte (groupe / individuel)
          const groupEnabled = !!teacher?.group_enabled;
          const teacherCap = Number(teacher?.group_capacity || 1);
          const defaultCap = teacherCap > 1 ? teacherCap : 1;

          // ✅ VÉRIFICATION double : si le prof autorise les groupes ET que la demande ne vient pas d’un “individuel forcé”
          const allowGroup = groupEnabled && defaultCap > 1;

          // Si un mode “groupé” ou “individuel” existe côté UI (par exemple, un switch ou pack sélectionné),
          // ajoute ici la vraie condition utilisateur.
          // Pour l’instant, on se base sur la capacité du prof :

          const createAsGroup = allowGroup; // ta logique déjà en place

          const newLessonRef = await addDoc(collection(db, 'lessons'), {
            teacher_id: teacherId,
            status: 'booked',
            created_at: serverTimestamp(),
            subject_id: Array.isArray(teacher?.subjects) ? teacher.subjects.join(', ') : (teacher?.subjects || ''),
            price_per_hour: hourly || 0,
            slot_day: slot.day,
            slot_hour: slot.hour,
            date: slot.date,              // "YYYY-MM-DD"
            week: slot.week,              // lundi "YYYY-MM-DD"
            startAt: slot.startAt,        // Date (sera sérialisée côté client) ou Timestamp côté backend
            is_group: createAsGroup,
            capacity: createAsGroup ? defaultCap : 1,
            student_id: createAsGroup ? null : targetStudentId,

            participant_ids: [targetStudentId],
            participantsMap: {
              [targetStudentId]: {
                parent_id: (bookingFor === 'child' ? me.uid : null),
                booked_by: me.uid,
                is_paid: false,
                paid_by: null,
                paid_at: null,
                status: 'pending_teacher',
                added_at: serverTimestamp(),
              },
            },

            mode: bookMode,
          });

          // Pose/Nettoie le pack APRES création (pour ne pas polluer la leçon)
          await updateDoc(doc(db, 'lessons', newLessonRef.id), {
            ...(isPack
              ? putPackParticipant(targetStudentId, packHours, bookMode)
              : wipePackParticipant(targetStudentId)),
          });

          // Optionnel: notif prof (garde ta version si tu en as déjà une)
          await addDoc(collection(db, 'notifications'), {
            user_id: teacherId,
            read: false,
            created_at: serverTimestamp(),
            type: 'lesson_request',
            lesson_id: newLessonRef.id,
            requester_id: targetStudentId,
            message: `Demande de cours ${createAsGroup ? 'groupé' : 'individuel'} (${slot.day} ${slot.hour}h).`,
          });

          // Pour ton feedback UI local
          results.push({
            slot,
            status: createAsGroup ? 'created_group' : 'created_individual',
            message: `Demande de cours ${createAsGroup ? 'groupé' : 'individuel'} pour ${slot.day} ${slot.hour}h.`,
          });
        } catch (e) {
          console.error("Booking error (single)", e);
          results.push({
            slot,
            status: "error",
            message: `Erreur sur ${slot.day} ${slot.hour}h.`,
          });
        }
      }

      const grouped = {
        created_group: [],
        created_individual: [],
        joined_group: [],
        duplicate: [],
        error: [],
      };
      for (const r of results) {
        const key = grouped[r.status] ? r.status : "error";
        grouped[key].push(`${r.slot.day} ${r.slot.hour}h`);
      }

      const parts = [];
      if (grouped.created_individual.length)
        parts.push(
          `Demandes individuelles envoyées : ${grouped.created_individual.join(", ")}.`
        );
      if (grouped.created_group.length)
        parts.push(
          `Demandes de création de groupe envoyées : ${grouped.created_group.join(", ")}.`
        );
      if (grouped.joined_group.length)
        parts.push(
          `Demandes d'ajout à un groupe envoyées : ${grouped.joined_group.join(", ")}.`
        );
      if (grouped.duplicate.length)
        parts.push(`Déjà inscrit(e) sur : ${grouped.duplicate.join(", ")}.`);
      if (grouped.error.length)
        parts.push(`Erreurs sur : ${grouped.error.join(", ")}.`);

      // Si on vient de "réactiver" un refus en unitaire => coupe l’état UI du pack
      if (isPack && results.some(r => r.status === 'revived_individual' || r.status === 'revived_group')) {
        setPackHours(1);  // plus d'étiquette Pack dans la confirmation
      }
      setShowBooking(false);

      const onlyOk = results.filter(r => r.status !== 'error');
      const hasOk  = onlyOk.length > 0;

      setConfirmationMsg(
        hasOk
          ? parts.join(' ')
          : "Erreur lors de la réservation. Réessayez plus tard."
      );
    } catch (e) {
      console.error("Booking error (batch)", e);
      setConfirmationMsg("Erreur lors de la réservation. Réessayez plus tard.");
    } finally {
      setIsBooking(false);
    }
  };

  // ✅ Profs similaires
  const [similarTeachers, setSimilarTeachers] = useState([]);
  const [loadingSimilar, setLoadingSimilar] = useState(false);

  // ✅ Sticky stop propre
  const layoutRef = useRef(null);       // conteneur "grid" global
  const stickyRef = useRef(null);       // le bloc sticky (wrapper)
  const stopRef = useRef(null);         // début de la section "profs similaires"
  const [stickyMode, setStickyMode] = useState('sticky'); // 'sticky' | 'stopped'
  const [stickyTopPx, setStickyTopPx] = useState(0);      // top absolu quand stopped

  const basePrice = Number(teacher.price_per_hour || 0);
  const visioPrice = effectiveVisioPrice(teacher);
  const p5 = pack5Display(teacher);
  const p10 = pack10Display(teacher);

  // --- UNIQUEMENT POUR L’AFFICHAGE DES PRIX (commissions incluses) ---
  const computePack = (rate, hours) => (rate > 0 ? Number((hours * rate * 0.9).toFixed(2)) : null);

  const displayHourPresentiel = Number.isFinite(basePrice) ? basePrice + 10 : null;

  const effectiveVisio = (visioPrice ?? basePrice);
  const displayHourVisio = teacher.visio_enabled ? (effectiveVisio + 10) : null;

  // Packs présentiel
  const displayPack5Presentiel  = p5  != null ? p5  + 50  : null;
  const displayPack10Presentiel = p10 != null ? p10 + 100 : null;

  // Packs visio
  const p5VisioRaw  = teacher.visio_enabled ? computePack(effectiveVisio, 5)  : null;
  const p10VisioRaw = teacher.visio_enabled ? computePack(effectiveVisio, 10) : null;
  const displayPack5Visio  = p5VisioRaw  != null ? p5VisioRaw  + 50  : null;
  const displayPack10Visio = p10VisioRaw != null ? p10VisioRaw + 100 : null;

  const presentielOnly = !!teacher.presentiel_enabled && !teacher.visio_enabled;
  const visioOnly = !!teacher.visio_enabled && !teacher.presentiel_enabled;
  const onlyMode = presentielOnly ? 'presentiel' : (visioOnly ? 'visio' : null);

  // 🔸 Mets ici le chemin de TON image promo (dans /public par ex)
  const PROMO_BANNER_SRC = "/promo/packs-guyane.png"; // <-- à adapter

  // ⭐ Notes / nb avis
  const ratings = reviews.map(r => Number(r.rating || 0)).filter(n => !Number.isNaN(n));
  const reviewsCount = ratings.length;
  const avgRating = reviewsCount ? (ratings.reduce((a,b)=>a+b,0) / reviewsCount) : 0;

  // 👥 “nb d’élèves ayant fait des cours avec le prof”
  // (on calcule depuis lessons déjà écoutés plus haut : bookedSlots contient les leçons)
  const uniqueStudentsCount = useMemo(() => {
    const ids = new Set();
    bookedSlots.forEach(l => {
      const sid = l.student_id;
      if (sid) ids.add(sid);
      const arr = Array.isArray(l.participant_ids) ? l.participant_ids : [];
      arr.forEach(x => x && ids.add(x));
    });
    return ids.size;
  }, [bookedSlots]);

  const modeLabel = teacher.presentiel_enabled && teacher.visio_enabled
    ? "Présentiel + Visio"
    : teacher.visio_enabled
      ? "Visio"
      : teacher.presentiel_enabled
        ? "Présentiel"
        : "Mode non précisé";

  if (!teacher) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="max-w-xl mx-auto bg-white p-6 rounded-xl shadow text-center">
          Chargement…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-white">
      <div ref={layoutRef} className="max-w-6xl mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8 relative">

        {/* ========================= */}
        {/* COLONNE GAUCHE (CONTENU)  */}
        {/* ========================= */}
        <main className="lg:col-span-8 space-y-8">

          {/* Image promo (à côté de la carte sticky, sans empiéter) */}
          <div className="w-full">
            <img
              src={PROMO_BANNER_SRC}
              alt="Offre packs"
              className="w-full rounded-2xl border border-gray-100 shadow-sm object-cover"
            />
            {/* Localisation sous l'image */}
            <div className="mt-3 text-sm text-slate-600">
              📍 {teacher.city || teacher.location || "Localisation non précisée"}
            </div>
          </div>

          {/* À propos de moi (AU DESSUS) */}
          <section className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6">
            <h2 className="text-xl md:text-2xl font-extrabold text-slate-900">À propos de moi</h2>
            <div className="mt-3 text-slate-700 leading-relaxed whitespace-pre-line">
              {teacher.about_me || teacher.bio || "Le professeur n’a pas encore renseigné sa présentation."}
            </div>
          </section>

          {/* À propos du cours (EN DESSOUS) */}
          <section className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6">
            <h2 className="text-xl md:text-2xl font-extrabold text-slate-900">À propos du cours</h2>
            <div className="mt-3 text-slate-700 leading-relaxed whitespace-pre-line">
              {teacher.about_course || "Le professeur n’a pas encore renseigné la description détaillée du cours."}
            </div>
          </section>

          {/* Tarifs (tu m’as dit : enlever la section “mode”, et mettre tarifs après) */}
          <section className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6">
            <h2 className="text-xl md:text-2xl font-extrabold text-slate-900">Tarifs</h2>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-slate-700">
              {teacher.presentiel_enabled && (
                <div className="border rounded-xl p-4">
                  <div className="font-semibold">Présentiel</div>
                  <div className="mt-1">À l’heure : <b>{displayHourPresentiel != null ? `${displayHourPresentiel.toFixed(2)} € / h` : "—"}</b></div>
                  <div className="mt-1">Pack 5h : <b>{displayPack5Presentiel != null ? `${displayPack5Presentiel.toFixed(2)} €` : "—"}</b></div>
                  <div className="mt-1">Pack 10h : <b>{displayPack10Presentiel != null ? `${displayPack10Presentiel.toFixed(2)} €` : "—"}</b></div>
                </div>
              )}

              {teacher.visio_enabled && (
                <div className="border rounded-xl p-4">
                  <div className="font-semibold">Visio</div>
                  <div className="mt-1">À l’heure : <b>{displayHourVisio != null ? `${displayHourVisio.toFixed(2)} € / h` : "—"}</b></div>
                  <div className="mt-1">Pack 5h : <b>{displayPack5Visio != null ? `${displayPack5Visio.toFixed(2)} €` : "—"}</b></div>
                  <div className="mt-1">Pack 10h : <b>{displayPack10Visio != null ? `${displayPack10Visio.toFixed(2)} €` : "—"}</b></div>
                </div>
              )}

              {!teacher.presentiel_enabled && !teacher.visio_enabled && (
                <div className="text-gray-500">Tarifs non disponibles.</div>
              )}
            </div>
          </section>

          {/* Avis (tu peux garder ton bloc existant, je ne le casse pas) */}
          <section className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6">
            <h2 className="text-xl md:text-2xl font-extrabold text-slate-900 mb-4">Avis</h2>

            <div className="flex flex-col gap-3">
              {reviews.length === 0 && (
                <div className="text-gray-400 text-sm">Aucun avis pour ce professeur.</div>
              )}

              {reviews.map((r) => {
                const rid = getReviewerId(r);
                const info = (rid && reviewerInfo[rid]) || {};
                const name = info.name || "Utilisateur";
                const avatar = info.avatar || "/avatar-default.png";
                const rating = r.rating || 0;

                return (
                  <div key={r.id} className="bg-gray-50 border rounded-xl px-4 py-3">
                    <div className="flex items-center gap-3 mb-2">
                      <img src={avatar} alt={name} className="w-9 h-9 rounded-full object-cover border" />
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold text-gray-800">{name}</span>
                        {r.created_at?.toDate && (
                          <span className="text-xs text-gray-400">
                            {r.created_at.toDate().toLocaleDateString("fr-FR")}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-start gap-2">
                      <span className="text-yellow-500">
                        {"★".repeat(Math.min(5, Math.max(0, Math.round(rating))))}
                      </span>
                      <span className="italic text-gray-700">{r.comment}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ========================= */}
          {/* PROFS SIMILAIRES (STOPPER) */}
          {/* ========================= */}
          <section ref={stopRef} className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-xl md:text-2xl font-extrabold text-slate-900">Profs similaires</h2>
              <span className="text-sm text-slate-500">
                Même matière ({String(teacher.subjects || '').split(',')[0].trim() || '—'})
              </span>
            </div>

            {loadingSimilar && (
              <div className="mt-4 text-sm text-slate-500">Chargement…</div>
            )}

            {!loadingSimilar && similarTeachers.length === 0 && (
              <div className="mt-4 text-sm text-slate-500">Aucun professeur similaire trouvé pour le moment.</div>
            )}

            {/* Mobile: slider horizontal / Desktop: grid */}
            <div className="mt-5">
              <div className="flex lg:grid lg:grid-cols-2 gap-4 overflow-x-auto lg:overflow-visible pb-2 snap-x snap-mandatory">
                {similarTeachers.map((t) => {
                  const first = t.firstName || '';
                  const last = t.lastName || (t.fullName ? String(t.fullName).split(' ').slice(-1).join(' ') : '');
                  const displayName = `${first} ${last}`.trim() || t.fullName || 'Professeur';
                  const avatar = t.avatarUrl || t.avatar_url || t.photoURL || '/avatar-default.png';

                  const modeLabelSmall =
                    t.presentiel_enabled && t.visio_enabled
                      ? 'Présentiel + Visio'
                      : t.visio_enabled
                        ? 'Visio'
                        : t.presentiel_enabled
                          ? 'Présentiel'
                          : '—';

                  return (
                    <button
                      key={t.id}
                      onClick={() => navigate(`/teacher/${t.id}`)}
                      className="min-w-[260px] lg:min-w-0 snap-start text-left border rounded-2xl overflow-hidden hover:shadow-md transition bg-white"
                      type="button"
                    >
                      <div className="relative">
                        <img src={avatar} alt={displayName} className="w-full h-40 object-cover" />
                        <div className="absolute bottom-2 left-2 px-2 py-1 rounded-full text-[11px] font-bold bg-black/65 text-white">
                          {modeLabelSmall}
                        </div>
                      </div>

                      <div className="p-4">
                        <div className="font-extrabold text-slate-900">{displayName}</div>

                        <div className="mt-2 flex items-center gap-2 text-sm">
                          <span className="text-yellow-500">
                            {"★".repeat(Math.round(t.avgRating || 0)).padEnd(5, "☆")}
                          </span>
                          <span className="text-slate-700 font-semibold">
                            {(t.avgRating || 0).toFixed(1)}
                          </span>
                          <span className="text-slate-500">({t.reviewsCount || 0})</span>
                        </div>

                        <div className="mt-2 text-sm text-slate-600">
                          {t.subjects || '—'} — {t.bio || t.about_me || 'Voir le profil'}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        </main>

        {/* ========================= */}
        {/* COLONNE DROITE (STICKY)   */}
        {/* ========================= */}
        <aside className="lg:col-span-4 relative">
          <div
            ref={stickyRef}
            className="space-y-4"
            style={
              stickyMode === 'stopped'
                ? { position: 'absolute', top: `${stickyTopPx}px`, width: '100%' }
                : { position: 'sticky', top: '24px' }
            }
          >

            {/* Carte prof unique (SUPERPROF LIKE) */}
            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
              {/* Photo + badge mode dans la photo */}
              <div className="relative">
                <img
                  src={teacher.avatarUrl || teacher.avatar_url || teacher.photoURL || "/avatar-default.png"}
                  alt={teacher.fullName || "Prof"}
                  className="w-full h-64 object-cover"
                />

                <div className="absolute bottom-3 left-3 px-3 py-1.5 rounded-full text-xs font-bold bg-black/65 text-white">
                  {modeLabel}
                </div>
              </div>

              <div className="p-5">
                <div className="text-lg font-extrabold text-slate-900">
                  {teacher.firstName || ""} {teacher.lastName || teacher.fullName || "Professeur"}
                </div>

                {/* étoiles + nb avis */}
                <div className="mt-2 flex items-center gap-2 text-sm">
                  <span className="text-yellow-500">
                    {"★".repeat(Math.round(avgRating || 0)).padEnd(5, "☆")}
                  </span>
                  <span className="text-slate-700 font-semibold">{avgRating ? avgRating.toFixed(1) : "0.0"}</span>
                  <span className="text-slate-500">({reviewsCount} avis)</span>
                </div>

                {/* nb d’élèves */}
                <div className="mt-2 text-sm text-slate-600">
                  {uniqueStudentsCount} élève{uniqueStudentsCount > 1 ? "s" : ""} a déjà pris un cours avec ce professeur
                </div>

                {/* Bouton contacter */}
                {!isOwnProfile && (
                  <button
                    className="mt-4 w-full bg-yellow-400 text-slate-900 px-5 py-3 rounded-xl font-semibold shadow hover:bg-yellow-500 transition"
                    onClick={() => {
                      if (!auth.currentUser) return navigate("/login");
                      navigate(`/chat/${teacherId}`);
                    }}
                  >
                    Contacter le professeur
                  </button>
                )}

                {/* Mode + Pack côte à côte */}
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Mode</label>
                    {onlyMode ? (
                      <div className="w-full border rounded-xl px-3 py-2 bg-gray-50 text-slate-800 font-semibold text-sm">
                        {onlyMode === "visio" ? "Visio" : "Présentiel"}
                      </div>
                    ) : (
                      <select
                        className="w-full border rounded-xl px-3 py-2 text-sm"
                        value={bookMode}
                        onChange={(e) => setBookMode(e.target.value)}
                      >
                        <option value="presentiel">Présentiel</option>
                        {teacher.visio_enabled && <option value="visio">Visio</option>}
                      </select>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Pack</label>
                    <select
                      className="w-full border rounded-xl px-3 py-2 text-sm"
                      value={packHours}
                      onChange={(e) => setPackHours(Number(e.target.value))}
                    >
                      <option value={1}>1h</option>
                      <option value={5}>5h</option>
                      <option value={10}>10h</option>
                    </select>
                  </div>
                </div>

                {/* Bouton réserver */}
                {(!isTeacherUser && !isOwnProfile) && (
                  <button
                    className="mt-4 w-full bg-primary text-white px-5 py-3 rounded-xl font-semibold shadow hover:bg-primary-dark transition"
                    onClick={() => {
                      if (!auth.currentUser) return navigate("/login");
                      setShowBooking(true);
                      setConfirmationMsg("");
                    }}
                  >
                    {isBooking ? "Envoi…" : "Réserver"}
                  </button>
                )}

                {confirmationMsg && (
                  <div className="mt-3 bg-amber-50 border border-amber-200 text-amber-800 px-4 py-2 rounded-xl text-sm">
                    {confirmationMsg}
                  </div>
                )}
              </div>
            </div>

            {/* Parent : choix enfant (si besoin, en dessous de la carte sticky) */}
            {currentRole === "parent" && (
              <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
                <label className="block text-sm font-semibold text-slate-700 mb-1">Qui est l’élève ?</label>
                <select
                  className="w-full border rounded-xl px-3 py-2"
                  value={selectedStudentId || meUid || ""}
                  onChange={(e) => setSelectedStudentId(e.target.value)}
                >
                  {meUid && <option value={meUid}>Moi (parent)</option>}
                  {children.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.full_name || k.fullName || k.name || "Enfant"}
                    </option>
                  ))}
                </select>

                <p className="text-xs text-gray-500 mt-2">
                  Les créneaux en rouge sont indisponibles pour l’élève sélectionné.
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Modal de réservation */}
      {(!isTeacherUser && !isOwnProfile) && showBooking && (
        <BookingModal
          availability={teacher.availability || {}}
          bookedSlots={bookedSlots}
          remainingBySlot={remainingBySlot}
          onBook={handleBooking}
          onClose={() => setShowBooking(false)}
          orderDays={DAYS_ORDER}
          multiSelect={true}
          requiredCount={packHours > 1 ? packHours : null}
          canBook={canBook}
          // Optionnel si tu veux la pastille “mes enfants” dans la grille :
          myStudentIds={children.map(c => c.id)}
          idToName={Object.fromEntries(children.map(c => [c.id, c.full_name || c.fullName || c.name || 'Enfant']))}
        />
      )}
    </div>
  );
}