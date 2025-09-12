import React from 'react';
import { fmtEUR } from '../../utils/earnings';

export default function EarningsSummary({ totalGross, totalCommission, totalNet, loading, subtitle }) {
  if (loading) {
    return <p className="text-gray-500">Calcul en cours…</p>;
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-lg bg-yellow-50 border">
          <div className="text-xs uppercase text-yellow-700 font-semibold">Brut</div>
          <div className="text-xl font-bold">{fmtEUR(totalGross)}</div>
        </div>
        <div className="p-4 rounded-lg bg-orange-50 border">
          <div className="text-xs uppercase text-orange-700 font-semibold">
            Commission (10 € / cours)
          </div>
          <div className="text-xl font-bold">{fmtEUR(totalCommission)}</div>
        </div>
        <div className="p-4 rounded-lg bg-emerald-50 border">
          <div className="text-xs uppercase text-emerald-700 font-semibold">Net</div>
          <div className="text-xl font-bold">{fmtEUR(totalNet)}</div>
        </div>
      </div>

      <p className="text-xs text-gray-500 mt-3">
        La commission plateforme est <b>fixe : 10 € par cours/paiement</b>. {subtitle ? `(${subtitle})` : ''}
      </p>
    </>
  );
}