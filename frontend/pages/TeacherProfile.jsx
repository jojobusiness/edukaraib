import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { auth, db } from '../lib/firebase';
import {
  doc, getDoc, collection, query, where, getDocs, addDoc, updateDoc,
  serverTimestamp, arrayUnion,
} from 'firebase/firestore';
import BookingModal from '../components/BookingModal';

// --- helper: recharge les créneaux pris/occupés (confirmés, bookés, ou groupes avec participants)
async function refreshBookedSlots(teacherId, setBookedSlots) {
  const lessonsQ = query(collection(db, 'lessons'), where('teacher_id', '==', teacherId));
  const lessonsSnap = await getDocs(lessonsQ);

  const full = new Map();
  lessonsSnap.docs.forEach((docu) => {
    const l = docu.data();
    if (!l.slot_day && l.slot_hour == null) return;
    const key = `${l.slot_day}|${l.slot_hour}`;

    // rouge si: confirmé OU en attente 'booked' OU groupe avec ≥1 participant
    const isConfirmedOrBooked = l.status === 'confirmed' || l.status === 'booked';
    const hasAnyGroupParticipant = Array.isArray(l.participant_ids) && l.participant_ids.length > 0;

    if (isConfirmedOrBooked || (l.is_group && hasAnyGroupParticipant)) {
      full.set(key, true);
    }
  });

  setBookedSlots(
    Array.from(full.keys()).map((k) => {
      const [day, hour] = k.split('|');
      return { day, hour: Number(hour) };
    })
  );
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

  const [bookedSlots, setBookedSlots] = useState([]); // [{day,hour}] déjà pleins
  const [showBooking, setShowBooking] = useState(false);
  const [isBooking, setIsBooking] = useState(false);
  const [confirmationMsg, setConfirmationMsg] = useState('');

  const [currentRole, setCurrentRole] = useState(null); // 'student' | 'teacher' | 'parent'
  const [children, setChildren] = useState([]);
  const [selectedStudentId, setSelectedStudentId] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const snap = await getDoc(doc(db, 'users', teacherId));
      if (!cancelled && snap.exists()) setTeacher({ ...snap.data(), id: teacherId });

      const qReviews = query(collection(db, 'reviews'), where('teacher_id', '==', teacherId));
      const rSnap = await getDocs(qReviews);
      if (!cancelled) setReviews(rSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      // slots occupés (confirmés, réservés, ou groupes complets)
      await refreshBookedSlots(teacherId, setBookedSlots);
      
    })();
    return () => { cancelled = true; };
  }, [teacherId]);

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
          // On tente d'abord dans users
          const u = await getDoc(doc(db, 'users', id));
          if (u.exists()) {
            const ux = u.data();
            return [id, { name: pickDisplayName(ux) || 'Utilisateur', avatar: pickAvatar(ux) || '' }];
          }
        } catch {}
        try {
          // Puis dans students (si l'avis a été laissé avec un compte élève distinct)
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
  const isParent = currentRole === 'parent';

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
      // rafraîchir l'état visuel des créneaux (rouge)
      try { await refreshBookedSlots(teacherId, setBookedSlots); } catch {}
      return;
    }

    const me = auth.currentUser;
    const targetStudentId = selectedStudentId || me.uid;
    const bookingFor = currentRole === 'parent' && targetStudentId !== me.uid ? 'child' : 'self';

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

      // ✅ rafraîchir immédiatement les créneaux pris (pour l'affichage en rouge)
      try { await refreshBookedSlots(teacherId, setBookedSlots); } catch {}
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

          <div className="flex items-center gap-2 mb-1">
            <span className="text-yellow-500 text-lg">
              {avgRating ? '★'.repeat(Math.round(avgRating)) : '—'}
            </span>
            <span className="font-bold text-gray-700">
              {avgRating ? `${avgRating} / 5` : 'Pas de note'}
            </span>
            <span className="text-xs text-gray-400">({reviews.length} avis)</span>
          </div>

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
                Chaque demande sera <b>validée par le professeur</b> avant confirmation.
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
            // ✅ accepte un tableau de slots OU un slot unique
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