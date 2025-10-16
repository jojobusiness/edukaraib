import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { auth, db } from '../lib/firebase';
import {
  doc, getDoc, collection, query, where, getDocs, addDoc, updateDoc,
  serverTimestamp, arrayUnion,
} from 'firebase/firestore';
import BookingModal from '../components/BookingModal';

/**
 * Recalcule les créneaux "bloqués" (rouges) ET les "places restantes" pour un professeur,
 * en tenant compte :
 *  - des cours individuels (toujours bloquants s’ils ne sont pas rejetés),
 *  - des groupes : un créneau N’EST BLOQUÉ que si TOUS les groupes à cette heure sont pleins,
 *    ou si l’enfant (forStudentId) est déjà dans un des groupes de ce créneau.
 *  - si aucun groupe n’existe mais que le prof autorise les groupes (capacité > 1),
 *    on considère qu’un groupe peut être créé => places restantes = capacité par défaut.
 *  - si le créneau est bloqué pour l’enfant (déjà inscrit), on n’affiche pas de badge.
 *
 * @param {string} teacherId
 * @param {(slots: Array<{day: string, hour: number}>) => void} setBookedSlots
 * @param {{ forStudentId?: string, teacherDoc?: any, setRemainingBySlot?: Function }} opts
 */
async function refreshBookedSlots(teacherId, setBookedSlots, opts = {}) {
  const { forStudentId = null, teacherDoc = null, setRemainingBySlot = null } = opts;

  const lessonsQ = query(collection(db, 'lessons'), where('teacher_id', '==', teacherId));
  const lessonsSnap = await getDocs(lessonsQ);
  const bySlot = new Map(); // key: "day|hour" -> { individuals: [], groups: [] }

  lessonsSnap.docs.forEach((docu) => {
    const l = docu.data();
    if (!l.slot_day && l.slot_hour == null) return;
    const key = `${l.slot_day}|${l.slot_hour}`;
    if (!bySlot.has(key)) bySlot.set(key, { individuals: [], groups: [] });
    if (l.is_group) bySlot.get(key).groups.push({ id: docu.id, ...l });
    else bySlot.get(key).individuals.push({ id: docu.id, ...l });
  });

  const blocked = [];
  const remainingMap = {}; // 'Lun:10' -> nb places

  // valeurs par défaut prof (pour autoriser la création d’un nouveau groupe si aucun n’existe)
  const teacherGroupEnabled = !!teacherDoc?.group_enabled;
  const teacherDefaultCap =
    typeof teacherDoc?.group_capacity === 'number' && teacherDoc.group_capacity > 1
      ? Math.floor(teacherDoc.group_capacity)
      : 1;

  for (const [key, { individuals, groups }] of bySlot.entries()) {
    const [day, hourStr] = key.split('|');
    const hour = Number(hourStr);
    const label = `${day}:${hour}`;

    // 1) INDIVIDUELS : s’il y a un cours individuel non rejeté => créneau bloqué
    const indivBlocks = individuals.some((l) => {
      const st = String(l.status || 'booked');
      return st !== 'rejected' && st !== 'deleted';
    });
    if (indivBlocks) {
      blocked.push({ day, hour });
      // pas de badge “places restantes” dans ce cas
      continue;
    }

    // 2) GROUPES EXISTANTS
    if (groups.length > 0) {
      // a) si l’enfant sélectionné est DÉJÀ dans un des groupes de ce créneau (non removed/rejected) => bloqué pour lui
      const childAlreadyIn = !!forStudentId && groups.some((g) => {
        const ids = Array.isArray(g.participant_ids) ? g.participant_ids : [];
        if (!ids.includes(forStudentId)) return false;
        const st = String(g.participantsMap?.[forStudentId]?.status || 'pending');
        return !['removed', 'deleted', 'rejected'].includes(st);
      });
      if (childAlreadyIn) {
        blocked.push({ day, hour });
        // pas de badge pour un créneau bloqué par appartenance
        continue;
      }

      // b) somme des places restantes parmi tous les groupes de ce créneau
      let totalRemaining = 0;
      let hasRoomSomewhere = false;

      groups.forEach((g) => {
        const capacity = Number(g.capacity || 0) > 0 ? Number(g.capacity) : (teacherDefaultCap > 1 ? teacherDefaultCap : 1);
        const ids = Array.isArray(g.participant_ids) ? g.participant_ids : [];
        const pm = g.participantsMap || {};
        let accepted = 0;
        ids.forEach((sid) => {
          const st = pm?.[sid]?.status;
          if (st === 'accepted' || st === 'confirmed') accepted += 1;
        });
        const remains = Math.max(0, capacity - accepted);
        if (remains > 0) hasRoomSomewhere = true;
        totalRemaining += remains;
      });

      if (!hasRoomSomewhere) {
        // tous les groupes sont pleins -> créneau bloqué
        blocked.push({ day, hour });
      } else if (totalRemaining > 0) {
        // on affiche la somme des places restantes sur l’ensemble des groupes de ce créneau
        remainingMap[label] = totalRemaining;
      }
      continue;
    }

    // 3) AUCUN GROUPE EXISTANT :
    //    - si le prof a activé les groupes et capacité > 1, on autorise la création d’un groupe => places restantes = capacité par défaut
    if (teacherGroupEnabled && teacherDefaultCap > 1) {
      remainingMap[label] = teacherDefaultCap;
      // créneau non bloqué (on pourrait créer un groupe)
      continue;
    }

    // 4) sinon: pas de groupe permis → pas de badge; le créneau reste dispo si pas d'individuel (déjà géré plus haut)
  }

  setBookedSlots(blocked);
  if (typeof setRemainingBySlot === 'function') {
    setRemainingBySlot(remainingMap);
  }
}

