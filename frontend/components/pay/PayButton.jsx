import React, { useState } from 'react';
import fetchWithAuth from '../../utils/fetchWithAuth';

/**
 * Props
 * - lessonId: string (obligatoire)
 * - forStudent?: string (optionnel, OBLIGATOIRE quand c'est un parent qui paie pour un enfant)
 * - variant?: 'checkout' | 'payment_link'
 */
export default function PayButton({ lessonId, forStudent, variant = 'checkout' }) {
  const [loading, setLoading] = useState(false);

  const onPay = async () => {
    try {
      setLoading(true);
      const url = variant === 'payment_link'
        ? '/api/pay/create-payment-link'
        : '/api/pay/create-checkout-session';

      const body = { lessonId };
      if (forStudent) body.forStudent = forStudent; // <<< aligne l'appel avec le backend (parent -> enfant)

      const data = await fetchWithAuth(url, {
        method: 'POST',
        body: JSON.stringify(body),
      });

      if (!data?.url) {
        throw new Error('Lien de paiement introuvable.');
      }
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
      disabled={loading || !lessonId}
      title={forStudent ? `Payer pour l'élève ${forStudent}` : 'Payer'}
    >
      {loading ? 'Redirection…' : '💳 Payer maintenant'}
    </button>
  );
}