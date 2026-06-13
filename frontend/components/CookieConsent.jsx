import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cookie } from 'lucide-react';
import { getStoredConsent, setConsent, applyConsent } from '../lib/consent';

/**
 * Bandeau de consentement RGPD.
 * - Au montage : si un choix existe déjà, on le ré-applique silencieusement.
 *   Sinon, on affiche le bandeau (les traceurs restent en attente par défaut).
 * - Accepter / Refuser : persiste le choix et propage à GA + Meta Pixel.
 */
export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const stored = getStoredConsent();
    if (stored === 'granted' || stored === 'denied') {
      applyConsent(stored === 'granted');
    } else {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const choose = (granted) => {
    setConsent(granted);
    setVisible(false);
  };

  return (
    <div className="fixed bottom-0 inset-x-0 z-[60] p-3 sm:p-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-3xl rounded-2xl border border-gray-200 bg-white shadow-2xl p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <Cookie className="shrink-0 text-amber-500 mt-0.5" size={22} />
          <div className="flex-1 text-sm text-gray-700">
            <p className="font-bold text-gray-900 mb-1">On respecte ta vie privée 🍪</p>
            <p>
              On utilise des cookies de mesure d'audience (Google Analytics) et de
              statistiques publicitaires (Meta) pour améliorer EduKaraib. Rien n'est
              envoyé tant que tu n'as pas accepté.{' '}
              <Link to="/privacy" className="text-primary font-semibold hover:underline">
                En savoir plus
              </Link>.
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-col sm:flex-row gap-2 sm:justify-end">
          <button
            onClick={() => choose(false)}
            className="order-2 sm:order-1 px-4 py-2.5 rounded-xl border border-gray-300 font-semibold text-gray-700 hover:bg-gray-50 transition"
          >
            Refuser
          </button>
          <button
            onClick={() => choose(true)}
            className="order-1 sm:order-2 px-5 py-2.5 rounded-xl bg-primary text-white font-bold shadow hover:bg-primary-dark transition"
          >
            Accepter
          </button>
        </div>
      </div>
    </div>
  );
}
