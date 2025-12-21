import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { auth } from '../lib/firebase';
import {
  applyActionCode,
  checkActionCode
} from 'firebase/auth';

export default function AuthAction() {
  const [params] = useSearchParams();
  const [status, setStatus] = useState('loading'); // loading | success | error
  const [message, setMessage] = useState('');

  useEffect(() => {
    const mode = params.get('mode');
    const oobCode = params.get('oobCode');

    if (!mode || !oobCode) {
      setStatus('error');
      setMessage('Lien invalide.');
      return;
    }

    const run = async () => {
      try {
        await checkActionCode(auth, oobCode);

        if (mode === 'verifyEmail') {
          await applyActionCode(auth, oobCode);
          setStatus('success');
          setMessage('✅ Email vérifié avec succès.');
        } else {
          setStatus('error');
          setMessage('Action non supportée.');
        }
      } catch (e) {
        setStatus('error');
        setMessage('Lien expiré ou invalide.');
      }
    };

    run();
  }, [params]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="bg-white shadow-xl rounded-xl p-6 max-w-md w-full text-center">
        {status === 'loading' && <p>Vérification en cours…</p>}

        {status === 'success' && (
          <>
            <h2 className="text-xl font-bold text-green-600 mb-2">
              Email vérifié 🎉
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
            <Link
              to="/"
              className="inline-block bg-gray-200 px-4 py-2 rounded-lg font-semibold"
            >
              Retour accueil
            </Link>
          </>
        )}
      </div>
    </div>
  );
}