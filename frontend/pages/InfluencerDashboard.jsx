import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import DashboardLayout from '../components/DashboardLayout';
import { auth, db } from '../lib/firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';

function fmtEur(n) {
  return Number(n || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}

function StatCard({ icon, title, value, borderColor, titleColor }) {
  return (
    <div className={'bg-white rounded-xl shadow p-6 border-l-4 flex flex-col items-start ' + borderColor}>
      <span className="text-3xl mb-2">{icon}</span>
      <span className={'text-xl font-bold ' + titleColor}>{title}</span>
      <span className="text-gray-700 mt-1 text-lg font-semibold">{value}</span>
    </div>
  );
}

export default function InfluencerDashboard() {
  const navigate = useNavigate();
  const [authLoading, setAuthLoading] = useState(true);
  const [influencer, setInfluencer] = useState(null);
  const [uid, setUid] = useState(null);
  const [userFirstName, setUserFirstName] = useState('');

  // IBAN
  const [ibanInput, setIbanInput] = useState('');
  const [ibanSaving, setIbanSaving] = useState(false);
  const [ibanMsg, setIbanMsg] = useState(null);
  const [ibanEdit, setIbanEdit] = useState(false);

  // Code copié
  const [codeCopied, setCodeCopied] = useState(false);

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
      const data = snap.data();
      setUserFirstName(data.firstName || (data.fullName ? data.fullName.split(' ')[0] : ''));
      setUid(firebaseUser.uid);
      setAuthLoading(false);
    });
    return () => unsub();
  }, [navigate]);

  // ── Load influencer doc ─────────────────────────────────────────────────
  const loadInfluencer = useCallback(async (currentUid) => {
    if (!currentUid) return;
    let snap = await getDoc(doc(db, 'influencers', currentUid));
    if (!snap.exists()) {
      const q = query(collection(db, 'influencers'), where('uid', '==', currentUid));
      const qSnap = await getDocs(q);
      if (!qSnap.empty) snap = qSnap.docs[0];
    }
    if (snap && snap.exists()) {
      const data = { id: snap.id, ...snap.data() };
      setInfluencer(data);
      setIbanInput(data.rib || '');
    }
  }, []);

  useEffect(() => { if (uid) loadInfluencer(uid); }, [uid, loadInfluencer]);

  // ── Save IBAN ───────────────────────────────────────────────────────────
  const saveIban = async () => {
    if (!influencer?.id) return;
    const cleaned = ibanInput.trim().replace(/\s/g, '').toUpperCase();
    if (!cleaned) { setIbanMsg({ type: 'err', text: 'IBAN vide.' }); return; }

    // ✅ Validation format IBAN minimal (2 lettres pays + 2 chiffres contrôle + jusqu'à 30 car.)
    const ibanRegex = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{4,30}$/;
    if (!ibanRegex.test(cleaned) || cleaned.length < 15 || cleaned.length > 34) {
      setIbanMsg({ type: 'err', text: 'Format IBAN invalide. Ex : FR7630001007941234567890185' });
      return;
    }

    setIbanSaving(true); setIbanMsg(null);
    try {
      await updateDoc(doc(db, 'influencers', influencer.id), { rib: cleaned });
      setInfluencer(prev => ({ ...prev, rib: cleaned }));
      setIbanMsg({ type: 'ok', text: 'IBAN enregistre avec succes.' });
      setIbanEdit(false);
    } catch (e) {
      setIbanMsg({ type: 'err', text: 'Erreur : ' + e.message });
    } finally {
      setIbanSaving(false);
    }
  };

  const copyCode = () => {
    navigator.clipboard.writeText(influencer?.code || '');
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const conversions = influencer?.conversions || [];
  const pending     = Number(influencer?.pendingPayout || 0);
  const total       = Number(influencer?.totalEarned   || 0);
  const firstName   = userFirstName || 'toi';

  return (
    <DashboardLayout role="influencer">

      {/* En-tete */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-primary mb-2 flex items-center gap-2">
          <span>🎤</span>
          Tableau de bord Influenceur
        </h2>
        <p className="text-gray-600">
          Bonjour {firstName} — retrouvez ici vos infos cles.
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <StatCard
          icon="💸" title="En attente de virement" value={fmtEur(pending)}
          borderColor={pending > 0 ? 'border-amber-400' : 'border-gray-200'}
          titleColor={pending > 0 ? 'text-amber-600' : 'text-gray-500'}
        />
        <StatCard
          icon="🏆" title="Total cumule" value={fmtEur(total)}
          borderColor="border-primary" titleColor="text-primary"
        />
        <StatCard
          icon="📊" title="Conversions"
          value={conversions.length + ' paiement' + (conversions.length > 1 ? 's' : '')}
          borderColor="border-yellow-400" titleColor="text-yellow-600"
        />
      </div>

      {/* Code promo */}
      <div className="bg-white rounded-xl shadow p-5 mb-6">
        <h3 className="font-bold text-primary mb-4">Mon code promo</h3>
        {influencer?.code ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="bg-gray-50 border border-gray-200 rounded-xl px-5 py-3">
                <span className="font-mono text-2xl font-extrabold text-primary tracking-widest">
                  {influencer.code}
                </span>
              </div>
              <button
                onClick={copyCode}
                className={'text-sm font-semibold px-4 py-2.5 rounded-xl border transition-all ' + (codeCopied ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-white border-gray-200 text-gray-600 hover:border-primary hover:text-primary')}
              >
                {codeCopied ? '✓ Copie !' : '📋 Copier le code'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { type: 'Cours unitaire', discount: '-5 EUR client', earn: '+5 EUR', border: 'border-blue-200',    bg: 'bg-blue-50',    color: 'text-blue-700'   },
                { type: 'Pack 5h',        discount: '-10 EUR client', earn: '+10 EUR', border: 'border-purple-200', bg: 'bg-purple-50',  color: 'text-purple-700' },
                { type: 'Pack 10h',       discount: '-30 EUR client', earn: '+20 EUR', border: 'border-primary/30', bg: 'bg-primary/5',  color: 'text-primary'    },
              ].map(r => (
                <div key={r.type} className={'rounded-xl border p-3 ' + r.border + ' ' + r.bg}>
                  <div className="text-xs text-gray-500 mb-1">{r.type}</div>
                  <div className={'text-lg font-extrabold ' + r.color}>{r.earn}</div>
                  <div className="text-xs text-gray-400">{r.discount}</div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
              <span>2 utilisations max par client (1x cours puis 1x pack)</span>
              <span>•</span>
              <span>Valide 6 mois</span>
              <span>•</span>
              <span>Commission creditee apres paiement confirme</span>
            </div>
          </div>
        ) : (
          <p className="text-gray-400 text-sm text-center py-4">
            Code en cours de generation — rafraichis la page dans quelques instants.
          </p>
        )}
      </div>

      {/* IBAN */}
      <div className="bg-white rounded-xl shadow p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <h3 className="font-bold text-primary">Coordonnees bancaires (IBAN)</h3>
          {influencer?.rib && !ibanEdit && (
            <button onClick={() => { setIbanEdit(true); setIbanMsg(null); }}
              className="text-xs text-primary hover:underline font-semibold shrink-0">
              Modifier
            </button>
          )}
        </div>

        <p className="text-gray-500 text-sm mb-3">
          Renseigne ton IBAN pour recevoir tes commissions par virement bancaire.
        </p>

        {influencer?.rib && !ibanEdit ? (
          <div className="flex items-center gap-3">
            <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 font-mono text-sm text-gray-700">
              {influencer.rib.replace(/(.{4})/g, '$1 ').trim()}
            </div>
            <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full inline-block" />
              Enregistre
            </span>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2 flex-wrap">
              <input
                type="text" value={ibanInput} onChange={e => setIbanInput(e.target.value)}
                placeholder="FR76 XXXX XXXX XXXX XXXX XXXX XXX"
                className="border border-gray-200 rounded-xl px-4 py-2.5 font-mono text-sm flex-1 min-w-0 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
              <button onClick={saveIban} disabled={ibanSaving}
                className="bg-primary hover:bg-primary-dark text-white font-bold px-5 py-2.5 rounded-xl text-sm disabled:opacity-50 shrink-0">
                {ibanSaving ? 'Enregistrement...' : 'Enregistrer'}
              </button>
              {ibanEdit && (
                <button onClick={() => { setIbanEdit(false); setIbanInput(influencer?.rib || ''); setIbanMsg(null); }}
                  className="border border-gray-200 text-gray-500 font-semibold px-4 py-2.5 rounded-xl text-sm shrink-0">
                  Annuler
                </button>
              )}
            </div>
            {ibanMsg && (
              <p className={'text-sm font-medium ' + (ibanMsg.type === 'ok' ? 'text-emerald-600' : 'text-red-600')}>
                {ibanMsg.type === 'ok' ? '✓' : '⚠'} {ibanMsg.text}
              </p>
            )}
          </div>
        )}
      </div>

    </DashboardLayout>
  );
}
