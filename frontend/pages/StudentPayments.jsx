import React, { useEffect, useMemo, useRef, useState } from 'react';
import { auth, db } from '../lib/firebase';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
  getDocs,
  orderBy,
  limit,
} from 'firebase/firestore';
import DashboardLayout from '../components/DashboardLayout';
import fetchWithAuth from '../utils/fetchWithAuth';

const billedHours = (l) => {
  const pt = String(l.pack_type || l.booking_kind || l.type || '').toLowerCase();
  if (pt === 'pack5' || String(l.pack_hours) === '5' || l.is_pack5) return 5;
  if (pt === 'pack10' || String(l.pack_hours) === '10' || l.is_pack10) return 10;
  const h = Number(l.duration_hours);
  return Number.isFinite(h) && h > 0 ? Math.floor(h) : 1;
};

const fmtDateTime = (start_datetime, slot_day, slot_hour) => {
  if (start_datetime?.toDate) {
    try { return start_datetime.toDate().toLocaleString('fr-FR'); } catch {}
  }
  if (typeof start_datetime?.seconds === 'number') {
    return new Date(start_datetime.seconds * 1000).toLocaleString('fr-FR');
  }
  if (slot_day != null && (slot_hour || slot_hour === 0)) {
    return `${slot_day} • ${String(slot_hour).padStart(2, '0')}:00`;
  }
  return '—';
};

const toNumber = (v) => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const getBaseAmount = (l) => {
  const isPackLesson = (() => {
    const pt = String(l.pack_type || l.booking_kind || l.type || '').toLowerCase();
    return pt === 'pack5' || pt === 'pack10' || String(l.pack_hours) === '5' || String(l.pack_hours) === '10' || l.is_pack5 === true || l.is_pack10 === true;
  })();
  if (isPackLesson) {
    const hours = billedHours(l);
    const isVisio = String(l.mode) === 'visio' || l.is_visio === true;
    const baseRate = isVisio && l.visio_enabled && l.visio_same_rate === false
      ? toNumber(l.visio_price_per_hour)
      : toNumber(l.price_per_hour);
    const packCalc = Number.isFinite(baseRate) ? Number((baseRate * hours * 0.9).toFixed(2)) : 0;
    return toNumber(l.total_amount) || toNumber(l.total_price) || packCalc;
  }
  return (
    toNumber(l.total_amount) ||
    toNumber(l.total_price) ||
    toNumber(l.amount_paid) ||
    toNumber(l.amount) ||
    toNumber(l.price_per_hour)
  );
};

const getDisplayAmount = (l) => {
  const base = getBaseAmount(l) || 0;
  const fee = billedHours(l) * 10;
  return base + fee;
};

// payé pour un élève (legacy ou groupe)
const isPaidForStudent = (lesson, studentId) => {
  if (!lesson) return false;
  if (lesson.participantsMap && studentId) {
    const ent = lesson.participantsMap[studentId];
    if (ent && ent.is_paid === true) return true;
  }
  if (lesson.student_id === studentId && lesson.is_paid === true) return true;
  return false;
};

// éligible au paiement pour moi
const isEligibleForMePayment = (lesson, uid) => {
  if (!uid) return false;
  if (lesson?.is_group) {
    const st = lesson?.participantsMap?.[uid]?.status;
    return st === 'accepted' || st === 'confirmed';
  }
  return ['confirmed','completed','scheduled'].includes(lesson?.status);
};

// --- NOUVEAU : helpers d'étiquette ---
const lessonMode = (l) => (String(l.mode) === 'visio' || l.is_visio === true ? 'visio' : 'presentiel');
const labelMode = (l) => (lessonMode(l) === 'visio' ? 'Visio' : 'Présentiel');
const detectSource = (l) => {
  const packType = String(l.pack_type || l.booking_kind || l.type || '').toLowerCase();
  if (packType === 'pack5' || String(l.pack_hours) === '5' || l.is_pack5 === true) return 'Pack 5h';
  if (packType === 'pack10' || String(l.pack_hours) === '10' || l.is_pack10 === true) return 'Pack 10h';
  return labelMode(l);
};

