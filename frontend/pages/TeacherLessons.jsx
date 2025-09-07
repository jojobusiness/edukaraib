import React, { useEffect, useMemo, useRef, useState } from 'react';
import { auth, db } from '../lib/firebase';
import {
  collection, query, where, getDocs, onSnapshot, doc, updateDoc,
  arrayRemove, deleteField,
} from 'firebase/firestore';
import DashboardLayout from '../components/DashboardLayout';

const FR_DAY_ORDER = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

const bySlot = (a, b) => {
  const da = (FR_DAY_ORDER.indexOf(a.slot_day) + 7) % 7;
  const dbi = (FR_DAY_ORDER.indexOf(b.slot_day) + 7) % 7;
  if (da !== dbi) return da - dbi;
  return (Number(a.slot_hour) || 0) - (Number(b.slot_hour) || 0);
};

const pickName = (x) =>
  x?.full_name || x?.fullName || x?.name || x?.displayName || 'Élève';

export default function TeacherLessons() {
  const [pendingIndiv, setPendingIndiv] = useState([]);   // leçons is_group:false, status: booked
  const [pendingGroup, setPendingGroup] = useState([]);   // [{lessonId, lesson, studentId, studentName}]
  const [confirmed, setConfirmed] = useState([]);         // leçons confirmées
  const [names, setNames] = useState(new Map());          // id -> nom
  const [loading, setLoading] = useState(true);

  const userId = auth.currentUser?.uid;
  const nameCacheRef = useRef(new Map());

  useEffect(() => {
    if (!userId) return;
    setLoading(true);

    // Abonnement live à toutes les leçons du prof
    const qAll = query(collection(db, 'lessons'), where('teacher_id', '==', userId));
    const unsub = onSnapshot(qAll, async (snap) => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Confirmés
      const confirmedLessons = all.filter(l => l.status === 'confirmed');
      // Pending individuel (cours “booked”)
      const pendingInd = all.filter(l => !l.is_group && l.status === 'booked');
      // Pending groupe (élèves en 'pending_teacher')
      const pendingG = [];
      all.filter(l => !!l.is_group).forEach(l => {
        const ids = Array.isArray(l.participant_ids) ? l.participant_ids : [];
        const map = l.participantsMap || {};
        ids.forEach((sid) => {
          if (map?.[sid]?.status === 'pending_teacher') {
            pendingG.push({ lessonId: l.id, lesson: l, studentId: sid });
          }
        });
      });

      setConfirmed(confirmedLessons.sort(bySlot));
      setPendingIndiv(pendingInd.sort(bySlot));
      setPendingGroup(pendingG.sort((a, b) => bySlot(a.lesson, b.lesson)));

      // Charger les noms nécessaires
      const idSet = new Set();
      // élèves des pending group
      pendingG.forEach(p => idSet.add(p.studentId));
      // élèves de participants confirmés
      confirmedLessons.forEach(l => {
        const ids = Array.isArray(l.participant_ids) ? l.participant_ids : [];
        const map = l.participantsMap || {};
        ids.forEach((sid) => {
          const st = map?.[sid]?.status || 'confirmed';
          if (st === 'accepted' || st === 'confirmed') idSet.add(sid);
        });
        if (!l.is_group && l.student_id) idSet.add(l.student_id);
      });

      // resolve names
      const pairs = [];
      for (const id of idSet) {
        if (nameCacheRef.current.has(id)) {
          pairs.push([id, nameCacheRef.current.get(id)]);
        } else {
          const nm = await resolveName(id);
          nameCacheRef.current.set(id, nm);
          pairs.push([id, nm]);
        }
      }
      setNames(new Map(pairs));
      setLoading(false);
    }, (e) => {
      console.error(e);
      setLoading(false);
    });

    return () => unsub();
  }, [userId]);

  async function resolveName(id) {
    // students/id en priorité
    try {
      const s = await getDocs(query(collection(db, 'students'), where('__name__', '==', id)));
      if (!s.empty) return pickName(s.docs[0].data());
    } catch {}
    // users/id fallback
    try {
      const u = await getDocs(query(collection(db, 'users'), where('__name__', '==', id)));
      if (!u.empty) return pickName(u.docs[0].data());
    } catch {}
    return id;
  }

  // ——— Actions : individuel ———
  const acceptIndividual = async (lessonId) => {
    await updateDoc(doc(db, 'lessons', lessonId), { status: 'confirmed' });
  };
  const rejectIndividual = async (lessonId) => {
    await updateDoc(doc(db, 'lessons', lessonId), { status: 'rejected' });
  };

  // ——— Actions : groupe (par élève) ———
  const acceptGroupStudent = async (lessonId, studentId) => {
    await updateDoc(doc(db, 'lessons', lessonId), {
      [`participantsMap.${studentId}.status`]: 'confirmed',
    });
  };
  const rejectGroupStudent = async (lessonId, studentId) => {
    await updateDoc(doc(db, 'lessons', lessonId), {
      participant_ids: arrayRemove(studentId),
      [`participantsMap.${studentId}`]: deleteField(),
    });
  };

  const ParticipantChips = ({ lesson }) => {
    const ids = Array.isArray(lesson.participant_ids) ? lesson.participant_ids : [];
    const map = lesson.participantsMap || {};
    const confirmedIds = ids.filter((sid) => {
      const st = map?.[sid]?.status || 'confirmed';
      return st === 'accepted' || st === 'confirmed';
    });
    if (!lesson.is_group) {
      // Individuel confirmé : montre l'élève principal
      return (
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-800 text-xs font-medium">
            {names.get(lesson.student_id) || lesson.student_id || 'Élève'}
          </span>
        </div>
      );
    }
    return (
      <div className="flex flex-wrap gap-2">
        {confirmedIds.length === 0 ? (
          <span className="text-xs text-gray-500">Aucun participant confirmé.</span>
        ) : (
          confirmedIds.map((sid) => (
            <span
              key={`${lesson.id}:${sid}`}
              className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-800 text-xs font-medium"
              title="Participant confirmé"
            >
              {names.get(sid) || sid}
            </span>
          ))
        )}
      </div>
    );
  };

  return (
    <DashboardLayout role="teacher">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-primary">📚 Mes cours</h2>
        <p className="text-gray-600 text-sm">
          Validez ou refusez les demandes. Les élèves en attente n’apparaissent pas dans les participants confirmés.
        </p>
      </div>

      {/* Demandes à valider */}
      <div className="bg-white rounded-xl shadow border p-5 mb-8">
        <h3 className="font-bold text-secondary mb-3">📝 Demandes à valider</h3>

        {loading && <div className="text-gray-500 text-sm">Chargement…</div>}

        {!loading && pendingIndiv.length === 0 && pendingGroup.length === 0 && (
          <div className="text-gray-500 text-sm">Aucune demande en attente.</div>
        )}

        {/* Individuel */}
        {pendingIndiv.length > 0 && (
          <div className="mb-6">
            <div className="font-semibold text-sm mb-2">Cours individuels</div>
            <ul className="space-y-2">
              {pendingIndiv.sort(bySlot).map((l) => (
                <li key={l.id} className="border rounded-lg px-3 py-2 flex items-center gap-3">
                  <span className="text-xs text-gray-600">
                    {l.slot_day} {String(l.slot_hour).padStart(2, '0')}h
                  </span>
                  <span className="text-sm font-medium">{l.subject_id || 'Cours'}</span>
                  <span className="text-xs text-gray-600">• Élève : {names.get(l.student_id) || l.student_id}</span>
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      className="px-3 py-1 rounded bg-green-600 text-white text-xs"
                      onClick={() => acceptIndividual(l.id)}
                    >
                      Accepter
                    </button>
                    <button
                      className="px-3 py-1 rounded bg-red-600 text-white text-xs"
                      onClick={() => rejectIndividual(l.id)}
                    >
                      Refuser
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Groupe (par élève) */}
        {pendingGroup.length > 0 && (
          <div>
            <div className="font-semibold text-sm mb-2">Groupes</div>
            <ul className="space-y-2">
              {pendingGroup.map(({ lessonId, lesson, studentId }) => (
                <li key={`${lessonId}:${studentId}`} className="border rounded-lg px-3 py-2 flex items-center gap-3">
                  <span className="text-xs text-gray-600">
                    {lesson.slot_day} {String(lesson.slot_hour).padStart(2, '0')}h
                  </span>
                  <span className="text-sm font-medium">{lesson.subject_id || 'Cours'}</span>
                  <span className="text-xs text-gray-600">• Élève : {names.get(studentId) || studentId}</span>
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      className="px-3 py-1 rounded bg-green-600 text-white text-xs"
                      onClick={() => acceptGroupStudent(lessonId, studentId)}
                    >
                      Accepter
                    </button>
                    <button
                      className="px-3 py-1 rounded bg-red-600 text-white text-xs"
                      onClick={() => rejectGroupStudent(lessonId, studentId)}
                    >
                      Refuser
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Cours confirmés */}
      <div className="bg-white rounded-xl shadow border p-5">
        <h3 className="font-bold text-primary mb-3">✅ Cours confirmés</h3>
        {loading ? (
          <div className="text-gray-500 text-sm">Chargement…</div>
        ) : confirmed.length === 0 ? (
          <div className="text-gray-500 text-sm">Aucun cours confirmé.</div>
        ) : (
          <ul className="space-y-2">
            {confirmed.map((l) => (
              <li key={l.id} className="border rounded-lg px-3 py-2">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-600">
                    {l.slot_day} {String(l.slot_hour).padStart(2, '0')}h
                  </span>
                  <span className="text-sm font-medium">{l.subject_id || 'Cours'}</span>
                  <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800">Confirmé</span>
                </div>

                <div className="mt-2">
                  <div className="text-xs font-semibold text-gray-700 mb-1">Participants</div>
                  <ParticipantChips lesson={l} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </DashboardLayout>
  );
}