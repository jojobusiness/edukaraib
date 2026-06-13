import React, { useState } from 'react';
import fetchWithAuth from '../../utils/fetchWithAuth';
import { pixelTrack } from '../../lib/metaPixel';

/**
 * Props
 * - lessonId: string (obligatoire)
 * - forStudent?: string (optionnel, OBLIGATOIRE quand c'est un parent qui paie pour un enfant)
 * - couponCode?: string (optionnel, code promo à appliquer au checkout)
 * - packKey?: string (optionnel, clé de pack pour regrouper les leçons)
 */
export default function PayButton({ lessonId, forStudent, couponCode, packKey }) {
  const [loading, setLoading] = useState(false);

  const onPay = async () => {
    try {
      setLoading(true);
      const url = '/api/pay/create-checkout-session';

      const body = { lessonId };
      if (forStudent) body.forStudent = forStudent;
      if (couponCode) body.couponCode = couponCode;
      if (packKey)    body.packKey    = packKey;

      const data = await fetchWithAuth(url, {
        method: 'POST',
        body: JSON.stringify(body),
      });

      if (!data?.url) {
        throw new Error('Lien de paiement introuvable.');
      }
      // Meta Pixel : paiement initié (juste avant la redirection Stripe)
      pixelTrack('InitiateCheckout', {
        content_ids: [lessonId],
        content_type: 'product',
        currency: 'EUR',
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
      disabled={loading || !lessonId}
      title={forStudent ? `Payer pour l'élève ${forStudent}` : 'Payer'}
    >
      {loading ? 'Redirection…' : '💳 Payer maintenant'}
    </button>
  );
}