// --- Pack helpers (affichage / regroupement) ---
const isPack = (l) => {
  const pt = String(l.pack_type || l.booking_kind || l.type || '').toLowerCase();
  return (
    pt === 'pack5' ||
    pt === 'pack10' ||
    String(l.pack_hours) === '5' ||
    String(l.pack_hours) === '10' ||
    l.is_pack5 === true ||
    l.is_pack10 === true
  );
};

const packHoursOf = (l) => {
  if (String(l.pack_hours) === '5' || l.is_pack5 === true) return 5;
  if (String(l.pack_hours) === '10' || l.is_pack10 === true) return 10;
  const pt = String(l.pack_type || l.booking_kind || l.type || '').toLowerCase();
  return pt === 'pack5' ? 5 : pt === 'pack10' ? 10 : 1;
};

// Regroupe toutes les heures d’un pack en UN SEUL item (clé pack)
const packKey = (l, forStudent) => {
  if (!isPack(l)) return `lesson:${l.id}:${forStudent}`;
  const hours = packHoursOf(l);
  const mode = String(l.mode) === 'visio' || l.is_visio === true ? 'visio' : 'presentiel';
  // Si tu as un champ dédié (ex: l.pack_id), remplace AUTO par l.pack_id
  return String(
    l.pack_id || l.pack_group_id || `AUTO:${l.teacher_id}|${l.subject_id || ''}|${mode}|${hours}|${forStudent}`
  );
};

