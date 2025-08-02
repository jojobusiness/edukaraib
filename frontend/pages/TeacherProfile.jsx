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

  // Note moyenne
  const avgRating = reviews.length > 0
    ? (reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.length).toFixed(1)
    : null;

  useEffect(() => {
    const fetch = async () => {
      const snap = await getDoc(doc(db, 'users', teacherId));
    if (snap.exists()) setTeacher({ ...snap.data(), id: teacherId });

      // Récupère les avis
      const q = query(collection(db, 'reviews'), where('teacher_id', '==', teacherId));
      const snapReviews = await getDocs(q);
      setReviews(snapReviews.docs.map(doc => doc.data()));

      // Récupère tous les cours à venir déjà réservés (booked ou confirmed)
      const lessonsQ = query(
        collection(db, 'lessons'),
        where('teacher_id', '==', teacherId)
      );
      const snapLessons = await getDocs(lessonsQ);
      const busySlots = snapLessons.docs
        .map(doc => doc.data())
        .filter(l =>
          (l.status === "booked" || l.status === "confirmed") &&
          l.slot_day && l.slot_hour
        )
        .map(l => ({ day: l.slot_day, hour: l.slot_hour }));
      setBookedSlots(busySlots);
    };
    fetch();
  }, [teacherId]);

  const handleBookingSlot = async (slot) => {
    setIsBooking(true);
    await addDoc(collection(db, 'lessons'), {
      teacher_id: teacherId,
      student_id: auth.currentUser.uid,
      status: "booked",
      created_at: serverTimestamp(),
      subject_id: teacher?.subjects || "",
      price_per_hour: teacher?.price_per_hour || 0,
      slot_day: slot.day,
      slot_hour: slot.hour,
    });
    setIsBooking(false);
    setBooked(true);
    setShowBooking(false);
    setConfirmationMsg(
      `Votre demande de cours (${slot.day} à ${slot.hour}h) a bien été envoyée au professeur !`
    );
  };

  if (!teacher)
    return <div className="max-w-xl mx-auto bg-white p-6 rounded-xl shadow mt-12 text-center">Chargement…</div>;

  return (
    <div className="min-h-screen flex flex-col items-center bg-gradient-to-br from-white via-gray-100 to-secondary/20 px-4 py-10">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
        <div className="flex flex-col items-center">
          <img
            src={teacher.avatarUrl || "/avatar-default.png"}
            alt={teacher.fullName || "Prof"}
            className="w-24 h-24 rounded-full object-cover border-2 border-primary mb-3"
          />
          <h2 className="font-bold text-2xl text-primary mb-2">{teacher.fullName}</h2>
          {/* Note moyenne */}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-yellow-500 text-lg">{avgRating ? '★'.repeat(Math.round(avgRating)) : "—"}</span>
            <span className="font-bold text-gray-700">{avgRating ? `${avgRating} / 5` : "Pas de note"}</span>
            <span className="text-xs text-gray-400">({reviews.length} avis)</span>
          </div>
          <div className="text-gray-700 mb-1">{teacher.subjects}</div>
          <div className="text-xs text-gray-500 mb-1">{teacher.location}</div>
          <div className="text-sm text-gray-600 mb-2">{teacher.bio}</div>
          <span className="inline-block text-yellow-700 font-semibold mb-4">
            {teacher.price_per_hour ? `${teacher.price_per_hour} € /h` : "Prix non précisé"}
          </span>
          {/* Bouton réserver un cours */}
          <button
            className="bg-primary text-white px-6 py-3 rounded-lg font-semibold shadow hover:bg-primary-dark transition mb-6"
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
            onBook={handleBookingSlot}
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
              <span className="text-yellow-500 mr-2">{'★'.repeat(r.rating)}</span>
              <span className="italic">{r.comment}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}