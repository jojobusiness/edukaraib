import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { auth, db } from '../lib/firebase';
import {
  doc, getDoc, collection, query, where, getDocs, addDoc, updateDoc,
  serverTimestamp, arrayUnion, onSnapshot,
} from 'firebase/firestore';
import BookingModal from '../components/BookingModal';

/**
 * Recalcule les créneaux "bloqués" (rouges) ET les "places restantes" pour un professeur,
 * … (contenu inchangé)
 */
function computeBookedAndRemaining(lessonsDocs, teacherDoc, forStudentId) {
  const bySlot = new Map(); // "day|hour" -> { individuals: [], groups: [] }

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

    // 1) Individuels : un seul suffit pour bloquer
    const indivBlocks = individuals.some((l) => {
      const st = String(l.status || 'booked');
      return st !== 'rejected' && st !== 'deleted';
    });
    if (indivBlocks) {
      blocked.push({ day, hour });
      continue;
    }

    // 2) Groupes
    if (groups.length > 0) {
      // Élève déjà dans un groupe actif sur ce créneau => on bloque
      const childAlreadyIn = !!forStudentId && groups.some((g) => {
        const ids = Array.isArray(g.participant_ids) ? g.participant_ids : [];
        if (!ids.includes(forStudentId)) return false;
        const st = String(g.participantsMap?.[forStudentId]?.status || 'pending');
        return !['removed', 'deleted', 'rejected'].includes(st);
      });
      if (childAlreadyIn) {
        blocked.push({ day, hour });
        continue;
      }

      // Capacité restante = somme(max(capacity - accepted, 0)) sur tous les groupes du slot
      let totalRemaining = 0;
      let hasRoomSomewhere = false;

      groups.forEach((g) => {
        // ⚠️ Priorité à g.capacity si défini (>0), sinon capacité par défaut prof
        const cap = Number(g.capacity || 0) > 0 ? Number(g.capacity)
                  : (teacherDefaultCap > 1 ? teacherDefaultCap : 1);
        const ids = Array.isArray(g.participant_ids) ? g.participant_ids : [];
        const pm = g.participantsMap || {};
        let accepted = 0;
        ids.forEach((sid) => {
          const st = pm?.[sid]?.status;
          if (st === 'accepted' || st === 'confirmed') accepted += 1;
        });
        const remains = Math.max(0, cap - accepted);
        if (remains > 0) hasRoomSomewhere = true;
        totalRemaining += remains;
      });

      if (!hasRoomSomewhere) {
        blocked.push({ day, hour });
      } else if (totalRemaining > 0) {
        remainingMap[label] = totalRemaining;
      }
      continue;
    }

    // 3) Aucun groupe existant sur ce créneau
    if (teacherGroupEnabled && teacherDefaultCap > 1) {
      remainingMap[label] = teacherDefaultCap;
      continue;
    }
  }

  return { blocked, remainingMap };
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

  // Charger prof + avis
  useEffect(() => {
    const unsubTeacher = onSnapshot(doc(db, 'users', teacherId), (snap) => {
      if (snap.exists()) {
        setTeacher({ ...snap.data(), id: teacherId });
      } else {
        setTeacher(null);
      }
    });
    return () => unsubTeacher();
  }, [teacherId]);

  // Avis du prof en temps réel
  useEffect(() => {
    const q = query(collection(db, 'reviews'), where('teacher_id', '==', teacherId));
    const unsub = onSnapshot(q, (snap) => {
      setReviews(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [teacherId]);

  // Dispos (rouge + badges)
  useEffect(() => {
    if (!teacher) return;

    const q = query(collection(db, 'lessons'), where('teacher_id', '==', teacherId));
    const unsubLessons = onSnapshot(q, (snap) => {
      // 1) Calcul de base (bloqués + restants depuis les docs lessons)
      const { blocked, remainingMap } = computeBookedAndRemaining(
        snap.docs,
        teacher,
        selectedStudentId || auth.currentUser?.uid || null
      );

      // 2) Compléter avec une capacité par défaut sur tous les créneaux "ouverts" du prof
      //    - si group_enabled && group_capacity>1 => cette capacité
      //    - sinon (individuel) => 1
      const fill = { ...remainingMap };
      const defCap =
        teacher?.group_enabled && Number(teacher?.group_capacity) > 1
          ? Math.floor(Number(teacher.group_capacity))
          : 1;

      const avail = teacher?.availability || {}; // { 'Lun': [8,9,10], ... }
      Object.entries(avail).forEach(([day, hours]) => {
        (hours || []).forEach((h) => {
          const key = `${day}:${h}`;
          const isBlocked = blocked.some((b) => b.day === day && b.hour === h);
          // On n’écrase pas une valeur issue d’un "lesson" (groupe existant/capacité custom)
          if (!fill[key] && !isBlocked) {
            fill[key] = defCap; // → 1 en individuel, ou capacité par défaut du prof en groupe
          }
        });
      });

      setBookedSlots(blocked);
      setRemainingBySlot(fill);
    });

    return () => unsubLessons();
  }, [teacherId, teacher, selectedStudentId]);

  // Infos auteurs d'avis
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

  // ✅ Blocages côté front :
  const isTeacherUser = currentRole === 'teacher';
  const isOwnProfile = teacherId === auth.currentUser?.uid;
  const canBook = !isTeacherUser && !isOwnProfile; // profs ne peuvent réserver ni pour eux, ni pour d'autres profs

  /**
   * Réserve 1 seul créneau (utilitaire interne)
   * … (logique inchangée)
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
        status: 'booked',
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
        status: 'booked',
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
   * Handler principal
   */
  const handleBooking = async (selected) => {
    if (!auth.currentUser) return navigate('/login');

    // 🚫 Blocage prof→prof et prof→lui-même
    if (!canBook) {
      setShowBooking(false);
      setConfirmationMsg("Les comptes professeurs ne peuvent pas réserver de cours.");
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
          results.push({ slot, status: 'error', message: `Erreur sur ${slot.day} ${slot.hour}h.` });
        }
      }

      const grouped = { created_group: [], created_individual: [], joined_group: [], duplicate: [], error: [] };
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

      // refresh slots/badges
      try {
        await refreshBookedSlots(teacherId, setBookedSlots, {
          forStudentId: targetStudentId,
          teacherDoc: teacher,
          setRemainingBySlot,
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

          {canBook && (
            <button
              className="bg-primary text-white px-6 py-3 rounded-lg font-semibold shadow hover:bg-primary-dark transition mb-2"
              onClick={() => {
                if (!auth.currentUser) return navigate('/login');
                setShowBooking(true);
                setConfirmationMsg('');
              }}
            >
              {isBooking ? 'Envoi…' : 'Réserver un ou plusieurs créneaux'}
            </button>
          )}

          {confirmationMsg && (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-2 rounded mb-2 text-sm text-center mt-2">
              {confirmationMsg}
            </div>
          )}
        </div>

        {canBook && showBooking && (
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