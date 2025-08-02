import React from 'react';

const jours = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const heures = Array.from({ length: 12 }, (_, i) => i + 8); // 8h à 19h

export default function TeacherAvailabilityEditor({ value = {}, onChange }) {
  // value : { 'Lun': [9, 10], 'Mar': [], ... }

  const toggle = (day, hour) => {
    const current = value[day] || [];
    const next = current.includes(hour)
      ? current.filter(h => h !== hour)
      : [...current, hour].sort((a, b) => a - b);
    onChange({ ...value, [day]: next });
  };

  return (
    <div className="mt-6 mb-3">
      <label className="font-bold text-primary block mb-2">Disponibilités hebdo (cochez les créneaux où vous êtes dispo) :</label>
      <div className="overflow-x-auto">
        <table className="table-auto border text-xs">
          <thead>
            <tr>
              <th className="px-1"></th>
              {heures.map(h => <th key={h} className="px-2">{h}h</th>)}
            </tr>
          </thead>
          <tbody>
            {jours.map(jour => (
              <tr key={jour}>
                <td className="font-bold text-gray-600">{jour}</td>
                {heures.map(h => (
                  <td key={h}>
                    <button
                      type="button"
                      onClick={() => toggle(jour, h)}
                      className={
                        (value[jour] || []).includes(h)
                          ? "bg-green-500 w-6 h-6 rounded shadow text-white"
                          : "bg-gray-100 w-6 h-6 rounded"
                      }
                    >
                      {(value[jour] || []).includes(h) ? '✓' : ''}
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}