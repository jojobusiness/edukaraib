import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { auth, db } from '../lib/firebase';
import {
  doc, getDoc, collection, query, where, getDocs, addDoc, updateDoc,
  serverTimestamp, arrayUnion, onSnapshot, deleteField,
} from 'firebase/firestore';
import BookingModal from '../components/BookingModal';

function computeBookedAndRemaining(lessonsDocs, teacherDoc, forStudentId) {
  const bySlot = new Map();
  lessonsDocs.forEach((docu) => {
    const l = docu.data();
    if (!l.slot_day && l.slot_hour == null) return;
    const key = `${l.slot_day}|${l.slot_hour}`;
    if (!bySlot.has(key)) bySlot.set(key, { individuals: [], groups: [] });
    if (l.is_group) bySlot.get(key).groups.push({ id: docu.id, ...l });
    else bySlot.get(key).individuals.push({ id: docu.id, ...l });
  });
  const blocked = [];
  const remainingMap = {};
  const teacherGroupEnabled = !!teacherDoc?.group_enabled;
  const teacherDefaultCap =
    typeof teacherDoc?.group_capacity === 'number' && teacherDoc.group_capacity > 1
      ? Math.floor(teacherDoc.group_capacity)
      : 1;

  for (const [key, { individuals, groups }] of bySlot.entries()) {
    const [day, hourStr] = key.split('|');
    const hour = Number(hourStr);
    const label = `${day}:${hour}`;

    // Helper: statut "actif" (= occupe une place) si pas rejeté/supprimé
    const isActive = (s) =>
      !['rejected','removed','deleted'].includes(String(s || '').toLowerCase());

    // --- NOUVEAU: regarder si l'enfant courant est déjà "actif" sur un individuel de ce créneau
    let childActiveOnIndividual = false;
    let anyActiveIndividual = false;

    for (const l of individuals) {
      const ownerSid =
        l?.student_id ||
        (Array.isArray(l?.participant_ids) && l.participant_ids.length === 1
          ? l.participant_ids[0]
          : null);

      // statut de l'élève propriétaire
      const st = ownerSid
        ? (l?.participantsMap?.[ownerSid]?.status ?? l?.status ?? 'booked')
        : (l?.status ?? 'booked');

      if (isActive(st)) {
        anyActiveIndividual = true;
        // si l'individuel "actif" appartient à l'enfant sélectionné, bloquer POUR LUI
        if (forStudentId && ownerSid === forStudentId) {
          childActiveOnIndividual = true;
        }
      }
    }

    // 👉 Cas 1: l'enfant courant est déjà pris en individuel (pending/accepted/confirmed)
    // => on BLOQUE pour l'enfant (badge "pris" dans l'UI)
    if (childActiveOnIndividual) {
      blocked.push({ day, hour });
      // on continue pour publier quand même les places restantes si groupe activé (voir plus bas)
    }

    // 👉 Cas 2: aucun individuel actif pour l'enfant, mais au moins un individuel actif existe
    // - si le prof autorise les groupes (capacité > 1), on NE bloque PAS globalement,
    //   on publie la capacité restante théorique = cap défaut - 1
    // - sinon, on bloque le créneau (comportement historique)
    const teacherGroupEnabled = !!teacherDoc?.group_enabled;
    const teacherDefaultCap =
      typeof teacherDoc?.group_capacity === 'number' && teacherDoc.group_capacity > 1
        ? Math.floor(teacherDoc.group_capacity)
        : 1;

    if (anyActiveIndividual && !childActiveOnIndividual) {
      if (teacherGroupEnabled && teacherDefaultCap > 1) {
        const capLeft = Math.max(0, teacherDefaultCap - 1);
        if (capLeft > 0) {
          remainingMap[label] = Math.max(remainingMap[label] || 0, capLeft);
        }
        // pas de blocked ici → les autres peuvent rejoindre
      } else {
        blocked.push({ day, hour });
      }
    }

    if (groups.length > 0) {
      // 1) Calculer la capacité restante globale pour l’affichage (toujours)
      let slotRemaining = 0;
      let hasAnyAvailableGroup = false;

      groups.forEach((g) => {
        const cap = Number(g.capacity || 0) > 0
          ? Number(g.capacity)
          : (teacherDefaultCap > 1 ? teacherDefaultCap : 1);

        const ids = Array.isArray(g.participant_ids) ? g.participant_ids : [];
        const pm  = g.participantsMap || {};

        // participants “actifs” = pas rejected/removed/deleted (=> pending inclus)
        let occupied = 0;
        const uniq = new Set(ids); // garde-fou anti-doublons
        uniq.forEach((sid) => {
          const st = String(pm?.[sid]?.status || 'pending').toLowerCase();
          if (!['rejected','removed','deleted'].includes(st)) occupied += 1;
        });

        const remains = Math.max(0, cap - occupied);
        if (remains > 0) {
          hasAnyAvailableGroup = true;
          slotRemaining = Math.max(slotRemaining, remains); // on garde le MAX
        }
      });

      // 2) Écrire la capacité restante SI dispo
      if (hasAnyAvailableGroup) {
        remainingMap[label] = slotRemaining;
      }

      // 3) Puis décider si le créneau est “bloqué” pour l’enfant sélectionné
      const childAlreadyIn = !!forStudentId && groups.some((g) => {
        const ids = Array.isArray(g.participant_ids) ? g.participant_ids : [];
        if (!ids.includes(forStudentId)) return false;
        const st = String(g.participantsMap?.[forStudentId]?.status || 'pending').toLowerCase();
        return !['removed','deleted','rejected'].includes(st); // pending/accepted/confirmed bloquent
      });

      if (!hasAnyAvailableGroup) {
        // pas de place nulle part
        blocked.push({ day, hour });
      } else if (childAlreadyIn) {
        // l’enfant a déjà une place “active” → on bloque POUR LUI,
        // mais on a quand même mis remainingMap[label] pour l’affichage global
        blocked.push({ day, hour });
      }

      continue;
    }
  }

  return { blocked, remainingMap };
}

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
        setBookMode('presentiel'); // défaut
      } else {
        setTeacher(null);
      }
    });
    return () => unsubTeacher();
  }, [teacherId]);

  // Avis
  useEffect(() => {
    const qReviews = query(collection(db, 'reviews'), where('teacher_id', '==', teacherId));
    const unsub = onSnapshot(qReviews, (snap) => {
      setReviews(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [teacherId]);

  // Dispos + blocs
  useEffect(() => {
    if (!teacher) return;
    const qLessons = query(collection(db, 'lessons'), where('teacher_id', '==', teacherId));
    const unsubLessons = onSnapshot(qLessons, (snap) => {
      const { blocked, remainingMap } = computeBookedAndRemaining(
        snap.docs,
        teacher,
        selectedStudentId || auth.currentUser?.uid || null // ← enfant choisi en priorité
      );
      const fill = { ...remainingMap };
      const defCap =
        teacher?.group_enabled && Number(teacher?.group_capacity) > 1
          ? Math.floor(Number(teacher.group_capacity))
          : 1;

      const avail = teacher?.availability || {};
      Object.entries(avail).forEach(([day, hours]) => {
        (hours || []).forEach((h) => {
          const key = `${day}:${h}`;
          const isBlocked = blocked.some((b) => b.day === day && b.hour === h);
          if (!fill[key] && !isBlocked) {
            fill[key] = defCap;
          }
        });
      });

      setBookedSlots(blocked);
      setRemainingBySlot(fill);
    });

    return () => unsubLessons();
  }, [teacherId, teacher, selectedStudentId]);

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
            where("is_group", "==", false),
            where("student_id", "==", targetStudentId)
          );
          const dupGrpQ = query(
            collection(db, "lessons"),
            where("teacher_id", "==", teacherId),
            where("slot_day", "==", slot.day),
            where("slot_hour", "==", slot.hour),
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

          const isPack = (packHours === 5 || packHours === 10);
          const createAsGroup = allowGroup; // ta logique déjà en place

          const newLessonRef = await addDoc(collection(db, 'lessons'), {
            teacher_id: teacherId,
            status: 'booked',
            created_at: serverTimestamp(),
            subject_id: Array.isArray(teacher?.subjects) ? teacher.subjects.join(', ') : (teacher?.subjects || ''),
            price_per_hour: hourly || 0,
            slot_day: slot.day,
            slot_hour: slot.hour,

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
          await updateDoc(newLessonRef, {
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

  if (!teacher) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="max-w-xl mx-auto bg-white p-6 rounded-xl shadow text-center">
          Chargement…
        </div>
      </div>
    );
  }

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

  // —————————— UI / style inspiré Superprof ——————————
  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-white via-gray-50 to-gray-100">
      {/* Header visuel */}
      <div className="relative bg-primary/5 border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 py-10 md:py-14">
          <div className="flex items-start gap-4">
            <img
              src={teacher.avatarUrl || teacher.avatar_url || teacher.photoURL || '/avatar-default.png'}
              alt={teacher.fullName || 'Prof'}
              className="w-24 h-24 md:w-28 md:h-28 rounded-2xl object-cover border-2 border-primary shadow"
            />
            <div className="min-w-0">
              <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900">
                {teacher.fullName || teacher.name || 'Professeur'}
              </h1>
              <div className="mt-1 text-slate-700">
                {Array.isArray(teacher.subjects) ? teacher.subjects.join(', ') : teacher.subjects || 'Matière non précisée'}
              </div>
              <div className="mt-1 text-sm text-slate-500">{teacher.location || teacher.city || ''}</div>
              {teacher.bio && (
                <p className="mt-3 text-slate-700 max-w-2xl">{teacher.bio}</p>
              )}
              {/* Tarifs en badges */}
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-1.5 text-sm shadow-sm">
                  Présentiel : <b>{displayHourPresentiel != null ? `${displayHourPresentiel.toFixed(2)} € / h` : '—'}</b>
                </span>
                <span className="inline-flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-1.5 text-sm shadow-sm">
                  Visio : <b>{teacher.visio_enabled ? `${displayHourVisio.toFixed(2)} € / h` : 'Non proposé'}</b>
                </span>
                <span className="inline-flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-1.5 text-sm shadow-sm">
                  Pack 5h (présentiel) : <b>{displayPack5Presentiel != null ? `${displayPack5Presentiel.toFixed(2)} €` : '—'}</b>
                </span>
                <span className="inline-flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-1.5 text-sm shadow-sm">
                  Pack 10h (présentiel) : <b>{displayPack10Presentiel != null ? `${displayPack10Presentiel.toFixed(2)} €` : '—'}</b>
                </span>
                {teacher.visio_enabled && (
                  <>
                    <span className="inline-flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-1.5 text-sm shadow-sm">
                      Pack 5h (visio) : <b>{displayPack5Visio != null ? `${displayPack5Visio.toFixed(2)} €` : '—'}</b>
                    </span>
                    <span className="inline-flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-1.5 text-sm shadow-sm">
                      Pack 10h (visio) : <b>{displayPack10Visio != null ? `${displayPack10Visio.toFixed(2)} €` : '—'}</b>
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Choix rapide (mode + pack) */}
          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Mode</label>
              <select
                className="w-full border rounded-xl px-3 py-2"
                value={bookMode}
                onChange={(e) => setBookMode(e.target.value)}
              >
                <option value="presentiel">Présentiel</option>
                {teacher.visio_enabled && <option value="visio">Visio</option>}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Pack</label>
              <select
                className="w-full border rounded-xl px-3 py-2"
                value={packHours}
                onChange={(e) => setPackHours(Number(e.target.value))}
              >
                <option value={1}>1h (à l’unité)</option>
                <option value={5}>5h (Pack)</option>
                <option value={10}>10h (Pack)</option>
              </select>
            </div>
            <div className="flex items-end">
              <div className="text-sm text-slate-700">
                {packHours === 5 && (
                  <>Total pack 5h : <b>{(
                    (bookMode === 'visio' ? displayPack5Visio : displayPack5Presentiel)
                    ?? 0
                  ).toFixed(2)} €</b></>
                )}
                {packHours === 10 && (
                  <>Total pack 10h : <b>{(
                    (bookMode === 'visio' ? displayPack10Visio : displayPack10Presentiel)
                    ?? 0
                  ).toFixed(2)} €</b></>
                )}
                {packHours === 1 && (
                  <>Tarif : <b>{(
                    (bookMode === 'visio' ? displayHourVisio : displayHourPresentiel)
                    ?? 0
                  ).toFixed(2)} €</b> / h</>
                )}
              </div>
            </div>
          </div>

          {/* CTA */}
          <div className="mt-4 flex items-center gap-3">
            {(!isTeacherUser && !isOwnProfile) && (
              <button
                className="bg-primary text-white px-5 py-3 rounded-xl font-semibold shadow hover:bg-primary-dark transition"
                onClick={() => {
                  if (!auth.currentUser) return navigate('/login');
                  setShowBooking(true);
                  setConfirmationMsg('');
                }}
              >
                {isBooking ? 'Envoi…' : 'Réserver des créneaux'}
              </button>
            )}
            {!isOwnProfile && (
              <button
                className="bg-yellow-400 text-slate-900 px-5 py-3 rounded-xl font-semibold shadow hover:bg-yellow-500 transition"
                onClick={() => {
                  if (!auth.currentUser) return navigate('/login');
                  navigate(`/chat/${teacherId}`);
                }}
              >
                Contacter le professeur
              </button>
            )}
          </div>

          {confirmationMsg && (
            <div className="mt-3 bg-amber-50 border border-amber-200 text-amber-800 px-4 py-2 rounded-xl text-sm">
              {confirmationMsg}
            </div>
          )}
        </div>
      </div>

      {/* Corps de page : sections nettes façon fiche Superprof */}
      <div className="max-w-5xl mx-auto px-4 py-10 grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Colonne principale */}
        <div className="lg:col-span-2 space-y-8">
          {/* À propos du cours */}
          {(teacher.about_course || teacher.about_me) && (
            <section className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6">
              <h2 className="text-xl md:text-2xl font-extrabold text-slate-900">À propos du cours</h2>
              <div className="mt-3 text-slate-700 leading-relaxed whitespace-pre-line">
                {teacher.about_course || "Le professeur n’a pas encore renseigné la description détaillée du cours."}
              </div>

              {teacher.about_me && (
                <>
                  <hr className="my-6 border-gray-100" />
                  <h3 className="text-lg font-bold text-slate-900">À propos de moi</h3>
                  <p className="mt-2 text-slate-700 whitespace-pre-line">
                    {teacher.about_me}
                  </p>
                </>
              )}
            </section>
          )}

          {/* Avis */}
          <section className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6">
            <h2 className="text-xl md:text-2xl font-extrabold text-slate-900 mb-4">Avis</h2>
            <div className="flex flex-col gap-3">
              {reviews.length === 0 && (
                <div className="text-gray-400 text-sm">Aucun avis pour ce professeur.</div>
              )}

              {reviews.map((r) => {
                const rid = getReviewerId(r);
                const info = (rid && reviewerInfo[rid]) || {};
                const name = info.name || 'Utilisateur';
                const avatar = info.avatar || '/avatar-default.png';
                const rating = r.rating || 0;
                return (
                  <div key={r.id} className="bg-gray-50 border rounded-xl px-4 py-3">
                    <div className="flex items-center gap-3 mb-2">
                      <img src={avatar} alt={name} className="w-9 h-9 rounded-full object-cover border" />
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold text-gray-800">{name}</span>
                        {r.created_at?.toDate && (
                          <span className="text-xs text-gray-400">
                            {r.created_at.toDate().toLocaleDateString('fr-FR')}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-yellow-500">{'★'.repeat(Math.min(5, Math.max(0, Math.round(rating))))}</span>
                      <span className="italic text-gray-700">{r.comment}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* Colonne latérale : infos pratiques */}
        <aside className="space-y-6">
          {currentRole === 'parent' && (
            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6">
              <label className="block text-sm font-semibold text-slate-700 mb-1">Qui est l’élève ?</label>
              <select
                className="w-full border rounded-xl px-3 py-2"
                value={selectedStudentId || meUid || ''}
                onChange={(e) => setSelectedStudentId(e.target.value)}
              >
                {meUid && <option value={meUid}>Moi (parent)</option>}
                {children.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.full_name || k.fullName || k.name || 'Enfant'}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-2">
                Les créneaux en rouge sont indisponibles pour l’élève sélectionné.
              </p>
            </div>
          )}

          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6">
            <h3 className="text-lg font-bold text-slate-900">Modes proposés</h3>
            <ul className="mt-2 space-y-2 text-sm text-slate-700">
              <li>• Présentiel : {teacher.presentiel_enabled ? 'Oui' : 'Non'}</li>
              <li>• Visio : {teacher.visio_enabled ? 'Oui' : 'Non'}</li>
            </ul>
            <hr className="my-4 border-gray-100" />
            <h4 className="text-sm font-semibold text-slate-900">Tarifs</h4>
            <div className="mt-2 text-sm text-slate-700 space-y-1">
              <div>Présentiel : <b>{displayHourPresentiel != null ? `${displayHourPresentiel.toFixed(2)} € / h` : '—'}</b></div>
              <div>Visio : <b>{teacher.visio_enabled ? `${displayHourVisio.toFixed(2)} € / h` : '—'}</b></div>

              <div>Pack 5h (présentiel) : <b>{displayPack5Presentiel != null ? `${displayPack5Presentiel.toFixed(2)} €` : '—'}</b></div>
              <div>Pack 10h (présentiel) : <b>{displayPack10Presentiel != null ? `${displayPack10Presentiel.toFixed(2)} €` : '—'}</b></div>

              {teacher.visio_enabled && (
                <>
                  <div>Pack 5h (visio) : <b>{displayPack5Visio != null ? `${displayPack5Visio.toFixed(2)} €` : '—'}</b></div>
                  <div>Pack 10h (visio) : <b>{displayPack10Visio != null ? `${displayPack10Visio.toFixed(2)} €` : '—'}</b></div>
                </>
              )}
            </div>
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
        />
      )}
    </div>
  );
}