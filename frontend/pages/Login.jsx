import React, { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth, db } from '../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { useNavigate, Link } from 'react-router-dom';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

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

      // Redirection en fonction du rôle
      switch (role) {
        case 'student':
          navigate('/dashboard-eleve');
          break;
        case 'parent':
          navigate('/parent/dashboard');
          break;
        case 'teacher':
          navigate('/prof/dashboard');
          break;
        default:
          alert("Rôle inconnu !");
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
            Connecte-toi à ta plateforme d’accompagnement scolaire en Guyane.
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
            <input
              type="password"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary outline-none transition"
              placeholder="Mot de passe"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
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
      </div>
    </div>
  );
}