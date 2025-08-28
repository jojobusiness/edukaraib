import React, { useState } from 'react';
import fetchWithAuth from '../../utils/fetchWithAuth';

export default function StripeConnectButtons({ hasAccount }) {
  const [loading, setLoading] = useState(false);

  const openConnect = async (mode = 'onboarding') => {
    try {
      setLoading(true);
      const url = mode === 'update' ? '/api/connect-link?mode=update' : '/api/connect-link';
      const data = await fetchWithAuth(url, { method: 'POST' });
      window.location.href = data.url;
    } catch (e) {
      alert(e.message || "Impossible d'ouvrir la page Stripe.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-2 mt-4">
      {!hasAccount ? (
        <button
          onClick={() => openConnect('onboarding')}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded font-semibold disabled:opacity-60"
          disabled={loading}
        >
          Configurer mes paiements
        </button>
      ) : (
        <>
          <button
            onClick={() => openConnect('onboarding')}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded font-semibold disabled:opacity-60"
            disabled={loading}
          >
            Ouvrir mon portail Stripe
          </button>
          <button
            onClick={() => openConnect('update')}
            className="bg-gray-800 hover:bg-gray-900 text-white px-4 py-2 rounded font-semibold disabled:opacity-60"
            disabled={loading}
          >
            Mettre à jour mon RIB
          </button>
        </>
      )}
    </div>
  );
}