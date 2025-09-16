import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { auth, db } from '../lib/firebase';
import {
  doc, getDoc, collection, query, where, getDocs, addDoc, updateDoc,
  serverTimestamp, arrayUnion,
} from 'firebase/firestore';
import BookingModal from '../components/BookingModal';

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

export default function TeacherProfile() {
  const { teacherId } = useParams();
  const navigate = useNavigate();

  const [teacher, setTeacher] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [bookedSlots, setBookedSlots] = useState([]); // [{day,hour}] déjà pleins
  const [showBooking, setShowBooking] = useState(false);
  const [isBooking, setIsBooking] = useState(false);
  const [booked, setBooked] = useState(false);
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
      if (!cancelled) setReviews(rSnap.docs.map((d) => d.data()));

      // slots occupés (confirmés ou groupes complets seulement)
      const lessonsQ = query(collection(db, 'lessons'), where('teacher_id', '==', teacherId));
      const lessonsSnap = await getDocs(lessonsQ);
      const full = new Map();
      lessonsSnap.docs.forEach((docu) => {
        const l = docu.data();
        if (!l.slot_day && l.slot_hour == null) return;
        if (!l.is_group) {
          if (l.status === 'confirmed') full.set(`${l.slot_day}|${l.slot_hour}`, true);
        } else {
          const cap = Number(l.capacity || 0);
          if (cap > 0 && countAccepted(l) >= cap) full.set(`${l.slot_day}|${l.slot_hour}`, true);
        }
      });
      setBookedSlots(Array.from(full.keys()).map(k => {
        const [day, hour] = k.split('|');
        return { day, hour: Number(hour) };
      }));
    })();
    return () => { cancelled = true; };
  }, [teacherId]);

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

  // ————— Réservation : TOUJOURS une demande à valider par le prof —————
  const handleBookingSlot = async (slot) => {
    if (!auth.currentUser) return navigate('/login');

    const me = auth.currentUser;
    const targetStudentId = selectedStudentId || me.uid;
    const bookingFor = isParent && targetStudentId !== me.uid ? 'child' : 'self';

    setIsBooking(true);
    setConfirmationMsg('');
    try {
      // 🔒 0) Anti-doublon global au même créneau (groupe OU individuel)
      //    - même prof, même slot_day + slot_hour, même enfant/parent
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
          // Si l'élève est présent et pas explicitement supprimé/rejeté
          return st !== 'removed' && st !== 'deleted' && st !== 'rejected';
        });

      if (hasDup) {
        setBooked(true);
        setShowBooking(false);
        setConfirmationMsg(`Tu es déjà inscrit(e) sur ce créneau (${slot.day} ${slot.hour}h) pour ce professeur.`);
        return;
      }

      // 1) Rejoindre un groupe existant à ce créneau → élève en attente (avec garde anti-doublon local)
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
          setBooked(true);
          setShowBooking(false);
          setConfirmationMsg(`Une participation existe déjà (${slot.day} ${slot.hour}h).`);
          return;
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
        setBooked(true);
        setShowBooking(false);
        setConfirmationMsg(`Demande envoyée au professeur pour ${slot.day} à ${slot.hour}h.`);
        return;
      }

      // 2) Pas de groupe à ce créneau → créer une DEMANDE (jamais auto-acceptée)
      const groupEnabled = !!teacher?.group_enabled;
      const defaultCap =
        typeof teacher?.group_capacity === 'number' && teacher.group_capacity > 1
          ? Math.floor(teacher.group_capacity)
          : 1;

      if (groupEnabled && defaultCap > 1) {
        // Nouveau groupe, élève en attente
        const newDoc = await addDoc(collection(db, 'lessons'), {
          teacher_id: teacherId,
          student_id: null,
          parent_id: bookingFor === 'child' ? me.uid : null,
          booked_by: me.uid,
          booked_for: bookingFor,
          status: 'booked',           // ⇐ à valider
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
      } else {
        // Individuel → leçon “booked” (prof doit confirmer)
        const newDoc = await addDoc(collection(db, 'lessons'), {
          teacher_id: teacherId,
          student_id: targetStudentId,
          parent_id: bookingFor === 'child' ? me.uid : null,
          booked_by: me.uid,
          booked_for: bookingFor,
          status: 'booked',           // ⇐ à valider
          created_at: serverTimestamp(),
          subject_id: Array.isArray(teacher?.subjects) ? teacher.subjects.join(', ') : teacher?.subjects || '',
          price_per_hour: teacher?.price_per_hour || 0,
          slot_day: slot.day,
          slot_hour: slot.hour,
          is_group: false,
          capacity: 1,
          participant_ids: [],
          participantsMap: {},        // (confirmation au niveau du cours)
        });
        await addDoc(collection(db, 'notifications'), {
          user_id: teacherId, read: false, created_at: serverTimestamp(),
          type: 'lesson_request', lesson_id: newDoc.id, requester_id: targetStudentId,
          message: `Demande de cours individuel (${slot.day} ${slot.hour}h).`,
        });
      }

      setBooked(true);
      setShowBooking(false);
      setConfirmationMsg(`Demande envoyée. Le professeur doit valider la réservation.`);
    } catch (e) {
      console.error('Booking error', e);
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
            disabled={isBooking || booked}
            onClick={() => {
              if (!auth.currentUser) return navigate('/login');
              setShowBooking(true);
              setConfirmationMsg('');
            }}
          >
            {booked ? 'Demande envoyée' : isBooking ? 'Envoi…' : 'Réserver un cours'}
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
            onBook={handleBookingSlot}
            onClose={() => setShowBooking(false)}
            orderDays={DAYS_ORDER}
          />
        )}

        <h3 className="text-lg font-bold text-secondary mt-6 mb-3">Avis</h3>
        <div className="flex flex-col gap-3">
          {reviews.length === 0 && <div className="text-gray-400 text-sm">Aucun avis pour ce professeur.</div>}
          {reviews.map((r, idx) => (
            <div key={idx} className="bg-gray-50 border rounded-xl px-4 py-3">
              <span className="text-yellow-500 mr-2">{'★'.repeat(r.rating || 0)}</span>
              <span className="italic">{r.comment}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}