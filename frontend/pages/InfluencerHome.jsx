import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { auth, db } from '../lib/firebase';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import fetchWithAuth from '../utils/fetchWithAuth';

// ── Champ de formulaire réutilisable ─────────────────────────────────────────
function Field({ label, type = 'text', value, onChange, placeholder, required, autoComplete }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-bold uppercase tracking-widest text-gray-500">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        autoComplete={autoComplete}
        className="border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800 bg-white placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
      />
    </div>
  );
}

// ── Avantage card ─────────────────────────────────────────────────────────────
function AdvCard({ icon, title, desc }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex gap-4 items-start">
      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-xl shrink-0">
        {icon}
      </div>
      <div>
        <div className="font-bold text-gray-900 text-sm">{title}</div>
        <div className="text-gray-500 text-xs mt-0.5 leading-relaxed">{desc}</div>
      </div>
    </div>
  );
}

// ── Composant principal ───────────────────────────────────────────────────────
export default function InfluencerHome() {
  const navigate = useNavigate();
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [loading, setLoading] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [error, setError] = useState('');

  // Login
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Register
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirm, setRegConfirm] = useState('');
  const [regNetwork, setRegNetwork] = useState('');
  const [regUrl, setRegUrl] = useState('');
  const [regAudience, setRegAudience] = useState('');
  const [showLoginPwd, setShowLoginPwd] = useState(false);
  const [showRegPwd, setShowRegPwd] = useState(false);

  // Redirect si deja connecte en tant qu influenceur
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (snap.exists() && snap.data()?.role === 'influencer') {
          navigate('/influencer/dashboard', { replace: true });
          return;
        }
      }
      setCheckingAuth(false);
    });
    return () => unsub();
  }, [navigate]);

  // ── Login ─────────────────────────────────────────────────────────────────
  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, loginEmail, loginPassword);
      const snap = await getDoc(doc(db, 'users', cred.user.uid));
      if (!snap.exists() || snap.data()?.role !== 'influencer') {
        await auth.signOut();
        setError("Ce compte n'est pas un compte influenceur.");
        return;
      }
      navigate('/influencer/dashboard', { replace: true });
    } catch (err) {
      const msgs = {
        'auth/user-not-found': 'Email introuvable.',
        'auth/wrong-password': 'Mot de passe incorrect.',
        'auth/invalid-credential': 'Email ou mot de passe incorrect.',
        'auth/too-many-requests': 'Trop de tentatives. Reessaie dans quelques minutes.',
      };
      setError(msgs[err.code] || 'Erreur de connexion.');
    } finally {
      setLoading(false);
    }
  };

  // ── Register ──────────────────────────────────────────────────────────────
  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');

    if (regPassword !== regConfirm) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }
    if (regPassword.length < 6) {
      setError('Le mot de passe doit faire au moins 6 caracteres.');
      return;
    }

    setLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, regEmail, regPassword);
      const uid = cred.user.uid;

      // Force le refresh du token Firebase pour s'assurer que fetchWithAuth
      // dispose d'un token valide immédiatement apres la creation du compte
      await cred.user.getIdToken(true);

      // La creation du doc users/{uid} avec role='influencer' est deleguee
      // a l'API (adminDb cote serveur) — empeche l'auto-attribution de role cote client
      const apiRes = await fetchWithAuth('/api/generate-influencer-code', {
        method: 'POST',
        body: JSON.stringify({
          name: regName.trim(),
          email: regEmail.trim().toLowerCase(),
          uid,
          network: regNetwork.trim(),
          profileUrl: regUrl.trim(),
          audienceSize: regAudience.trim(),
          createUserDoc: true,
        }),
      });

      if (apiRes && !apiRes.uid && !apiRes.code) {
        throw new Error(apiRes.error || 'Erreur lors de la creation du compte partenaire.');
      }


      navigate('/influencer/dashboard', { replace: true });
    } catch (err) {
      const msgs = {
        'auth/email-already-in-use': 'Cet email est deja utilise.',
        'auth/invalid-email': 'Email invalide.',
        'auth/weak-password': 'Mot de passe trop faible.',
      };
      setError(msgs[err.code] || "Erreur lors de l'inscription : " + err.message);
      if (auth.currentUser) await auth.currentUser.delete().catch(() => {});
    } finally {
      setLoading(false);
    }
  };

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // ── Avantages ─────────────────────────────────────────────────────────────
  const avantages = [
    {
      icon: '💸',
      title: "Jusqu'a 20 EUR par pack vendu",
      desc: 'Cours unitaire : +5 EUR — Pack 5h : +10 EUR — Pack 10h : +20 EUR',
    },
    {
      icon: '🔗',
      title: 'Lien unique tracable',
      desc: 'Un code personnel partage en 1 clic. Tu suis tes conversions en temps reel.',
    },
    {
      icon: '♾️',
      title: 'Sans limite de conversions',
      desc: 'Aucun plafond. Plus tu partages, plus tu gagnes.',
    },
    {
      icon: '🏦',
      title: 'Virement bancaire direct',
      desc: 'Renseigne ton IBAN dans ton espace et recois tes commissions.',
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* ── Header ── */}
      <header className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
        <Link to="/" className="text-2xl font-extrabold text-primary tracking-tight">
          EduKaraib
        </Link>
        <span className="text-xs font-semibold uppercase tracking-widest text-gray-400 hidden sm:block">
          Programme Partenaires
        </span>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-10 md:py-16 grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">

        {/* ── Colonne gauche : présentation ── */}
        <div className="space-y-8">

          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-full px-4 py-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-amber-700 text-xs font-bold uppercase tracking-wider">
              Programme ouvert — au Caraïbe
            </span>
          </div>

          {/* Titre */}
          <div>
            <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900 leading-tight tracking-tight">
              Partage EduKaraib,
              <span className="block text-primary">gagne a chaque vente.</span>
            </h1>
            <p className="mt-4 text-gray-500 text-lg leading-relaxed max-w-md">
              Rejoins notre reseau de partenaires locaux en au Caraïbe.
              Un code, un lien, des commissions directes sur chaque cours vendu.
            </p>
          </div>

          {/* Grille commissions */}
          <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
            <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
              <span className="text-xs font-bold uppercase tracking-widest text-gray-400">
                Grille des commissions
              </span>
            </div>
            <div className="divide-y divide-gray-50">
              {[
                { type: 'Cours unitaire', client: '-5 EUR client', earn: '+5 EUR', color: 'text-blue-600 bg-blue-50' },
                { type: 'Pack 5h', client: '-10 EUR client', earn: '+10 EUR', color: 'text-emerald-600 bg-emerald-50' },
                { type: 'Pack 10h', client: '-30 EUR client', earn: '+20 EUR', color: 'text-primary bg-primary/5' },
              ].map(r => (
                <div key={r.type} className="flex items-center justify-between px-5 py-3.5">
                  <div>
                    <span className="font-semibold text-gray-800 text-sm">{r.type}</span>
                    <span className="ml-2 text-xs text-gray-400">{r.client}</span>
                  </div>
                  <span className={`text-sm font-extrabold px-3 py-1 rounded-full ${r.color}`}>
                    {r.earn}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Avantages */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {avantages.map(a => (
              <AdvCard key={a.title} icon={a.icon} title={a.title} desc={a.desc} />
            ))}
          </div>

          {/* Image illustrative */}
          <div className="relative rounded-2xl overflow-hidden h-48 shadow-sm">
            <img
              src="/hero-promo-2026.png"
              alt="Partenaires EduKaraib"
              className="w-full h-full object-cover object-center"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-white/80 to-transparent" />
            <div className="absolute inset-0 flex items-center px-6">
              <div>
                <div className="font-extrabold text-gray-900 text-lg leading-tight">
                  Professeurs verifies en au Caraïbe
                </div>
                <div className="text-gray-600 text-sm mt-1">
                  Presentiel et visio disponibles
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Colonne droite : formulaire ── */}
        <div className="lg:sticky lg:top-8">
          <div className="bg-white rounded-3xl border border-gray-100 shadow-xl p-6 md:p-8">

            {/* Toggle */}
            <div className="flex bg-gray-100 rounded-xl p-1 mb-6">
              {[
                { key: 'login', label: 'Connexion' },
                { key: 'register', label: 'Inscription' },
              ].map(m => (
                <button
                  key={m.key}
                  onClick={() => { setMode(m.key); setError(''); }}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${
                    mode === m.key
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {/* Titre formulaire */}
            <div className="mb-5">
              <h2 className="text-xl font-extrabold text-gray-900">
                {mode === 'login' ? 'Bon retour 👋' : 'Creer mon espace partenaire'}
              </h2>
              <p className="text-gray-400 text-sm mt-0.5">
                {mode === 'login'
                  ? 'Connecte-toi pour acceder a ton dashboard'
                  : 'Inscription gratuite, commissions immediates'}
              </p>
            </div>

            {/* Erreur */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-600 text-sm mb-5 flex items-start gap-2">
                <span className="text-red-400 mt-0.5">⚠</span>
                {error}
              </div>
            )}

            {/* ── LOGIN ── */}
            {mode === 'login' && (
              <form onSubmit={handleLogin} className="space-y-4">
                <Field
                  label="Adresse email"
                  type="email"
                  value={loginEmail}
                  onChange={setLoginEmail}
                  placeholder="ton@email.com"
                  required
                  autoComplete="email"
                />
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold uppercase tracking-widest text-gray-500">Mot de passe</label>
                  <div className="relative">
                    <input
                      type={showLoginPwd ? "text" : "password"}
                      value={loginPassword}
                      onChange={e => setLoginPassword(e.target.value)}
                      placeholder="Mot de passe"
                      required
                      autoComplete="current-password"
                      className="w-full pr-10 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                    />
                    <button type="button" onClick={() => setShowLoginPwd(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" tabIndex={-1}>
                      {showLoginPwd
                        ? <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 4.411m0 0L21 21" /></svg>
                        : <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                      }
                    </button>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-primary hover:bg-primary-dark text-white font-bold py-3.5 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-2 text-sm"
                >
                  {loading ? 'Connexion en cours...' : 'Se connecter'}
                </button>
              </form>
            )}

            {/* ── REGISTER ── */}
            {mode === 'register' && (
              <form onSubmit={handleRegister} className="space-y-4">
                <Field
                  label="Nom complet"
                  value={regName}
                  onChange={setRegName}
                  placeholder="Marie Dupont"
                  required
                  autoComplete="name"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field
                    label="Email"
                    type="email"
                    value={regEmail}
                    onChange={setRegEmail}
                    placeholder="marie@email.com"
                    required
                    autoComplete="email"
                  />
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold uppercase tracking-widest text-gray-500">Mot de passe</label>
                    <div className="relative">
                      <input
                        type={showRegPwd ? "text" : "password"}
                        value={regPassword}
                        onChange={e => setRegPassword(e.target.value)}
                        placeholder="Min. 6 caracteres"
                        required
                        autoComplete="new-password"
                        className="w-full pr-10 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                      />
                      <button type="button" onClick={() => setShowRegPwd(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" tabIndex={-1}>
                        {showRegPwd
                          ? <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 4.411m0 0L21 21" /></svg>
                          : <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                        }
                      </button>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold uppercase tracking-widest text-gray-500">Confirmer le mot de passe</label>
                  <div className="relative">
                    <input
                      type={showRegPwd ? "text" : "password"}
                      value={regConfirm}
                      onChange={e => setRegConfirm(e.target.value)}
                      placeholder="Confirmer"
                      required
                      autoComplete="new-password"
                      className={`w-full pr-10 border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 ${
                        regConfirm && regConfirm !== regPassword
                          ? 'border-red-400 focus:ring-red-300'
                          : regConfirm && regConfirm === regPassword
                          ? 'border-green-400 focus:ring-green-300'
                          : 'border-gray-200 focus:ring-primary/30 focus:border-primary'
                      }`}
                    />
                    {regConfirm && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm">
                        {regConfirm === regPassword ? '✅' : '❌'}
                      </span>
                    )}
                  </div>
                  {regConfirm && regConfirm !== regPassword && (
                    <p className="text-xs text-red-500">Les mots de passe ne correspondent pas.</p>
                  )}
                </div>

                {/* Separateur */}
                <div className="flex items-center gap-3 py-1">
                  <div className="flex-1 h-px bg-gray-100" />
                  <span className="text-xs text-gray-400 font-semibold uppercase tracking-wider">
                    Ton profil
                  </span>
                  <div className="flex-1 h-px bg-gray-100" />
                </div>

                <Field
                  label="Reseau principal"
                  value={regNetwork}
                  onChange={setRegNetwork}
                  placeholder="Instagram, TikTok, Facebook..."
                />
                <Field
                  label="Lien profil / page"
                  value={regUrl}
                  onChange={setRegUrl}
                  placeholder="https://instagram.com/monprofil"
                />
                <Field
                  label="Taille d'audience"
                  value={regAudience}
                  onChange={setRegAudience}
                  placeholder="Ex : 5 000 abonnes"
                />

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-primary hover:bg-primary-dark text-white font-bold py-3.5 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-2 text-sm"
                >
                  {loading ? 'Creation du compte...' : 'Rejoindre le programme'}
                </button>

                <p className="text-center text-xs text-gray-400 pt-1">
                  En vous inscrivant vous acceptez les conditions du programme partenaire EduKaraib.
                </p>
              </form>
            )}

            {/* Social proof */}
            <div className="mt-6 pt-5 border-t border-gray-100 flex items-center gap-4">
              <div className="flex -space-x-2">
                {['🧑‍🏫', '👩', '🧑'].map((e, i) => (
                  <div key={i} className="w-7 h-7 rounded-full bg-gray-100 border-2 border-white flex items-center justify-center text-sm">
                    {e}
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-400">
                Rejoins nos partenaires actifs en au Caraïbe
              </p>
            </div>
          </div>
        </div>

      </main>

      {/* ── Footer minimal ── */}
      <footer className="border-t border-gray-100 bg-white py-4 px-6 text-center">
        <p className="text-xs text-gray-400">
          &copy; {new Date().getFullYear()} EduKaraib &mdash; au Caraïbe &mdash;{' '}
          <Link to="/" className="hover:text-primary transition-colors">Retour au site</Link>
        </p>
      </footer>

    </div>
  );
}
