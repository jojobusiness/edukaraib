import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { auth, db } from '../lib/firebase';
import {
  doc, getDoc, collection, query, where, getDocs, addDoc, updateDoc,
  serverTimestamp, arrayUnion, onSnapshot,
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

    const indivBlocks = individuals.some((l) => {
      const st = String(l.status || 'booked');
      return st !== 'rejected' && st !== 'deleted';
    });
    if (indivBlocks) { blocked.push({ day, hour }); continue; }

    if (groups.length > 0) {
      const childAlreadyIn = !!forStudentId && groups.some((g) => {
        const ids = Array.isArray(g.participant_ids) ? g.participant_ids : [];
        if (!ids.includes(forStudentId)) return false;
        const st = String(g.participantsMap?.[forStudentId]?.status || 'pending');
        return !['removed', 'deleted', 'rejected'].includes(st);
      });
      if (childAlreadyIn) { blocked.push({ day, hour }); continue; }

      let totalRemaining = 0;
      let hasRoomSomewhere = false;
      groups.forEach((g) => {
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

  // ➕ Options de réservation (NOUVEAU)
  const [bookMode, setBookMode] = useState('presentiel'); // 'presentiel' | 'visio'
  const [packHours, setPackHours] = useState(1);          // 1 | 5 | 10

  // Charger prof + avis
  useEffect(() => {
    const unsubTeacher = onSnapshot(doc(db, 'users', teacherId), (snap) => {
      if (snap.exists()) {
        const t = { ...snap.data(), id: teacherId };
        setTeacher(t);
        // défaut du mode selon dispo prof
        if (t.visio_enabled) {
          setBookMode('presentiel'); // par défaut présentiel, mais visio dispo
        } else {
          setBookMode('presentiel');
        }
      } else {
        setTeacher(null);
      }
    });
    return () => unsubTeacher();
  }, [teacherId]);

  // Avis
  useEffect(() => {
    const q = query(collection(db, 'reviews'), where('teacher_id', '==', teacherId));
    const unsub = onSnapshot(q, (snap) => {
      setReviews(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [teacherId]);

  // Dispos
  useEffect(() => {
    if (!teacher) return;
    const q = query(collection(db, 'lessons'), where('teacher_id', '==', teacherId));
    const unsubLessons = onSnapshot(q, (snap) => {
      const { blocked, remainingMap } = computeBookedAndRemaining(
        snap.docs, teacher, selectedStudentId || auth.currentUser?.uid || null
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

  // Infos auteurs d'avis
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
  const isTeacherUser = currentRole === 'teacher';
  const isOwnProfile = teacherId === auth.currentUser?.uid;
  const canBook = !isTeacherUser && !isOwnProfile;

  // ➕ util: prix visio effectif
  const effectiveVisioPrice = (t) => {
    if (!t?.visio_enabled) return null;
    return t.visio_same_rate ? Number(t.price_per_hour || 0) : Number(t.visio_price_per_hour || 0);
  };

  // ➕ util: prix pack fallback si non rempli en base
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

  // Réservation: un seul créneau
  const bookSingleSlot = async (slot, context) => {
    const { teacherId, teacher, me, bookingFor, targetStudentId, mode, hourly } = context;

    // Doublons (même logique)
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
      return { slot, status: 'duplicate', message: `Déjà inscrit(e) sur ${slot.day} ${slot.hour}h.` };
    }

    // Essayer de rejoindre un groupe existant
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
      return { slot, status: 'joined_group', message: `Ajout au groupe demandé pour ${slot.day} ${slot.hour}h.` };
    }

    // Créer individuel ou groupe
    const groupEnabled = !!teacher?.group_enabled;
    const defaultCap =
      typeof teacher?.group_capacity === 'number' && teacher.group_capacity > 1
        ? Math.floor(teacher.group_capacity)
        : 1;

    if (groupEnabled && defaultCap > 1) {
      const newDoc = await addDoc(collection(db, 'lessons'), {
        teacher_id: teacherId,
        student_id: null,
        parent_id: bookingFor === 'child' ? me.uid : null,
        booked_by: me.uid,
        booked_for: bookingFor,
        status: 'booked',
        created_at: serverTimestamp(),
        subject_id: Array.isArray(teacher?.subjects) ? teacher.subjects.join(', ') : teacher?.subjects || '',
        price_per_hour: hourly || 0,
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
        // ➕ champs nouveaux
        mode,
      });
      await addDoc(collection(db, 'notifications'), {
        user_id: teacherId, read: false, created_at: serverTimestamp(),
        type: 'lesson_request', lesson_id: newDoc.id, requester_id: targetStudentId,
        message: `Demande de créer un groupe (${slot.day} ${slot.hour}h).`,
      });
      return { slot, status: 'created_group', message: `Demande de création de groupe pour ${slot.day} ${slot.hour}h.` };
    } else {
      const newDoc = await addDoc(collection(db, 'lessons'), {
        teacher_id: teacherId,
        student_id: targetStudentId,
        parent_id: bookingFor === 'child' ? me.uid : null,
        booked_by: me.uid,
        booked_for: bookingFor,
        status: 'booked',
        created_at: serverTimestamp(),
        subject_id: Array.isArray(teacher?.subjects) ? teacher.subjects.join(', ') : teacher?.subjects || '',
        price_per_hour: hourly || 0,
        slot_day: slot.day,
        slot_hour: slot.hour,
        is_group: false,
        capacity: 1,
        participant_ids: [],
        participantsMap: {},
        // ➕ champs nouveaux
        mode,
      });
      await addDoc(collection(db, 'notifications'), {
        user_id: teacherId, read: false, created_at: serverTimestamp(),
        type: 'lesson_request', lesson_id: newDoc.id, requester_id: targetStudentId,
        message: `Demande de cours individuel (${slot.day} ${slot.hour}h).`,
      });
      return { slot, status: 'created_individual', message: `Demande de cours individuel pour ${slot.day} ${slot.hour}h.` };
    }
  };

  const handleBooking = async (selected) => {
    if (!auth.currentUser) return navigate('/login');
    if (!canBook) {
      setShowBooking(false);
      setConfirmationMsg("Les comptes professeurs ne peuvent pas réserver de cours.");
      return;
    }

    const me = auth.currentUser;
    const targetStudentId = selectedStudentId || me.uid;
    const bookingFor = (currentRole === 'parent' && targetStudentId !== me.uid) ? 'child' : 'self';
    const slots = Array.isArray(selected) ? selected : [selected];

    // 🧮 tarif à appliquer (mode présentiel/visio)
    const base = Number(teacher?.price_per_hour || 0);
    const visio = effectiveVisioPrice(teacher);
    const hourly = (bookMode === 'visio' && visio !== null) ? visio : base;

    setIsBooking(true);
    setConfirmationMsg('');
    try {
      const results = [];
      for (const slot of slots) {
        try {
          const r = await bookSingleSlot(slot, {
            teacherId, teacher, me, bookingFor, targetStudentId,
            mode: bookMode, hourly
          });
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
      if (grouped.created_individual.length) parts.push(`Demandes individuelles envoyées : ${grouped.created_individual.join(', ')}.`);
      if (grouped.created_group.length) parts.push(`Demandes de création de groupe envoyées : ${grouped.created_group.join(', ')}.`);
      if (grouped.joined_group.length) parts.push(`Demandes d'ajout à un groupe envoyées : ${grouped.joined_group.join(', ')}.`);
      if (grouped.duplicate.length) parts.push(`Déjà inscrit(e) sur : ${grouped.duplicate.join(', ')}.`);
      if (grouped.error.length) parts.push(`Erreurs sur : ${grouped.error.join(', ')}.`);

      setShowBooking(false);
      setConfirmationMsg(parts.length ? parts.join(' ') : "Demandes envoyées.");
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

  const basePrice = Number(teacher.price_per_hour || 0);
  const visioPrice = effectiveVisioPrice(teacher);
  const p5 = pack5Display(teacher);
  const p10 = pack10Display(teacher);

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
          <div className="text-sm text-gray-600 mb-3 text-center">{teacher.bio}</div>

          {/* 🔎 Tarifs affichés */}
          <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <div className="rounded-lg border p-3">
              <div className="text-xs text-gray-500">Tarif présentiel</div>
              <div className="text-lg font-semibold text-yellow-700">
                {Number.isFinite(basePrice) ? `${basePrice.toFixed(2)} € / h` : '—'}
              </div>
            </div>

            <div className="rounded-lg border p-3">
              <div className="text-xs text-gray-500">Tarif visio</div>
              <div className="text-lg font-semibold text-yellow-700">
                {teacher.visio_enabled ? `${(visioPrice ?? basePrice).toFixed(2)} € / h` : 'Non proposé'}
              </div>
            </div>

            <div className="rounded-lg border p-3">
              <div className="text-xs text-gray-500">Pack 5h</div>
              <div className="text-lg font-semibold">
                {p5 !== null ? `${p5.toFixed(2)} €` : '—'}
              </div>
            </div>

            <div className="rounded-lg border p-3">
              <div className="text-xs text-gray-500">Pack 10h</div>
              <div className="text-lg font-semibold">
                {p10 !== null ? `${p10.toFixed(2)} €` : '—'}
              </div>
            </div>
          </div>

          {/* Sélecteur parent */}
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
                Les créneaux en rouge sont indisponibles pour l’élève sélectionné.
              </p>
            </div>
          )}

          {/* ➕ Choix Mode + Pack */}
          <div className="w-full grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <div className="col-span-1">
              <label className="block text-sm font-semibold text-gray-700 mb-1">Mode</label>
              <select
                className="w-full border rounded px-3 py-2"
                value={bookMode}
                onChange={(e) => setBookMode(e.target.value)}
              >
                <option value="presentiel">Présentiel</option>
                {teacher.visio_enabled && <option value="visio">Visio</option>}
              </select>
            </div>
            <div className="col-span-1">
              <label className="block text-sm font-semibold text-gray-700 mb-1">Pack</label>
              <select
                className="w-full border rounded px-3 py-2"
                value={packHours}
                onChange={(e) => setPackHours(Number(e.target.value))}
              >
                <option value={1}>1h (à l’unité)</option>
                <option value={5}>5h (Pack)</option>
                <option value={10}>10h (Pack)</option>
              </select>
            </div>
            <div className="col-span-1 flex items-end">
              {packHours === 5 && p5 !== null && (
                <div className="text-sm text-gray-700">
                  Total pack 5h : <b>{p5.toFixed(2)} €</b>
                </div>
              )}
              {packHours === 10 && p10 !== null && (
                <div className="text-sm text-gray-700">
                  Total pack 10h : <b>{p10.toFixed(2)} €</b>
                </div>
              )}
              {packHours === 1 && (
                <div className="text-sm text-gray-700">
                  Tarif : <b>{(bookMode === 'visio' && visioPrice !== null ? visioPrice : basePrice).toFixed(2)} €</b> / h
                </div>
              )}
            </div>
          </div>

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
            // ➕ impose un nombre de créneaux à sélectionner pour les packs
            requiredCount={packHours > 1 ? packHours : null}
          />
        )}

        {!isOwnProfile && (
          <button
            className="bg-secondary text-white px-6 py-2 rounded-lg font-semibold shadow hover:bg-yellow-500 transition mb-2"
            onClick={() => {
              if (!auth.currentUser) return navigate('/login');
              navigate(`/chat/${teacherId}`);
            }}
          >
            Contacter
          </button>
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
                  <img src={avatar} alt={name} className="w-8 h-8 rounded-full object-cover border" />
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