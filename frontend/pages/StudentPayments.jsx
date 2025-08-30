import React, { useEffect, useMemo, useRef, useState } from 'react';
import { auth, db } from '../lib/firebase';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import DashboardLayout from '../components/DashboardLayout';
import fetchWithAuth from '../utils/fetchWithAuth'; // <— helper d’API signée (token Firebase)

// Choix du flow de paiement : 'checkout' (bouton) ou 'payment_link' (lien partagé)
const PAY_FLOW = 'checkout'; // ou 'payment_link'

export default function StudentPayments() {
  const [toPay, setToPay] = useState([]);
  const [paid, setPaid] = useState([]);
  const [loading, setLoading] = useState(true);
  const [payingId, setPayingId] = useState(null); // <— pour désactiver le bouton pendant la redirection
  const teacherCacheRef = useRef(new Map()); // évite de re-fetch 100x le même prof
  
  // ---- Helpers ----
  const fmtDateTime = (start_datetime, slot_day, slot_hour) => {
    if (start_datetime?.seconds) {
      return new Date(start_datetime.seconds * 1000).toLocaleString('fr-FR');
    }
    if (slot_day != null && (slot_hour || slot_hour === 0)) {
      return `${slot_day} • ${String(slot_hour).padStart(2, '0')}:00`;
    }
    return '—';
  };

  const upsertTeacherName = async (uid) => {
    if (!uid) return uid || 'Professeur';
    const cache = teacherCacheRef.current;
    if (cache.has(uid)) return cache.get(uid);

    try {
      // users/{uid}
      const snap = await getDoc(doc(db, 'users', uid));
      let name = uid;
      if (snap.exists()) {
        const d = snap.data();
        name = d.fullName || d.name || d.displayName || uid;
      }
      cache.set(uid, name);
      return name;
    } catch {
      return uid;
    }
  };

  // ---- Live fetch des leçons de l'élève connecté ----
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const qLessons = query(
      collection(db, 'lessons'),
      where('student_id', '==', user.uid)
    );

    const unsub = onSnapshot(
      qLessons,
      async (snap) => {
        const lessonsRaw = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

        // hydrate teacherName (cache)
        const enriched = await Promise.all(
          lessonsRaw.map(async (l) => ({
            ...l,
            teacherName: await upsertTeacherName(l.teacher_id),
          }))
        );

        // is_paid absent => false par défaut
        const unpaid = enriched.filter((l) => !!l && l.is_paid !== true);
        const alreadyPaid = enriched.filter((l) => l?.is_paid === true);

        // tri léger pour stabilité d’affichage
        const keyTime = (l) =>
          (l.start_datetime?.seconds ? l.start_datetime.seconds * 1000 : 0) ||
          (Number.isFinite(l.slot_hour) ? l.slot_hour : 9_999_999);

        setToPay(unpaid.sort((a, b) => keyTime(a) - keyTime(b)));
        setPaid(alreadyPaid.sort((a, b) => keyTime(a) - keyTime(b)));
        setLoading(false);
      },
      (err) => {
        console.error('onSnapshot(lessons) error:', err);
        setLoading(false);
      }
    );
    
    return () => unsub();
  }, []);

  // total des montants à payer / déjà payés (facultatif pour affichage)
  const totals = useMemo(() => {
    const sum = (arr) =>
      arr.reduce((acc, l) => acc + (parseFloat(l.price_per_hour || 0) || 0), 0);
    return {
      due: sum(toPay),
      paid: sum(paid),
    };
  }, [toPay, paid]);

  // ---- Paiement : création du lien (Checkout ou Payment Link) puis redirection ----
  const handlePay = async (lesson) => {
    try {
      setPayingId(lesson.id);
      
        // 1) DIAGNOSTIC AVANT CRÉATION
        const diag = await fetchWithAuth('/api/pay/diag', {
        method: 'POST',
        body: JSON.stringify({ lessonId: lesson.id }),
        });
        console.log('[PAY DIAG student]', diag);
        if (!diag.ok) {
        alert('Diagnostic paiement : ' + (diag.error || 'inconnu'));
        setPayingId(null);
        return; // on ne lance pas Stripe si le diag dit "non"
        }

        // 2) CRÉATION DE LA SESSION STRIPE (inchangé)
        const endpoint = '/api/pay/create-checkout-session'; // ou payment-link
        const data = await fetchWithAuth(endpoint, {
        method: 'POST',
        body: JSON.stringify({ lessonId: lesson.id }),
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

  return (
    <DashboardLayout role="student">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold text-primary mb-6">💳 Mes paiements</h2>

        {/* À régler */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-secondary">Paiements à effectuer</h3>
            {!loading && (
              <span className="text-xs text-gray-600">
                Total à régler : {totals.due.toFixed(2)} €
              </span>
            )}
          </div>

          {loading ? (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">
              Chargement…
            </div>
          ) : toPay.length === 0 ? (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">
              Aucun paiement en attente !
            </div>
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
                        {l.price_per_hour ? `${l.price_per_hour} €` : ''}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500">
                      Professeur&nbsp;: {l.teacherName || l.teacher_id}
                    </div>
                    <div className="text-xs text-gray-500">
                      📅 {fmtDateTime(l.start_datetime, l.slot_day, l.slot_hour)}
                    </div>
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
              <span className="text-xs text-gray-600">
                Total payé : {totals.paid.toFixed(2)} €
              </span>
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
                  className="border rounded-lg px-4 py-2 flex flex-col md:flex-row md:items-center gap-2 bg-gray-50"
                >
                  <span className="font-bold text-primary">
                    {l.subject_id || 'Matière'}
                  </span>
                  <span className="text-xs text-gray-600">
                    {fmtDateTime(l.start_datetime, l.slot_day, l.slot_hour)}
                  </span>
                  <span className="text-xs text-gray-600">
                    Prof&nbsp;: {l.teacherName || l.teacher_id}
                  </span>
                  <span className="text-green-600 text-xs font-semibold md:ml-auto">
                    Payé
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}