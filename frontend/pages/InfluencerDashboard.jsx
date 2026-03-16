import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import DashboardLayout from '../components/DashboardLayout';
import { auth, db, storage } from '../lib/firebase';
import {
  onAuthStateChanged,
  signOut,
  sendPasswordResetEmail,
  EmailAuthProvider,
  reauthenticateWithCredential,
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
import { ref as sRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import PhoneInput from 'react-phone-number-input';
import 'react-phone-number-input/style.css';

// ── Communes de Guyane ────────────────────────────────────────────────────────
const GUYANE_COMMUNES = [
  'Apatou','Awala-Yalimapo','Camopi','Cayenne','Grand-Santi','Iracoubo',
  'Kourou','Macouria','Mana','Maripasoula','Matoury',
  'Montsinéry-Tonnegrande','Ouanary','Papaïchton','Régina','Rémire-Montjoly',
  'Roura','Saint-Élie','Saint-Georges','Saint-Laurent-du-Maroni','Saül','Sinnamary',
];

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

// ── Stat card (pattern TeacherDashboard) ─────────────────────────────────────
function StatCard({ icon, title, value, borderColor, titleColor }) {
  return (
    <div className={'bg-white rounded-xl shadow p-6 border-l-4 flex flex-col items-start ' + borderColor}>
      <span className="text-3xl mb-2">{icon}</span>
      <span className={'text-xl font-bold ' + titleColor}>{title}</span>
      <span className="text-gray-700 mt-1 text-lg font-semibold">{value}</span>
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────
function Section({ title, children, className = '' }) {
  return (
    <div className={'bg-white rounded-xl shadow p-5 mb-6 ' + className}>
      <h3 className="font-bold text-primary mb-4">{title}</h3>
      {children}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function InfluencerDashboard() {
  const navigate = useNavigate();
  const [authLoading, setAuthLoading] = useState(true);
  const [influencer, setInfluencer] = useState(null);
  const [uid, setUid] = useState(null);

  // Profil fields
  const [profile, setProfile] = useState({
    firstName: '', lastName: '', email: '', phone: '', city: '',
    network: '', profileUrl: '', audienceSize: '', avatarUrl: '',
  });
  const [avatarFile, setAvatarFile] = useState(null);
  const [saving, setSaving] = useState(false);

  // IBAN
  const [ibanInput, setIbanInput] = useState('');
  const [ibanSaving, setIbanSaving] = useState(false);
  const [ibanMsg, setIbanMsg] = useState(null);
  const [ibanEdit, setIbanEdit] = useState(false);

  // Copie
  const [copied, setCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  // ── Auth guard ──────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) { navigate('/influencer', { replace: true }); return; }
      const userSnap = await getDoc(doc(db, 'users', firebaseUser.uid));
      if (!userSnap.exists() || userSnap.data()?.role !== 'influencer') {
        await signOut(auth);
        navigate('/influencer', { replace: true });
        return;
      }
      const data = userSnap.data();
      const loadedFirst = data.firstName || (data.fullName ? data.fullName.split(' ')[0] : '');
      const loadedLast  = data.lastName  || (data.fullName ? data.fullName.split(' ').slice(1).join(' ') : '');
      setProfile({
        firstName:    loadedFirst,
        lastName:     loadedLast,
        email:        data.email || firebaseUser.email || '',
        phone:        data.phone || '',
        city:         data.city || '',
        network:      data.network || '',
        profileUrl:   data.profileUrl || '',
        audienceSize: data.audienceSize || '',
        avatarUrl:    data.avatarUrl || '',
      });
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

  // ── Save profil ─────────────────────────────────────────────────────────
  const handleSave = async (e) => {
    e.preventDefault();
    if (!uid) return;
    setSaving(true);
    try {
      let avatarUrl = profile.avatarUrl || '';
      if (avatarFile) {
        const r = sRef(storage, 'avatars/' + uid);
        await uploadBytes(r, avatarFile);
        avatarUrl = await getDownloadURL(r);
      }
      const fullName = ((profile.firstName || '').trim() + ' ' + (profile.lastName || '').trim()).trim();
      await updateDoc(doc(db, 'users', uid), {
        firstName:    (profile.firstName || '').trim(),
        lastName:     (profile.lastName || '').trim(),
        fullName,
        phone:        (profile.phone || '').trim(),
        city:         (profile.city || '').trim(),
        network:      (profile.network || '').trim(),
        profileUrl:   (profile.profileUrl || '').trim(),
        audienceSize: (profile.audienceSize || '').trim(),
        avatarUrl,
      });
      // Sync nom dans le doc influencers aussi
      if (influencer?.id) {
        await updateDoc(doc(db, 'influencers', influencer.id), { name: fullName });
      }
      setProfile(p => ({ ...p, avatarUrl, fullName }));
      alert('Profil mis a jour !');
    } catch (err) {
      console.error(err);
      alert("Erreur pendant l'enregistrement.");
    } finally {
      setSaving(false);
    }
  };

  // ── Save IBAN ───────────────────────────────────────────────────────────
  const saveIban = async () => {
    if (!influencer?.id) return;
    const cleaned = ibanInput.trim().replace(/\s/g, '').toUpperCase();
    if (!cleaned) { setIbanMsg({ type: 'err', text: 'IBAN vide.' }); return; }
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

  // ── Copie ───────────────────────────────────────────────────────────────
  const copyLink = () => {
    navigator.clipboard.writeText('https://www.edukaraib.com/ref/' + (influencer?.code || ''));
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };
  const copyCode = () => {
    navigator.clipboard.writeText(influencer?.code || '');
    setCodeCopied(true); setTimeout(() => setCodeCopied(false), 2000);
  };

  // ── Actions compte ──────────────────────────────────────────────────────
  const handleLogout = async () => { await signOut(auth); window.location.href = '/'; };

  const handleResetPassword = async () => {
    const email = profile.email || auth.currentUser?.email;
    if (!email) return alert("Pas d'adresse email trouvee.");
    await sendPasswordResetEmail(auth, email);
    alert('Un email de reinitialisation a ete envoye.');
  };

  const handleDeleteAccount = async () => {
    if (!window.confirm('Supprimer definitivement votre compte ?\nCette action est irreversible.')) return;
    try {
      const u = auth.currentUser;
      const idToken = await u.getIdToken(true);
      const r = await fetch('/api/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      alert('Compte supprime. A bientot !');
      window.location.href = '/';
    } catch (err) {
      const msg = String(err?.message || '');
      if (msg.includes('requires-recent-login')) {
        const email = auth.currentUser?.email || '';
        const pwd = window.prompt('Par securite, entrez votre mot de passe (' + email + ') :');
        if (!pwd) return;
        const cred = EmailAuthProvider.credential(email, pwd);
        await reauthenticateWithCredential(auth.currentUser, cred);
        await handleDeleteAccount();
      } else {
        alert('Erreur : ' + msg);
      }
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const conversions   = influencer?.conversions   || [];
  const payoutHistory = influencer?.payoutHistory || [];
  const pending       = Number(influencer?.pendingPayout || 0);
  const total         = Number(influencer?.totalEarned   || 0);
  const shareLink     = 'https://www.edukaraib.com/ref/' + (influencer?.code || '');
  const firstName     = (profile.firstName || '').split(' ')[0] || 'toi';

  return (
    <DashboardLayout role="influencer">

      {/* ── En-tete ── */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-primary mb-2 flex items-center gap-2">
          <span>🎤</span>
          Tableau de bord Influenceur
        </h2>
        <p className="text-gray-600">
          Bonjour {firstName} — retrouvez ici vos commissions, votre code et votre profil.
        </p>
      </div>

      {/* ── KPIs ── */}
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
          icon="📊"
          title="Conversions"
          value={conversions.length + ' paiement' + (conversions.length > 1 ? 's' : '')}
          borderColor="border-yellow-400" titleColor="text-yellow-600"
        />
      </div>

      {/* ── Code et lien ── */}
      <Section title="Mon code et mon lien de partage">
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

            <div className="flex flex-wrap gap-4 text-xs text-gray-400 pt-1">
              <span>Utilisable 2 fois par client (1x cours unitaire puis 1x pack)</span>
              <span>•</span>
              <span>Valide 6 mois</span>
              <span>•</span>
              <span>Commission creditee apres paiement confirme</span>
            </div>
          </div>
        ) : (
          <div className="py-6 text-center text-gray-400 text-sm">
            Ton code est en cours de generation. Rafraichis la page dans quelques instants.
          </div>
        )}
      </Section>

      {/* ── Profil ── */}
      <Section title="Mon profil">
        <form onSubmit={handleSave} className="space-y-5">

          {/* Avatar */}
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-gray-100 overflow-hidden border-2 border-primary shadow shrink-0">
              <img
                src={avatarFile ? URL.createObjectURL(avatarFile) : (profile.avatarUrl || '/avatar-default.png')}
                alt="Avatar"
                className="w-full h-full object-cover"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Photo de profil</label>
              <input type="file" accept="image/*" onChange={e => setAvatarFile(e.target.files?.[0] || null)} className="text-xs text-gray-500" />
            </div>
          </div>

          {/* Prenom / Nom */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block mb-1 text-sm font-medium text-gray-700">Prenom</label>
              <input
                type="text" className="w-full border border-gray-300 rounded-lg px-3 py-2"
                value={profile.firstName} onChange={e => setProfile(p => ({ ...p, firstName: e.target.value }))}
                required placeholder="ex : Marie"
              />
            </div>
            <div>
              <label className="block mb-1 text-sm font-medium text-gray-700">Nom</label>
              <input
                type="text" className="w-full border border-gray-300 rounded-lg px-3 py-2"
                value={profile.lastName} onChange={e => setProfile(p => ({ ...p, lastName: e.target.value }))}
                required placeholder="ex : Dupont"
              />
            </div>
          </div>

          {/* Email (lecture seule) */}
          <div>
            <label className="block mb-1 text-sm font-medium text-gray-700">Adresse email</label>
            <div className="border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 text-sm text-gray-500">
              {profile.email || '—'}
            </div>
          </div>

          {/* Telephone */}
          <div>
            <label className="block mb-1 text-sm font-medium text-gray-700">Telephone</label>
            <PhoneInput
              international defaultCountry="GF"
              value={profile.phone}
              onChange={value => setProfile(p => ({ ...p, phone: value || '' }))}
            />
          </div>

          {/* Ville */}
          <div>
            <label className="block mb-1 text-sm font-medium text-gray-700">Ville (commune)</label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
              value={profile.city} onChange={e => setProfile(p => ({ ...p, city: e.target.value }))}
            >
              <option value="">Selectionner...</option>
              {GUYANE_COMMUNES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Separateur */}
          <div className="flex items-center gap-3 py-1">
            <div className="flex-1 h-px bg-gray-100" />
            <span className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Profil partenaire</span>
            <div className="flex-1 h-px bg-gray-100" />
          </div>

          {/* Reseau */}
          <div>
            <label className="block mb-1 text-sm font-medium text-gray-700">Reseau principal</label>
            <input
              type="text" className="w-full border border-gray-300 rounded-lg px-3 py-2"
              value={profile.network} onChange={e => setProfile(p => ({ ...p, network: e.target.value }))}
              placeholder="Instagram, TikTok, Facebook..."
            />
          </div>

          {/* Lien */}
          <div>
            <label className="block mb-1 text-sm font-medium text-gray-700">Lien profil / page</label>
            <input
              type="text" className="w-full border border-gray-300 rounded-lg px-3 py-2"
              value={profile.profileUrl} onChange={e => setProfile(p => ({ ...p, profileUrl: e.target.value }))}
              placeholder="https://instagram.com/monprofil"
            />
          </div>

          {/* Audience */}
          <div>
            <label className="block mb-1 text-sm font-medium text-gray-700">Taille d'audience</label>
            <input
              type="text" className="w-full border border-gray-300 rounded-lg px-3 py-2"
              value={profile.audienceSize} onChange={e => setProfile(p => ({ ...p, audienceSize: e.target.value }))}
              placeholder="ex : 5 000 abonnes"
            />
          </div>

          <button
            type="submit" disabled={saving}
            className="w-full bg-primary text-white font-semibold py-2.5 rounded-lg shadow hover:bg-primary-dark transition disabled:opacity-60"
          >
            {saving ? 'Enregistrement...' : 'Enregistrer le profil'}
          </button>
        </form>

        {/* Actions compte */}
        <div className="mt-6 flex flex-col gap-2">
          <button onClick={handleLogout}
            className="w-full bg-gray-200 text-gray-700 font-semibold py-2 rounded-lg hover:bg-gray-300 transition">
            Se deconnecter
          </button>
          <button onClick={handleResetPassword}
            className="w-full bg-yellow-100 text-yellow-800 font-semibold py-2 rounded-lg hover:bg-yellow-200 transition">
            Changer de mot de passe
          </button>
          <button onClick={handleDeleteAccount} disabled={saving}
            className="w-full bg-red-100 text-red-800 font-semibold py-2 rounded-lg hover:bg-red-200 transition disabled:opacity-60">
            Supprimer mon compte
          </button>
        </div>
      </Section>

      {/* ── IBAN ── */}
      <Section title="Coordonnees bancaires (IBAN)">
        <div className="flex items-center justify-between mb-3">
          <p className="text-gray-500 text-sm">
            Renseigne ton IBAN pour recevoir tes commissions par virement bancaire.
          </p>
          {influencer?.rib && !ibanEdit && (
            <button onClick={() => { setIbanEdit(true); setIbanMsg(null); }}
              className="text-xs text-primary hover:underline font-semibold shrink-0 ml-3">
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
                className="border border-gray-200 rounded-xl px-4 py-2.5 font-mono text-sm text-gray-800 flex-1 min-w-0 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
              <button onClick={saveIban} disabled={ibanSaving}
                className="bg-primary hover:bg-primary-dark text-white font-bold px-5 py-2.5 rounded-xl text-sm disabled:opacity-50 transition-all shrink-0">
                {ibanSaving ? 'Enregistrement...' : 'Enregistrer'}
              </button>
              {ibanEdit && (
                <button onClick={() => { setIbanEdit(false); setIbanInput(influencer?.rib || ''); setIbanMsg(null); }}
                  className="border border-gray-200 text-gray-500 font-semibold px-4 py-2.5 rounded-xl text-sm transition-colors shrink-0">
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
      </Section>

      {/* ── Historique virements ── */}
      {payoutHistory.length > 0 && (
        <Section title="Historique des virements">
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
        </Section>
      )}

      {/* ── Historique conversions ── */}
      <Section title="Historique des conversions">
        {conversions.length === 0 ? (
          <div className="py-8 text-center">
            <div className="text-gray-400 text-sm">Aucune conversion pour le moment.</div>
            <div className="text-gray-300 text-xs mt-1">Partage ton code pour commencer a gagner.</div>
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
      </Section>

    </DashboardLayout>
  );
}