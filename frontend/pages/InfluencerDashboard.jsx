import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import DashboardLayout from '../components/DashboardLayout';
import { auth, db } from '../lib/firebase';
import {
  onAuthStateChanged,
  signOut,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
} from 'firebase/firestore';

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

// ── Stat card (meme style que TeacherDashboard) ───────────────────────────────
function StatCard({ icon, title, value, borderColor, titleColor }) {
  return (
    <div className={'bg-white rounded-xl shadow p-6 border-l-4 flex flex-col items-start ' + borderColor}>
      <span className="text-3xl mb-2">{icon}</span>
      <span className={'text-xl font-bold ' + titleColor}>{title}</span>
      <span className="text-gray-700 mt-1 text-lg font-semibold">{value}</span>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function InfluencerDashboard() {
  const navigate = useNavigate();
  const [authLoading, setAuthLoading] = useState(true);
  const [influencer, setInfluencer] = useState(null);
  const [user, setUser] = useState(null);
  const [uid, setUid] = useState(null);

  const [ibanInput, setIbanInput] = useState('');
  const [ibanSaving, setIbanSaving] = useState(false);
  const [ibanMsg, setIbanMsg] = useState(null);
  const [ibanEdit, setIbanEdit] = useState(false);

  const [copied, setCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  // ── Auth guard ──────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        navigate('/influencer', { replace: true });
        return;
      }
      const userSnap = await getDoc(doc(db, 'users', firebaseUser.uid));
      if (!userSnap.exists() || userSnap.data()?.role !== 'influencer') {
        await signOut(auth);
        navigate('/influencer', { replace: true });
        return;
      }
      setUser({ id: userSnap.id, ...userSnap.data() });
      setUid(firebaseUser.uid);
      setAuthLoading(false);
    });
    return () => unsub();
  }, [navigate]);

  // ── Load influencer doc ─────────────────────────────────────────────────
  const loadInfluencer = useCallback(async (currentUid) => {
    if (!currentUid) return;
    // Doc influencers/{uid} — l'uid Auth est l'ID du doc (depuis generate-code)
    let snap = await getDoc(doc(db, 'influencers', currentUid));
    if (!snap.exists()) {
      // Fallback : chercher par champ uid
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

  useEffect(() => {
    if (uid) loadInfluencer(uid);
  }, [uid, loadInfluencer]);

  // ── Save IBAN ───────────────────────────────────────────────────────────
  const saveIban = async () => {
    if (!influencer?.id) return;
    const cleaned = ibanInput.trim().replace(/\s/g, '').toUpperCase();
    if (!cleaned) { setIbanMsg({ type: 'err', text: 'IBAN vide.' }); return; }
    setIbanSaving(true);
    setIbanMsg(null);
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

  // ── Copy helpers ────────────────────────────────────────────────────────
  const copyLink = () => {
    navigator.clipboard.writeText('https://www.edukaraib.com/ref/' + (influencer?.code || ''));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyCode = () => {
    navigator.clipboard.writeText(influencer?.code || '');
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  };

  // ── Loading ─────────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const conversions = influencer?.conversions || [];
  const payoutHistory = influencer?.payoutHistory || [];
  const pending = Number(influencer?.pendingPayout || 0);
  const total = Number(influencer?.totalEarned || 0);
  const usageCount = Number(influencer?.usageCount || 0);
  const shareLink = 'https://www.edukaraib.com/ref/' + (influencer?.code || '');
  const firstName = (user?.fullName || '').split(' ')[0] || 'toi';

  return (
    <DashboardLayout role="influencer">

      {/* ── En-tete ── */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-primary mb-2 flex items-center gap-2">
          <span>🎤</span>
          Tableau de bord Influenceur
        </h2>
        <p className="text-gray-600">
          Bonjour {firstName} — retrouvez ici vos commissions, votre code et votre historique.
        </p>
      </div>

      {/* ── KPIs (meme pattern que TeacherDashboard) ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <StatCard
          icon="💸"
          title="En attente de virement"
          value={fmtEur(pending)}
          borderColor={pending > 0 ? 'border-amber-400' : 'border-gray-200'}
          titleColor={pending > 0 ? 'text-amber-600' : 'text-gray-500'}
        />
        <StatCard
          icon="🏆"
          title="Total cumule"
          value={fmtEur(total)}
          borderColor="border-primary"
          titleColor="text-primary"
        />
        <StatCard
          icon="📊"
          title="Conversions"
          value={conversions.length + ' paiement' + (conversions.length > 1 ? 's' : '') + ' genere' + (conversions.length > 1 ? 's' : '')}
          borderColor="border-yellow-400"
          titleColor="text-yellow-600"
        />
      </div>

      {/* ── Code et lien ── */}
      <div className="bg-white rounded-xl shadow p-5 mb-6">
        <h3 className="font-bold text-primary mb-4">Ton code et ton lien de partage</h3>

        {influencer?.code ? (
          <div className="space-y-4">

            {/* Code */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5">
                <span className="font-mono text-xl font-extrabold text-primary tracking-widest">
                  {influencer.code}
                </span>
              </div>
              <button
                onClick={copyCode}
                className={'text-sm font-semibold px-4 py-2 rounded-xl border transition-all ' + (codeCopied ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-white border-gray-200 text-gray-600 hover:border-primary hover:text-primary')}
              >
                {codeCopied ? '✓ Code copie !' : '📋 Copier le code'}
              </button>
            </div>

            {/* Lien */}
            <div className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 flex-wrap">
              <span className="text-sm text-gray-500 font-mono flex-1 min-w-0 truncate">{shareLink}</span>
              <button
                onClick={copyLink}
                className={'text-sm font-bold px-4 py-2 rounded-xl transition-all shrink-0 ' + (copied ? 'bg-emerald-500 text-white' : 'bg-primary hover:bg-primary-dark text-white')}
              >
                {copied ? '✓ Lien copie !' : 'Copier le lien'}
              </button>
            </div>

            {/* Grille commissions */}
            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
                Grille des commissions
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  { type: 'Cours unitaire', discount: '-5 EUR client', earn: '+5 EUR', border: 'border-blue-200', bg: 'bg-blue-50', color: 'text-blue-700' },
                  { type: 'Pack 5h', discount: '-10 EUR client', earn: '+10 EUR', border: 'border-purple-200', bg: 'bg-purple-50', color: 'text-purple-700' },
                  { type: 'Pack 10h', discount: '-30 EUR client', earn: '+20 EUR', border: 'border-primary/30', bg: 'bg-primary/5', color: 'text-primary' },
                ].map(r => (
                  <div key={r.type} className={'rounded-xl border p-3 ' + r.border + ' ' + r.bg}>
                    <div className="text-xs text-gray-500 mb-1">{r.type}</div>
                    <div className={'text-lg font-extrabold ' + r.color}>{r.earn}</div>
                    <div className="text-xs text-gray-400">{r.discount}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Infos */}
            <div className="flex flex-wrap gap-4 text-xs text-gray-400 pt-1">
              <span>Code utilisable 2 fois par client (1x cours + 1x pack)</span>
              <span>•</span>
              <span>Valide 6 mois depuis la creation</span>
              <span>•</span>
              <span>Commission creditee apres paiement Stripe confirme</span>
            </div>
          </div>
        ) : (
          <div className="py-6 text-center text-gray-400 text-sm">
            Ton code est en cours de generation. Rafraichis la page dans quelques instants.
          </div>
        )}
      </div>

      {/* ── IBAN ── */}
      <div className="bg-white rounded-xl shadow p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-primary">Coordonnees bancaires (IBAN)</h3>
          {influencer?.rib && !ibanEdit && (
            <button
              onClick={() => { setIbanEdit(true); setIbanMsg(null); }}
              className="text-xs text-primary hover:underline font-semibold"
            >
              Modifier
            </button>
          )}
        </div>

        {influencer?.rib && !ibanEdit ? (
          <div className="flex items-center gap-3">
            <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 font-mono text-sm text-gray-700">
              {influencer.rib.replace(/(.{4})/g, '$1 ').trim()}
            </div>
            <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
              Enregistre
            </span>
          </div>
        ) : (
          <div className="space-y-3">
            {!influencer?.rib && (
              <p className="text-gray-500 text-sm">
                Renseigne ton IBAN pour recevoir tes commissions par virement bancaire.
                Les virements sont declenches manuellement par l'equipe EduKaraib.
              </p>
            )}
            <div className="flex gap-2 flex-wrap">
              <input
                type="text"
                value={ibanInput}
                onChange={e => setIbanInput(e.target.value)}
                placeholder="FR76 XXXX XXXX XXXX XXXX XXXX XXX"
                className="border border-gray-200 rounded-xl px-4 py-2.5 font-mono text-sm text-gray-800 flex-1 min-w-0 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
              <button
                onClick={saveIban}
                disabled={ibanSaving}
                className="bg-primary hover:bg-primary-dark text-white font-bold px-5 py-2.5 rounded-xl text-sm disabled:opacity-50 transition-all shrink-0"
              >
                {ibanSaving ? 'Enregistrement...' : 'Enregistrer'}
              </button>
              {ibanEdit && (
                <button
                  onClick={() => { setIbanEdit(false); setIbanInput(influencer?.rib || ''); setIbanMsg(null); }}
                  className="border border-gray-200 text-gray-500 hover:text-gray-700 font-semibold px-4 py-2.5 rounded-xl text-sm transition-colors shrink-0"
                >
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

      {/* ── Historique virements ── */}
      {payoutHistory.length > 0 && (
        <div className="bg-white rounded-xl shadow p-5 mb-6">
          <h3 className="font-bold text-primary mb-3">Historique des virements</h3>
          <ul className="divide-y divide-gray-100">
            {[...payoutHistory].reverse().map((p, i) => (
              <li key={i} className="py-3 flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-gray-800">{fmtEur(p.amount_eur)}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{fmtDate(p.triggered_at)}</div>
                </div>
                <span className={'text-xs font-bold px-2.5 py-1 rounded-full ' + (p.status === 'done' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>
                  {p.status === 'done' ? 'Verse' : 'En cours'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Historique conversions ── */}
      <div className="bg-white rounded-xl shadow p-5">
        <h3 className="font-bold text-primary mb-4">Historique des conversions</h3>
        {conversions.length === 0 ? (
          <div className="py-8 text-center">
            <div className="text-gray-400 text-sm">Aucune conversion pour le moment.</div>
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
                  <th className="pb-3 text-right text-xs font-bold uppercase tracking-wider text-gray-400">Commission</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {[...conversions].reverse().map((c, i) => (
                  <tr key={i}>
                    <td className="py-3 text-gray-500">{fmtDate(c.paid_at)}</td>
                    <td className="py-3">
                      <span className={'text-xs font-bold px-2.5 py-1 rounded-full ' + typeBadge(c.type)}>
                        {typeLabel(c.type)}
                      </span>
                    </td>
                    <td className="py-3 text-right font-extrabold text-primary">
                      +{fmtEur(c.amount_eur)}
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