import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { auth, db } from '../lib/firebase';
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  serverTimestamp,
  arrayUnion,
} from 'firebase/firestore';
import BookingModal from '../components/BookingModal';

const DAYS_ORDER = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

export default function TeacherProfile() {
  const { teacherId } = useParams();
  const navigate = useNavigate();

  // UI / data
  const [teacher, setTeacher] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [bookedSlots, setBookedSlots] = useState([]); // [{day, hour}] pour l'UI
  const [showBooking, setShowBooking] = useState(false);
  const [isBooking, setIsBooking] = useState(false);
  const [booked, setBooked] = useState(false);
  const [confirmationMsg, setConfirmationMsg] = useState('');

  // Parent flow
  const [currentRole, setCurrentRole] = useState(null); // 'student' | 'teacher' | 'parent' | null
  const [children, setChildren] = useState([]);
  const [selectedStudentId, setSelectedStudentId] = useState('');

  // -------- Fetch teacher + reviews + busy slots (group-aware)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Teacher
      const snap = await getDoc(doc(db, 'users', teacherId));
      if (!cancelled && snap.exists()) {
        setTeacher({ ...snap.data(), id: teacherId });
      }

      // Reviews
      const qReviews = query(collection(db, 'reviews'), where('teacher_id', '==', teacherId));
      const rSnap = await getDocs(qReviews);
      if (!cancelled) {
        setReviews(rSnap.docs.map((d) => d.data()));
      }

      // Lessons pour calculer les créneaux occupés en tenant compte des groupes
      const lessonsQ = query(collection(db, 'lessons'), where('teacher_id', '==', teacherId));
      const lessonsSnap = await getDocs(lessonsQ);

      // Regrouper par (day, hour)
      const bySlot = new Map(); // key "day|hour" -> array of lessons
      lessonsSnap.docs.forEach((docu) => {
        const l = docu.data();
        if (!l.slot_day || (l.slot_hour !== 0 && !l.slot_hour && l.slot_hour !== 0)) return;
        if (!(l.status === 'booked' || l.status === 'confirmed')) return;
        const key = `${l.slot_day}|${String(l.slot_hour)}`;
        if (!bySlot.has(key)) bySlot.set(key, []);
        bySlot.get(key).push(l);
      });

      // Un créneau est occupé si:
      // - il y a un cours non-groupé (is_group !== true)
      // - OU il existe au moins un cours groupé pour lequel used >= capacity
      const busy = [];
      for (const [key, arr] of bySlot.entries()) {
        const [day, hourStr] = key.split('|');
        const hour = Number(hourStr);

        const hasSingle = arr.some((l) => !l.is_group);
        if (hasSingle) {
          busy.push({ day, hour });
          continue;
        }

        // uniquement des groupes
        const groupFull = arr.some((l) => {
          const cap = Number(l.capacity || 0);
          const used = Array.isArray(l.participant_ids) ? l.participant_ids.length : 0;
          return cap > 0 && used >= cap;
        });

        if (groupFull) {
          busy.push({ day, hour });
        }
      }

      if (!cancelled) {
        setBookedSlots(busy);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [teacherId]);

  // -------- Fetch current user role + children when logged in
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const me = auth.currentUser;
      if (!me) return;

      // role
      try {
        const meSnap = await getDoc(doc(db, 'users', me.uid));
        const role = meSnap.exists() ? meSnap.data()?.role : null;
        if (!cancelled) setCurrentRole(role || null);
      } catch {
        if (!cancelled) setCurrentRole(null);
      }

      // children (if parent)
      try {
        const kidsQ = query(collection(db, 'students'), where('parent_id', '==', me.uid));
        const kidsSnap = await getDocs(kidsQ);
        const kids = kidsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (!cancelled) setChildren(kids);
      } catch {
        if (!cancelled) setChildren([]);
      }

      // default selected student id
      if (!cancelled) setSelectedStudentId((prev) => prev || me.uid);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // -------- Derived values
  const avgRating = useMemo(() => {
    if (!reviews.length) return null;
    const sum = reviews.reduce((acc, r) => acc + (r.rating || 0), 0);
    return (sum / reviews.length).toFixed(1);
  }, [reviews]);

  const isParent = currentRole === 'parent';
  const meUid = auth.currentUser?.uid;

  // -------- Booking (group-aware)
  const handleBookingSlot = async (slot) => {
    if (!auth.currentUser) return navigate('/login');

    const me = auth.currentUser;
    const targetStudentId = selectedStudentId || me.uid;
    const bookingFor = isParent && targetStudentId !== me.uid ? 'child' : 'self';

    setIsBooking(true);
    setConfirmationMsg('');
    try {
      // 1) Tenter de rejoindre un groupe existant non plein sur ce créneau
      const qExisting = query(
        collection(db, 'lessons'),
        where('teacher_id', '==', teacherId),
        where('slot_day', '==', slot.day),
        where('slot_hour', '==', slot.hour),
        where('status', 'in', ['booked', 'confirmed'])
      );
      const existSnap = await getDocs(qExisting);

      let joinedGroup = false;
      for (const d of existSnap.docs) {
        const l = d.data();
        if (!l.is_group) continue;

        const capacity = Number(l.capacity || 0);
        const current = Array.isArray(l.participant_ids) ? l.participant_ids : [];
        const used = current.length;

        // déjà inscrit ?
        if (current.includes(targetStudentId)) {
          joinedGroup = true;
          setBooked(true);
          setShowBooking(false);
          setConfirmationMsg(`Vous êtes déjà inscrit(e) sur ce créneau ${slot.day} ${slot.hour}h.`);
          break;
        }

        // place dispo ?
        if (capacity > 0 && used < capacity) {
          await updateDoc(doc(db, 'lessons', d.id), {
            participant_ids: arrayUnion(targetStudentId),
            [`participantsMap.${targetStudentId}`]: {
              parent_id: bookingFor === 'child' ? me.uid : null,
              booked_by: me.uid,
              is_paid: false,
              paid_by: null,
              paid_at: null,
              status: 'booked',
              added_at: serverTimestamp(),
            },
          });

          setBooked(true);
          setShowBooking(false);
          setConfirmationMsg(
            bookingFor === 'child'
              ? `Ajouté au groupe ! ${slot.day} à ${slot.hour}h pour votre enfant.`
              : `Ajouté au groupe ! ${slot.day} à ${slot.hour}h.`
          );
          joinedGroup = true;
          break;
        }
      }

      if (joinedGroup) return;

      // 2) Sinon, créer un nouveau cours
      const groupEnabled = !!teacher?.group_enabled;
      const defaultCap =
        typeof teacher?.group_capacity === 'number' && teacher.group_capacity > 1
          ? Math.floor(teacher.group_capacity)
          : 1;

      const willBeGroup = groupEnabled && defaultCap > 1;

      await addDoc(collection(db, 'lessons'), {
        teacher_id: teacherId,
        student_id: willBeGroup ? null : targetStudentId, // si groupé, pas d'élève "principal"
        parent_id: bookingFor === 'child' ? me.uid : null,
        booked_by: me.uid,
        booked_for: bookingFor, // 'self' | 'child'
        status: 'booked',
        created_at: serverTimestamp(),
        subject_id: Array.isArray(teacher?.subjects)
          ? teacher.subjects.join(', ')
          : teacher?.subjects || '',
        price_per_hour: teacher?.price_per_hour || 0,
        slot_day: slot.day,
        slot_hour: slot.hour,

        // Champs groupe
        is_group: willBeGroup,
        capacity: willBeGroup ? defaultCap : 1,
        participant_ids: willBeGroup ? [targetStudentId] : [],
        participantsMap: willBeGroup
          ? {
              [targetStudentId]: {
                parent_id: bookingFor === 'child' ? me.uid : null,
                booked_by: me.uid,
                is_paid: false,
                paid_by: null,
                paid_at: null,
                status: 'booked',
                added_at: serverTimestamp(),
              },
            }
          : {},
      });

      setBooked(true);
      setShowBooking(false);
      setConfirmationMsg(
        willBeGroup
          ? bookingFor === 'child'
            ? `Votre enfant est préinscrit dans un nouveau groupe (${slot.day} à ${slot.hour}h).`
            : `Préinscription dans un nouveau groupe (${slot.day} à ${slot.hour}h).`
          : bookingFor === 'child'
          ? `Demande envoyée ! ${slot.day} à ${slot.hour}h pour votre enfant.`
          : `Votre demande de cours (${slot.day} à ${slot.hour}h) a bien été envoyée !`
      );
    } catch (e) {
      console.error('Booking error', e);
      setConfirmationMsg("Erreur lors de la réservation. Réessayez plus tard.");
    } finally {
      setIsBooking(false);
    }
  };

  // -------- Render
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

          {/* Note moyenne */}
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
            {Array.isArray(teacher.subjects)
              ? teacher.subjects.join(', ')
              : teacher.subjects || 'Matière non précisée'}
          </div>

          <div className="text-xs text-gray-500 mb-1">
            {teacher.location || teacher.city || ''}
          </div>

          <div className="text-sm text-gray-600 mb-2 text-center">{teacher.bio}</div>

          <span className="inline-block text-yellow-700 font-semibold mb-4">
            {teacher.price_per_hour ? `${teacher.price_per_hour} € /h` : 'Prix non précisé'}
          </span>

          {/* Sélecteur enfant (si parent) */}
          {currentRole === 'parent' && (
            <div className="w-full bg-gray-50 border rounded-lg p-3 mb-4">
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Qui est l’élève ?
              </label>
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
                Sélectionnez l’enfant si vous réservez pour lui.
              </p>
            </div>
          )}

          {/* Bouton Réserver */}
          <button
            className="bg-primary text-white px-6 py-3 rounded-lg font-semibold shadow hover:bg-primary-dark transition mb-4 disabled:opacity-60"
            disabled={isBooking || booked}
            onClick={() => {
              if (!auth.currentUser) return navigate('/login');
              setShowBooking(true);
              setConfirmationMsg('');
            }}
          >
            {booked ? 'Demande envoyée !' : isBooking ? 'Envoi en cours…' : 'Réserver un cours'}
          </button>

          {/* Message post-réservation */}
          {confirmationMsg && (
            <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-2 rounded mb-2 text-sm text-center mt-2">
              {confirmationMsg}
            </div>
          )}
        </div>

        {/* Modal créneau */}
        {showBooking && (
          <BookingModal
            availability={teacher.availability || {}}
            bookedSlots={bookedSlots} // déjà "group-aware"
            onBook={handleBookingSlot}
            onClose={() => setShowBooking(false)}
            orderDays={DAYS_ORDER}
          />
        )}

        {/* Avis */}
        <h3 className="text-lg font-bold text-secondary mt-6 mb-3">Avis</h3>
        <div className="flex flex-col gap-3">
          {reviews.length === 0 && (
            <div className="text-gray-400 text-sm">Aucun avis pour ce professeur.</div>
          )}
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