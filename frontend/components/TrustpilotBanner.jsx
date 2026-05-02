import React from 'react';

const STARS = '★★★★★';
const TRUSTPILOT_URL = 'https://fr.trustpilot.com/review/edukaraib.com';

export default function TrustpilotBanner() {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <div className="bg-[#00B67A] rounded px-1.5 py-0.5">
            <span className="text-white text-sm font-bold">★</span>
          </div>
          <span className="font-extrabold text-slate-900 text-base">Trustpilot</span>
        </div>
        <p className="text-slate-600 text-sm mt-1">
          Votre avis aide d'autres familles à nous trouver. Cela prend 1 minute.
        </p>
        <div className="flex gap-0.5 text-[#00B67A] text-lg leading-none">{STARS}</div>
      </div>
      <a
        href={TRUSTPILOT_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 bg-[#00B67A] hover:bg-[#009d6b] text-white font-semibold px-5 py-2.5 rounded-xl transition text-sm whitespace-nowrap shrink-0"
      >
        Laisser un avis
      </a>
    </div>
  );
}
