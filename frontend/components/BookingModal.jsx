import React, { useState } from 'react';

const jours = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const heures = Array.from({ length: 12 }, (_, i) => i + 8); // 8h à 19h

export default function BookingModal({ availability, bookedSlots = [], onBook, onClose }) {
  const [selected, setSelected] = useState(null);

  const isBooked = (day, hour) =>
    bookedSlots.some(slot => slot.day === day && slot.hour === hour);

  return (
    <div className="fixed inset-0 flex items-center justify-center z-40 bg-black/30">
      <div className="bg-white p-6 rounded-xl shadow max-w-md w-full relative">
        <button className="absolute right-2 top-2 text-gray-500" onClick={onClose}>✖</button>
        <h3 className="text-xl font-bold text-primary mb-3">Choisissez un créneau</h3>
        <div className="overflow-x-auto">
          <table className="table-auto border text-xs mb-3">
            <thead>
              <tr>
                <th></th>
                {heures.map(h => <th key={h}>{h}h</th>)}
              </tr>
            </thead>
            <tbody>
              {jours.map(jour => (
                <tr key={jour}>
                  <td className="font-bold">{jour}</td>
                  {heures.map(h => {
                    const dispo = (availability[jour] || []).includes(h);
                    const booked = isBooked(jour, h);
                    const sel = selected && selected.day === jour && selected.hour === h;
                    return (
                      <td key={h}>
                        <button
                          disabled={!dispo || booked}
                          className={`w-7 h-7 rounded shadow
                            ${booked
                              ? "bg-red-500 text-white cursor-not-allowed"
                              : sel
                              ? "bg-secondary text-white"
                              : dispo
                              ? "bg-green-500 text-white"
                              : "bg-gray-100 text-gray-400"
                            }
                          `}
                          onClick={() => setSelected({ day: jour, hour: h })}
                          title={booked ? "Créneau déjà réservé" : ""}
                        >
                          {booked ? "✖" : sel ? "✔" : ""}
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
          className="w-full bg-primary text-white py-2 rounded-lg font-semibold shadow mt-2"
          onClick={() => selected && onBook(selected)}
          disabled={!selected}
        >
          Réserver ce créneau
        </button>
      </div>
    </div>
  );
}