export default function StudentPayments() {
  const [toPay, setToPay] = useState([]);
  const [paid, setPaid] = useState([]);
  const [loading, setLoading] = useState(true);
  const [payingId, setPayingId] = useState(null);
  const [refundingId, setRefundingId] = useState(null);
  const teacherCacheRef = useRef(new Map());
  const [uid, setUid] = useState(auth.currentUser?.uid || null);

  const teacherNameOf = async (uid) => {
    if (!uid) return 'Professeur';
    const cache = teacherCacheRef.current;
    if (cache.has(uid)) return cache.get(uid);
    try {
      const s = await getDoc(doc(db, 'users', uid));
      let name = uid;
      if (s.exists()) {
        const d = s.data();
        name = d.fullName || d.name || d.displayName || uid;
      }
      cache.set(uid, name);
      return name;
    } catch { return uid; }
  };

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) { setLoading(false); return; }
    setUid(user.uid);
    setLoading(true);

    let unsubscribers = [];

    (async () => {
      // 1) Résoudre toutes mes identités (uid + éventuel doc students)
      const myAliases = new Set([String(user.uid)]);

      // a) doc students avec user_id == uid
      try {
        const s1 = await getDocs(query(collection(db, 'students'), where('user_id', '==', user.uid), limit(1)));
        if (!s1.empty) {
          const d = s1.docs[0];
          myAliases.add(String(d.id));
          const data = d.data() || {};
          if (data.uid) myAliases.add(String(data.uid));
          if (data.user_id) myAliases.add(String(data.user_id));
        }
      } catch {}

      // b) doc students avec uid == uid
      try {
        const s2 = await getDocs(query(collection(db, 'students'), where('uid', '==', user.uid), limit(1)));
        if (!s2.empty) {
          const d = s2.docs[0];
          myAliases.add(String(d.id));
          const data = d.data() || {};
          if (data.uid) myAliases.add(String(data.uid));
          if (data.user_id) myAliases.add(String(data.user_id));
        }
      } catch {}

      const aliases = Array.from(new Set(Array.from(myAliases).filter(Boolean).map(String)));
      const chunks = [];
      for (let i = 0; i < aliases.length; i += 10) chunks.push(aliases.slice(i, i + 10));

      let combined = new Map();

      const upsertAndRender = async () => {
        const rows = Array.from(combined.values());

        const enriched = await Promise.all(rows.map(async (l) => ({
          ...l,
          teacherName: await teacherNameOf(l.teacher_id),
        })));

        // --- Regroupement pack ---
        const groupMap = new Map();
        for (const l of enriched) {
          const key = packKey(l, user.uid); // ici l est directement une "lesson" dans StudentPayments
          const isPackLesson = isPack(l);
          if (!groupMap.has(key)) {
            groupMap.set(key, { ...l, __groupCount: 1 });
          } else if (isPackLesson) {
            const rep = groupMap.get(key);
            rep.__groupCount += 1;
            groupMap.set(key, rep);
          }
        }
        const groupedRows = Array.from(groupMap.values());

        // Éligible pour moi (mêmes règles que tu avais)
        const eligibleForMe = groupedRows.filter((l) => isEligibleForMePayment(l, user.uid));

        // Payé / non payé pour moi (en respectant participantsMap / is_paid)
        const unpaid = eligibleForMe.filter((l) => !isPaidForStudent(l, user.uid));
        const paidOnes = groupedRows.filter((l) => isPaidForStudent(l, user.uid));

        const keyTime = (l) =>
          (l.start_datetime?.toDate?.() && l.start_datetime.toDate().getTime()) ||
          (l.start_datetime?.seconds && l.start_datetime.seconds * 1000) ||
          (Number.isFinite(l.slot_hour) ? l.slot_hour : 9_999_999);

        setToPay(unpaid.sort((a, b) => keyTime(a) - keyTime(b)));
        setPaid(paidOnes.sort((a, b) => keyTime(b) - keyTime(a)));
        setLoading(false);
      };

      // 2) Legacy: student_id IN (avec mes aliases)
      for (const c of chunks) {
        const qLegacy = query(collection(db, 'lessons'), where('student_id', 'in', c));
        const unsub = onSnapshot(qLegacy, (snap) => {
          snap.docs.forEach((d) => combined.set(d.id, { id: d.id, ...d.data() }));
          upsertAndRender();
        }, (e) => { console.error(e); setLoading(false); });
        unsubscribers.push(unsub);
      }

      // 3) Groupes: array-contains sur participant_ids pour CHAQUE alias
      aliases.forEach((aid) => {
        const qGroup = query(collection(db, 'lessons'), where('participant_ids', 'array-contains', aid));
        const unsub = onSnapshot(qGroup, (snap) => {
          snap.docs.forEach((d) => combined.set(d.id, { id: d.id, ...d.data() }));
          upsertAndRender();
        }, (e) => { console.error(e); setLoading(false); });
        unsubscribers.push(unsub);
      });
    })();

    return () => { unsubscribers.forEach((u) => u && u()); };
  }, []);

  const totals = useMemo(() => {
    const sum = (arr) => arr.reduce((acc, l) => acc + getDisplayAmount(l), 0);
    return { due: sum(toPay), paid: sum(paid) };
  }, [toPay, paid]);

  const handlePay = async (lesson) => {
    try {
      if (!uid) return;
      setPayingId(lesson.id);

      const diag = await fetchWithAuth('/api/pay/diag', {
        method: 'POST',
        body: JSON.stringify({ lessonId: lesson.id, forStudent: uid }),
      });
      if (!diag?.ok) {
        alert('Diagnostic paiement : ' + (diag?.error || 'inconnu'));
        setPayingId(null);
        return;
      }

      const data = await fetchWithAuth('/api/pay/create-checkout-session', {
        method: 'POST',
        body: JSON.stringify({ lessonId: lesson.id, forStudent: uid }),
      });
      if (!data?.url) throw new Error('Lien de paiement introuvable.');
      window.location.href = data.url;
    } catch (e) {
      console.error(e);
      alert(e.message || 'Impossible de démarrer le paiement.');
    } finally {
      setPayingId(null);
    }
  };

  // --- Résolution du paymentId (payments) pour rembourser ---
  const resolvePaymentId = async (lessonId) => {
    try {
      let qBase = query(
        collection(db, 'payments'),
        where('lesson_id', '==', String(lessonId)),
        where('for_student', '==', String(uid)),
        where('status', 'in', ['held', 'released'])
      );
      qBase = query(qBase, orderBy('created_at', 'desc'), limit(1));
      const snap = await getDocs(qBase);
      if (!snap.empty) return snap.docs[0].id;
      return null;
    } catch (e) {
      console.error('resolvePaymentId error', e);
      return null;
    }
  };

  const handleRefund = async (lesson) => {
    try {
      setRefundingId(lesson.id);
      const paymentId = await resolvePaymentId(lesson.id);
      if (!paymentId) {
        alert('Impossible de retrouver le paiement pour ce cours.');
        return;
      }
      const resp = await fetchWithAuth('/api/refund', {
        method: 'POST',
        body: JSON.stringify({ paymentId }),
      });
      if (!resp || resp.error) throw new Error(resp?.error || 'Échec du remboursement');
      alert('Demande de remboursement envoyée.');
    } catch (e) {
      console.error(e);
      alert(e.message || 'Remboursement impossible.');
    } finally {
      setRefundingId(null);
    }
  };

  return (
    <DashboardLayout role="student">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold text-primary mb-6">💳 Mes paiements</h2>

        {/* À régler (éligibles pour moi) */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-bold text-secondary">Paiements à effectuer</h3>
            {!loading && (
              <span className="text-xs text-gray-600">Total à régler : {totals.due.toFixed(2)} €</span>
            )}
          </div>

          {loading ? (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Chargement…</div>
          ) : toPay.length === 0 ? (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">Aucun paiement en attente !</div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {toPay.map((l) => (
                <div
                  key={l.id}
                  className="bg-white p-5 rounded-xl shadow border flex flex-col md:flex-row md:items-center gap-4 justify-between"
                >
                  <div>
                    <div className="font-bold text-primary">
                      {l.subject_id || 'Matière'}{' '}
                      <span className="text-gray-600 text-xs ml-2">
                        {getDisplayAmount(l) ? `${getDisplayAmount(l).toFixed(2)} €` : ''}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500">Professeur : {l.teacherName || l.teacher_id}</div>
                    <div className="text-xs text-gray-500">Type : {detectSource(l)}</div>
                    <div className="text-xs text-gray-500">📅 {fmtDateTime(l.start_datetime, l.slot_day, l.slot_hour)}</div>
                  </div>

                  <button
                    className="bg-green-600 hover:bg-green-700 text-white px-5 py-2 rounded font-semibold shadow disabled:opacity-60"
                    onClick={() => handlePay(l)}
                    disabled={payingId === l.id}
                    aria-busy={payingId === l.id}
                  >
                    {payingId === l.id ? 'Redirection…' : 'Payer maintenant'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Historique */}
        <div className="bg-white p-6 rounded-xl shadow border">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-primary">Historique des paiements</h3>
            {!loading && (
              <span className="text-xs text-gray-600">Total payé : {totals.paid.toFixed(2)} €</span>
            )}
          </div>

          {loading ? (
            <div className="text-gray-500">Chargement…</div>
          ) : paid.length === 0 ? (
            <div className="text-gray-400 text-sm">Aucun paiement effectué.</div>
          ) : (
            <div className="flex flex-col gap-3">
              {paid.map((l) => (
                <div
                  key={l.id}
                  className="border rounded-lg px-4 py-3 flex flex-col gap-2 bg-gray-50"
                >
                  <div className="flex flex-col md:flex-row md:items-center gap-2">
                    <span className="font-bold text-primary">{l.subject_id || 'Matière'}</span>
                    <span className="text-xs text-gray-600">{fmtDateTime(l.start_datetime, l.slot_day, l.slot_hour)}</span>
                    <span className="text-xs text-gray-600">Type : {detectSource(l)}</span>
                    <span className="text-xs text-gray-600">Prof : {l.teacherName || l.teacher_id}</span>
                    <span className="text-green-600 text-xs font-semibold md:ml-auto">Payé</span>
                  </div>

                  {/* Bouton remboursement */}
                  <div className="flex justify-end">
                    <button
                      className="text-sm px-3 py-1.5 rounded border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-60"
                      onClick={() => handleRefund(l)}
                      disabled={refundingId === l.id}
                    >
                      {refundingId === l.id ? 'Demande en cours…' : 'Demander un remboursement'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}