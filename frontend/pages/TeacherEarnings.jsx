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

const billedHours = (l) => {
  const pt = String(l.pack_type || l.booking_kind || l.type || '').toLowerCase();
  if (pt === 'pack5' || String(l.pack_hours) === '5' || l.is_pack5) return 5;
  if (pt === 'pack10' || String(l.pack_hours) === '10' || l.is_pack10) return 10;
  const h = Number(l.duration_hours);
  return Number.isFinite(h) && h > 0 ? Math.floor(h) : 1;
};

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

// ----- Détection de la source (Présentiel / Visio / Pack) -----
const detectSource = (l) => {
  // Pack 5/10
  const packType =
    String(l.pack_type || l.booking_kind || l.type || '').toLowerCase();
  if (packType === 'pack5' || String(l.pack_hours) === '5' || l.is_pack5 === true) return 'pack5';
  if (packType === 'pack10' || String(l.pack_hours) === '10' || l.is_pack10 === true) return 'pack10';

  // Visio / Présentiel
  const isVisio = String(l.mode) === 'visio' || l.is_visio === true;
  return isVisio ? 'visio' : 'presentiel';
};

export default function TeacherEarnings() {
  const [uid, setUid] = useState(auth.currentUser?.uid || null);

  // Leçons du prof
  const [lessons, setLessons] = useState([]);
  const [loadingLessons, setLoadingLessons] = useState(true);

  // Paiements associés à ce prof (held/released/refunded)
  const [payments, setPayments] = useState([]);
  const [loadingPayments, setLoadingPayments] = useState(true);

  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [referralData, setReferralData] = useState(null);

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
      const fee = Math.min(billedHours(l) * 10, amount);
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

  // Répartition par source (Présentiel / Visio / Pack 5h / Pack 10h)
  const sourceBreakdown = useMemo(() => {
    const acc = {
      presentiel: { count: 0, gross: 0, net: 0 },
      visio: { count: 0, gross: 0, net: 0 },
      pack5: { count: 0, gross: 0, net: 0 },
      pack10: { count: 0, gross: 0, net: 0 },
    };
    lessons.forEach((l) => {
      if (!l.is_paid) return;
      const d = getRevenueDate(l);
      if (d.getFullYear() !== selectedYear) return;

      const src = detectSource(l);
      const amount = getPaidAmount(l);
      const fee = Math.min(billedHours(l) * 10, amount);
      const net = Math.max(0, amount - fee);
      const bucket = acc[src] || acc.presentiel;

      bucket.count += 1;
      bucket.gross += amount;
      bucket.net += net;
    });
    return acc;
  }, [lessons, selectedYear]);

  // Historique encaissements (déjà payés côté élève)
  const paymentHistory = useMemo(() => {
    const rows = lessons
      .filter((l) => l.is_paid)
      .map((l) => {
        const date = getRevenueDate(l);
        const amount = getPaidAmount(l);
        const fee = Math.min(billedHours(l) * 10, amount);
        const net = Math.max(0, amount - fee);

        let payerId =
          l.paid_by || (l.parent_id && l.booked_for === 'child' ? l.parent_id : l.booked_by);
        const payerName = (payerId && userNames[payerId]) || payerId || '—';

        const studentName =
          (l.student_id && studentNames[l.student_id]) ||
          l.student_name || l.studentIdName ||
          l.student_id || '—';

        const source = detectSource(l); // <- NOUVEAU

        return {
          id: l.id,
          date,
          dateLabel: date.toLocaleString('fr-FR'),
          payerName,
          studentName,
          subject: l.subject_id || '—',
          source, // 'presentiel' | 'visio' | 'pack5' | 'pack10'
          gross: amount,
          fee,
          net,
        };
      })
      .sort((a, b) => b.date - a.date);

    return rows;
  }, [lessons, userNames, studentNames]);

  const loading = loadingLessons || loadingPayments;

  // Charger les données de parrainage
  useEffect(() => {
    if (!uid) return;
    const loadReferral = async () => {
      try {
        const { doc: fsDoc, getDoc } = await import("firebase/firestore");
        const snap = await getDoc(fsDoc(db, "users", uid));
        if (snap.exists()) {
          const d = snap.data();
          setReferralData({
            code: d.referralCode || null,
            filleuls: d.referralFilleuls || [],
            pending: Number(d.referralEarnings?.pending || 0),
            total: Number(d.referralEarnings?.total || 0),
          });
        }
      } catch (e) { console.warn("referral load:", e); }
    };
    loadReferral();
  }, [uid]);

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

        {/* ---------- Section Répartition par source ---------- */}
        <div className="bg-white rounded-xl shadow p-6 mb-8 border">
          <h3 className="font-bold text-primary mb-3">Répartition par source</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { key: 'presentiel', label: 'Présentiel' },
              { key: 'visio', label: 'Visio' },
              { key: 'pack5', label: 'Pack 5h' },
              { key: 'pack10', label: 'Pack 10h' },
            ].map(({ key, label }) => {
              const s = sourceBreakdown[key];
              return (
                <div key={key} className="rounded-lg border p-4 bg-gray-50">
                  <div className="text-xs text-gray-500">{label}</div>
                  <div className="text-lg font-bold">{fmtEUR(s.net)}</div>
                  <div className="text-xs text-gray-600">
                    Brut {fmtEUR(s.gross)} · {s.count} paiement{s.count > 1 ? 's' : ''}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ---------- Section Paiements à venir (retenus) ---------- */}
        <UpcomingHeldSection
          loadingLessons={loadingLessons}
          loadingPayments={loadingPayments}
          payments={payments}
          lessonById={lessonById}
          studentNames={studentNames}
          referralData={referralData}
        />

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

        {/* Historique encaissements (déjà payés) */}
        <PaymentsTable
          rows={paymentHistory.map((r) => ({
            ...r,
            // on enrichit l’intitulé pour que la source soit visible dans le tableau
            subject: `${r.subject} · ${
              r.source === 'presentiel' ? 'Présentiel'
              : r.source === 'visio' ? 'Visio'
              : r.source === 'pack5' ? 'Pack 5h'
              : 'Pack 10h'
            }`,
          }))}
        />
      </div>
    </DashboardLayout>
  );
}

