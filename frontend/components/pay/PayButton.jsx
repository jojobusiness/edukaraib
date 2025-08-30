import React, { useState } from 'react';
import fetchWithAuth from '../../utils/fetchWithAuth';

export default function PayButton({ lessonId, variant = 'checkout' /* or 'payment_link' */ }) {
  const [loading, setLoading] = useState(false);

  const onPay = async () => {
    try {
      setLoading(true);
      const url = variant === 'payment_link'
        ? '/api/pay/create-payment-link'
        : '/api/pay/create-checkout-session';

      const data = await fetchWithAuth(url, {
        method: 'POST',
        body: JSON.stringify({ lessonId }),
      });
      window.location.href = data.url;
    } catch (e) {
      alert(e.message || 'Impossible de créer le paiement');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded shadow font-semibold disabled:opacity-60"
      onClick={onPay}
      disabled={loading}
    >
      {loading ? 'Redirection…' : '💳 Payer maintenant'}
    </button>
  );
}