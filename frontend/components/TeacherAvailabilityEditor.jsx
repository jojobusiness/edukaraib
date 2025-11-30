import React from 'react';

const jours = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
// Créneaux d'1h : 6 → 23
const heures = Array.from({ length: 18 }, (_, i) => i + 6); // 6..23

export default function TeacherAvailabilityEditor({ value = {}, onChange }) {
  // =============== Dates & utilitaires (mois/semaines) ===============
  const startOfWeekMon = (d) => {
    const x = new Date(d);
    const day = (x.getDay() + 6) % 7; // 0=Mon..6=Sun
    x.setDate(x.getDate() - day);
    x.setHours(0, 0, 0, 0);
    return x;
  };

  const formatLocalDate = (d) => {
    if (!d) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const weekKeyOf = (d) => {
    const monday = startOfWeekMon(d);
    return formatLocalDate(monday); // "YYYY-MM-DD" du lundi de la semaine
  };

  const startOfMonth = (d) => { const x = new Date(d); x.setDate(1); x.setHours(0,0,0,0); return x; };
  const addMonths = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  // Vue mensuelle — curseur sur le mois affiché
  const [monthCursor, setMonthCursor] = React.useState(() => {
    const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d;
  });

  // Semaine active (celle qu’on édite)
  const [weekAnchor, setWeekAnchor] = React.useState(() => startOfWeekMon(new Date()));

  // Construit 6 semaines x 7 jours pour le mois courant (début lundi)
  const buildMonthMatrix = (cursor) => {
    const first = startOfMonth(cursor);
    const gridStart = startOfWeekMon(first);
    const weeks = [];
    for (let w = 0; w < 6; w++) {
      const row = [];
      for (let d = 0; d < 7; d++) {
        const cell = new Date(gridStart); cell.setDate(gridStart.getDate() + w * 7 + d);
        row.push(cell);
      }
      weeks.push(row);
    }
    return weeks;
  };

  const isoWeek = (date) => {
    const tmp = new Date(date.getTime());
    tmp.setHours(0,0,0,0);
    tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7));
    const week1 = new Date(tmp.getFullYear(), 0, 4);
    return 1 + Math.round(((tmp - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  };

  const goToWeekOf = (date) => setWeekAnchor(startOfWeekMon(date));

  // Jours de la semaine active (lundi→dimanche, objets Date réels)
  const activeWeekDays = React.useMemo(() => {
    const out = [];
    const start = startOfWeekMon(weekAnchor);
    for (let i = 0; i < 7; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      out.push(d);
    }
    return out;
  }, [weekAnchor]);

  // =============== Verrous temporels (NOW + 1h) ===============
  const now = new Date();
  const nowHour = now.getHours(); // 0..23
  const todayMidnight = new Date(); todayMidnight.setHours(0,0,0,0);

  // Bloque si:
  // - date du créneau < aujourd’hui
  // - date = aujourd’hui ET h <= nowHour (on autorise dès now+1h ; si nowHour>=23 → tout aujourd’hui verrouillé)
  const isSlotLockedByDate = (dayDate, hour) => {
    const d = new Date(dayDate); d.setHours(0,0,0,0);

    if (d.getTime() < todayMidnight.getTime()) return true; // passé
    if (d.getTime() === todayMidnight.getTime()) {
      if (nowHour >= 23) return true; // fin de journée → tout verrouillé
      return hour <= nowHour;
    }
    return false; // futur
  };

  // =============== Accès/écriture (NOUVEAU : par semaine) ===============
  // Nouveau format :
  // value = {
  //   "YYYY-MM-DD" (lundi de la semaine) : { 'Lun': [9,10], 'Mar': [14], ... },
  //   ...
  // }
  const dayLabelForIndex = (i) => ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'][i];
  const uniqueSorted = (arr) => Array.from(new Set(arr)).sort((a, b) => a - b);

  const currentWeekKey = () => weekKeyOf(weekAnchor);

  const getWeekMap = (wk) => {
    const raw = value && typeof value[wk] === 'object' && !Array.isArray(value[wk])
      ? value[wk]
      : {};
    return raw || {};
  };

  const readDay = (label) => {
    const wk = currentWeekKey();
    const weekMap = getWeekMap(wk);
    return weekMap[label] || [];
  };

  const writeDay = (label, hoursArr, dayDate) => {
    const wk = currentWeekKey();
    const weekMap = getWeekMap(wk);
    const safe = (hoursArr || []).filter((h) => !isSlotLockedByDate(dayDate, h));

    const nextWeekMap = {
      ...weekMap,
      [label]: uniqueSorted(safe),
    };

    onChange({
      ...(value || {}),
      [wk]: nextWeekMap,
    });
  };

  const addHours = (label, addArr, dayDate) => {
    const current = readDay(label);
    const safeToAdd = (addArr || []).filter((h) => !isSlotLockedByDate(dayDate, h));
    writeDay(label, uniqueSorted([...current, ...safeToAdd]), dayDate);
  };

  const clearDay = (label, dayDate) => {
    const current = readDay(label);
    const remaining = current.filter((h) => isSlotLockedByDate(dayDate, h));
    const wk = currentWeekKey();
    const weekMap = getWeekMap(wk);

    const nextWeekMap = {
      ...weekMap,
      [label]: uniqueSorted(remaining),
    };

    onChange({
      ...(value || {}),
      [wk]: nextWeekMap,
    });
  };

  const selectAllDay = (label, dayDate) => {
    writeDay(label, heures.filter((h) => !isSlotLockedByDate(dayDate, h)), dayDate);
  };

  // Plage [start, end[
  const rangeHours = (start, end) => {
    const s = Number(start);
    const e = Number(end);
    if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return [];
    const out = [];
    for (let h = s; h < e; h++) out.push(h);
    return out;
  };

  const toggle = (label, hour, dayDate) => {
    if (isSlotLockedByDate(dayDate, hour)) return; // 🔒
    const current = readDay(label);
    const next = current.includes(hour) ? current.filter(h => h !== hour) : [...current, hour];
    writeDay(label, next, dayDate);
  };

  // ---- UI state pour plage perso + copie ----
  const initialRanges = Object.fromEntries(jours.map(j => [j, { start: 8, end: 12 }]));
  const [ranges, setRanges] = React.useState(initialRanges);
  const updateRange = (label, key, val) => setRanges((r) => ({ ...r, [label]: { ...r[label], [key]: Number(val) } }));
  const applyRange = (label, dayDate) => {
    const { start, end } = ranges[label] || {};
    const hrs = rangeHours(start, end);
    if (hrs.length === 0) return;
    addHours(label, hrs, dayDate);
  };

  const [copyPanel, setCopyPanel] = React.useState({ openDay: null, targets: [] });
  const toggleCopyTarget = (targetLabel) => {
    setCopyPanel((cp) => {
      const has = cp.targets.includes(targetLabel);
      return { ...cp, targets: has ? cp.targets.filter(d => d !== targetLabel) : [...cp.targets, targetLabel] };
    });
  };
  const openCopyFor = (label) => setCopyPanel({ openDay: label, targets: [] });
  const closeCopy = () => setCopyPanel({ openDay: null, targets: [] });
  const doCopy = () => {
    const from = copyPanel.openDay;
    if (!from || copyPanel.targets.length === 0) return;

    const wk = currentWeekKey();
    const weekMap = getWeekMap(wk);

    const fromIdx = jours.indexOf(from);
    const fromDate = activeWeekDays[fromIdx];
    const fromHours = readDay(from).filter((h) => !isSlotLockedByDate(fromDate, h));

    const nextWeekMap = { ...weekMap };

    copyPanel.targets.forEach((to) => {
      if (to === from) return;
      const toIdx = jours.indexOf(to);
      const toDate = activeWeekDays[toIdx];
      nextWeekMap[to] = uniqueSorted(
        fromHours.filter((h) => !isSlotLockedByDate(toDate, h))
      );
    });

    onChange({
      ...(value || {}),
      [wk]: nextWeekMap,
    });
    closeCopy();
  };

  // Presets (respectent les verrous selon la semaine active)
  const applyPreset = (preset) => {
    const wk = currentWeekKey();
    const currentWeekMap = getWeekMap(wk);
    const nextWeekMap = {};

    if (preset === 'empty') {
      jours.forEach((label, idx) => {
        const d = activeWeekDays[idx];
        nextWeekMap[label] = (readDay(label) || []).filter((h) => isSlotLockedByDate(d, h));
      });
    } else if (preset === 'office') {
      jours.forEach((label, idx) => {
        const d = activeWeekDays[idx];
        const base = idx <= 4 ? [...rangeHours(8, 12), ...rangeHours(14, 18)] : [];
        const safe = base.filter((h) => !isSlotLockedByDate(d, h));
        const lockedKeep = (readDay(label) || []).filter((h) => isSlotLockedByDate(d, h));
        nextWeekMap[label] = uniqueSorted([...lockedKeep, ...safe]);
      });
    } else if (preset === 'continuous') {
      jours.forEach((label, idx) => {
        const d = activeWeekDays[idx];
        const base = idx <= 5 ? rangeHours(9, 19) : [];
        const safe = base.filter((h) => !isSlotLockedByDate(d, h));
        const lockedKeep = (readDay(label) || []).filter((h) => isSlotLockedByDate(d, h));
        nextWeekMap[label] = uniqueSorted([...lockedKeep, ...safe]);
      });
    }

    onChange({
      ...(value || {}),
      [wk]: {
        ...currentWeekMap,
        ...nextWeekMap,
      },
    });
  };

  // Styles de bouton selon verrous/état
  const btnClass = (locked, selected) => {
    if (locked) return "w-7 h-7 rounded-md bg-gray-50 text-gray-300 ring-1 ring-gray-200 cursor-not-allowed";
    return selected
      ? "w-7 h-7 rounded-md shadow-sm bg-green-600 text-white ring-1 ring-green-700/30"
      : "w-7 h-7 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-600 ring-1 ring-gray-200";
  };

  const isPastDay = (d) => {
    const a = new Date(d); a.setHours(0,0,0,0);
    return a.getTime() < todayMidnight.getTime();
  };

  // ====================== RENDER ======================
  return (
    <div className="mt-6 mb-3">
      {/* --- Vue mensuelle (navigation + sélection de semaine) --- */}
      <div className="mb-3 bg-white rounded-xl border shadow-sm p-3">
        <div className="flex items-center justify-between mb-2">
          <button
            type="button"
            onClick={() => setMonthCursor((d) => addMonths(d, -1))}
            className="px-2 py-1 text-sm rounded border hover:bg-gray-50"
          >‹</button>

          <div className="font-semibold">
            {monthCursor.toLocaleString('fr-FR', { month: 'long', year: 'numeric' })}
          </div>

          <button
            type="button"
            onClick={() => setMonthCursor((d) => addMonths(d, 1))}
            className="px-2 py-1 text-sm rounded border hover:bg-gray-50"
          >›</button>
        </div>

        <div className="grid grid-cols-8 gap-1 text-[11px]">
          <div className="text-gray-500 px-1"></div>
          {['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'].map(h=>(
            <div key={h} className="text-center text-gray-500">{h}</div>
          ))}

          {buildMonthMatrix(monthCursor).map((week, i)=>(
            <React.Fragment key={i}>
              <div className="text-center text-gray-500 font-mono px-1">S{isoWeek(week[0])}</div>
              {week.map((day,j)=>{
                const isCurMonth = day.getMonth()===monthCursor.getMonth();
                const isActiveWeek = startOfWeekMon(day).getTime() === startOfWeekMon(weekAnchor).getTime();
                const disabled = isPastDay(day);
                return (
                  <button
                    key={j}
                    type="button"
                    disabled={disabled}
                    onClick={()=>{ goToWeekOf(day); }}
                    className={[
                      "py-1 rounded border text-center",
                      disabled ? "text-gray-300 bg-gray-50 cursor-not-allowed"
                               : (isActiveWeek ? "bg-primary/10 border-primary/30 text-primary"
                                               : (isCurMonth ? "bg-white hover:bg-gray-50" : "bg-gray-50 text-gray-400"))
                    ].join(' ')}
                    title={disabled ? "Jour passé" : "Éditer la semaine de ce jour"}
                  >
                    {day.getDate()}
                  </button>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* --- Entête & presets hebdo --- */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <label className="font-bold text-primary block">
          Calendrier hebdo (créneaux d’1h) :
        </label>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => applyPreset('empty')}
              className="px-3 py-1.5 text-xs hover:bg-gray-50"
              title="Vider la semaine (respecte les verrous)"
            >
              🧹 Vider
            </button>
            <div className="w-px bg-gray-200" />
            <button
              type="button"
              onClick={() => applyPreset('office')}
              className="px-3 py-1.5 text-xs hover:bg-gray-50"
              title="Lun–Ven : 8–12 & 14–18 (respecte les verrous)"
            >
              🗓️ Bureau
            </button>
            <div className="w-px bg-gray-200" />
            <button
              type="button"
              onClick={() => applyPreset('continuous')}
              className="px-3 py-1.5 text-xs hover:bg-gray-50"
              title="Lun–Sam : 9–19 (respecte les verrous)"
            >
              ⏱️ Continu
            </button>
          </div>

          <span className="text-[11px] text-gray-500 hidden sm:inline">
            Modifiable à partir de <b>{nowHour >= 23 ? 'demain 00h' : `${String(nowHour + 1).padStart(2,'0')}:00`}</b>. Jours passés verrouillés.
          </span>
        </div>
      </div>

      {/* --- Grille hebdo (édition de la semaine active) --- */}
      <div className="overflow-x-auto p-2 sm:p-4 bg-white rounded-xl shadow-inner">
        <table className="table-auto border text-xs w-full">
          <thead>
            <tr>
              <th className="px-1"></th>
              {heures.map(h => <th key={h} className="px-2 whitespace-nowrap">{h}h</th>)}
              <th className="px-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {jours.map((label, idx) => {
              const dayDate = activeWeekDays[idx];
              const current = readDay(label);
              return (
                <tr key={label} className="align-top">
                  <td className="font-bold text-gray-600 pr-2">
                    {label}
                    <span className="ml-1 text-[10px] text-gray-400">
                      ({dayDate.getDate()}/{String(dayDate.getMonth()+1).padStart(2,'0')})
                    </span>
                  </td>

                  {/* Grille 1h */}
                  {heures.map(h => {
                    const locked = isSlotLockedByDate(dayDate, h);
                    const selected = current.includes(h) && !locked;
                    return (
                      <td key={h} className="text-center">
                        <button
                          type="button"
                          onClick={() => toggle(label, h, dayDate)}
                          className={btnClass(locked, selected)}
                          disabled={locked}
                          title={
                            locked
                              ? 'Créneau verrouillé (passé ou avant +1h)'
                              : (selected ? `${h}h–${h+1}h (sélectionné)` : `${h}h–${h+1}h`)
                          }
                        >
                          {selected ? '✓' : ''}
                        </button>
                      </td>
                    );
                  })}

                  {/* Actions rapides par jour */}
                  <td className="min-w-[300px] align-top">
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center flex-wrap gap-1.5">
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                          {current.filter(h => !isSlotLockedByDate(dayDate, h)).length} sélection(s)
                        </span>

                        <div className="inline-flex rounded-lg border border-gray-300 bg-white shadow-sm overflow-hidden">
                          <button
                            type="button"
                            onClick={() => selectAllDay(label, dayDate)}
                            className="px-2.5 py-1.5 text-[11px] hover:bg-gray-50"
                            title="Tout sélectionner (futur uniquement)"
                          >
                            Tout
                          </button>
                          <div className="w-px bg-gray-200" />
                          <button
                            type="button"
                            onClick={() => clearDay(label, dayDate)}
                            className="px-2.5 py-1.5 text-[11px] hover:bg-gray-50"
                            title="Vider (ne touche pas aux créneaux verrouillés)"
                          >
                            Vider
                          </button>
                          <div className="w-px bg-gray-200" />
                          <button
                            type="button"
                            onClick={() => openCopyFor(label)}
                            className="px-2.5 py-1.5 text-[11px] hover:bg-gray-50"
                            title="Copier ce jour vers d'autres (verrous respectés)"
                          >
                            Copier →
                          </button>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => addHours(label, rangeHours(8, 12), dayDate)}
                            className="text-[11px] px-2 py-1 rounded-full bg-gray-100 hover:bg-gray-200 border border-gray-200"
                            title="Ajouter 8→12 (futur uniquement)"
                          >
                            8–12
                          </button>
                          <button
                            type="button"
                            onClick={() => addHours(label, rangeHours(14, 18), dayDate)}
                            className="text-[11px] px-2 py-1 rounded-full bg-gray-100 hover:bg-gray-200 border border-gray-200"
                            title="Ajouter 14–18 (futur uniquement)"
                          >
                            14–18
                          </button>
                          <button
                            type="button"
                            onClick={() => addHours(label, rangeHours(18, 21), dayDate)}
                            className="text-[11px] px-2 py-1 rounded-full bg-gray-100 hover:bg-gray-200 border border-gray-200"
                            title="Ajouter 18–21 (futur uniquement)"
                          >
                            Soir
                          </button>
                        </div>
                      </div>

                      {/* Plage perso */}
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-gray-500">Plage perso</span>
                        <div className="flex items-center gap-1">
                          <select
                            className="text-[11px] border rounded-md px-2 py-1 bg-white"
                            value={ranges[label]?.start ?? 8}
                            onChange={(e) => updateRange(label, 'start', e.target.value)}
                          >
                            {heures.map(h => <option key={h} value={h}>{h}h</option>)}
                          </select>
                          <span className="text-[11px]">→</span>
                          <select
                            className="text-[11px] border rounded-md px-2 py-1 bg-white"
                            value={ranges[label]?.end ?? 12}
                            onChange={(e) => updateRange(label, 'end', e.target.value)}
                          >
                            {heures.map(h => <option key={h} value={h}>{h}h</option>)}
                            <option value={24}>24h</option>
                          </select>
                        </div>
                        <button
                          type="button"
                          onClick={() => applyRange(label, dayDate)}
                          className="text-[11px] px-3 py-1.5 rounded-lg bg-primary text-white hover:bg-primary/90 shadow-sm"
                          title="Ajouter la plage (futur uniquement)"
                        >
                          Ajouter
                        </button>
                      </div>

                      {/* Panneau copier vers… */}
                      {copyPanel.openDay === label && (
                        <div className="mt-1 p-2.5 border rounded-xl bg-gray-50">
                          <div className="text-[11px] mb-1 text-gray-600">Copier vers :</div>
                          <div className="flex flex-wrap gap-1.5">
                            {jours.map((j2, j2idx) => (
                              <label key={j2} className={`text-[11px] px-2.5 py-1 rounded-full border cursor-pointer ${
                                copyPanel.targets.includes(j2) ? 'bg-primary text-white border-primary' : 'bg-white'
                              } ${j2 === label ? 'opacity-40 cursor-not-allowed' : ''}`}>
                                <input
                                  type="checkbox"
                                  className="hidden"
                                  disabled={j2 === label}
                                  checked={copyPanel.targets.includes(j2)}
                                  onChange={() => toggleCopyTarget(j2)}
                                />
                                {j2}
                                <span className="ml-1 text-[10px] text-gray-400">
                                  ({activeWeekDays[j2idx].getDate()}/{String(activeWeekDays[j2idx].getMonth()+1).padStart(2,'0')})
                                </span>
                              </label>
                            ))}
                          </div>
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              onClick={doCopy}
                              className="text-[11px] px-3 py-1.5 rounded-lg bg-primary text-white hover:bg-primary/90"
                            >
                              Copier
                            </button>
                            <button
                              type="button"
                              onClick={closeCopy}
                              className="text-[11px] px-3 py-1.5 rounded-lg border hover:bg-gray-50"
                            >
                              Fermer
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-gray-500 mt-2">
        Modifiable à partir de <b>{nowHour >= 23 ? 'demain 00h' : `${String(nowHour + 1).padStart(2,'0')}:00`}</b>.
        Les jours passés sont verrouillés. Sélectionne une semaine depuis le calendrier du haut pour l’éditer.
      </p>
    </div>
  );
}