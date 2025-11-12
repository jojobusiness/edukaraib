import React from 'react';

const jours = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

// ⏰ Étendue horaire : 6h → 23h (créneaux d'1h : 6-7, ..., 23-24)
const heures = Array.from({ length: 18 }, (_, i) => i + 6); // 6..23

export default function TeacherAvailabilityEditor({ value = {}, onChange }) {
  // value attendu : { 'Lun': [9, 10], 'Mar': [], ... }  (chaque nombre = début d’un créneau d’1h)

  // ===== Verrous temporels (NOW + 1h) =====
  const now = new Date();
  const nowHour = now.getHours();          // 0..23
  const jsTodayIdx = now.getDay();         // 0=Dim, 1=Lun, ... 6=Sam

  // Map label jour -> index 0..6 aligné sur getDay()
  const dayLabelToJsIdx = (label) => ({ 'Dim':0,'Lun':1,'Mar':2,'Mer':3,'Jeu':4,'Ven':5,'Sam':6 })[label];

  // Interdiction:
  // - si jour passé dans la semaine courante
  // - si jour = aujourd'hui ET h <= nowHour  (on autorise dès now+1h)
  // - cas bord : si nowHour >= 23 => tout aujourd'hui bloqué
  const isSlotLocked = (dayLabel, hour) => {
    const dIdx = dayLabelToJsIdx(dayLabel);
    if (dIdx === undefined) return true;

    // jours d'avant = bloqués
    if (dIdx < jsTodayIdx) return true;

    // Aujourd'hui : <= nowHour bloqué (on édite à partir de +1h)
    if (dIdx === jsTodayIdx) {
      if (nowHour >= 23) return true;           // 23h → tout le jour non modifiable
      return hour <= nowHour;                    // ex 15:07 → 15h bloqué, 16h OK
    }

    // jours futurs : OK
    return false;
  };

  // Helpers internes standards
  const uniqueSorted = (arr) => Array.from(new Set(arr)).sort((a, b) => a - b);

  const setDay = (day, hoursArr) => {
    // filtre auto les heures verrouillées
    const safe = (hoursArr || []).filter((h) => !isSlotLocked(day, h));
    onChange({ ...value, [day]: uniqueSorted(safe) });
  };

  const addHours = (day, addArr) => {
    const current = value[day] || [];
    const safeToAdd = (addArr || []).filter((h) => !isSlotLocked(day, h));
    setDay(day, uniqueSorted([...current, ...safeToAdd]));
  };

  const clearDay = (day) => {
    // On autorise "vider" uniquement pour les créneaux encore modifiables
    const current = value[day] || [];
    const remaining = current.filter((h) => isSlotLocked(day, h)); // on garde ceux verrouillés (passés)
    onChange({ ...value, [day]: uniqueSorted(remaining) });
  };

  const selectAllDay = (day) => setDay(day, [...heures].filter((h) => !isSlotLocked(day, h)));

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
    if (isSlotLocked(day, hour)) return; // 🔒 ignore le clic si verrouillé
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
    addHours(day, hrs); // addHours filtre déjà les heures verrouillées
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
    const fromHours = (value[from] || []).filter((h) => !isSlotLocked(from, h)); // ne copie que le modifiable depuis "from"
    const next = { ...value };
    copyPanel.targets.forEach((d) => {
      if (d === from) return;
      // copie en filtrant les verrous du jour cible
      next[d] = uniqueSorted(fromHours.filter((h) => !isSlotLocked(d, h)));
    });
    onChange(next);
    closeCopy();
  };

  // ---- Presets semaine (toujours 1h par créneau) ----
  const applyPreset = (preset) => {
    const next = {};
    if (preset === 'empty') {
      jours.forEach((j) => (next[j] = (value[j] || []).filter((h) => isSlotLocked(j, h)))); // garde les verrouillés
    } else if (preset === 'office') {
      jours.forEach((j, idx) => {
        const base = idx <= 4 ? [...rangeHours(8, 12), ...rangeHours(14, 18)] : [];
        const safe = base.filter((h) => !isSlotLocked(j, h));
        // on merge avec les créneaux verrouillés existants
        const lockedKeep = (value[j] || []).filter((h) => isSlotLocked(j, h));
        next[j] = uniqueSorted([...lockedKeep, ...safe]);
      });
    } else if (preset === 'continuous') {
      jours.forEach((j, idx) => {
        const base = idx <= 5 ? rangeHours(9, 19) : [];
        const safe = base.filter((h) => !isSlotLocked(j, h));
        const lockedKeep = (value[j] || []).filter((h) => isSlotLocked(j, h));
        next[j] = uniqueSorted([...lockedKeep, ...safe]);
      });
    }
    onChange(next);
  };

  // Petite aide visuelle pour les boutons verrouillés
  const btnClass = (day, h) => {
    const selected = (value[day] || []).includes(h);
    const locked = isSlotLocked(day, h);
    if (locked) {
      return "w-7 h-7 rounded-md bg-gray-50 text-gray-300 ring-1 ring-gray-200 cursor-not-allowed";
    }
    return selected
      ? "w-7 h-7 rounded-md shadow-sm bg-green-600 text-white ring-1 ring-green-700/30"
      : "w-7 h-7 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-600 ring-1 ring-gray-200";
  };

  // ===== Vue mensuelle (lecture + sélection de semaine) =====
  const [monthCursor, setMonthCursor] = React.useState(() => {
    const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d;
  });

  // Monday-based helpers
  const startOfWeekMon = (d) => {
    const x = new Date(d);
    const day = (x.getDay() + 6) % 7; // 0=Mon..6=Sun
    x.setDate(x.getDate() - day);
    x.setHours(0,0,0,0);
    return x;
  };
  const startOfMonth = (d) => { const x=new Date(d); x.setDate(1); x.setHours(0,0,0,0); return x; };
  const addMonths = (d, n) => { const x=new Date(d); x.setMonth(x.getMonth()+n); return x; };

  // construit 6 semaines x 7 jours pour le mois courant (début lundi)
  const buildMonthMatrix = (cursor) => {
    const first = startOfMonth(cursor);
    const gridStart = startOfWeekMon(first);
    const weeks = [];
    for (let w=0; w<6; w++){
      const row = [];
      for (let d=0; d<7; d++){
        const cell = new Date(gridStart); cell.setDate(gridStart.getDate() + w*7 + d);
        row.push(cell);
      }
      weeks.push(row);
    }
    return weeks;
  };

  // week number ISO
  const isoWeek = (date) => {
    const tmp = new Date(date.getTime());
    tmp.setHours(0,0,0,0);
    // Thursday in current week allows calculation
    tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay()+6)%7));
    const week1 = new Date(tmp.getFullYear(),0,4);
    return 1 + Math.round(((tmp.getTime()-week1.getTime())/86400000 - 3 + ((week1.getDay()+6)%7))/7);
  };

  // changer de "semaine active" quand on clique un jour du mois (visuel)
  const [weekAnchor, setWeekAnchor] = React.useState(new Date());
  const goToWeekOf = (date) => setWeekAnchor(startOfWeekMon(date));

  const isPastDay = (d) => {
    const a = new Date(d); a.setHours(0,0,0,0);
    const b = new Date();  b.setHours(0,0,0,0);
    return a < b;
  };

  return (
    <div className="mt-6 mb-3">
      {/* --- Vue mensuelle compacte --- */}
      <div className="mb-3 bg-white rounded-xl border shadow-sm p-3">
        <div className="flex items-center justify-between mb-2">
          <button
            type="button"
            onClick={() => setMonthCursor((d)=>addMonths(d,-1))}
            className="px-2 py-1 text-sm rounded border hover:bg-gray-50"
          >‹</button>

          <div className="font-semibold">
            {monthCursor.toLocaleString('fr-FR', { month: 'long', year: 'numeric' })}
          </div>

          <button
            type="button"
            onClick={() => setMonthCursor((d)=>addMonths(d,1))}
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
                const disabled = isPastDay(new Date(day));
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
                    title={disabled ? "Jour passé" : "Voir/éditer cette semaine"}
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
              title="Vider toute la semaine (respecte les verrous)"
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

      {/* --- Grille hebdo (édition) --- */}
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
            {jours.map(jour => (
              <tr key={jour} className="align-top">
                <td className="font-bold text-gray-600 pr-2">{jour}</td>

                {/* Grille de 1h */}
                {heures.map(h => (
                  <td key={h} className="text-center">
                    <button
                      type="button"
                      onClick={() => toggle(jour, h)}
                      className={btnClass(jour, h)}
                      disabled={isSlotLocked(jour, h)}
                      title={
                        isSlotLocked(jour, h)
                          ? 'Créneau verrouillé (passé ou avant +1h)'
                          : ((value[jour] || []).includes(h) ? `${h}h–${h+1}h (sélectionné)` : `${h}h–${h+1}h`)
                      }
                    >
                      {(value[jour] || []).includes(h) && !isSlotLocked(jour, h) ? '✓' : ''}
                    </button>
                  </td>
                ))}

                {/* Actions rapides par jour */}
                <td className="min-w-[280px] align-top">
                  <div className="flex flex-col gap-2">
                    {/* Barre compacte d’actions jour */}
                    <div className="flex items-center flex-wrap gap-1.5">
                      {/* Compteur sélection du jour (créneaux encore modifiables) */}
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                        {(value[jour] || []).filter(h => !isSlotLocked(jour, h)).length} sélection(s)
                      </span>

                      <div className="inline-flex rounded-lg border border-gray-300 bg-white shadow-sm overflow-hidden">
                        <button
                          type="button"
                          onClick={() => selectAllDay(jour)}
                          className="px-2.5 py-1.5 text-[11px] hover:bg-gray-50"
                          title="Tout sélectionner (jour) – futur uniquement"
                        >
                          Tout
                        </button>
                        <div className="w-px bg-gray-200" />
                        <button
                          type="button"
                          onClick={() => clearDay(jour)}
                          className="px-2.5 py-1.5 text-[11px] hover:bg-gray-50"
                          title="Vider le jour (ne touche pas aux créneaux verrouillés)"
                        >
                          Vider
                        </button>
                        <div className="w-px bg-gray-200" />
                        <button
                          type="button"
                          onClick={() => openCopyFor(jour)}
                          className="px-2.5 py-1.5 text-[11px] hover:bg-gray-50"
                          title="Copier ce jour vers d'autres jours (verrous respectés)"
                        >
                          Copier →
                        </button>
                      </div>

                      {/* Raccourcis de plages 1 clic */}
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => addHours(jour, rangeHours(8, 12))}
                          className="text-[11px] px-2 py-1 rounded-full bg-gray-100 hover:bg-gray-200 border border-gray-200"
                          title="Ajouter 8→12 (futur uniquement)"
                        >
                          8–12
                        </button>
                        <button
                          type="button"
                          onClick={() => addHours(jour, rangeHours(14, 18))}
                          className="text-[11px] px-2 py-1 rounded-full bg-gray-100 hover:bg-gray-200 border border-gray-200"
                          title="Ajouter 14→18 (futur uniquement)"
                        >
                          14–18
                        </button>
                        <button
                          type="button"
                          onClick={() => addHours(jour, rangeHours(18, 21))}
                          className="text-[11px] px-2 py-1 rounded-full bg-gray-100 hover:bg-gray-200 border border-gray-200"
                          title="Ajouter 18→21 (futur uniquement)"
                        >
                          Soir
                        </button>
                      </div>
                    </div>

                    {/* Ajout de plage personnalisée */}
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-gray-500">Plage perso</span>
                      <div className="flex items-center gap-1">
                        <select
                          className="text-[11px] border rounded-md px-2 py-1 bg-white"
                          value={ranges[jour]?.start ?? 8}
                          onChange={(e) => updateRange(jour, 'start', e.target.value)}
                        >
                          {heures.map(h => <option key={h} value={h}>{h}h</option>)}
                        </select>
                        <span className="text-[11px]">→</span>
                        <select
                          className="text-[11px] border rounded-md px-2 py-1 bg-white"
                          value={ranges[jour]?.end ?? 12}
                          onChange={(e) => updateRange(jour, 'end', e.target.value)}
                        >
                          {heures.map(h => <option key={h} value={h}>{h}h</option>)}
                          <option value={24}>24h</option>
                        </select>
                      </div>
                      <button
                        type="button"
                        onClick={() => applyRange(jour)}
                        className="text-[11px] px-3 py-1.5 rounded-lg bg-primary text-white hover:bg-primary/90 shadow-sm"
                        title="Ajouter la plage (futur uniquement)"
                      >
                        Ajouter
                      </button>
                    </div>

                    {/* Panneau copie ciblée */}
                    {copyPanel.openDay === jour && (
                      <div className="mt-1 p-2.5 border rounded-xl bg-gray-50">
                        <div className="text-[11px] mb-1 text-gray-600">Copier vers :</div>
                        <div className="flex flex-wrap gap-1.5">
                          {jours.map((j2) => (
                            <label key={j2} className={`text-[11px] px-2.5 py-1 rounded-full border cursor-pointer ${
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
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-gray-500 mt-2">
        Modifiable à partir de <b>{nowHour >= 23 ? 'demain 00h' : `${String(nowHour + 1).padStart(2,'0')}:00`}</b>.
        Les jours passés sont verrouillés.
      </p>
    </div>
  );
}