import React, { useEffect, useMemo, useState } from 'react';
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

// Helpers
const stars = (n) => (n ? '★'.repeat(Math.round(n)) : '—');
const fmtEUR = (n) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })
    .format(Number(n || 0));

// Clé de slot (jour+heure) pour identifier facilement les sessions de groupe
const slotKey = (day, hour) => `${day}|${String(hour).padStart(2, '0')}`;

export default function TeacherProfile() {
  const { teacherId } = useParams();
  const navigate = useNavigate();

  // Données prof & avis
  const [teacher, setTeacher] = useState(null);
  const [reviews, setReviews] = useState([]);

  // Créneaux pris / sessions de groupe
  const [bookedSlots, setBookedSlots] = useState([]); // à passer au modal
  const [groupSessionsByKey, setGroupSessionsByKey] = useState({}); // { "Lun|10": { id, capacity, occupied, remaining, slot_day, slot_hour } }

  // Contexte utilisateur courant
  const [currentRole, setCurrentRole] = useState(null); // "student" | "parent" | "teacher" | null
  const [children, setChildren] = useState([]);
  const [selectedStudentId, setSelectedStudentId] = useState(null);

  // Réservation
  const [isBooking, setIsBooking] = useState(false);
  const [booked, setBooked] = useState(false);
  const [showBooking, setShowBooking] = useState(false);
  const [confirmationMsg, setConfirmationMsg] = useState('');

  // Note moyenne
  const avgRating = useMemo(() => {
    if (!reviews.length) return null;
    const s = reviews.reduce((acc, r) => acc + (r.rating || 0), 0);
    return (s / reviews.length).toFixed(1);
  }, [reviews]);

  // ----------- Chargement PROF + AVIS + CRÉNEAUX / GROUPES -----------
  useEffect(() => {
    const fetch = async () => {
      // 1) Prof
      const snap = await getDoc(doc(db, 'users', teacherId));
      if (snap.exists()) setTeacher({ id: teacherId, ...snap.data() });

      // 2) Avis
      const qReviews = query(collection(db, 'reviews'), where('teacher_id', '==', teacherId));
      const rSnap = await getDocs(qReviews);
      setReviews(rSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      // 3) Leçons de ce prof pour construire :
      //    - les créneaux occupés (1:1 toujours, groupe seulement si plein)
      //    - la table des sessions de groupe disponibles par créneau
      const sessions = [];
      try {
        const qLessons = query(collection(db, 'lessons'), where('teacher_id', '==', teacherId));
        const lSnap = await getDocs(qLessons);
        lSnap.docs.forEach(d => sessions.push({ id: d.id, ...d.data() }));
      } catch (e) {
        console.error('fetch lessons error', e);
      }

      const busy = [];
      const groups = {};

      sessions.forEach(l => {
        if (!l.slot_day || l.slot_hour === undefined || l.slot_hour === null) return;

        const isGroup = Boolean(l.is_group) || Number(l.capacity) > 1;
        const capacity = Number(l.capacity || (isGroup ? 2 : 1)); // si is_group=true sans capacity, on assume 2+
        const participantsMap = l.participantsMap || {};
        const participantIds = Array.isArray(l.participant_ids) ? l.participant_ids : Object.keys(participantsMap);
        let occupied = participantIds.length;

        // compat : si ancien schéma 1:1 a un student_id
        if (!isGroup && l.student_id) occupied = 1;

        const remaining = Math.max(0, capacity - occupied);
        const key = slotKey(l.slot_day, l.slot_hour);

        if (isGroup) {
          // On mémorise la session de groupe pour ce créneau
          // NB: s'il y a plusieurs sessions au même slot (rare), on garde celle avec le + de places restantes
          const prev = groups[key];
          if (!prev || remaining > prev.remaining) {
            groups[key] = {
              id: l.id,
              slot_day: l.slot_day,
              slot_hour: l.slot_hour,
              capacity,
              occupied,
              remaining,
            };
          }
          // On bloque le créneau dans le planning uniquement si la session est PLEINE
          if (remaining <= 0 && (l.status === 'booked' || l.status === 'confirmed')) {
            busy.push({ day: l.slot_day, hour: l.slot_hour });
          }
        } else {
          // Cours individuel : occupé si booked/confirmed
          if (l.status === 'booked' || l.status === 'confirmed') {
            busy.push({ day: l.slot_day, hour: l.slot_hour });
          }
        }
      });

      setGroupSessionsByKey(groups);
      setBookedSlots(busy);
    };
    fetch();
  }, [teacherId]);

  // ----------- Chargement RÔLE + ENFANTS (si parent) -----------
  useEffect(() => {
    (async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;

      // Rôle
      try {
        const me = await getDoc(doc(db, 'users', uid));
        const role = me.exists() ? me.data()?.role : null;
        setCurrentRole(role || null);
      } catch {
        setCurrentRole(null);
      }

      // Enfants
      try {
        const kidsQ = query(collection(db, 'students'), where('parent_id', '==', uid));
        const kidsSnap = await getDocs(kidsQ);
        const kids = kidsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        setChildren(kids);
      } catch {
        setChildren([]);
      }

      // Élève ciblé par défaut
      setSelectedStudentId(prev => {
        if (prev) return prev;
        if (auth.currentUser) return auth.currentUser.uid;
        return null;
      });
    })();
  }, []);

  // ----------- Anti-réservation "soi-même" -----------
  const bookingDisabledBecauseOwner =
    auth.currentUser?.uid && auth.currentUser.uid === teacherId;

  // ----------- Réservation (inclut la logique "groupe") -----------
  const handleBookingSlot = async (slot) => {
    if (!auth.currentUser) return navigate('/login');
    if (bookingDisabledBecauseOwner) return;

    const meUid = auth.currentUser.uid;
    const isParent = currentRole === 'parent';
    const targetStudentId = selectedStudentId || meUid;
    const booked_for = isParent && targetStudentId !== meUid ? 'child' : 'self';

    // 0) Anti-doublon : même prof / même créneau / déjà en booked/confirmed
    try {
      const qDup = query(
        collection(db, 'lessons'),
        where('teacher_id', '==', teacherId),
        where('slot_day', '==', slot.day),
        where('slot_hour', '==', slot.hour)
      );
      const dupSnap = await getDocs(qDup);
      const hasConflict = dupSnap.docs.some(d => {
        const l = d.data();
        // déjà élève dans un cours 1:1
        if (!l.is_group && (l.status === 'booked' || l.status === 'confirmed') && l.student_id === targetStudentId) {
          return true;
        }
        // déjà inscrit dans la session de groupe
        if ((l.is_group || Number(l.capacity) > 1)) {
          const pMap = l.participantsMap || {};
          if (pMap[targetStudentId]?.status === 'booked' || pMap[targetStudentId]?.status === 'confirmed') {
            return true;
          }
        }
        return false;
      });
      if (hasConflict) {
        setShowBooking(false);
        setConfirmationMsg("Tu as déjà une demande ou une place dans ce créneau pour ce professeur.");
        return;
      }
    } catch {
      // on ne bloque pas si la vérif échoue
    }

    setIsBooking(true);
    setConfirmationMsg('');

    // 1) Regarder s’il existe une session de groupe confirmée et non pleine à ce slot
    const gKey = slotKey(slot.day, slot.hour);
    const group = groupSessionsByKey[gKey]; // { id, capacity, occupied, remaining, ... }

    try {
      if (group && group.remaining > 0) {
        // -> On ajoute l’élève comme participant "booked" dans la session existante
        const sessionRef = doc(db, 'lessons', group.id);

        // sécurité : éviter d’ajouter deux fois
        const sessionSnap = await getDoc(sessionRef);
        if (!sessionSnap.exists()) throw new Error("Session de groupe introuvable.");
        const sData = sessionSnap.data();
        const pMap = sData.participantsMap || {};
        if (pMap[targetStudentId]?.status === 'booked' || pMap[targetStudentId]?.status === 'confirmed') {
          setShowBooking(false);
          setIsBooking(false);
          setConfirmationMsg("Tu es déjà inscrit(e) sur cette session.");
          return;
        }
        const partEntry = {
          parent_id: booked_for === 'child' ? meUid : null,
          booked_by: meUid,
          is_paid: false,
          paid_by: null,
          paid_at: null,
          status: 'booked',
          created_at: serverTimestamp(),
        };

        await updateDoc(sessionRef, {
          [`participantsMap.${targetStudentId}`]: partEntry,
          participant_ids: arrayUnion(targetStudentId),
          is_group: true,
        });

        // Notif prof
        try {
          const meSnap = await getDoc(doc(db, 'users', meUid));
          const meName = meSnap.exists()
            ? (meSnap.data().fullName || meSnap.data().name || 'Un utilisateur')
            : 'Un utilisateur';

          await addDoc(collection(db, 'notifications'), {
            user_id: teacherId, // prof
            type: 'group_join_request',
            with_id: meUid,
            withName: meName,
            lesson_id: group.id,
            message:
              booked_for === 'child'
                ? `${meName} a demandé à rejoindre la session de groupe (${slot.day} ${String(slot.hour).padStart(2, '0')}h) pour son enfant.`
                : `${meName} a demandé à rejoindre la session de groupe (${slot.day} ${String(slot.hour).padStart(2, '0')}h).`,
            created_at: serverTimestamp(),
            read: false,
          });
        } catch {}

        // UI : si la session devient pleine, marquer le créneau occupé
        if ((group.remaining - 1) <= 0) {
          setBookedSlots(prev => [...prev, { day: slot.day, hour: slot.hour }]);
        }

        setBooked(true);
        setShowBooking(false);
        setConfirmationMsg(
          booked_for === 'child'
            ? `Demande envoyée ! Place demandée sur la session de groupe ${slot.day} à ${String(slot.hour).padStart(2, '0')}h pour votre enfant.`
            : `Demande envoyée ! Place demandée sur la session de groupe ${slot.day} à ${String(slot.hour).padStart(2, '0')}h.`
        );
        return;
      }

      // 2) Sinon : on crée une demande "booked" standard (1:1).
      const lessonRef = await addDoc(collection(db, 'lessons'), {
        teacher_id: teacherId,
        student_id: targetStudentId,
        parent_id: booked_for === 'child' ? meUid : null,
        booked_by: meUid,
        booked_for, // "self" | "child"
        status: 'booked',
        created_at: serverTimestamp(),
        subject_id: Array.isArray(teacher?.subjects)
          ? teacher.subjects.join(', ')
          : (teacher?.subjects || ''),
        price_per_hour: teacher?.price_per_hour || 0,
        slot_day: slot.day,
        slot_hour: slot.hour,
        // groupe par défaut = false (le prof pourra transformer en session de groupe côté back-office)
        is_group: false,
      });

      // Notif prof
      try {
        const meSnap = await getDoc(doc(db, 'users', meUid));
        const meName = meSnap.exists()
          ? (meSnap.data().fullName || meSnap.data().name || 'Un utilisateur')
          : 'Un utilisateur';

        await addDoc(collection(db, 'notifications'), {
          user_id: teacherId,         // prof
          type: 'lesson_request',
          with_id: meUid,
          withName: meName,
          lesson_id: lessonRef.id,
          message:
            booked_for === 'child'
              ? `${meName} a demandé un cours pour son enfant (${slot.day} ${String(slot.hour).padStart(2, '0')}h).`
              : `${meName} a demandé un cours (${slot.day} ${String(slot.hour).padStart(2, '0')}h).`,
          created_at: serverTimestamp(),
          read: false,
        });
      } catch {}

      setBooked(true);
      setShowBooking(false);
      setBookedSlots(prev => [...prev, { day: slot.day, hour: slot.hour }]); // 1:1 => le slot devient occupé
      setConfirmationMsg(
        booked_for === 'child'
          ? `Demande envoyée ! ${slot.day} à ${String(slot.hour).padStart(2, '0')}h pour votre enfant.`
          : `Votre demande de cours (${slot.day} à ${String(slot.hour).padStart(2, '0')}h) a bien été envoyée !`
      );
    } catch (e) {
      console.error('Booking error', e);
      setConfirmationMsg("Erreur lors de la réservation. Réessaie plus tard.");
    } finally {
      setIsBooking(false);
    }
  };

  if (!teacher) {
    return (
      <div className="max-w-xl mx-auto bg-white p-6 rounded-xl shadow mt-12 text-center">
        Chargement…
      </div>
    );
  }

  const isParent = currentRole === 'parent';
  const meUid = auth.currentUser?.uid;

  // Badges Stripe (miroir dans users)
  const stripeBadges = (
    <div className="flex flex-wrap items-center gap-2 mt-1">
      {teacher.stripeChargesEnabled && (
        <span className="text-xs px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
          Paiements activés
        </span>
      )}
      {teacher.stripePayoutsEnabled && (
        <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
          Virements OK
        </span>
      )}
    </div>
  );

  // Petit rappel à l’utilisateur : s’il existe une session de groupe ouverte pour ce prof,
  // on peut afficher une info sous le bouton (facultatif, visuel).
  const hasOpenGroups = useMemo(() => {
    return Object.values(groupSessionsByKey).some(g => g.remaining > 0);
  }, [groupSessionsByKey]);

  return (
    <div className="min-h-screen flex flex-col items-center bg-gradient-to-br from-white via-gray-100 to-secondary/20 px-4 py-10">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
        {/* Header prof */}
        <div className="flex flex-col items-center">
          <img
            src={teacher.avatarUrl || teacher.avatar_url || teacher.photoURL || '/avatar-default.png'}
            alt={teacher.fullName || 'Prof'}
            className="w-24 h-24 rounded-full object-cover border-2 border-primary mb-3"
          />
          <h2 className="font-bold text-2xl text-primary mb-1">
            {teacher.fullName || teacher.name || 'Professeur'}
          </h2>

          {/* Note moyenne */}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-yellow-500 text-lg">{stars(avgRating)}</span>
            <span className="font-bold text-gray-700">
              {avgRating ? `${avgRating} / 5` : 'Pas de note'}
            </span>
            <span className="text-xs text-gray-400">({reviews.length} avis)</span>
          </div>

          {/* Matières / ville / bio / prix */}
          <div className="text-gray-700 mb-1">
            {Array.isArray(teacher.subjects) ? teacher.subjects.join(', ') : (teacher.subjects || 'Matière non précisée')}
          </div>
          {teacher.location && <div className="text-xs text-gray-500 mb-1">{teacher.location}</div>}
          {teacher.bio && <div className="text-sm text-gray-600 mb-2 text-center">{teacher.bio}</div>}
          <span className="inline-block text-yellow-700 font-semibold mb-2">
            {teacher.price_per_hour ? `${fmtEUR(teacher.price_per_hour)} / h` : 'Prix non précisé'}
          </span>

          {stripeBadges}
        </div>

        {/* Sélection élève (si parent) */}
        {isParent && (
          <div className="w-full bg-gray-50 border rounded-lg p-3 mt-4">
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Qui est l’élève ?
            </label>
            <select
              className="w-full border rounded px-3 py-2"
              value={selectedStudentId || meUid}
              onChange={(e) => setSelectedStudentId(e.target.value)}
            >
              <option value={meUid}>Moi (parent)</option>
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

        {/* Info sessions de groupe ouvertes */}
        {hasOpenGroups && (
          <div className="mt-3 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2">
            Des sessions <b>de groupe</b> sont ouvertes sur certains créneaux (places restantes).
            En choisissant l’un de ces créneaux, ta demande rejoindra automatiquement la session.
          </div>
        )}

        {/* Bouton réserver */}
        <div className="mt-4 flex flex-col items-center">
          <button
            className="bg-primary text-white px-6 py-3 rounded-lg font-semibold shadow hover:bg-primary-dark transition disabled:opacity-60"
            disabled={isBooking || booked || bookingDisabledBecauseOwner}
            onClick={() => {
              if (!auth.currentUser) return navigate('/login');
              setShowBooking(true);
              setConfirmationMsg('');
            }}
            title={bookingDisabledBecauseOwner ? "Tu ne peux pas réserver tes propres cours." : undefined}
          >
            {bookingDisabledBecauseOwner
              ? "Réservation indisponible (ton compte)"
              : booked
              ? 'Demande envoyée !'
              : isBooking
              ? 'Envoi en cours…'
              : 'Réserver un cours'}
          </button>

          {/* Message de confirmation */}
          {confirmationMsg && (
            <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-2 rounded mt-3 text-sm text-center">
              {confirmationMsg}
            </div>
          )}
        </div>

        {/* Modal planning */}
        {showBooking && (
          <BookingModal
            availability={teacher.availability || {}}
            bookedSlots={bookedSlots}         // 1:1 occupés + groupes pleins
            onClose={() => setShowBooking(false)}
            onBook={handleBookingSlot}        // reçoit {day, hour}
            // Si ton BookingModal accepte des props additionnelles, tu peux aussi lui passer groupSessionsByKey
            // pour afficher “X places restantes” par créneau. Sinon, la logique d’inscription se fait côté handler.
          />
        )}

        {/* Avis */}
        <h3 className="text-lg font-bold text-secondary mt-8 mb-3">Avis</h3>
        <div className="flex flex-col gap-3">
          {reviews.length === 0 && (
            <div className="text-gray-400 text-sm">Aucun avis pour ce professeur.</div>
          )}
          {reviews.map((r) => (
            <div key={r.id} className="bg-gray-50 border rounded-xl px-4 py-3">
              <span className="text-yellow-500 mr-2">{'★'.repeat(r.rating || 0)}</span>
              <span className="italic">{r.comment}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}