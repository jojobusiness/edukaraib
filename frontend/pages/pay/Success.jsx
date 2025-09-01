import React, { useEffect, useState } from 'react';
import DashboardLayout from '../../components/DashboardLayout';
import fetchWithAuth from '../../utils/fetchWithAuth';
import { auth, db } from '../../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

export default function PaySuccess() {
  const [role, setRole] = useState('student'); // fallback
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  // Récupère le rôle de l'utilisateur connecté pour le libellé + lien retour
  useEffect(() => {
    const u = auth.currentUser;
    if (!u) return;
    (async () => {
      try {
        const s = await getDoc(doc(db, 'users', u.uid));
        if (s.exists()) {
          const r = s.data()?.role || s.data()?.type;
          if (r) setRole(r);
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get('session_id');
    if (!sid) {
      setErr('Session Stripe introuvable.');
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const r = await fetchWithAuth('/api/pay/session-status', {
          method: 'POST',
          body: JSON.stringify({ sessionId: sid }),
        });
        setInfo(r);
      } catch (e) {
        setErr(e.message || 'Erreur de lecture de la session.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const backPath = role === 'parent' ? '/parent/payments' : '/student/payments';

  // Déduire qui a payé (parent vs élève) d’après la leçon renvoyée
  const payerIsParent =
    !!info?.lesson?.parent_id || info?.lesson?.booked_for === 'child';

  const fmtEUR = (cents) =>
    new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })
      .format(Number(cents || 0) / 100);

  return (
    <DashboardLayout role={role || 'student'}>
      <div className="max-w-lg mx-auto bg-white rounded-xl shadow p-6 border">
        <h2 className="text-2xl font-bold text-primary mb-2">
          Paiement réussi ✅
        </h2>
        <p className="text-gray-600 mb-4">
          Merci&nbsp;! Un reçu Stripe a été envoyé par email.
        </p>

        {loading && <div className="text-gray-500">Chargement…</div>}
        {err && <div className="text-red-600 text-sm mb-3">{err}</div>}

        {!loading && !err && info && (
          <div className="text-sm text-gray-700 space-y-1">
            <div>
              Type de payeur&nbsp;: <b>{payerIsParent ? 'Parent' : 'Élève'}</b>
            </div>
            <div>
              Leçon&nbsp;: <b>{info?.lesson?.subject_id || info?.lesson_id || 'Cours'}</b>
            </div>
            <div>
              Montant&nbsp;: <b>{fmtEUR(info?.amount_cents)}</b>
            </div>
            {info?.payment_intent && (
              <div>
                Référence&nbsp;: <span className="font-mono">{info.payment_intent}</span>
              </div>
            )}
          </div>
        )}

        <a
          href={backPath}
          className="inline-block mt-5 text-primary underline font-medium"
        >
          Revenir à mes paiements
        </a>
      </div>
    </DashboardLayout>
  );
}