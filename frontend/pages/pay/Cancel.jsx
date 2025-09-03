import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import DashboardLayout from '../../components/DashboardLayout';
import { auth, db } from '../../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import fetchWithAuth from '../../utils/fetchWithAuth';

const roleToPaths = {
  student: { payments: '/student/payments' },
  parent:  { payments: '/parent/payments'  },
  teacher: { payments: '/prof/earnings'    },
};

export default function PayCancel() {
  const [search] = useSearchParams();
  const lessonId = search.get('lesson') || '';
  const forStudent = search.get('student') || '';

  const [role, setRole] = useState('student');
  const [paying, setPaying] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    const run = async () => {
      try {
        const u = auth.currentUser;
        if (!u) { setRole('student'); return; }
        const s = await getDoc(doc(db, 'users', u.uid));
        if (s.exists()) setRole(s.data().role || 'student');
      } catch {}
    };
    run();
  }, []);

  const resumePayment = async () => {
    setErr('');
    setPaying(true);
    try {
      // 1) Diagnostic : vérifie accès, confirmation, non-payé, etc.
      const diag = await fetchWithAuth('/api/pay/diag', {
        method: 'POST',
        body: JSON.stringify({ lessonId, forStudent: forStudent || undefined }),
      });
      if (!diag.ok) {
        throw new Error(diag.error || 'Diagnostic paiement refusé.');
      }

      // 2) Créer une nouvelle session Checkout
      const data = await fetchWithAuth('/api/pay/create-checkout-session', {
        method: 'POST',
        body: JSON.stringify({ lessonId, forStudent: forStudent || undefined }),
      });
      if (!data?.url) throw new Error('Lien de paiement introuvable.');
      window.location.href = data.url;
    } catch (e) {
      setErr(e.message || 'Impossible de reprendre le paiement.');
      setPaying(false);
    }
  };

  const back = (roleToPaths[role] || roleToPaths.student).payments;

  return (
    <DashboardLayout role={role}>
      <div className="max-w-xl mx-auto bg-white rounded-2xl shadow p-6 border">
        <h2 className="text-2xl font-bold text-red-600 mb-1">❌ Paiement annulé</h2>
        <p className="text-gray-600 text-sm">
          Tu peux reprendre le paiement quand tu veux.
        </p>

        <div className="mt-4 space-y-1 text-sm">
          <div className="text-gray-600">
            <span className="font-semibold">Cours&nbsp;:</span>{' '}
            <span className="font-mono">{lessonId || '—'}</span>
          </div>
          <div className="text-gray-600">
            <span className="font-semibold">Pour l’élève&nbsp;:</span>{' '}
            <span className="font-mono">{forStudent || '—'}</span>
          </div>
        </div>

        {err && <div className="mt-3 text-sm text-red-600">{err}</div>}

        <div className="flex flex-wrap gap-2 mt-6">
          <button
            onClick={resumePayment}
            disabled={paying || !lessonId}
            className="bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white px-4 py-2 rounded font-semibold"
          >
            {paying ? 'Redirection…' : 'Reprendre le paiement'}
          </button>

          <Link
            to={back}
            className="bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded font-semibold"
          >
            Revenir à mes paiements
          </Link>
        </div>

        <p className="text-xs text-gray-500 mt-4">
          Conseil : vérifie le montant et le cours avant de relancer le paiement.
        </p>
      </div>
    </DashboardLayout>
  );
}