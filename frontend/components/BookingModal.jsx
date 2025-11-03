import React, { useMemo, useState } from 'react';

// Jours + heures affichées
const DEFAULT_DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

export default function BookingModal({
  availability = {},
  bookedSlots = [],
  onBook,
  onClose,
  orderDays = DEFAULT_DAYS,
  multiSelect = true,

  remainingBySlot = {},
  showRemainingLegend = true,

  canBook = true,

  // ➕ NOUVEAU: imposer un nombre exact de créneaux (ex: pack 5h ou 10h)
  requiredCount = null, // null | 5 | 10
}) {
  const [selected, setSelected] = useState([]);

  const bookedMap = useMemo(() => {
    const m = new Map();
    bookedSlots.forEach(({ day, hour }) => { m.set(`${day}:${hour}`, true); });
    return m;
  }, [bookedSlots]);

  const hours = useMemo(() => {
    const all = Object.values(availability || {}).flat().filter((h) => Number.isInteger(h));
    if (all.length === 0) return Array.from({ length: 12 }, (_, i) => i + 8);
    const min = Math.max(0, Math.min(...all));
    const max = Math.min(23, Math.max(...all));
    return Array.from({ length: (max - min + 1) }, (_, i) => min + i);
  }, [availability]);

  const isBooked = (day, hour) => bookedMap.get(`${day}:${hour}`) === true;
  const isAvailable = (day, hour) => Array.isArray(availability[day]) && availability[day].includes(hour);
  const isSelected = (day, hour) => selected.some(s => s.day === day && s.hour === hour);
  const remainingFor = (day, hour) => {
    const key = `${day}:${hour}`;
    const val = remainingBySlot?.[key];
    return typeof val === 'number' ? val : null;
  };

  const toggleSelect = (day, hour) => {
    if (!canBook) return;
    if (!isAvailable(day, hour) || isBooked(day, hour)) return;

    if (multiSelect) {
      setSelected(prev => {
        const exists = prev.some(s => s.day === day && s.hour === hour);
        if (exists) {
          return prev.filter(s => !(s.day === day && s.hour === hour));
        }
        // ➕ limite par requiredCount
        if (requiredCount && prev.length >= requiredCount) return prev;
        return [...prev, { day, hour }];
      });
    } else {
      setSelected([{ day, hour }]);
    }
  };

  const handleSubmit = () => {
    if (!canBook) return;
    if (!selected.length) return;
    if (requiredCount && selected.length !== requiredCount) return; // impose exact
    if (multiSelect) onBook(selected); else onBook(selected[0]);
  };

  const need = requiredCount ? (requiredCount - selected.length) : null;

  return (
    <div className="fixed inset-0 flex items-center justify-center z-40 bg-black/30">
      <div className="bg-white p-6 rounded-2xl shadow-2xl max-w-md w-full relative border border-gray-100">
        <button className="absolute right-2 top-2 text-gray-500" onClick={onClose} aria-label="Fermer">
          ✖
        </button>

        <h3 className="text-xl font-bold text-primary mb-1">
          {multiSelect ? 'Choisissez un ou plusieurs créneaux' : 'Choisissez un créneau'}
        </h3>

        {requiredCount && (
          <div className="mb-2 text-sm">
            Pack : sélectionnez <b>{requiredCount}</b> créneau(x). Reste à choisir : <b>{need}</b>.
          </div>
        )}

        {!canBook && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-sm">
            Les comptes <b>professeurs</b> ne peuvent pas réserver de cours. Connectez-vous en élève/parent.
          </div>
        )}

        {/* Légende */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-700 mb-3 p-2 rounded-lg bg-gray-50 border border-gray-200">
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
          {showRemainingLegend && (
            <span className="inline-flex items-center gap-1 ml-auto">
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] text-[10px] rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 px-1">
                n
              </span>
              Places restantes
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="table-auto border text-xs mb-3">
            <thead>
              <tr>
                <th className="px-2 py-1"></th>
                {hours.map((h) => (
                  <th key={h} className="px-2 py-1">{h}h</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orderDays.map((day) => (
                <tr key={day}>
                  <td className="font-bold px-2 py-1">{day}</td>
                  {hours.map((h) => {
                    const booked = isBooked(day, h);
                    const dispo = isAvailable(day, h);
                    const sel = isSelected(day, h);
                    const remaining = remainingFor(day, h);

                    let classes = 'relative w-8 h-8 rounded shadow flex items-center justify-center select-none ';
                    if (!canBook) {
                      classes += 'bg-gray-100 text-gray-300 cursor-not-allowed';
                    } else if (booked) {
                      classes += 'bg-red-500 text-white cursor-not-allowed';
                    } else if (sel) {
                      classes += 'bg-secondary text-white';
                    } else if (dispo) {
                      classes += 'bg-green-500 text-white hover:opacity-90';
                    } else {
                      classes += 'bg-gray-100 text-gray-400 cursor-not-allowed';
                    }

                    const baseTitle = booked
                      ? 'Créneau déjà réservé'
                      : dispo
                      ? (sel ? 'Sélectionné' : 'Disponible')
                      : 'Indisponible';
                    const title = !canBook ? 'Réservation désactivée pour les professeurs' : baseTitle;

                    const disabledByPack =
                      canBook && dispo && !booked && requiredCount && !sel && selected.length >= requiredCount;

                    return (
                      <td key={h} className="px-1 py-1">
                        <button
                          type="button"
                          disabled={!canBook || !dispo || booked || disabledByPack}
                          onClick={() => toggleSelect(day, h)}
                          className={classes + (disabledByPack ? ' opacity-60' : '')}
                          title={title}
                          aria-label={
                            remaining !== null ? `${title}. Places restantes : ${remaining}` : title
                          }
                        >
                          {booked ? '❌' : sel ? '✔' : ''}

                          {remaining !== null && !booked && canBook && (
                            <span
                              className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] leading-[18px] text-center pointer-events-none"
                              title={`Places restantes : ${remaining}`}
                            >
                              {remaining}
                            </span>
                          )}
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
          className="w-full bg-primary text-white py-3 rounded-xl font-semibold shadow mt-2 disabled:opacity-60 hover:bg-primary/90"
          onClick={handleSubmit}
          disabled={
            !canBook ||
            !selected.length ||
            (requiredCount && selected.length !== requiredCount)
          }
          title={!canBook ? 'La réservation est désactivée pour les professeurs' : undefined}
        >
          {requiredCount
            ? `Réserver ${selected.length}/${requiredCount} créneau(x)`
            : (multiSelect
                ? `Réserver ${selected.length} créneau${selected.length > 1 ? 'x' : ''}`
                : 'Réserver ce créneau')}
        </button>
      </div>
    </div>
  );
}