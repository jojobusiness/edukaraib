import React, { useEffect, useMemo, useRef, useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import { auth, db } from '../lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  getDoc,
} from 'firebase/firestore';

import EarningsSummary from '../components/earnings/EarningsSummary';
import EarningsChart from '../components/earnings/EarningsChart';
import PaymentsTable from '../components/earnings/PaymentsTable';

// ----- Commission fixe de la plateforme -----
const SITE_FEE_EUR = 10;

// ----- Helpers -----
const fmtEUR = (n) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);

const toNumber = (v) => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const getPaidAmount = (l) =>
  toNumber(l.total_amount) ||
  toNumber(l.total_price) ||
  toNumber(l.amount_paid) ||
  toNumber(l.amount) ||
  toNumber(l.price_per_hour);

const getRevenueDate = (l) => {
  // date de revenu (affichage historique) = date de paiement si dispo, sinon date du cours
  if (l.paid_at?.toDate) { try { return l.paid_at.toDate(); } catch {} }
  if (typeof l.paid_at?.seconds === 'number') return new Date(l.paid_at.seconds * 1000);
  if (l.start_datetime?.toDate) { try { return l.start_datetime.toDate(); } catch {} }
  if (typeof l.start_datetime?.seconds === 'number') return new Date(l.start_datetime.seconds * 1000);
  return new Date();
};

const coerceLessonDate = (l) => {
  if (l?.start_datetime?.toDate) { try { return l.start_datetime.toDate(); } catch {} }
  if (typeof l?.start_datetime?.seconds === 'number') return new Date(l.start_datetime.seconds * 1000);
  return null;
};

const monthLabel = (i) =>
  new Date(2000, i, 1).toLocaleDateString('fr-FR', { month: 'short' });

