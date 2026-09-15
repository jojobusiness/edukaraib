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
import { PARTNER_KINDS, partnerGridRows } from '../lib/partner';
import { PARTNER_ROLE, PARTNER_MODEL } from '../../api/_partners.mjs';

const ERRORS = {
  'auth/user-not-found': 'Adresse email introuvable.',
  'auth/wrong-password': 'Mot de passe incorrect.',
  'auth/invalid-credential': 'Email ou mot de passe incorrect.',
  'auth/too-many-requests': 'Trop de tentatives. Réessayez dans quelques minutes.',
  'auth/email-already-in-use': 'Cette adresse a déjà un compte EduKaraib. Écrivez-nous à contact@edukaraib.com : nous créons votre espace partenaire.',
  'auth/invalid-email': 'Adresse email invalide.',
  'auth/weak-password': 'Mot de passe trop faible (6 caractères minimum).',
  CODE_TAKEN: 'Ce code est déjà pris : choisissez-en un autre, ou laissez le champ vide.',
  INVALID_CODE: 'Le code doit faire de 4 à 20 caractères : lettres, chiffres ou tirets.',
  INVALID_STRUCTURE_NAME: 'Indiquez le nom de votre structure.',
  EMAIL_USED_BY_OTHER_ACCOUNT: 'Cette adresse est celle d’un compte parent, élève ou professeur. Utilisez l’adresse de la structure.',
  EMAIL_ALREADY_PARTNER: 'Cette adresse est déjà celle d’un partenaire : connectez-vous.',
};
const errorText = (err) => ERRORS[err?.code] || ERRORS[err?.message] || `Une erreur est survenue : ${err?.message || ''}`;

const inputCls = 'border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800 bg-white placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary w-full';

function Field({ label, hint, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-bold uppercase tracking-widest text-gray-500">{label}</span>
      {children}
      {hint && <span className="text-xs text-gray-400">{hint}</span>}
    </label>
  );
}

const AVANTAGES = [
  { icon: '🤝', title: 'Rien à gérer', desc: 'Vous transmettez un lien ou un message tout prêt. Le reste est automatique.' },
  { icon: '👨‍👩‍👧', title: 'Toute la famille', desc: 'Le code s’enregistre sur le compte de la famille : tous ses enfants, tous ses achats de l’année.' },
  { icon: '📋', title: 'Un relevé clair', desc: 'Votre espace affiche les familles rattachées, les cours payés et les sommes à reverser.' },
  { icon: '🏦', title: 'Virement sur votre compte', desc: 'Indiquez l’IBAN de votre structure : les reversements arrivent par virement.' },
];