const DAYS_ORDER = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function countAccepted(l) {
  const pm = l.participantsMap || {};
  const ids = Array.isArray(l.participant_ids) ? l.participant_ids : [];
  let accepted = 0;
  for (const id of ids) {
    const st = pm?.[id]?.status;
    if (st === 'accepted' || st === 'confirmed') accepted += 1;
  }
  return accepted;
}

// Helpers pour afficher le nom / avatar d'un utilisateur ou élève
function pickDisplayName(x = {}) {
  return (
    x.fullName ||
    x.full_name ||
    x.name ||
    x.displayName ||
    [x.first_name, x.last_name].filter(Boolean).join(' ') ||
    (x.profile && (x.profile.full_name || x.profile.name)) ||
    ''
  );
}
function pickAvatar(x = {}) {
  return x.avatarUrl || x.avatar_url || x.photoURL || (x.profile && x.profile.avatar) || '';
}
// Renvoie l'ID du rédacteur de l'avis, selon les champs possibles
function getReviewerId(r = {}) {
  return r.reviewer_id || r.author_id || r.user_id || r.student_id || r.created_by || null;
}

export default function TeacherProfile() {
  const { teacherId } = useParams();
  const navigate = useNavigate();

  const [teacher, setTeacher] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [reviewerInfo, setReviewerInfo] = useState({}); // { reviewerId: {name, avatar} }

  const [bookedSlots, setBookedSlots] = useState([]); // [{day,hour}] bloqués (rouges)
  const [remainingBySlot, setRemainingBySlot] = useState({}); // {'Lun:10': 2, ...} badges places restantes

  const [showBooking, setShowBooking] = useState(false);
  const [isBooking, setIsBooking] = useState(false);
  const [confirmationMsg, setConfirmationMsg] = useState('');

  const [currentRole, setCurrentRole] = useState(null); // 'student' | 'teacher' | 'parent'
  const [children, setChildren] = useState([]);
  const [selectedStudentId, setSelectedStudentId] = useState('');

  // Charger prof + avis
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const snap = await getDoc(doc(db, 'users', teacherId));
      if (!cancelled && snap.exists()) setTeacher({ ...snap.data(), id: teacherId });

      const qReviews = query(collection(db, 'reviews'), where('teacher_id', '==', teacherId));
      const rSnap = await getDocs(qReviews);
      if (!cancelled) setReviews(rSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    })();
    return () => { cancelled = true; };
  }, [teacherId]);

  // Dispos (rouge + badges) : recalcul quand on a le prof, et à chaque changement d’élève sélectionné
  useEffect(() => {
    if (!teacher) return;
    (async () => {
      await refreshBookedSlots(teacherId, setBookedSlots, {
        forStudentId: selectedStudentId || auth.currentUser?.uid || null,
        teacherDoc: teacher,
        setRemainingBySlot, // 👈 met à jour les badges “places restantes”
      });
    })();
  }, [teacher, teacherId, selectedStudentId]);

  // Récupération des infos (nom + avatar) des auteurs des avis
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ids = Array.from(
        new Set(
          reviews
            .map((r) => getReviewerId(r))
            .filter(Boolean)
        )
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
  }, [reviews]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rôle courant + enfants du parent
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const me = auth.currentUser;
      if (!me) return;

      try {
        const meSnap = await getDoc(doc(db, 'users', me.uid));
        const role = meSnap.exists() ? meSnap.data()?.role : null;
        if (!cancelled) setCurrentRole(role || null);
      } catch { if (!cancelled) setCurrentRole(null); }

      try {
        const kidsQ = query(collection(db, 'students'), where('parent_id', '==', me.uid));
        const kidsSnap = await getDocs(kidsQ);
        const kids = kidsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (!cancelled) setChildren(kids);
      } catch { if (!cancelled) setChildren([]); }

      if (!cancelled) setSelectedStudentId((prev) => prev || me.uid);
    })();
    return () => { cancelled = true; };
  }, []);

  const avgRating = useMemo(() => {
    if (!reviews.length) return null;
    const sum = reviews.reduce((acc, r) => acc + (r.rating || 0), 0);
    return (sum / reviews.length).toFixed(1);
  }, [reviews]);

  const meUid = auth.currentUser?.uid;

  /**
   * Réserve 1 seul créneau (utilitaire interne)
   * Retourne { slot, status, message }
   * status: 'duplicate' | 'joined_group' | 'created_group' | 'created_individual' | 'error'
   */
  const bookSingleSlot = async (slot, context) => {
    const { teacherId, teacher, me, bookingFor, targetStudentId } = context;

    // 🔒 Doublon exact sur même créneau (indiv ou groupe)
    const dupIndQ = query(
      collection(db, 'lessons'),
      where('teacher_id', '==', teacherId),
      where('slot_day', '==', slot.day),
      where('slot_hour', '==', slot.hour),
      where('is_group', '==', false),
      where('student_id', '==', targetStudentId)
    );
    const dupGrpQ = query(
      collection(db, 'lessons'),
      where('teacher_id', '==', teacherId),
      where('slot_day', '==', slot.day),
      where('slot_hour', '==', slot.hour),
      where('is_group', '==', true),
      where('participant_ids', 'array-contains', targetStudentId)
    );
    const [dupIndSnap, dupGrpSnap] = await Promise.all([getDocs(dupIndQ), getDocs(dupGrpQ)]);

    const hasDup =
      dupIndSnap.docs.some((d) => (d.data()?.status || 'booked') !== 'rejected') ||
      dupGrpSnap.docs.some((d) => {
        const dat = d.data();
        const st = dat?.participantsMap?.[targetStudentId]?.status;
        return st !== 'removed' && st !== 'deleted' && st !== 'rejected';
      });

    if (hasDup) {
      return {
        slot,
        status: 'duplicate',
        message: `Déjà inscrit(e) sur ${slot.day} ${slot.hour}h.`,
      };
    }

    // 1) Essayer de rejoindre un groupe existant
    const qExisting = query(
      collection(db, 'lessons'),
      where('teacher_id', '==', teacherId),
      where('slot_day', '==', slot.day),
      where('slot_hour', '==', slot.hour),
      where('is_group', '==', true)
    );
    const existSnap = await getDocs(qExisting);
    for (const d of existSnap.docs) {
      const l = d.data();
      const current = Array.isArray(l.participant_ids) ? l.participant_ids : [];
      if (current.includes(targetStudentId)) {
        return { slot, status: 'duplicate', message: `Déjà inscrit(e) sur ${slot.day} ${slot.hour}h.` };
      }
      await updateDoc(doc(db, 'lessons', d.id), {
        participant_ids: arrayUnion(targetStudentId),
        [`participantsMap.${targetStudentId}`]: {
          parent_id: bookingFor === 'child' ? me.uid : null,
          booked_by: me.uid,
          is_paid: false,
          paid_by: null,
          paid_at: null,
          status: 'pending_teacher',
          added_at: serverTimestamp(),
        },
      });
      await addDoc(collection(db, 'notifications'), {
        user_id: teacherId, read: false, created_at: serverTimestamp(),
        type: 'lesson_request', lesson_id: d.id, requester_id: targetStudentId,
        message: `Demande d'ajout au groupe (${slot.day} ${slot.hour}h).`,
      });
      return {
        slot,
        status: 'joined_group',
        message: `Ajout au groupe demandé pour ${slot.day} ${slot.hour}h.`,
      };
    }

    // 2) Créer une demande (groupe ou individuel)
    const groupEnabled = !!teacher?.group_enabled;
    const defaultCap =
      typeof teacher?.group_capacity === 'number' && teacher.group_capacity > 1
        ? Math.floor(teacher.group_capacity)
        : 1;

    if (groupEnabled && defaultCap > 1) {
      // Nouveau groupe
      const newDoc = await addDoc(collection(db, 'lessons'), {
        teacher_id: teacherId,
        student_id: null,
        parent_id: bookingFor === 'child' ? me.uid : null,
        booked_by: me.uid,
        booked_for: bookingFor,
        status: 'booked', // à valider par le prof
        created_at: serverTimestamp(),
        subject_id: Array.isArray(teacher?.subjects) ? teacher.subjects.join(', ') : teacher?.subjects || '',
        price_per_hour: teacher?.price_per_hour || 0,
        slot_day: slot.day,
        slot_hour: slot.hour,
        is_group: true,
        capacity: defaultCap,
        participant_ids: [targetStudentId],
        participantsMap: {
          [targetStudentId]: {
            parent_id: bookingFor === 'child' ? me.uid : null,
            booked_by: me.uid,
            is_paid: false,
            paid_by: null,
            paid_at: null,
            status: 'pending_teacher',
            added_at: serverTimestamp(),
          },
        },
      });
      await addDoc(collection(db, 'notifications'), {
        user_id: teacherId, read: false, created_at: serverTimestamp(),
        type: 'lesson_request', lesson_id: newDoc.id, requester_id: targetStudentId,
        message: `Demande de créer un groupe (${slot.day} ${slot.hour}h).`,
      });
      return {
        slot,
        status: 'created_group',
        message: `Demande de création de groupe pour ${slot.day} ${slot.hour}h.`,
      };
    } else {
      // Individuel
      const newDoc = await addDoc(collection(db, 'lessons'), {
        teacher_id: teacherId,
        student_id: targetStudentId,
        parent_id: bookingFor === 'child' ? me.uid : null,
        booked_by: me.uid,
        booked_for: bookingFor,
        status: 'booked', // à valider par le prof
        created_at: serverTimestamp(),
        subject_id: Array.isArray(teacher?.subjects) ? teacher.subjects.join(', ') : teacher?.subjects || '',
        price_per_hour: teacher?.price_per_hour || 0,
        slot_day: slot.day,
        slot_hour: slot.hour,
        is_group: false,
        capacity: 1,
        participant_ids: [],
        participantsMap: {},
      });
      await addDoc(collection(db, 'notifications'), {
        user_id: teacherId, read: false, created_at: serverTimestamp(),
        type: 'lesson_request', lesson_id: newDoc.id, requester_id: targetStudentId,
        message: `Demande de cours individuel (${slot.day} ${slot.hour}h).`,
      });
      return {
        slot,
        status: 'created_individual',
        message: `Demande de cours individuel pour ${slot.day} ${slot.hour}h.`,
      };
    }
  };

  /**
   * Handler principal : accepte un seul créneau OU un tableau de créneaux.
   * Exemples d'entrée:
   *  - { day: 'Lun', hour: 10 }
   *  - [{ day: 'Lun', hour: 10 }, { day: 'Mar', hour: 14 }]
   */
  const handleBooking = async (selected) => {
    if (!auth.currentUser) return navigate('/login');

    // 🚫 Empêcher un professeur de réserver ses propres cours
    if (teacherId === auth.currentUser.uid) {
      try {
        await refreshBookedSlots(teacherId, setBookedSlots, {
          forStudentId: selectedStudentId || auth.currentUser?.uid || null,
          teacherDoc: teacher,
          setRemainingBySlot, // 👈 met à jour les badges
        });
      } catch {}
      return;
    }

    const me = auth.currentUser;
    const targetStudentId = selectedStudentId || me.uid;
    const bookingFor = (currentRole === 'parent' && targetStudentId !== me.uid) ? 'child' : 'self';

    const slots = Array.isArray(selected) ? selected : [selected];

    setIsBooking(true);
    setConfirmationMsg('');
    try {
      const results = [];
      for (const slot of slots) {
        try {
          const r = await bookSingleSlot(slot, { teacherId, teacher, me, bookingFor, targetStudentId });
          results.push(r);
        } catch (e) {
          console.error('Booking error (single)', e);
          results.push({
            slot,
            status: 'error',
            message: `Erreur sur ${slot.day} ${slot.hour}h.`,
          });
        }
      }

      // Construire un message récapitulatif lisible
      const grouped = {
        created_group: [],
        created_individual: [],
        joined_group: [],
        duplicate: [],
        error: [],
      };
      for (const r of results) {
        const key = grouped[r.status] ? r.status : 'error';
        grouped[key].push(`${r.slot.day} ${r.slot.hour}h`);
      }

      const parts = [];
      if (grouped.created_individual.length)
        parts.push(`Demandes individuelles envoyées : ${grouped.created_individual.join(', ')}.`);
      if (grouped.created_group.length)
        parts.push(`Demandes de création de groupe envoyées : ${grouped.created_group.join(', ')}.`);
      if (grouped.joined_group.length)
        parts.push(`Demandes d'ajout à un groupe envoyées : ${grouped.joined_group.join(', ')}.`);
      if (grouped.duplicate.length)
        parts.push(`Déjà inscrit(e) sur : ${grouped.duplicate.join(', ')}.`);
      if (grouped.error.length)
        parts.push(`Erreurs sur : ${grouped.error.join(', ')}.`);

      setShowBooking(false);
      setConfirmationMsg(parts.length ? parts.join(' ') : "Demandes envoyées.");

      // ✅ rafraîchir immédiatement les créneaux pris + badges POUR L’ÉLÈVE EN COURS
      try {
        await refreshBookedSlots(teacherId, setBookedSlots, {
          forStudentId: targetStudentId,
          teacherDoc: teacher,
          setRemainingBySlot, // 👈
        });
      } catch {}
    } catch (e) {
      console.error('Booking error (batch)', e);
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

  return (
    <div className="min-h-screen flex flex-col items-center bg-gradient-to-br from-white via-gray-100 to-secondary/20 px-4 py-10">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
        <div className="flex flex-col items-center">
          <img
            src={teacher.avatarUrl || teacher.avatar_url || teacher.photoURL || '/avatar-default.png'}
            alt={teacher.fullName || 'Prof'}
            className="w-24 h-24 rounded-full object-cover border-2 border-primary mb-3"
          />

          <h2 className="font-bold text-2xl text-primary mb-2">
            {teacher.fullName || teacher.name || 'Professeur'}
          </h2>

          <div className="text-gray-700 mb-1">
            {Array.isArray(teacher.subjects) ? teacher.subjects.join(', ') : teacher.subjects || 'Matière non précisée'}
          </div>

          <div className="text-xs text-gray-500 mb-1">{teacher.location || teacher.city || ''}</div>
          <div className="text-sm text-gray-600 mb-2 text-center">{teacher.bio}</div>

          <span className="inline-block text-yellow-700 font-semibold mb-4">
            {teacher.price_per_hour !== undefined && teacher.price_per_hour !== null && teacher.price_per_hour !== ''
              ? `${(Number(String(teacher.price_per_hour).replace(',', '.')) + 10).toFixed(2)} € /h`
              : 'Prix non précisé'}
          </span>

          {/* Sélecteur parent: l’élève choisi influe sur les disponibilités */}
          {currentRole === 'parent' && (
            <div className="w-full bg-gray-50 border rounded-lg p-3 mb-4">
              <label className="block text-sm font-semibold text-gray-700 mb-1">Qui est l’élève ?</label>
              <select
                className="w-full border rounded px-3 py-2"
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
              <p className="text-xs text-gray-500 mt-1">
                Les créneaux en rouge sont indisponibles pour l’élève sélectionné (déjà inscrit ou pleins).
                Les pastilles indiquent le nombre de places restantes en groupe.
              </p>
            </div>
          )}

          <button
            className="bg-primary text-white px-6 py-3 rounded-lg font-semibold shadow hover:bg-primary-dark transition mb-4 disabled:opacity-60"
            disabled={isBooking}
            onClick={() => {
              if (!auth.currentUser) return navigate('/login');
              setShowBooking(true);
              setConfirmationMsg('');
            }}
          >
            {isBooking ? 'Envoi…' : 'Réserver un ou plusieurs créneaux'}
          </button>

          {confirmationMsg && (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-2 rounded mb-2 text-sm text-center mt-2">
              {confirmationMsg}
            </div>
          )}
        </div>

        {showBooking && (
          <BookingModal
            availability={teacher.availability || {}}
            bookedSlots={bookedSlots}
            remainingBySlot={remainingBySlot}   
            onBook={handleBooking}
            onClose={() => setShowBooking(false)}
            orderDays={DAYS_ORDER}
            multiSelect={true}
          />
        )}

        <h3 className="text-lg font-bold text-secondary mt-6 mb-3">Avis</h3>
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
                {/* En-tête auteur de l'avis */}
                <div className="flex items-center gap-3 mb-2">
                  <img
                    src={avatar}
                    alt={name}
                    className="w-8 h-8 rounded-full object-cover border"
                  />
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-gray-800">{name}</span>
                    {r.created_at?.toDate && (
                      <span className="text-xs text-gray-400">
                        {r.created_at.toDate().toLocaleDateString('fr-FR')}
                      </span>
                    )}
                  </div>
                </div>

                {/* Note + commentaire */}
                <div className="flex items-start gap-2">
                  <span className="text-yellow-500">{'★'.repeat(Math.min(5, Math.max(0, Math.round(rating))))}</span>
                  <span className="italic text-gray-700">{r.comment}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}