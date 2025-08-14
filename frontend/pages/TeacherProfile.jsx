import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { auth, db } from '../lib/firebase';
import {
  doc, getDoc, collection, query, where, getDocs, addDoc, serverTimestamp,
} from 'firebase/firestore';
import BookingModal from '../components/BookingModal';

export default function TeacherProfile() {
  const { teacherId } = useParams();
  const navigate = useNavigate();

  const [teacher, setTeacher] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [isBooking, setIsBooking] = useState(false);
  const [booked, setBooked] = useState(false);
  const [showBooking, setShowBooking] = useState(false);
  const [bookedSlots, setBookedSlots] = useState([]);
  const [confirmationMsg, setConfirmationMsg] = useState('');

  // ---- Parent-related
  const [currentRole, setCurrentRole] = useState(null); // "student" | "teacher" | "parent" | null
  const [children, setChildren] = useState([]);         // [{id, full_name, ...}]
  const [selectedStudentId, setSelectedStudentId] = useState(null); // qui reçoit le cours

  // Note moyenne
  const avgRating = reviews.length > 0
    ? (reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.length).toFixed(1)
    : null;

  // ---- Chargement prof + avis + créneaux occupés
  useEffect(() => {
    const fetch = async () => {
      const snap = await getDoc(doc(db, 'users', teacherId));
      if (snap.exists()) setTeacher({ ...snap.data(), id: teacherId });

      // Avis
      const qReviews = query(collection(db, 'reviews'), where('teacher_id', '==', teacherId));
      const snapReviews = await getDocs(qReviews);
      setReviews(snapReviews.docs.map(doc => doc.data()));

      // Créneaux occupés (booked/confirmed)
      const lessonsQ = query(
        collection(db, 'lessons'),
        where('teacher_id', '==', teacherId)
      );
      const snapLessons = await getDocs(lessonsQ);
      const busySlots = snapLessons.docs
        .map(doc => doc.data())
        .filter(l =>
          (l.status === "booked" || l.status === "confirmed") &&
          l.slot_day && (l.slot_hour !== undefined)
        )
        .map(l => ({ day: l.slot_day, hour: l.slot_hour }));
      setBookedSlots(busySlots);
    };
    fetch();
  }, [teacherId]);

  // ---- Chargement rôle courant + enfants (si parent)
  useEffect(() => {
    (async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;

      // Rôle courant
      try {
        const me = await getDoc(doc(db, 'users', uid));
        const role = me.exists() ? me.data()?.role : null;
        setCurrentRole(role || null);
      } catch {
        setCurrentRole(null);
      }

      // Si parent → charger enfants
      try {
        const kidsQ = query(collection(db, 'students'), where('parent_id', '==', uid));
        const kidsSnap = await getDocs(kidsQ);
        const kids = kidsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        setChildren(kids);
      } catch {
        setChildren([]);
      }

      // Par défaut : si parent, on présélectionne le 1er enfant si dispo, sinon "moi"
      setSelectedStudentId(prev => prev || (auth.currentUser?.uid || null));
    })();
  }, []);

  // ---- Réservation
  const handleBookingSlot = async (slot) => {
    if (!auth.currentUser) return navigate('/login');

    // Déterminer pour qui (self ou enfant)
    const meUid = auth.currentUser.uid;
    const isParent = currentRole === 'parent';
    const targetStudentId = selectedStudentId || meUid;
    const bookingFor = isParent && targetStudentId !== meUid ? 'child' : 'self';

    setIsBooking(true);
    try {
      await addDoc(collection(db, 'lessons'), {
        teacher_id: teacherId,
        student_id: targetStudentId,
        parent_id: bookingFor === 'child' ? meUid : null,
        booked_by: meUid,           // qui a cliqué “réserver”
        booked_for: bookingFor,     // "self" | "child"
        status: "booked",
        created_at: serverTimestamp(),
        subject_id: Array.isArray(teacher?.subjects) ? teacher.subjects.join(', ') : (teacher?.subjects || ""),
        price_per_hour: teacher?.price_per_hour || 0,
        slot_day: slot.day,
        slot_hour: slot.hour,
      });

      setBooked(true);
      setShowBooking(false);
      setConfirmationMsg(
        bookingFor === 'child'
          ? `Demande envoyée ! ${slot.day} à ${slot.hour}h pour votre enfant.`
          : `Votre demande de cours (${slot.day} à ${slot.hour}h) a bien été envoyée !`
      );
    } catch (e) {
      console.error('Booking error', e);
      setConfirmationMsg("Erreur lors de la réservation. Réessaie plus tard.");
    } finally {
      setIsBooking(false);
    }
  };

  if (!teacher)
    return <div className="max-w-xl mx-auto bg-white p-6 rounded-xl shadow mt-12 text-center">Chargement…</div>;

  const isParent = currentRole === 'parent';
  const meUid = auth.currentUser?.uid;

  return (
    <div className="min-h-screen flex flex-col items-center bg-gradient-to-br from-white via-gray-100 to-secondary/20 px-4 py-10">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
        <div className="flex flex-col items-center">
          <img
            src={teacher.avatarUrl || teacher.avatar_url || teacher.photoURL || "/avatar-default.png"}
            alt={teacher.fullName || "Prof"}
            className="w-24 h-24 rounded-full object-cover border-2 border-primary mb-3"
          />
          <h2 className="font-bold text-2xl text-primary mb-2">{teacher.fullName || teacher.name || "Professeur"}</h2>

          {/* Note moyenne */}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-yellow-500 text-lg">{avgRating ? '★'.repeat(Math.round(avgRating)) : "—"}</span>
            <span className="font-bold text-gray-700">{avgRating ? `${avgRating} / 5` : "Pas de note"}</span>
            <span className="text-xs text-gray-400">({reviews.length} avis)</span>
          </div>

          <div className="text-gray-700 mb-1">
            {Array.isArray(teacher.subjects) ? teacher.subjects.join(', ') : (teacher.subjects || "Matière non précisée")}
          </div>
          <div className="text-xs text-gray-500 mb-1">{teacher.location}</div>
          <div className="text-sm text-gray-600 mb-2 text-center">{teacher.bio}</div>
          <span className="inline-block text-yellow-700 font-semibold mb-4">
            {teacher.price_per_hour ? `${teacher.price_per_hour} € /h` : "Prix non précisé"}
          </span>

          {/* Sélection élève (visible si parent) */}
          {isParent && (
            <div className="w-full bg-gray-50 border rounded-lg p-3 mb-4">
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Qui est l’élève ?
              </label>
              <select
                className="w-full border rounded px-3 py-2"
                value={selectedStudentId || meUid}
                onChange={(e) => setSelectedStudentId(e.target.value)}
              >
                <option value={meUid}>Moi (parent)</option>
                {children.map(k => (
                  <option key={k.id} value={k.id}>
                    {k.full_name || k.fullName || k.name || "Enfant"}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Sélectionnez l’enfant si vous réservez pour lui.
              </p>
            </div>
          )}

          {/* Bouton réserver un cours */}
          <button
            className="bg-primary text-white px-6 py-3 rounded-lg font-semibold shadow hover:bg-primary-dark transition mb-4"
            disabled={isBooking || booked}
            onClick={() => {
              if (!auth.currentUser) return navigate('/login');
              setShowBooking(true);
              setConfirmationMsg('');
            }}
          >
            {booked
              ? "Demande envoyée !"
              : isBooking
              ? "Envoi en cours..."
              : "Réserver un cours"}
          </button>

          {/* Message de confirmation */}
          {confirmationMsg && (
            <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-2 rounded mb-2 text-sm text-center mt-2">
              {confirmationMsg}
            </div>
          )}
        </div>

        {/* Modal planning pour choisir un créneau */}
        {showBooking && teacher.availability && (
          <BookingModal
            availability={teacher.availability}
            bookedSlots={bookedSlots}
            onClose={() => setShowBooking(false)}
            onBook={handleBookingSlot} // reçoit {day, hour}
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