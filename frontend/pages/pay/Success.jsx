import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import DashboardLayout from '../../components/DashboardLayout';
import { auth, db } from '../../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import fetchWithAuth from '../../utils/fetchWithAuth';

const fmtEUR = (cents) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })
    .format((Number(cents || 0)) / 100);

const roleToPaths = {
  student: { payments: '/student/payments', courses: '/my-courses' },
  parent:  { payments: '/parent/payments',  courses: '/parent/courses' },
  teacher: { payments: '/prof/earnings',    courses: '/prof/lessons' },
};

export default function PaySuccess() {
  const [search] = useSearchParams();
  const sessionId = search.get('session_id');

  const [role, setRole] = useState('student');
  const [status, setStatus] = useState(null); // réponse /api/pay/session-status
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  // Rôle utilisateur (pour liens de retour)
  useEffect(() => {
    const run = async () => {
      try {
        const u = auth.currentUser;
        if (!u) { setRole('student'); return; }
        const s = await getDoc(doc(db, 'users', u.uid));
        if (s.exists()) {
          setRole(s.data().role || 'student');
        }
      } catch {}
    };
    run();
  }, []);

  // Vérifier la session Stripe
  useEffect(() => {
    const run = async () => {
      if (!sessionId) {
        setErr('Identifiant de session manquant.');
        setLoading(false);
        return;
      }
      try {
        const data = await fetchWithAuth('/api/pay/session-status', {
          method: 'POST',
          body: JSON.stringify({ sessionId }),
        });
        setStatus(data);
      } catch (e) {
        setErr(e.message || 'Impossible de vérifier la session.');
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [sessionId]);

  const paths = roleToPaths[role] || roleToPaths.student;
  const paid = status?.paid === true || status?.payment_status === 'paid';

  return (
    <DashboardLayout role={role}>
      <div className="max-w-xl mx-auto bg-white rounded-2xl shadow p-6 border">
        <div className="mb-4">
          {paid ? (
            <h2 className="text-2xl font-bold text-emerald-600">✅ Paiement réussi</h2>
          ) : (
            <h2 className="text-2xl font-bold text-amber-600">⏳ Paiement en traitement</h2>
          )}
          <p className="text-gray-600 text-sm mt-1">
            Référence session&nbsp;: <span className="font-mono">{sessionId || '—'}</span>
          </p>
        </div>

        {loading && <div className="text-gray-500">Vérification en cours…</div>}
        {err && <div className="text-red-600">{err}</div>}

        {!loading && !err && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-gray-600 text-sm">Statut Stripe</span>
              <span className={`text-sm font-semibold ${paid ? 'text-emerald-700' : 'text-amber-700'}`}>
                {status?.payment_status || '—'}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-gray-600 text-sm">Montant</span>
              <span className="text-sm font-semibold">
                {fmtEUR(status?.amount_cents || 0)}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-gray-600 text-sm">Cours</span>
              <span className="text-sm font-mono">{status?.lesson_id || '—'}</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-gray-600 text-sm">Pour l’élève</span>
              <span className="text-sm font-mono">{status?.for_student || '—'}</span>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2 mt-6">
          <Link
            to={paths.payments}
            className="bg-primary text-white px-4 py-2 rounded font-semibold"
          >
            Revenir à mes paiements
          </Link>
          <Link
            to={paths.courses}
            className="bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded font-semibold"
          >
            Voir mes cours
          </Link>
        </div>

        {!paid && (
          <p className="text-xs text-gray-500 mt-4">
            Si le statut n’est pas “paid”, le traitement peut prendre un court instant selon le moyen de paiement.
          </p>
        )}
      </div>
    </DashboardLayout>
  );
}