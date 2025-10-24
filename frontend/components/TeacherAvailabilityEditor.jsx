import React from 'react';
const jours = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

// ⏰ Étendue horaire élargie : 6h → 23h (créneaux d'1h : 6-7, 7-8, ..., 22-23, 23-24)
const heures = Array.from({ length: 18 }, (_, i) => i + 6); // 6..23

export default function TeacherAvailabilityEditor({ value = {}, onChange }) {
  // value attendu : { 'Lun': [9, 10], 'Mar': [], ... }  (chaque nombre = début d’un créneau d’1h)

  // ---- Helpers internes ----
  const uniqueSorted = (arr) => Array.from(new Set(arr)).sort((a, b) => a - b);
  const setDay = (day, hoursArr) => {
    onChange({ ...value, [day]: uniqueSorted(hoursArr) });
  };
  const addHours = (day, addArr) => {
    const current = value[day] || [];
    setDay(day, uniqueSorted([...current, ...addArr]));
  };
  const clearDay = (day) => setDay(day, []);
  const selectAllDay = (day) => setDay(day, [...heures]);

  // Plage [start, end[ -> ex: 8 à 12 => 8,9,10,11
  const rangeHours = (start, end) => {
    const s = Number(start);
    const e = Number(end);
    if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return [];
    const out = [];
    for (let h = s; h < e; h++) out.push(h);
    return out;
  };

  const toggle = (day, hour) => {
    const current = value[day] || [];
    const next = current.includes(hour)
      ? current.filter(h => h !== hour)
      : [...current, hour];
    setDay(day, next);
  };

  // ---- UI state pour ajout de plage et copie par jour ----
  const initialRanges = Object.fromEntries(jours.map(j => [j, { start: 8, end: 12 }]));
  const [ranges, setRanges] = React.useState(initialRanges);

  const updateRange = (day, key, val) => {
    setRanges((r) => ({ ...r, [day]: { ...r[day], [key]: Number(val) } }));
  };

  const applyRange = (day) => {
    const { start, end } = ranges[day] || {};
    const hrs = rangeHours(start, end);
    if (hrs.length === 0) return;
    addHours(day, hrs);
  };

  // Copier un jour vers une sélection d’autres jours (panneau léger)
  const [copyPanel, setCopyPanel] = React.useState({ openDay: null, targets: [] });

  const toggleCopyTarget = (targetDay) => {
    setCopyPanel((cp) => {
      const has = cp.targets.includes(targetDay);
      return { ...cp, targets: has ? cp.targets.filter(d => d !== targetDay) : [...cp.targets, targetDay] };
    });
  };

  const openCopyFor = (day) => setCopyPanel({ openDay: day, targets: [] });
  const closeCopy = () => setCopyPanel({ openDay: null, targets: [] });

  const doCopy = () => {
    const from = copyPanel.openDay;
    if (!from || copyPanel.targets.length === 0) return;
    const fromHours = value[from] || [];
    const next = { ...value };
    copyPanel.targets.forEach((d) => {
      if (d !== from) next[d] = [...fromHours];
    });
    onChange(next);
    closeCopy();
  };

  // ---- Presets semaine (toujours 1h par créneau) ----
  const applyPreset = (preset) => {
    const next = {};
    if (preset === 'empty') {
      jours.forEach((j) => (next[j] = []));
    } else if (preset === 'office') {
      // Lun–Ven : 8–12 & 14–18 ; Sam–Dim : vide
      jours.forEach((j, idx) => {
        if (idx <= 4) next[j] = [...rangeHours(8, 12), ...rangeHours(14, 18)];
        else next[j] = [];
      });
    } else if (preset === 'continuous') {
      // Lun–Sam : 9–19 ; Dim : vide
      jours.forEach((j, idx) => {
        if (idx <= 5) next[j] = rangeHours(9, 19);
        else next[j] = [];
      });
    }
    onChange(next);
  };

  return (
    <div className="mt-6 mb-3">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
        <label className="font-bold text-primary block">Disponibilités hebdo (créneaux d’1h) :</label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => applyPreset('empty')}
            className="text-xs px-3 py-1 rounded border hover:bg-gray-50"
            title="Vider toute la semaine"
          >
            Vider semaine
          </button>
          <button
            type="button"
            onClick={() => applyPreset('office')}
            className="text-xs px-3 py-1 rounded border hover:bg-gray-50"
            title="Lun–Ven : 8–12 & 14–18"
          >
            8–12 & 14–18
          </button>
          <button
            type="button"
            onClick={() => applyPreset('continuous')}
            className="text-xs px-3 py-1 rounded border hover:bg-gray-50"
            title="Lun–Sam : 9–19"
          >
            9–19 (Lun–Sam)
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="table-auto border text-xs">
          <thead>
            <tr>
              <th className="px-1"></th>
              {heures.map(h => <th key={h} className="px-2 whitespace-nowrap">{h}h</th>)}
              <th className="px-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {jours.map(jour => (
              <tr key={jour} className="align-top">
                <td className="font-bold text-gray-600 pr-2">{jour}</td>

                {/* Grille de 1h */}
                {heures.map(h => (
                  <td key={h} className="text-center">
                    <button
                      type="button"
                      onClick={() => toggle(jour, h)}
                      className={
                        (value[jour] || []).includes(h)
                          ? "w-7 h-7 rounded-md shadow-sm bg-green-600 text-white ring-1 ring-green-700/30"
                          : "w-7 h-7 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-600 ring-1 ring-gray-200"
                      }
                      title={(value[jour] || []).includes(h) ? `${h}h–${h+1}h (sélectionné)` : `${h}h–${h+1}h`}
                    >
                      {(value[jour] || []).includes(h) ? '✓' : ''}
                    </button>
                  </td>
                ))}

                {/* Actions rapides par jour */}
                <td className="min-w-[220px]">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => selectAllDay(jour)}
                        className="text-[11px] px-2.5 py-1 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 shadow-sm"
                        title="Tout sélectionner (jour)"
                      >
                        Tout
                      </button>
                      <button
                        type="button"
                        onClick={() => clearDay(jour)}
                        className="text-[11px] px-2.5 py-1 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 shadow-sm"
                        title="Vider le jour"
                      >
                        Vider
                      </button>
                      <button
                        type="button"
                        onClick={() => openCopyFor(jour)}
                        className="text-[11px] px-2.5 py-1 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 shadow-sm"
                        title="Copier ce jour vers d'autres jours"
                      >
                        Copier →
                      </button>
                    </div>

                    {/* Ajout de plage rapide (toujours 1h/slot) */}
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-gray-500">Plage</span>
                      <select
                        className="text-[11px] border rounded px-1 py-[1px]"
                        value={ranges[jour]?.start ?? 8}
                        onChange={(e) => updateRange(jour, 'start', e.target.value)}
                      >
                        {heures.map(h => <option key={h} value={h}>{h}h</option>)}
                      </select>
                      <span className="text-[10px]">→</span>
                      <select
                        className="text-[11px] border rounded px-1 py-[1px]"
                        value={ranges[jour]?.end ?? 12}
                        onChange={(e) => updateRange(jour, 'end', e.target.value)}
                      >
                        {heures.map(h => <option key={h} value={h}>{h}h</option>)}
                        <option value={24}>24h</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => applyRange(jour)}
                        className="text-[11px] px-2.5 py-1 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 shadow-sm"
                        title="Ajouter la plage au jour"
                      >
                        Ajouter
                      </button>
                    </div>

                    {/* Panneau de copie ciblée */}
                    {copyPanel.openDay === jour && (
                      <div className="mt-1 p-2 border rounded bg-gray-50">
                        <div className="text-[11px] mb-1 text-gray-600">Copier vers :</div>
                        <div className="flex flex-wrap gap-1">
                          {jours.map((j2) => (
                            <label key={j2} className={`text-[11px] px-2 py-[2px] rounded border cursor-pointer ${
                              copyPanel.targets.includes(j2) ? 'bg-primary text-white border-primary' : 'bg-white'
                            } ${j2 === jour ? 'opacity-40 cursor-not-allowed' : ''}`}>
                              <input
                                type="checkbox"
                                className="hidden"
                                disabled={j2 === jour}
                                checked={copyPanel.targets.includes(j2)}
                                onChange={() => toggleCopyTarget(j2)}
                              />
                              {j2}
                            </label>
                          ))}
                        </div>
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            onClick={doCopy}
                            className="text-[11px] px-3 py-1 rounded bg-primary text-white hover:bg-primary/90"
                          >
                            Copier
                          </button>
                          <button
                            type="button"
                            onClick={closeCopy}
                            className="text-[11px] px-3 py-1 rounded border hover:bg-gray-50"
                          >
                            Fermer
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-gray-500 mt-2">
        Astuce : utilisez les boutons <i>Plage</i> pour ajouter rapidement 8→12 ou 14→18, etc. Chaque case représente un cours d’1h.
      </p>
    </div>
  );
}