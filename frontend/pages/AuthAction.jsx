import { useEffect, useState } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { auth } from '../lib/firebase';
import {
  applyActionCode,
  verifyPasswordResetCode,
  confirmPasswordReset
} from 'firebase/auth';

export default function AuthAction() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('loading'); // loading | success | error | reset-form
  const [message, setMessage] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const mode = params.get('mode');
  const oobCode = params.get('oobCode');

  useEffect(() => {
    if (!mode || !oobCode) {
      setStatus('error');
      setMessage('Lien invalide.');
      return;
    }

    const run = async () => {
      try {
        if (mode === 'verifyEmail') {
          await applyActionCode(auth, oobCode);
          setStatus('success');
          setMessage('✅ Email vérifié avec succès.');
        } else if (mode === 'resetPassword') {
          const email = await verifyPasswordResetCode(auth, oobCode);
          setResetEmail(email);
          setStatus('reset-form');
        } else if (mode === 'recoverEmail') {
          await applyActionCode(auth, oobCode);
          setStatus('success');
          setMessage('✅ Ton adresse email a été restaurée.');
        } else {
          setStatus('error');
          setMessage('Action non supportée.');
        }
      } catch (e) {
        setStatus('error');
        setMessage('Ce lien a expiré ou a déjà été utilisé. Refais une demande depuis la page "Mot de passe oublié".');
      }
    };

    run();
  }, [mode, oobCode]);

  const handleResetSubmit = async (e) => {
    e.preventDefault();
    setFormError('');

    if (newPassword.length < 6) {
      setFormError('Le mot de passe doit contenir au moins 6 caractères.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setFormError('Les deux mots de passe ne correspondent pas.');
      return;
    }

    setSubmitting(true);
    try {
      await confirmPasswordReset(auth, oobCode, newPassword);
      setStatus('success');
      setMessage('✅ Ton mot de passe a été modifié. Tu peux maintenant te connecter.');
      setTimeout(() => navigate('/login', { replace: true }), 3000);
    } catch (err) {
      if (err?.code === 'auth/weak-password') {
        setFormError('Mot de passe trop faible. Choisis-en un plus long.');
      } else {
        setStatus('error');
        setMessage('Ce lien a expiré ou a déjà été utilisé. Refais une demande depuis la page "Mot de passe oublié".');
      }
    }
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="bg-white shadow-xl rounded-xl p-6 max-w-md w-full text-center">
        {status === 'loading' && <p>Vérification en cours…</p>}

        {status === 'reset-form' && (
          <>
            <img src="/edukaraib_logo.png" alt="Logo EduKaraib" className="h-12 mx-auto mb-3" />
            <h2 className="text-xl font-bold text-primary mb-1">
              Nouveau mot de passe
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              Choisis un nouveau mot de passe pour <strong>{resetEmail}</strong>
            </p>
            <form className="space-y-4 text-left" onSubmit={handleResetSubmit}>
              <div>
                <label className="block mb-1 text-sm font-medium text-gray-700">Nouveau mot de passe</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-10 focus:ring-2 focus:ring-primary outline-none transition"
                    placeholder="Au moins 6 caractères"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    required
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
                    tabIndex={-1}
                  >
                    {showPassword ? 'Masquer' : 'Voir'}
                  </button>
                </div>
              </div>
              <div>
                <label className="block mb-1 text-sm font-medium text-gray-700">Confirme le mot de passe</label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary outline-none transition"
                  placeholder="Retape le mot de passe"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  required
                />
              </div>
              {formError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {formError}
                </p>
              )}
              <button
                type="submit"
                className="w-full bg-primary text-white font-semibold py-2 rounded-lg shadow hover:bg-primary-dark transition disabled:opacity-60"
                disabled={submitting}
              >
                {submitting ? 'Modification…' : 'Changer mon mot de passe'}
              </button>
            </form>
          </>
        )}

        {status === 'success' && (
          <>
            <h2 className="text-xl font-bold text-green-600 mb-2">
              C’est fait 🎉
            </h2>
            <p className="mb-4">{message}</p>
            <Link
              to="/login"
              className="inline-block bg-primary text-white px-4 py-2 rounded-lg font-semibold"
            >
              Se connecter
            </Link>
          </>
        )}

        {status === 'error' && (
          <>
            <h2 className="text-xl font-bold text-red-600 mb-2">
              Erreur
            </h2>
            <p className="mb-4">{message}</p>
            <div className="flex flex-col gap-2">
              <Link
                to="/mot-de-passe-oublie"
                className="inline-block bg-primary text-white px-4 py-2 rounded-lg font-semibold"
              >
                Refaire une demande
              </Link>
              <Link
                to="/"
                className="inline-block bg-gray-200 px-4 py-2 rounded-lg font-semibold"
              >
                Retour accueil
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
