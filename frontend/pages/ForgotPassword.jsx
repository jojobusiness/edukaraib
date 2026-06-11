import React, { useState } from 'react';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { Link } from 'react-router-dom';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setSent(true);
    } catch (err) {
      if (err?.code === 'auth/invalid-email') {
        setError('Adresse email invalide.');
      } else if (err?.code === 'auth/too-many-requests') {
        setError('Trop de tentatives. Réessaie dans quelques minutes.');
      } else {
        // auth/user-not-found inclus : on affiche le même message pour ne pas
        // révéler si un compte existe ou non
        setSent(true);
      }
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex flex-col justify-center items-center bg-gradient-to-br from-white via-gray-100 to-secondary/30 px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
        <div className="flex flex-col items-center mb-6">
          <img src="/edukaraib_logo.png" alt="Logo EduKaraib" className="h-14 mb-3" />
          <h2 className="text-2xl font-bold text-primary mb-1">Mot de passe oublié</h2>
          <p className="text-gray-600 text-center text-sm">
            Entre ton adresse email, on t’envoie un lien pour choisir un nouveau mot de passe.
          </p>
        </div>

        {sent ? (
          <div className="text-center space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-800">
              📩 Si un compte existe avec <strong>{email}</strong>, un email de
              réinitialisation vient de t’être envoyé. Pense à vérifier tes spams.
            </div>
            <Link
              to="/login"
              className="inline-block bg-primary text-white px-4 py-2 rounded-lg font-semibold hover:bg-primary-dark transition"
            >
              Retour à la connexion
            </Link>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={handleSubmit}>
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
            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
            <button
              type="submit"
              className="w-full bg-primary text-white font-semibold py-2 rounded-lg shadow hover:bg-primary-dark transition disabled:opacity-60"
              disabled={loading}
            >
              {loading ? 'Envoi…' : 'Envoyer le lien de réinitialisation'}
            </button>
          </form>
        )}

        <div className="mt-4 text-center text-sm text-gray-700">
          <Link to="/login" className="text-primary font-semibold hover:underline">
            ⬅️ Retour à la connexion
          </Link>
        </div>
      </div>
    </div>
  );
}