export default function PartnerHome() {
  const navigate = useNavigate();
  const [mode, setMode] = useState('register'); // 'login' | 'register'
  const [loading, setLoading] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [error, setError] = useState('');

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [form, setForm] = useState({
    structureName: '', kind: 'association', contactName: '', email: '', phone: '', code: '', password: '', confirm: '',
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Déjà connecté en tant que partenaire → espace
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (snap.exists() && snap.data()?.role === PARTNER_ROLE) {
          navigate('/partenaire/espace', { replace: true });
          return;
        }
      }
      setCheckingAuth(false);
    });
    return () => unsub();
  }, [navigate]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, loginEmail, loginPassword);
      const snap = await getDoc(doc(db, 'users', cred.user.uid));
      if (!snap.exists() || snap.data()?.role !== PARTNER_ROLE) {
        await auth.signOut();
        setError('Ce compte n’est pas un compte partenaire.');
        return;
      }
      navigate('/partenaire/espace', { replace: true });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) { setError('Les mots de passe ne correspondent pas.'); return; }
    if (form.password.length < 6) { setError('Le mot de passe doit faire au moins 6 caractères.'); return; }

    setLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, form.email.trim(), form.password);
      await cred.user.getIdToken(true);
      // Le rôle et la fiche partenaire sont créés côté serveur (anti auto-attribution)
      await fetchWithAuth('/api/partner-signup', {
        method: 'POST',
        body: JSON.stringify({
          structureName: form.structureName.trim(),
          kind: form.kind,
          contactName: form.contactName.trim(),
          phone: form.phone.trim(),
          code: form.code.trim(),
        }),
      });
      navigate('/partenaire/espace', { replace: true });
    } catch (err) {
      setError(errorText(err));
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

  const grid = partnerGridRows({ model: PARTNER_MODEL });

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
        <Link to="/" className="text-2xl font-extrabold text-primary tracking-tight">EduKaraib</Link>
        <span className="text-xs font-semibold uppercase tracking-widest text-gray-400 hidden sm:block">Programme partenaires</span>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-10 md:py-16 grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
        {/* ── Présentation ── */}
        <div className="space-y-8">
          <div className="inline-flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-full px-4 py-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-emerald-700 text-xs font-bold uppercase tracking-wider">
              Associations · établissements · communautés
            </span>
          </div>

          <div>
            <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900 leading-tight tracking-tight">
              Vos familles paient moins cher.
              <span className="block text-primary">Votre structure reçoit 2 € par heure.</span>
            </h1>
            <p className="mt-4 text-gray-500 text-lg leading-relaxed max-w-md">
              Un code pour vos familles : 2 € de remise par heure de cours avec des professeurs de Guyane
              et des Antilles, et 2 € par heure reversés à votre structure, sur tous leurs achats de l’année scolaire.
            </p>
          </div>

          <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
            <div className="grid grid-cols-3 px-5 py-3 bg-gray-50 border-b border-gray-100 text-xs font-bold uppercase tracking-widest text-gray-400">
              <span>Achat</span><span className="text-right">Famille</span><span className="text-right">Votre structure</span>
            </div>
            <div className="divide-y divide-gray-50">
              {grid.map((r) => (
                <div key={r.type} className="grid grid-cols-3 px-5 py-3.5 text-sm">
                  <span className="font-semibold text-gray-800">{r.type}</span>
                  <span className="text-right text-gray-500">{r.famille}</span>
                  <span className="text-right font-extrabold text-primary">{r.partenaire}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {AVANTAGES.map((a) => (
              <div key={a.title} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex gap-4 items-start">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-xl shrink-0">{a.icon}</div>
                <div>
                  <div className="font-bold text-gray-900 text-sm">{a.title}</div>
                  <div className="text-gray-500 text-xs mt-0.5 leading-relaxed">{a.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Formulaire ── */}
        <div className="lg:sticky lg:top-8">
          <div className="bg-white rounded-3xl border border-gray-100 shadow-xl p-6 md:p-8">
            <div className="flex bg-gray-100 rounded-xl p-1 mb-6">
              {[{ key: 'register', label: 'Devenir partenaire' }, { key: 'login', label: 'Connexion' }].map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => { setMode(m.key); setError(''); }}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${mode === m.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-600 text-sm mb-5">{error}</div>
            )}

            {mode === 'login' ? (
              <form onSubmit={handleLogin} className="space-y-4">
                <Field label="Adresse email">
                  <input type="email" className={inputCls} value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} required autoComplete="email" />
                </Field>
                <Field label="Mot de passe">
                  <input type="password" className={inputCls} value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} required autoComplete="current-password" />
                </Field>
                <button type="submit" disabled={loading} className="w-full bg-primary hover:bg-primary-dark text-white font-bold py-3.5 rounded-xl disabled:opacity-50 text-sm">
                  {loading ? 'Connexion…' : 'Accéder à mon espace'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleRegister} className="space-y-4">
                <Field label="Nom de la structure">
                  <input className={inputCls} value={form.structureName} onChange={set('structureName')} required placeholder="APE du collège…" />
                </Field>
                <Field label="Type">
                  <select className={inputCls} value={form.kind} onChange={set('kind')}>
                    {Object.entries(PARTNER_KINDS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                </Field>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Votre nom">
                    <input className={inputCls} value={form.contactName} onChange={set('contactName')} required autoComplete="name" />
                  </Field>
                  <Field label="Téléphone">
                    <input type="tel" className={inputCls} value={form.phone} onChange={set('phone')} autoComplete="tel" />
                  </Field>
                </div>
                <Field label="Email de la structure">
                  <input type="email" className={inputCls} value={form.email} onChange={set('email')} required autoComplete="email" />
                </Field>
                <Field label="Code souhaité (facultatif)" hint="Ex. APEL973. Laissez vide : nous le créons à partir du nom.">
                  <input className={`${inputCls} uppercase`} value={form.code} onChange={set('code')} maxLength={20} />
                </Field>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Mot de passe">
                    <input type="password" className={inputCls} value={form.password} onChange={set('password')} required autoComplete="new-password" />
                  </Field>
                  <Field label="Confirmation">
                    <input type="password" className={inputCls} value={form.confirm} onChange={set('confirm')} required autoComplete="new-password" />
                  </Field>
                </div>
                <button type="submit" disabled={loading} className="w-full bg-primary hover:bg-primary-dark text-white font-bold py-3.5 rounded-xl disabled:opacity-50 text-sm">
                  {loading ? 'Envoi…' : 'Demander mon code partenaire'}
                </button>
                <p className="text-center text-xs text-gray-400">Nous validons chaque demande sous 24 h. Votre code est actif dès la validation.</p>
              </form>
            )}
          </div>
        </div>
      </main>

      <footer className="border-t border-gray-100 bg-white py-4 px-6 text-center">
        <p className="text-xs text-gray-400">
          &copy; {new Date().getFullYear()} EduKaraib — <Link to="/" className="hover:text-primary">Retour au site</Link>
        </p>
      </footer>
    </div>
  );
}
