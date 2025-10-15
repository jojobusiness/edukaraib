import React, { useMemo, useState } from 'react';

// Jours + heures affichées
const DEFAULT_DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const HOURS = Array.from({ length: 12 }, (_, i) => i + 8); // 08h → 19h

export default function BookingModal({
  availability = {},        // { 'Lun': [10,11], ... }
  bookedSlots = [],         // [{day:'Lun', hour:10}, ...]
  onBook,                   // onBook(slot) ou onBook([slots]) selon multiSelect
  onClose,
  orderDays = DEFAULT_DAYS, // option d’ordre de colonnes
  multiSelect = true        // 🔁 active la multi-sélection
}) {
  // Tableau de créneaux sélectionnés: [{day, hour}]
  const [selected, setSelected] = useState([]); 

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
  const isSelected = (day, hour) => selected.some(s => s.day === day && s.hour === hour);

  const toggleSelect = (day, hour) => {
    if (!isAvailable(day, hour) || isBooked(day, hour)) return;

    if (multiSelect) {
      setSelected(prev => {
        const exists = prev.some(s => s.day === day && s.hour === hour);
        if (exists) {
          return prev.filter(s => !(s.day === day && s.hour === hour));
        }
        return [...prev, { day, hour }];
      });
    } else {
      setSelected([{ day, hour }]);
    }
  };

  const handleSubmit = () => {
    if (!selected.length) return;
    if (multiSelect) {
      onBook(selected);
    } else {
      onBook(selected[0]);
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-40 bg-black/30">
      <div className="bg-white p-6 rounded-xl shadow max-w-md w-full relative">
        <button className="absolute right-2 top-2 text-gray-500" onClick={onClose} aria-label="Fermer">
          ✖
        </button>

        <h3 className="text-xl font-bold text-primary mb-3">
          {multiSelect ? 'Choisissez un ou plusieurs créneaux' : 'Choisissez un créneau'}
        </h3>

        {/* Légende */}
        <div className="flex items-center gap-3 text-xs text-gray-600 mb-3">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded bg-green-500" /> Libre
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded bg-secondary" /> Sélectionné
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded bg-red-500" /> Pris (❌)
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded bg-gray-100 border" /> Indisponible
          </span>
        </div>

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
                    const sel = isSelected(day, h);

                    let classes =
                      'w-7 h-7 rounded shadow flex items-center justify-center select-none ';
                    if (booked) {
                      classes += 'bg-red-500 text-white cursor-not-allowed';
                    } else if (sel) {
                      classes += 'bg-secondary text-white';
                    } else if (dispo) {
                      classes += 'bg-green-500 text-white hover:opacity-90';
                    } else {
                      classes += 'bg-gray-100 text-gray-400 cursor-not-allowed';
                    }

                    return (
                      <td key={h} className="px-1 py-1">
                        <button
                          type="button"
                          disabled={!dispo || booked}
                          onClick={() => toggleSelect(day, h)}
                          className={classes}
                          title={
                            booked
                              ? 'Créneau déjà réservé'
                              : dispo
                              ? (sel ? 'Sélectionné' : 'Disponible')
                              : 'Indisponible'
                          }
                        >
                          {booked ? '❌' : sel ? '✔' : ''}
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
          onClick={handleSubmit}
          disabled={!selected.length}
        >
          {multiSelect
            ? `Réserver ${selected.length} créneau${selected.length > 1 ? 'x' : ''}`
            : 'Réserver ce créneau'}
        </button>
      </div>
    </div>
  );
}