export default function TeacherEarnings() {
  const [uid, setUid] = useState(auth.currentUser?.uid || null);

  // Leçons du prof
  const [lessons, setLessons] = useState([]);
  const [loadingLessons, setLoadingLessons] = useState(true);

  // Paiements associés à ce prof (held/released/refunded)
  const [payments, setPayments] = useState([]);
  const [loadingPayments, setLoadingPayments] = useState(true);

  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  // caches noms
  const [userNames, setUserNames] = useState({});       // userId -> nom (payer)
  const [studentNames, setStudentNames] = useState({}); // studentId -> nom élève
  const userRequestedRef = useRef(new Set());
  const studentRequestedRef = useRef(new Set());

  // Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUid(u?.uid || null));
    return () => unsub();
  }, []);

  // Live: leçons du prof
  useEffect(() => {
    if (!uid) {
      setLessons([]);
      setLoadingLessons(false);
      return;
    }
    setLoadingLessons(true);
    const qLessons = query(collection(db, 'lessons'), where('teacher_id', '==', uid));
    const unsub = onSnapshot(
      qLessons,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setLessons(rows);
        setLoadingLessons(false);
        ensureNames(rows); // démarrer la résolution des noms
      },
      (err) => {
        console.error(err);
        setLessons([]);
        setLoadingLessons(false);
      }
    );
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // Live: payments du prof (pour détecter les "held" à venir et les "released")
  useEffect(() => {
    if (!uid) {
      setPayments([]);
      setLoadingPayments(false);
      return;
    }
    setLoadingPayments(true);
    const qPays = query(collection(db, 'payments'), where('teacher_uid', '==', uid));
    const unsub = onSnapshot(
      qPays,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setPayments(rows);
        setLoadingPayments(false);
      },
      (err) => {
        console.error(err);
        setPayments([]);
        setLoadingPayments(false);
      }
    );
    return () => unsub();
  }, [uid]);

  // Résout noms PAYER (users) et ÉLÈVE (students OU users)
  const ensureNames = async (rows) => {
    const needUsers = new Set();
    const needStudents = new Set();

    rows.forEach((l) => {
      if (l.paid_by) needUsers.add(l.paid_by);
      else if (l.parent_id && l.booked_for === 'child') needUsers.add(l.parent_id);
      else if (l.booked_by) needUsers.add(l.booked_by);

      if (l.student_id) needStudents.add(l.student_id);
    });

    const toFetchUsers = Array.from(needUsers).filter(
      (id) => id && !userNames[id] && !userRequestedRef.current.has(id)
    );
    const toFetchStudents = Array.from(needStudents).filter(
      (id) => id && !studentNames[id] && !studentRequestedRef.current.has(id)
    );

    toFetchUsers.forEach((id) => userRequestedRef.current.add(id));
    toFetchStudents.forEach((id) => studentRequestedRef.current.add(id));

    if (toFetchUsers.length) {
      const { resolveUserName } = await import('../utils/nameResolvers');
      const entries = await Promise.all(
        toFetchUsers.map(async (id) => [id, await resolveUserName(id)])
      );
      setUserNames((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    }

    if (toFetchStudents.length) {
      const { resolveStudentDisplayName } = await import('../utils/nameResolvers');
      const entries = await Promise.all(
        toFetchStudents.map(async (id) => [id, await resolveStudentDisplayName(id)])
      );
      setStudentNames((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    }
  };

  // Index leçons par id pour accès rapide
  const lessonById = useMemo(() => {
    const map = new Map();
    lessons.forEach((l) => map.set(String(l.id), l));
    return map;
  }, [lessons]);

  // Années dispo (d’après is_paid des leçons)
  const years = useMemo(() => {
    const ys = new Set();
    lessons.forEach((l) => {
      if (!l.is_paid) return;
      ys.add(getRevenueDate(l).getFullYear());
    });
    if (ys.size === 0) ys.add(new Date().getFullYear());
    return Array.from(ys).sort((a, b) => b - a);
  }, [lessons]);

  useEffect(() => {
    if (years.length && !years.includes(selectedYear)) {
      setSelectedYear(years[0]);
    }
  }, [years, selectedYear]);

  // Agrégation pour le graphe & le résumé (basé sur les leçons "is_paid")
  const { chartData, totalGross, totalCommission, totalNet } = useMemo(() => {
    const base = Array.from({ length: 12 }, (_, i) => ({
      idx: i,
      month: monthLabel(i),
      gains: 0,
      net: 0,
    }));

    let gross = 0;
    let commission = 0;

    lessons.forEach((l) => {
      if (!l.is_paid) return;
      const d = getRevenueDate(l);
      if (d.getFullYear() !== selectedYear) return;

      const amount = getPaidAmount(l);  // montant payé par l'élève (inclut +10€ côté front/stockage)
      const fee = Math.min(SITE_FEE_EUR, amount);
      const mIdx = d.getMonth();

      base[mIdx].gains += amount;
      base[mIdx].net += Math.max(0, amount - fee);
      gross += amount;
      commission += fee;
    });

    const net = Math.max(0, gross - commission);

    return {
      chartData: base,
      totalGross: gross,
      totalCommission: commission,
      totalNet: net,
    };
  }, [lessons, selectedYear]);

  // Historique paiements (déjà encaissés par le prof : basé sur leçons is_paid)
  const paymentHistory = useMemo(() => {
    const rows = lessons
      .filter((l) => l.is_paid)
      .map((l) => {
        const date = getRevenueDate(l);
        const amount = getPaidAmount(l);
        const fee = Math.min(SITE_FEE_EUR, amount);
        const net = Math.max(0, amount - fee);

        let payerId =
          l.paid_by || (l.parent_id && l.booked_for === 'child' ? l.parent_id : l.booked_by);
        const payerName = (payerId && userNames[payerId]) || payerId || '—';

        const studentName =
          (l.student_id && studentNames[l.student_id]) ||
          l.student_name || l.studentIdName ||
          l.student_id || '—';

        return {
          id: l.id,
          date,
          dateLabel: date.toLocaleString('fr-FR'),
          payerName,
          studentName,
          subject: l.subject_id || '—',
          gross: amount,
          fee,
          net,
        };
      })
      .sort((a, b) => b.date - a.date);

    return rows;
  }, [lessons, userNames, studentNames]);

  // ---------- NOUVEAU : Paiements à venir (held) en fonction de la date du cours ----------
  const upcomingHeld = useMemo(() => {
    const now = new Date();

    // Prend les payments "held", récupère la leçon liée pour sa date,
    // garde ceux dont la date du cours est FUTURE.
    const rows = payments
      .filter((p) => String(p.status) === 'held')
      .map((p) => {
        const lesson = lessonById.get(String(p.lesson_id));
        const start = lesson ? coerceLessonDate(lesson) : null;

        // Montants : on privilégie les champs du doc payments s'ils existent
        const gross = Number(p.gross_eur ?? NaN);
        const netTeacher = Number(p.net_to_teacher_eur ?? NaN);
        const fee = Number(p.fee_eur ?? NaN);

        const hasAllFromPayment =
          Number.isFinite(gross) && Number.isFinite(netTeacher) && Number.isFinite(fee);

        // fallback depuis la leçon si nécessaire
        let amountGross = hasAllFromPayment
          ? gross
          : Math.max(0, getPaidAmount(lesson)) + SITE_FEE_EUR; // brut ~ prix prof + 10€
        let amountNet = hasAllFromPayment
          ? netTeacher
          : Math.max(0, getPaidAmount(lesson));                 // net prof ~ prix prof

        // Infos d'affichage
        const studentId = p.for_student || lesson?.student_id || null;
        const studentDisplay =
          (studentId && studentNames[studentId]) || studentId || '—';

        return {
          paymentId: p.id,
          lessonId: String(p.lesson_id),
          start,
          subject: lesson?.subject_id || '—',
          studentName: studentDisplay,
          gross: amountGross,
          net: amountNet,
        };
      })
      .filter((r) => r.start && r.start.getTime() > now.getTime())
      .sort((a, b) => a.start - b.start);

    return rows;
  }, [payments, lessonById, studentNames]);

  const loading = loadingLessons || loadingPayments;

  return (
    <DashboardLayout role="teacher">
      <div className="max-w-4xl mx-auto">
        {/* Header + Sélecteur année */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-primary">💰 Mes revenus</h2>
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">Année</label>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="border rounded-lg px-2 py-1 text-sm"
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Info commission */}
        <div className="text-[12px] text-gray-600 mb-4">
          <strong>Info :</strong> les montants <em>bruts</em> correspondent à ce que l’élève paie
          (prix du prof <strong>+ 10&nbsp;€</strong>). La commission est
          <strong> fixe : 10&nbsp;€ par cours/paiement</strong>. Les paiements “retenus” vous sont
          versés automatiquement à l’heure du cours.
        </div>

        {/* ---------- Section Paiements à venir (retenus) ---------- */}
        <div className="bg-white rounded-xl shadow p-6 mb-8 border">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-primary">Paiements à venir (retenus)</h3>
            {!loading && (
              <span className="text-xs text-gray-500">
                {upcomingHeld.length} paiement{upcomingHeld.length > 1 ? 's' : ''} programmé{upcomingHeld.length > 1 ? 's' : ''} à verser
              </span>
            )}
          </div>

          {loading ? (
            <div className="text-gray-500">Chargement…</div>
          ) : upcomingHeld.length === 0 ? (
            <div className="text-gray-500 text-sm">Aucun paiement à venir.</div>
          ) : (
            <div className="flex flex-col gap-3">
              {upcomingHeld.map((r) => (
                <div key={`${r.paymentId}:${r.lessonId}`} className="border rounded-lg px-4 py-3 bg-gray-50 flex flex-col md:flex-row md:items-center gap-2">
                  <div className="font-semibold text-primary">{r.subject}</div>
                  <div className="text-xs text-gray-600">Élève : {r.studentName}</div>
                  <div className="text-xs text-gray-600">
                    📅 {r.start.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                  </div>
                  <div className="md:ml-auto flex items-center gap-3">
                    <span className="text-xs text-gray-700">Brut&nbsp;: {fmtEUR(r.gross)}</span>
                    <span className="text-xs text-green-700 font-semibold">Net&nbsp;: {fmtEUR(r.net)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Résumé (brut/net sur l'année) */}
        <div className="bg-white rounded-xl shadow p-6 mb-8 border">
          <EarningsSummary
            totalGross={totalGross}
            totalCommission={totalCommission}
            totalNet={totalNet}
            commissionRate={0}
            loading={loading}
            subtitle="Frais plateforme fixes : 10 € / paiement"
          />
        </div>

        {/* Graph */}
        <div className="bg-white rounded-xl shadow p-6 border mb-8">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-primary">Évolution sur l’année</h3>
            <span className="text-xs text-gray-500">Brut vs Net (−10 € par paiement)</span>
          </div>
          <EarningsChart chartData={chartData} commissionRate={0} />
        </div>

        {/* Historique encaissements (déjà payés côté élève) */}
        <PaymentsTable rows={paymentHistory} />
      </div>
    </DashboardLayout>
  );
}