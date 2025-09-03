import React, { useEffect, useMemo, useState } from 'react';

const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const HEURES = Array.from({ length: 12 }, (_, i) => i + 8); // 8h → 19h

export default function BookingModal({
  availability = {},        // ← défaut: objet vide (évite undefined[jour])
  bookedSlots = [],         // ← défaut: tableau vide
  onBook,
  onClose,
}) {
  const [selected, setSelected] = useState(null);

  // Set pour lookup O(1) des créneaux réservés
  const bookedSet = useMemo(
    () => new Set(bookedSlots.map((s) => `${s.day}|${s.hour}`)),
    [bookedSlots]
  );
  const isBooked = (day, hour) => bookedSet.has(`${day}|${hour}`);

  // Sécurité si availability[jour] n’existe pas / n’est pas un tableau
  const isDispo = (day, hour) =>
    Array.isArray(availability[day]) && availability[day].includes(hour);

  // Fermer au clavier (ESC)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleConfirm = () => {
    if (selected) onBook?.(selected);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-xl relative">
        <button
          type="button"
          className="absolute right-3 top-3 text-gray-500 hover:text-gray-700"
          onClick={onClose}
          aria-label="Fermer le modal"
        >
          ✕
        </button>

        <h3 className="text-xl font-bold text-primary mb-4">Choisissez un créneau</h3>

        <div className="overflow-x-auto">
          <table className="table-fixed border-separate border-spacing-1 text-xs w-full">
            <thead>
              <tr className="text-gray-600">
                <th className="w-16"></th>
                {HEURES.map((h) => (
                  <th key={h} className="px-1 text-center">
                    {h}h
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {JOURS.map((jour) => (
                <tr key={jour}>
                  <td className="font-semibold text-gray-700 pr-2">{jour}</td>
                  {HEURES.map((h) => {
                    const booked = isBooked(jour, h);
                    const dispo = isDispo(jour, h);
                    const sel = selected?.day === jour && selected?.hour === h;
                    const disabled = booked || !dispo;

                    return (
                      <td key={h} className="text-center">
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => setSelected({ day: jour, hour: h })}
                          className={[
                            'w-7 h-7 rounded transition shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/50',
                            booked
                              ? 'bg-red-500 text-white cursor-not-allowed'
                              : sel
                              ? 'bg-secondary text-white'
                              : dispo
                              ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                              : 'bg-gray-200 text-gray-400 cursor-not-allowed',
                          ].join(' ')}
                          title={
                            booked ? 'Créneau déjà réservé'
                            : !dispo ? 'Indisponible'
                            : 'Disponible'
                          }
                          aria-pressed={sel}
                        >
                          {booked ? '×' : sel ? '✔' : ''}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button
          type="button"
          className="w-full mt-4 bg-primary text-white py-2.5 rounded-lg font-semibold shadow hover:bg-primary/90 disabled:opacity-50"
          onClick={handleConfirm}
          disabled={!selected}
        >
          Réserver ce créneau
        </button>
      </div>
    </div>
  );
}