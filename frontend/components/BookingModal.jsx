import React, { useMemo, useState } from 'react';

// Jours + heures affichées
const DEFAULT_DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const HOURS = Array.from({ length: 12 }, (_, i) => i + 8); // 08h → 19h

export default function BookingModal({
  availability = {},       // { 'Lun': [10,11], ... }
  bookedSlots = [],        // [{day:'Lun', hour:10}, ...]
  onBook,                  // ({day, hour}) => void
  onClose,
  orderDays = DEFAULT_DAYS // option d’ordre de colonnes
}) {
  const [selected, setSelected] = useState(null); // {day, hour}

  // Map rapide pour savoir si un slot est déjà pris
  const bookedMap = useMemo(() => {
    const m = new Map();
    bookedSlots.forEach(({ day, hour }) => {
      m.set(`${day}:${hour}`, true);
    });
    return m;
  }, [bookedSlots]);

  const isBooked = (day, hour) => bookedMap.get(`${day}:${hour}`) === true;
  const isAvailable = (day, hour) => Array.isArray(availability[day]) && availability[day].includes(hour);

  return (
    <div className="fixed inset-0 flex items-center justify-center z-40 bg-black/30">
      <div className="bg-white p-6 rounded-xl shadow max-w-md w-full relative">
        <button className="absolute right-2 top-2 text-gray-500" onClick={onClose}>
          ✖
        </button>
        <h3 className="text-xl font-bold text-primary mb-3">Choisissez un créneau</h3>

        <div className="overflow-x-auto">
          <table className="table-auto border text-xs mb-3">
            <thead>
              <tr>
                <th className="px-2 py-1"></th>
                {HOURS.map((h) => (
                  <th key={h} className="px-2 py-1">{h}h</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orderDays.map((day) => (
                <tr key={day}>
                  <td className="font-bold px-2 py-1">{day}</td>
                  {HOURS.map((h) => {
                    const booked = isBooked(day, h);
                    const dispo = isAvailable(day, h);
                    const sel = selected && selected.day === day && selected.hour === h;

                    return (
                      <td key={h} className="px-1 py-1">
                        <button
                          type="button"
                          disabled={!dispo || booked}
                          onClick={() => setSelected({ day, hour: h })}
                          className={`w-7 h-7 rounded shadow
                            ${
                              booked
                                ? 'bg-red-500 text-white cursor-not-allowed'
                                : sel
                                ? 'bg-secondary text-white'
                                : dispo
                                ? 'bg-green-500 text-white'
                                : 'bg-gray-100 text-gray-400'
                            }`}
                          title={booked ? 'Créneau déjà réservé' : dispo ? 'Disponible' : 'Indisponible'}
                        >
                          {booked ? '✖' : sel ? '✔' : ''}
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
          className="w-full bg-primary text-white py-2 rounded-lg font-semibold shadow mt-2 disabled:opacity-60"
          onClick={() => selected && onBook(selected)}
          disabled={!selected}
        >
          Réserver ce créneau
        </button>
      </div>
    </div>
  );
}