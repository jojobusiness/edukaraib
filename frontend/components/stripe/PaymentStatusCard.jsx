import React, { useEffect, useState, useCallback } from 'react';
import fetchWithAuth from '../../utils/fetchWithAuth';

export default function PaymentStatusCard() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchWithAuth('/api/connect-status');
      setStatus(data); // data: { id?, charges_enabled, payouts_enabled, details_submitted, ... }
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p className="text-gray-500">Chargement du statut…</p>;
  if (!status || !status.id) {
    return <p className="text-gray-600">Paiements non configurés.</p>;
  }

  const ready = !!status.charges_enabled && !!status.payouts_enabled;

  return (
    <div className="text-sm text-gray-700 space-y-1">
      <div>
        Charges activées :{' '}
        <b className={status.charges_enabled ? 'text-emerald-600' : 'text-red-600'}>
          {status.charges_enabled ? 'oui' : 'non'}
        </b>
      </div>
      <div>
        Virements (payouts) :{' '}
        <b className={status.payouts_enabled ? 'text-emerald-600' : 'text-red-600'}>
          {status.payouts_enabled ? 'oui' : 'non'}
        </b>
      </div>
      {!ready && (
        <div className="text-amber-600">
          À compléter sur Stripe (KYC/IBAN). {status.requirements_disabled_reason ? `Raison: ${status.requirements_disabled_reason}` : ''}
        </div>
      )}
      <button
        onClick={load}
        className="mt-2 text-xs underline text-gray-500 hover:text-gray-700"
      >
        Rafraîchir le statut
      </button>
    </div>
  );
}