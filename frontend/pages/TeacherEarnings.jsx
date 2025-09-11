import React, { useEffect, useMemo, useRef, useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import { auth, db } from '../lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, query, where, onSnapshot } from 'firebase/firestore';

import EarningsSummary from '../components/earnings/EarningsSummary';
import EarningsChart from '../components/earnings/EarningsChart';
import PaymentsTable from '../components/earnings/PaymentsTable';

// ===== Plus de 5% : on passe à un FORFAIT =====
const SITE_FEE_EUR = 10; // frais fixes par paiement

// Helpers locaux (remplacent l'ancien utils/earnings basé sur un taux)
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
  // date de revenu = date de paiement si dispo, sinon date du cours
  if (l.paid_at?.toDate) {
    try { return l.paid_at.toDate(); } catch {}
  }
  if (typeof l.paid_at?.seconds === 'number') {
    return new Date(l.paid_at.seconds * 1000);
  }
  if (l.start_datetime?.toDate) {
    try { return l.start_datetime.toDate(); } catch {}
  }
  if (typeof l.start_datetime?.seconds === 'number') {
    return new Date(l.start_datetime.seconds * 1000);
  }
  return new Date();
};
const monthLabel = (i) =>
  new Date(2000, i, 1).toLocaleDateString('fr-FR', { month: 'short' });

export default function TeacherEarnings() {
  const [uid, setUid] = useState(auth.currentUser?.uid || null);
  const [lessons, setLessons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  // caches noms
  const [userNames, setUserNames] = useState({});      // userId -> nom (payer)
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
      setLoading(false);
      return;
    }
    setLoading(true);
    const qLessons = query(collection(db, 'lessons'), where('teacher_id', '==', uid));
    const unsub = onSnapshot(
      qLessons,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setLessons(rows);
        setLoading(false);
        ensureNames(rows); // démarrer la résolution des noms
      },
      (err) => {
        console.error(err);
        setLessons([]);
        setLoading(false);
      }
    );
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Années dispo (d’après is_paid)
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

  // Agrégation par mois (année sélectionnée)
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

      const mIdx = d.getMonth();
      const amount = getPaidAmount(l);  // montant payé par l'élève (hors/avec frais — selon stockage)
      const fee = Math.min(SITE_FEE_EUR, amount); // évite net négatif si petit montant
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

  // Historique paiements
  const paymentHistory = useMemo(() => {
    const rows = lessons
      .filter((l) => l.is_paid)
      .map((l) => {
        const date = getRevenueDate(l);
        const amount = getPaidAmount(l);
        const fee = Math.min(SITE_FEE_EUR, amount);
        const net = Math.max(0, amount - fee);

        let payerId = l.paid_by || (l.parent_id && l.booked_for === 'child' ? l.parent_id : l.booked_by);
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

        {/* Résumé */}
        <div className="bg-white rounded-xl shadow p-6 mb-8 border">
          <EarningsSummary
            totalGross={totalGross}
            totalCommission={totalCommission}
            totalNet={totalNet}
            // Ancien prop pourcentage → on peut l’ignorer côté composant
            commissionRate={0}
            loading={loading}
            subtitle="Frais plateforme fixes : 10 € / paiement"
          />
        </div>

        {/* Graph */}
        <div className="bg-white rounded-xl shadow p-6 border">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-primary">Évolution sur l’année</h3>
            <span className="text-xs text-gray-500">Brut vs Net (−10 € par paiement)</span>
          </div>
          {/* chartData contient déjà gains et net */}
          <EarningsChart chartData={chartData} commissionRate={0} />
        </div>

        {/* Historique */}
        <PaymentsTable rows={paymentHistory} />
      </div>
    </DashboardLayout>
  );
}