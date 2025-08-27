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
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

const COMMISSION_RATE = 0.05; // 5%

const fmtEUR = (n) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(n || 0));

const toNum = (v) => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Ordre préféré pour la “date de revenu”
const getRevenueDate = (l) => {
  const ts = l?.paid_at || l?.completed_at || l?.start_datetime || l?.created_at;
  if (!ts) return new Date();
  if (typeof ts?.toDate === 'function') return ts.toDate();
  if (typeof ts?.seconds === 'number') return new Date(ts.seconds * 1000);
  const d = new Date(ts);
  return Number.isFinite(d.getTime()) ? d : new Date();
};

// Montant payé : on essaie d’abord un total, sinon on retombe sur un prix horaire × durée
const getPaidAmount = (l) => {
  // préférences : total_amount | total_price | amount_paid | amount
  const total =
    toNum(l.total_amount) ||
    toNum(l.total_price) ||
    toNum(l.amount_paid) ||
    toNum(l.amount);

  if (total > 0) return total;

  // fallback : price_per_hour × duration_hours (si dispo)
  const pph = toNum(l.price_per_hour);
  const hours =
    toNum(l.duration_hours) ||
    toNum(l.hours) ||
    1; // si pas d’info, on considère 1h pour ne pas perdre le revenu

  return pph * hours;
};

const monthLabel = (i) =>
  new Date(2000, i, 1).toLocaleString('fr-FR', { month: 'short' });

