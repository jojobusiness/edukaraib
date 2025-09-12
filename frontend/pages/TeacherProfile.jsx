import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { auth, db } from '../lib/firebase';
import {
  doc, getDoc, collection, query, where, getDocs, addDoc, updateDoc,
  serverTimestamp, arrayUnion,
} from 'firebase/firestore';
import BookingModal from '../components/BookingModal';

const DAYS_ORDER = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

// Compte les participants acceptés/confirmés dans un cours de groupe
function countAccepted(l) {
  const pm = l.participantsMap || {};
  const ids = Array.isArray(l.participant_ids) ? l.participant_ids : [];
  let accepted = 0;
  for (const id of ids) {
    const st = pm?.[id]?.status;
    if (st === 'accepted' || st === 'confirmed') accepted++;
  }
  return accepted;
}

export default function TeacherProfile() {
  const { teacherId } = useParams();
  const navigate = useNavigate();

  const [teacher, setTeacher] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);

  // Pour ouvrir la modale de réservation
  const [bookOpen, setBookOpen] = useState(false);

  // (optionnel) Liste des enfants d’un parent connecté
  const [children, setChildren] = useState([]);
  const [selectedStudentId, setSelectedStudentId] = useState('');

  // ----- Chargement des données -----
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        // Profil prof
        const snap = await getDoc(doc(db, 'users', teacherId));
        if (!cancelled && snap.exists()) setTeacher({ ...snap.data(), id: teacherId });

        // Avis
        const qReviews = query(collection(db, 'reviews'), where('teacher_id', '==', teacherId));
        const rSnap = await getDocs(qReviews);
        if (!cancelled) setReviews(rSnap.docs.map((d) => d.data()));

        // Enfants du parent si besoin (pour la réservation pour enfant)
        const me = auth.currentUser;
        if (me) {
          const meSnap = await getDoc(doc(db, 'users', me.uid));
          const role = meSnap.exists() ? (meSnap.data().role || meSnap.data().type) : null;
          if (role === 'parent') {
            const kidsSnap = await getDocs(query(collection(db, 'students'), where('parent_id', '==', me.uid)));
            const kids = kidsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
            if (!cancelled) {
              setChildren(kids);
              if (!selectedStudentId && kids.length) setSelectedStudentId(kids[0].id);
            }
          }
        }
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [teacherId]);

  // ----- Notes / prix -----
  const avgRating = useMemo(() => {
    if (!reviews.length) return 0;
    const s = reviews.reduce((a, r) => a + (Number(r.rating) || 0), 0);
    return Math.round((s / reviews.length) * 10) / 10;
  }, [reviews]);

  // 👉 Prix final = prix prof + 10 €
  const finalHourly = useMemo(() => {
    const raw = teacher?.price_per_hour;
    const n = typeof raw === 'string' ? Number(raw.replace(',', '.')) : Number(raw);
    return Number.isFinite(n) ? n + 10 : null;
  }, [teacher]);

  // ----- Actions -----
  const handleBook = () => {
    if (!auth.currentUser) {
      navigate('/login');
      return;
    }
    setBookOpen(true);
  };

  // ----- UI -----
  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center text-gray-500">
        Chargement…
      </div>
    );
  }

  if (!teacher) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center text-gray-400">
        Professeur introuvable.
      </div>
    );
  }

  return (
    <div className="min-h-screen flex justify-center bg-gradient-to-br from-white via-gray-100 to-secondary/20 px-4 py-10">
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
        <div className="flex items-start gap-5">
          <img
            src={teacher.avatarUrl || '/avatar-default.png'}
            alt={teacher.fullName || 'Professeur'}
            className="w-24 h-24 rounded-full object-cover border-2 border-primary"
          />
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-primary">{teacher.fullName || 'Professeur'}</h1>
            <div className="text-sm text-gray-600">
              {teacher.city ? `📍 ${teacher.city}` : '📍 —'}
            </div>
            <div className="text-sm text-gray-700 mt-1">
              {teacher.subjects || 'Matières non précisées'}
            </div>

            {/* Prix (affichage +10 €) */}
            {finalHourly == null ? (
              <div className="mt-3">
                <span className="inline-block text-yellow-700 font-semibold">
                  Prix non précisé
                </span>
              </div>
            ) : (
              <div className="mt-3">
                <span className="inline-block text-yellow-700 font-semibold">
                  {finalHourly.toFixed(2)} € /h
                </span>
              </div>
            )}

            {/* Note moyenne */}
            <div className="mt-2 text-sm text-gray-700">
              <span className="text-yellow-500 mr-1">★</span>
              {avgRating || '—'} ({reviews.length} avis)
            </div>

            {/* Bouton réserver (design d'avant) */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                className="bg-primary text-white px-5 py-2 rounded-lg font-semibold shadow hover:bg-primary-dark transition"
                onClick={handleBook}
              >
                Réserver
              </button>
              {auth.currentUser && children.length > 0 && (
                <label className="text-xs text-gray-600 ml-2">
                  pour&nbsp;
                  <select
                    className="border rounded px-2 py-1 text-xs"
                    value={selectedStudentId}
                    onChange={(e) => setSelectedStudentId(e.target.value)}
                  >
                    {children.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.full_name || c.name || c.id}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </div>
        </div>

        {/* Bio */}
        {teacher.bio && (
          <div className="mt-6">
            <h3 className="text-lg font-bold text-secondary mb-2">Présentation</h3>
            <p className="text-gray-700 whitespace-pre-wrap">{teacher.bio}</p>
          </div>
        )}

        {/* Disponibilités (affichage simple si présentes) */}
        {teacher.availability && typeof teacher.availability === 'object' && (
          <div className="mt-6">
            <h3 className="text-lg font-bold text-secondary mb-2">Disponibilités</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              {DAYS_ORDER.map((d) => {
                const slots = teacher.availability?.[d];
                if (!Array.isArray(slots) || !slots.length) {
                  return (
                    <div key={d} className="border rounded-lg px-3 py-2 text-gray-500">
                      <span className="font-semibold">{d}</span> : —
                    </div>
                  );
                }
                return (
                  <div key={d} className="border rounded-lg px-3 py-2">
                    <span className="font-semibold">{d}</span> :{' '}
                    {slots.map((h, i) => (
                      <span key={i} className="inline-block text-xs bg-gray-100 px-2 py-1 rounded mr-1 mt-1">
                        {String(h).padStart(2, '0')}:00
                      </span>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Avis */}
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

      {/* Modale de réservation */}
      {bookOpen && (
        <BookingModal
          open={bookOpen}
          onClose={() => setBookOpen(false)}
          teacher={teacher}
          // Si votre BookingModal supporte la réservation pour un enfant :
          selectedStudentId={selectedStudentId || null}
        />
      )}
    </div>
  );
}