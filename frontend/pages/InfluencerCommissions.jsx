import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import DashboardLayout from '../components/DashboardLayout';
import { auth, db } from '../lib/firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';

// ── Utils ─────────────────────────────────────────────────────────────────────
function fmtDate(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return '—'; }
}
function fmtEur(n) {
  return Number(n || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}
function typeLabel(t) {
  if (t === 'unitaire') return 'Cours unitaire';
  if (t === 'pack5') return 'Pack 5h';
  if (t === 'pack10') return 'Pack 10h';
  return t || '—';
}
function typeBadge(t) {
  if (t === 'unitaire') return 'bg-blue-50 text-blue-700';
  if (t === 'pack5') return 'bg-purple-50 text-purple-700';
  if (t === 'pack10') return 'bg-emerald-50 text-emerald-700';
  return 'bg-gray-100 text-gray-600';
}

export default function InfluencerCommissions() {
  const navigate = useNavigate();
  const [authLoading, setAuthLoading] = useState(true);
  const [influencer, setInfluencer] = useState(null);

  // ── Auth guard ──────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) { navigate('/influencer', { replace: true }); return; }
      const snap = await getDoc(doc(db, 'users', firebaseUser.uid));
      if (!snap.exists() || snap.data()?.role !== 'influencer') {
        await signOut(auth);
        navigate('/influencer', { replace: true });
        return;
      }
      setAuthLoading(false);

      // Load influencer doc
      let iSnap = await getDoc(doc(db, 'influencers', firebaseUser.uid));
      if (!iSnap.exists()) {
        const q = query(collection(db, 'influencers'), where('uid', '==', firebaseUser.uid));
        const qSnap = await getDocs(q);
        if (!qSnap.empty) iSnap = qSnap.docs[0];
      }
      if (iSnap && iSnap.exists()) {
        setInfluencer({ id: iSnap.id, ...iSnap.data() });
      }
    });
    return () => unsub();
  }, [navigate]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const conversions   = influencer?.conversions   || [];
  const payoutHistory = influencer?.payoutHistory || [];
  const total         = Number(influencer?.totalEarned || 0);
  const pending       = Number(influencer?.pendingPayout || 0);

  const nbUnitaire  = conversions.filter(c => c.type === 'unitaire').length;
  const nbPack5     = conversions.filter(c => c.type === 'pack5').length;
  const nbPack10    = conversions.filter(c => c.type === 'pack10').length;
  const totalVerse  = payoutHistory
    .filter(p => p.status === 'done')
    .reduce((s, p) => s + Number(p.amount_eur || 0), 0);

  return (
    <DashboardLayout role="influencer">

      {/* En-tete */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-primary mb-2 flex items-center gap-2">
          <span>💸</span>
          Mes commissions
        </h2>
        <p className="text-gray-600">Detail de toutes vos commissions et virements.</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Cours unitaires', value: nbUnitaire,      color: 'text-blue-700',    border: 'border-blue-200',     bg: 'bg-blue-50'    },
          { label: 'Packs 5h',        value: nbPack5,         color: 'text-purple-700',  border: 'border-purple-200',   bg: 'bg-purple-50'  },
          { label: 'Packs 10h',       value: nbPack10,        color: 'text-primary',     border: 'border-primary/20',   bg: 'bg-primary/5'  },
          { label: 'Total verse',     value: fmtEur(totalVerse), color: 'text-emerald-700', border: 'border-emerald-200', bg: 'bg-emerald-50' },
        ].map(s => (
          <div key={s.label} className={'bg-white rounded-xl shadow p-5 border-l-4 ' + s.border}>
            <div className="text-xs text-gray-500 mb-1">{s.label}</div>
            <div className={'text-2xl font-extrabold ' + s.color}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Table commissions */}
      <div className="bg-white rounded-xl shadow p-5 mb-6">
        <h3 className="font-bold text-primary mb-4">
          Detail des commissions
          <span className="ml-2 text-sm font-normal text-gray-400">
            {conversions.length} entree{conversions.length > 1 ? 's' : ''}
            {' — '}Total : {fmtEur(total)}
            {pending > 0 && (
              <span className="ml-2 text-amber-600 font-semibold">
                ({fmtEur(pending)} en attente)
              </span>
            )}
          </span>
        </h3>

        {conversions.length === 0 ? (
          <div className="py-10 text-center">
            <div className="text-gray-400 text-sm">Aucune commission pour le moment.</div>
            <div className="text-gray-300 text-xs mt-1">
              Partage ton code pour commencer a gagner des commissions.
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-gray-100">
                  <th className="pb-3 text-xs font-bold uppercase tracking-wider text-gray-400">Date</th>
                  <th className="pb-3 text-xs font-bold uppercase tracking-wider text-gray-400">Type</th>
                  <th className="pb-3 text-xs font-bold uppercase tracking-wider text-gray-400">Commission</th>
                  <th className="pb-3 text-xs font-bold uppercase tracking-wider text-gray-400 hidden sm:table-cell">Reference paiement</th>
                  <th className="pb-3 text-xs font-bold uppercase tracking-wider text-gray-400 hidden md:table-cell">ID cours</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {[...conversions].reverse().map((c, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="py-3 text-gray-500 whitespace-nowrap">{fmtDate(c.paid_at)}</td>
                    <td className="py-3">
                      <span className={'text-xs font-bold px-2.5 py-1 rounded-full ' + typeBadge(c.type)}>
                        {typeLabel(c.type)}
                      </span>
                    </td>
                    <td className="py-3 font-extrabold text-primary whitespace-nowrap">
                      +{fmtEur(c.amount_eur)}
                    </td>
                    <td className="py-3 text-xs text-gray-400 font-mono hidden sm:table-cell">
                      {c.session_id
                        ? c.session_id.slice(0, 12) + '...'
                        : (c.payer_uid ? c.payer_uid.slice(0, 12) + '...' : '—')}
                    </td>
                    <td className="py-3 text-xs text-gray-400 font-mono hidden md:table-cell">
                      {c.lesson_id ? c.lesson_id.slice(0, 12) + '...' : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200">
                  <td colSpan={2} className="pt-4 font-bold text-gray-700">Total</td>
                  <td className="pt-4 font-extrabold text-primary">{fmtEur(total)}</td>
                  <td colSpan={2} className="hidden sm:table-cell" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Table virements */}
      <div className="bg-white rounded-xl shadow p-5">
        <h3 className="font-bold text-primary mb-4">Virements recus</h3>

        {payoutHistory.length === 0 ? (
          <div className="py-8 text-center text-gray-400 text-sm">
            Aucun virement pour le moment.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-gray-100">
                  <th className="pb-3 text-xs font-bold uppercase tracking-wider text-gray-400">Date</th>
                  <th className="pb-3 text-xs font-bold uppercase tracking-wider text-gray-400">Montant</th>
                  <th className="pb-3 text-xs font-bold uppercase tracking-wider text-gray-400 hidden sm:table-cell">IBAN</th>
                  <th className="pb-3 text-xs font-bold uppercase tracking-wider text-gray-400">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {[...payoutHistory].reverse().map((p, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="py-3 text-gray-500 whitespace-nowrap">{fmtDate(p.triggered_at)}</td>
                    <td className="py-3 font-extrabold text-gray-800">{fmtEur(p.amount_eur)}</td>
                    <td className="py-3 text-xs text-gray-400 font-mono hidden sm:table-cell">
                      {p.iban
                        ? p.iban.slice(0, 4) + ' •••• •••• ' + p.iban.slice(-4)
                        : '—'}
                    </td>
                    <td className="py-3">
                      <span className={'text-xs font-bold px-2.5 py-1 rounded-full ' + (p.status === 'done' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>
                        {p.status === 'done' ? 'Verse' : 'En cours'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </DashboardLayout>
  );
}