export default function TeacherEarnings() {
  const [uid, setUid] = useState(auth.currentUser?.uid || null);
  const [lessons, setLessons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  // caches noms
  const [userNames, setUserNames] = useState({});     // userId -> "Nom Prénom" (payer = parent/élève)
  const [studentNames, setStudentNames] = useState({}); // studentId -> "Nom élève"
  const userRequestedRef = useRef(new Set());
  const studentRequestedRef = useRef(new Set());

  // Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUid(u?.uid || null));
    return () => unsub();
  }, []);

  // LIVE: leçons du prof
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
        // dès qu'on a des lignes, on prépare la résolution des noms
        ensureNames(rows);
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

  // Résout noms PAYER (users) et ÉLÈVE (students)
  const ensureNames = async (rows) => {
    // collecter ids nécessaires
    const neededUserIds = new Set();
    const neededStudentIds = new Set();

    rows.forEach((l) => {
      // payer probable
      if (l.paid_by) neededUserIds.add(l.paid_by);
      else if (l.parent_id && l.booked_for === 'child') neededUserIds.add(l.parent_id);
      else if (l.booked_by) neededUserIds.add(l.booked_by);

      // élève
      if (l.student_id) neededStudentIds.add(l.student_id);
    });

    // filtrer ceux déjà présents/demandés
    const toFetchUsers = Array.from(neededUserIds).filter(
      (id) => id && !userNames[id] && !userRequestedRef.current.has(id)
    );
    const toFetchStudents = Array.from(neededStudentIds).filter(
      (id) => id && !studentNames[id] && !studentRequestedRef.current.has(id)
    );

    // marquer "en cours"
    toFetchUsers.forEach((id) => userRequestedRef.current.add(id));
    toFetchStudents.forEach((id) => studentRequestedRef.current.add(id));

    // fetch users
    if (toFetchUsers.length) {
      const entries = await Promise.all(
        toFetchUsers.map(async (id) => {
          try {
            const s = await getDoc(doc(db, 'users', id));
            if (s.exists()) {
              const d = s.data();
              const name = d.fullName || d.name || d.displayName || id;
              return [id, name];
            }
          } catch {}
          return [id, id];
        })
      );
      setUserNames((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    }

    // fetch students
    if (toFetchStudents.length) {
      const entries = await Promise.all(
        toFetchStudents.map(async (id) => {
          try {
            const s = await getDoc(doc(db, 'students', id));
            if (s.exists()) {
              const d = s.data();
              const name = d.full_name || d.name || d.first_name || d.firstname || id;
              return [id, name];
            }
          } catch {}
          return [id, id];
        })
      );
      setStudentNames((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    }
  };

  // Années disponibles (où is_paid = true)
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
    if (!years.includes(selectedYear)) {
      setSelectedYear(years[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [years.join('|')]);

  // Agrégation par mois pour l’année sélectionnée
  const { chartData, totalGross, totalCommission, totalNet } = useMemo(() => {
    const base = Array.from({ length: 12 }, (_, i) => ({
      idx: i,
      month: monthLabel(i),
      gains: 0, // brut
      net: 0,   // net après commission
    }));

    let gross = 0;

    lessons.forEach((l) => {
      if (!l.is_paid) return;
      const d = getRevenueDate(l);
      if (d.getFullYear() !== selectedYear) return;

      const mIdx = d.getMonth();
      const amount = getPaidAmount(l);
      base[mIdx].gains += amount;
      base[mIdx].net += amount * (1 - COMMISSION_RATE);
      gross += amount;
    });

    const commission = gross * COMMISSION_RATE;
    const net = gross - commission;

    return {
      chartData: base,
      totalGross: gross,
      totalCommission: commission,
      totalNet: net,
    };
  }, [lessons, selectedYear]);

  // Historique paiements (tri décroissant par date)
  const paymentHistory = useMemo(() => {
    const rows = lessons
      .filter((l) => l.is_paid)
      .map((l) => {
        const date = getRevenueDate(l);
        const amount = getPaidAmount(l);
        // qui a payé ?
        let payerId = l.paid_by || (l.parent_id && l.booked_for === 'child' ? l.parent_id : l.booked_by);
        const payerName = (payerId && userNames[payerId]) || payerId || '—';
        const studentName = (l.student_id && studentNames[l.student_id]) || l.student_id || '—';
        return {
          id: l.id,
          date,
          dateLabel: date.toLocaleString('fr-FR'),
          payerName,
          studentName,
          subject: l.subject_id || '—',
          gross: amount,
          fee: amount * COMMISSION_RATE,
          net: amount * (1 - COMMISSION_RATE),
        };
      })
      .sort((a, b) => b.date - a.date);

    return rows;
  }, [lessons, userNames, studentNames]);

  return (
    <DashboardLayout role="teacher">
      <div className="max-w-4xl mx-auto">
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

        <div className="bg-white rounded-xl shadow p-6 mb-8 border">
          {loading ? (
            <p className="text-gray-500">Calcul en cours…</p>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-4 rounded-lg bg-yellow-50 border">
                  <div className="text-xs uppercase text-yellow-700 font-semibold">Brut</div>
                  <div className="text-xl font-bold">{fmtEUR(totalGross)}</div>
                </div>
                <div className="p-4 rounded-lg bg-orange-50 border">
                  <div className="text-xs uppercase text-orange-700 font-semibold">
                    Commission ({Math.round(COMMISSION_RATE * 100)}%)
                  </div>
                  <div className="text-xl font-bold">{fmtEUR(totalCommission)}</div>
                </div>
                <div className="p-4 rounded-lg bg-emerald-50 border">
                  <div className="text-xs uppercase text-emerald-700 font-semibold">Net</div>
                  <div className="text-xl font-bold">{fmtEUR(totalNet)}</div>
                </div>
              </div>

              <p className="text-xs text-gray-500 mt-3">
                La commission plateforme est fixée à <b>{Math.round(COMMISSION_RATE * 100)}%</b> et est déduite à chaque paiement reçu.
              </p>
            </>
          )}
        </div>

        <div className="bg-white rounded-xl shadow p-6 border">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-primary">Évolution sur l’année</h3>
            <span className="text-xs text-gray-500">Brut vs Net (95%)</span>
          </div>

          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis tickFormatter={(v) => `${v}`} />
              <Tooltip formatter={(v, name) => [fmtEUR(v), name]} />
              <Legend />
              <Bar dataKey="gains" name="Brut" fill="#F59E0B" />
              <Bar dataKey="net" name="Net (95%)" fill="#10B981" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* ===== Historique des paiements ===== */}
        <div className="bg-white rounded-xl shadow p-6 border mt-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-primary">Historique des paiements</h3>
            <span className="text-xs text-gray-500">{paymentHistory.length} paiement(s)</span>
          </div>

          {paymentHistory.length === 0 ? (
            <div className="text-gray-500">Aucun paiement enregistré.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-600 border-b">
                    <th className="py-2 pr-4">Date</th>
                    <th className="py-2 pr-4">Payer</th>
                    <th className="py-2 pr-4">Élève</th>
                    <th className="py-2 pr-4">Matière</th>
                    <th className="py-2 pr-4 text-right">Brut</th>
                    <th className="py-2 pr-4 text-right">Commission (5%)</th>
                    <th className="py-2 pr-0 text-right">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentHistory.map((row) => (
                    <tr key={row.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 whitespace-nowrap">{row.dateLabel}</td>
                      <td className="py-2 pr-4">{row.payerName}</td>
                      <td className="py-2 pr-4">{row.studentName}</td>
                      <td className="py-2 pr-4">{row.subject}</td>
                      <td className="py-2 pr-4 text-right font-medium">{fmtEUR(row.gross)}</td>
                      <td className="py-2 pr-4 text-right">{fmtEUR(row.fee)}</td>
                      <td className="py-2 pr-0 text-right font-semibold text-emerald-700">{fmtEUR(row.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-gray-400 mt-3">
            * Le “Payer” est déterminé par <code>paid_by</code> si présent, sinon <code>parent_id</code> (si réservation pour enfant), sinon <code>booked_by</code>.
          </p>
        </div>
      </div>
    </DashboardLayout>
  );
}