/** Sous-composant : Paiements retenus à venir (inchangé sauf extraction) */
function UpcomingHeldSection({ loadingLessons, loadingPayments, payments, lessonById, studentNames, referralData }) {
  const loading = loadingLessons || loadingPayments;
  const now = new Date();

  const allHeld = useMemo(() => {
    const getPaidAmount = (l) =>
      toNumber(l?.total_amount) ||
      toNumber(l?.total_price) ||
      toNumber(l?.amount_paid) ||
      toNumber(l?.amount) ||
      toNumber(l?.price_per_hour);

    return payments
      .filter((p) => String(p.status) === 'held')
      .map((p) => {
        const lesson = lessonById.get(String(p.lesson_id));
        const start = lesson ? coerceLessonDate(lesson) : null;

        const gross = Number(p.gross_eur ?? NaN);
        const netTeacher = Number(p.net_to_teacher_eur ?? NaN);
        const hasAllFromPayment = Number.isFinite(gross) && Number.isFinite(netTeacher);

        const amountGross = hasAllFromPayment
          ? gross
          : Math.max(0, getPaidAmount(lesson)) + SITE_FEE_EUR;
        const amountNet = hasAllFromPayment ? netTeacher : Math.max(0, getPaidAmount(lesson));

        const studentId = p.for_student || lesson?.student_id || null;
        const studentDisplay = (studentId && studentNames[studentId]) || studentId || '—';

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
      .filter((r) => r.start);
  }, [payments, lessonById, studentNames]);

  // Cours à venir (date future) — paiement reçu, cours pas encore eu lieu
  const upcomingHeld = allHeld
    .filter((r) => r.start.getTime() > now.getTime())
    .sort((a, b) => a.start - b.start);

  // Cours passés (date dépassée) — paiement reçu mais pas encore versé au prof
  const pendingPayout = allHeld
    .filter((r) => r.start.getTime() <= now.getTime())
    .sort((a, b) => a.start - b.start);

  const HeldRow = ({ r }) => (
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
  );

  return (
    <div className="space-y-6 mb-8">

      {/* Cours à venir — paiement déjà reçu */}
      <div className="bg-white rounded-xl shadow p-6 border">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-primary">📅 Paiements reçus — cours à venir</h3>
          {!loading && (
            <span className="text-xs text-gray-500">
              {upcomingHeld.length} cours programmé{upcomingHeld.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
        {loading ? (
          <div className="text-gray-500">Chargement…</div>
        ) : upcomingHeld.length === 0 ? (
          <div className="text-gray-500 text-sm">Aucun cours à venir avec paiement reçu.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {upcomingHeld.map((r) => <HeldRow key={r.paymentId} r={r} />)}
          </div>
        )}
      </div>

      {/* Cours passés — versement en attente */}
      <div className="bg-white rounded-xl shadow p-6 border">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-primary">⏳ Versements en attente</h3>
          {!loading && (
            <span className="text-xs text-gray-500">
              {pendingPayout.length} versement{pendingPayout.length > 1 ? 's' : ''} en cours de traitement
            </span>
          )}
        </div>
        {loading ? (
          <div className="text-gray-500">Chargement…</div>
        ) : pendingPayout.length === 0 ? (
          <div className="text-gray-500 text-sm">Aucun versement en attente. ✅</div>
        ) : (
          <div className="flex flex-col gap-3">
            {pendingPayout.map((r) => (
              <div key={r.paymentId} className="border rounded-lg px-4 py-3 bg-amber-50 flex flex-col md:flex-row md:items-center gap-2">
                <div className="font-semibold text-primary">{r.subject}</div>
                <div className="text-xs text-gray-600">Élève : {r.studentName}</div>
                <div className="text-xs text-gray-600">
                  📅 {r.start.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                </div>
                <div className="md:ml-auto flex items-center gap-3">
                  <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">En cours de virement</span>
                  <span className="text-xs text-green-700 font-semibold">Net&nbsp;: {fmtEUR(r.net)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Section Parrainage ── */}
      <div className="bg-white rounded-xl shadow p-6 border mb-8">
        <h3 className="font-bold text-primary mb-4">🤝 Parrainage</h3>
        {!referralData ? (
          <p className="text-sm text-gray-400">Chargement…</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-lg border p-4 bg-green-50">
                <div className="text-xs text-green-700">En attente de versement</div>
                <div className="text-2xl font-extrabold text-green-800">{referralData.pending.toFixed(2)} €</div>
              </div>
              <div className="rounded-lg border p-4 bg-gray-50">
                <div className="text-xs text-gray-500">Total gagné (parrainage)</div>
                <div className="text-2xl font-extrabold">{referralData.total.toFixed(2)} €</div>
              </div>
              <div className="rounded-lg border p-4 bg-gray-50">
                <div className="text-xs text-gray-500">Filleuls actifs</div>
                <div className="text-2xl font-extrabold">{referralData.filleuls.length}</div>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 bg-green-50 border border-dashed border-green-300 rounded-xl p-4">
              <div className="flex-1">
                <p className="text-sm font-semibold text-green-800 mb-1">Votre code de parrainage</p>
                <p className="font-mono text-xl font-extrabold tracking-widest text-green-900">{referralData.code || '—'}</p>
                <p className="text-xs text-green-700 mt-1">Partagez ce code : vous recevez <strong>10 €</strong> dès le 1er cours de chaque filleul.</p>
              </div>
              {referralData.code && (
                <button type="button"
                  onClick={() => { navigator.clipboard.writeText(referralData.code); alert('Code copié !'); }}
                  className="shrink-0 bg-white border border-green-300 text-green-700 font-bold text-sm px-4 py-2 rounded-xl hover:bg-green-100 transition">
                  📋 Copier
                </button>
              )}
            </div>
            {referralData.filleuls.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">Historique filleuls</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border rounded-xl overflow-hidden">
                    <thead className="bg-gray-50 text-gray-500 text-xs">
                      <tr>
                        <th className="px-4 py-2 text-left">Filleul</th>
                        <th className="px-4 py-2 text-left">Inscrit le</th>
                        <th className="px-4 py-2 text-center">1er cours</th>
                        <th className="px-4 py-2 text-center">1er pack 5h</th>
                        <th className="px-4 py-2 text-right">Prime reçue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {referralData.filleuls.map((f, i) => {
                        const deleted = !!f.deletedAt;
                        return (
                          <tr key={i} className={`border-t ${deleted ? 'bg-red-50' : ''}`}>
                            <td className="px-4 py-2">
                              <div className="flex items-center gap-2">
                                {deleted && (
                                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-500 bg-red-100 px-2 py-0.5 rounded-full shrink-0">
                                    🗑 Compte supprimé
                                  </span>
                                )}
                                <span className={`font-medium ${deleted ? 'line-through text-gray-400' : ''}`}>
                                  {f.name || f.email || '—'}
                                </span>
                              </div>
                              {deleted && (
                                <div className="text-xs text-red-400 mt-0.5">
                                  Supprimé le {f.deletedAt?.toDate ? f.deletedAt.toDate().toLocaleDateString('fr-FR') : '—'}
                                </div>
                              )}
                            </td>
                            <td className={`px-4 py-2 ${deleted ? 'text-gray-400' : 'text-gray-500'}`}>
                              {f.joinedAt?.toDate ? f.joinedAt.toDate().toLocaleDateString('fr-FR') : '—'}
                            </td>
                            <td className="px-4 py-2 text-center">
                              {deleted && !f.firstCoursePaid ? <span className="text-gray-300">—</span> : f.firstCoursePaid ? '✅' : '⏳'}
                            </td>
                            <td className="px-4 py-2 text-center">
                              {deleted && !f.firstPackPaid ? <span className="text-gray-300">—</span> : f.firstPackPaid ? '✅' : '⏳'}
                            </td>
                            <td className={`px-4 py-2 text-right font-semibold ${deleted && !f.firstCoursePaid ? 'text-gray-400' : 'text-green-700'}`}>
                              +{(f.firstCoursePaid ? 10 : 0).toFixed(2)} €
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
}