import React, { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth, db } from '../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { useNavigate, Link, useLocation } from 'react-router-dom';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const uid = userCredential.user.uid;

      // Récupération du rôle depuis Firestore
      const userDoc = await getDoc(doc(db, 'users', uid));
      if (!userDoc.exists()) {
        alert("Aucun profil trouvé. Contactez l'administrateur.");
        setLoading(false);
        return;
      }

      const role = userDoc.data().role;

      // 🚀 Destination prioritaire : d'où l'on venait (guard a mis state.from)
      const fromState = location.state?.from?.pathname
        ? (location.state.from.pathname + (location.state.from.search || '') + (location.state.from.hash || ''))
        : null;

      // 🧭 Sinon, dernière route mémorisée (refresh ou retour appli)
      const last = (() => {
        try { return localStorage.getItem('lastRoute'); } catch { return null; }
      })();

      // ⛔️ Ne renvoie pas vers login/register/unauthorized
      const isForbidden = (p) => !p || ['/login','/register','/unauthorized'].includes(p);

      if (!isForbidden(fromState)) {
        navigate(fromState, { replace: true });
      } else if (!isForbidden(last)) {
        navigate(last, { replace: true });
      } else {
        // 🔁 Fallback rôle si aucune route valable
        switch (role) {
          case 'student':
            navigate('/dashboard-eleve', { replace: true });
            break;
          case 'parent':
            navigate('/parent/dashboard', { replace: true });
            break;
          case 'teacher':
            navigate('/prof/dashboard', { replace: true });
            break;
          case 'admin':
            navigate('/admin/dashboard', { replace: true });
            break;
          default:
            navigate('/', { replace: true });
        }
      }
    } catch (error) {
      alert('Erreur: ' + error.message);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex flex-col justify-center items-center bg-gradient-to-br from-white via-gray-100 to-secondary/30 px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
        <div className="flex flex-col items-center mb-6">
          <img src="/edukaraib_logo.png" alt="Logo EduKaraib" className="h-14 mb-3" />
          <h2 className="text-2xl font-bold text-primary mb-1">Connexion</h2>
          <p className="text-gray-600 text-center text-sm">
            Connecte-toi à ta plateforme d’accompagnement scolaire en au Caraïbe.
          </p>
        </div>
        <form className="space-y-4" onSubmit={handleLogin}>
          <div>
            <label className="block mb-1 text-sm font-medium text-gray-700">Email</label>
            <input
              type="email"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary outline-none transition"
              placeholder="ex: jean@edukaraib.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div>
            <label className="block mb-1 text-sm font-medium text-gray-700">Mot de passe</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-10 focus:ring-2 focus:ring-primary outline-none transition"
                placeholder="Mot de passe"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                tabIndex={-1}
                aria-label={showPassword ? "Masquer le mot de passe" : "Voir le mot de passe"}
              >
                {showPassword ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 4.411m0 0L21 21" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
          </div>
          <button
            type="submit"
            className="w-full bg-primary text-white font-semibold py-2 rounded-lg shadow hover:bg-primary-dark transition disabled:opacity-60"
            disabled={loading}
          >
            {loading ? "Connexion..." : "Se connecter"}
          </button>
        </form>
        <div className="mt-4 text-center text-sm text-gray-700">
          Pas encore de compte ?{" "}
          <Link to="/register" className="text-primary font-semibold hover:underline">Créer un compte</Link>
        </div>
        <div className="mt-3 text-center">
          <Link to="/" className="inline-block bg-gray-100 text-gray-700 px-4 py-2 rounded-lg font-semibold hover:bg-gray-200 transition">
            ⬅️ Retour à l’accueil
          </Link>
        </div>
      </div>
    </div>
  );
}