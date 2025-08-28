import React from 'react';
import { fmtEUR } from '../../utils/earnings';

export default function PaymentsTable({ rows }) {
  return (
    <div className="bg-white rounded-xl shadow p-6 border mt-8">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-primary">Historique des paiements</h3>
        <span className="text-xs text-gray-500">{rows.length} paiement(s)</span>
      </div>

      {rows.length === 0 ? (
        <div className="text-gray-500">Aucun paiement enregistré.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600 border-b">
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4">Payer</th>
                <th className="py-2 pr-4">Élève</th>
                <th className="py-2 pr-4">Matière</th>
                <th className="py-2 pr-4 text-right">Brut</th>
                <th className="py-2 pr-4 text-right">Commission</th>
                <th className="py-2 pr-0 text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="py-2 pr-4 whitespace-nowrap">{row.dateLabel}</td>
                  <td className="py-2 pr-4">{row.payerName}</td>
                  <td className="py-2 pr-4">{row.studentName}</td>
                  <td className="py-2 pr-4">{row.subject}</td>
                  <td className="py-2 pr-4 text-right font-medium">{fmtEUR(row.gross)}</td>
                  <td className="py-2 pr-4 text-right">{fmtEUR(row.fee)}</td>
                  <td className="py-2 pr-0 text-right font-semibold text-emerald-700">{fmtEUR(row.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-400 mt-3">
        * Le “Payer” est déterminé par <code>paid_by</code> si présent, sinon <code>parent_id</code> (si réservation pour enfant), sinon <code>booked_by</code>.
      </p>
    </div>
  );
}