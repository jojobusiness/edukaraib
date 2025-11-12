import React, { useMemo, useState } from 'react';

// Jours + heures affichées
const DEFAULT_DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

// ---- utils "mois/semaines" repris de TeacherAvailabilityEditor ----
const startOfWeekMon = (d) => {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // 0=Mon..6=Sun
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
};
const startOfMonth = (d) => { const x = new Date(d); x.setDate(1); x.setHours(0,0,0,0); return x; };
const addMonths    = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };
const isoWeek = (date) => {
  const tmp = new Date(date.getTime());
  tmp.setHours(0,0,0,0);
  tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7));
  const week1 = new Date(tmp.getFullYear(), 0, 4);
  return 1 + Math.round(((tmp - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
};
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
// map 'Lun'..'Dim' -> index 0..6
const DAY_INDEX = { 'Lun':0, 'Mar':1, 'Mer':2, 'Jeu':3, 'Ven':4, 'Sam':5, 'Dim':6 };

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

  // ➕ impose un nombre exact de créneaux (ex: pack 5h / 10h)
  requiredCount = null, // null | 5 | 10
}) {
  const [selected, setSelected] = useState([]);

  // ------- NOUVEAU : navigation mois + semaine active -------
  const [monthCursor, setMonthCursor] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; });
  const [weekAnchor, setWeekAnchor] = useState(() => startOfWeekMon(new Date()));
  const activeWeekDays = useMemo(() => {
    const out = [];
    const start = startOfWeekMon(weekAnchor);
    for (let i = 0; i < 7; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      out.push(d);
    }
    return out;
  }, [weekAnchor]);

  // Verrous temporels (+1h)
  const now = new Date();
  const nowHour = now.getHours();
  const todayMidnight = new Date(); todayMidnight.setHours(0,0,0,0);
  const isSlotLockedByDate = (dayDate, hour) => {
    const d = new Date(dayDate); d.setHours(0,0,0,0);
    if (d.getTime() < todayMidnight.getTime()) return true;
    if (d.getTime() === todayMidnight.getTime()) {
      if (nowHour >= 23) return true;
      return hour <= nowHour; // autorise à partir de now+1h
    }
    return false;
  };

  // booked/remaining (inchangés)
  const bookedMap = useMemo(() => {
    const m = new Map();
    bookedSlots.forEach(({ day, hour }) => { m.set(`${day}:${hour}`, true); });
    return m;
  }, [bookedSlots]);

  const hours = useMemo(() => {
    const all = Object.values(availability || {}).flat().filter((h) => Number.isInteger(h));
    if (all.length === 0) return Array.from({ length: 12 }, (_, i) => i + 8); // 8 → 19h
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

  // Date réelle d’un label de jour (Lun..Dim) de la semaine active
  const dateForLabel = (label) => {
    const idx = DAY_INDEX[label] ?? 0;
    return activeWeekDays[idx];
  };

  const toggleSelect = (day, hour) => {
    if (!canBook) return;
    const dayDate = dateForLabel(day);
    if (!isAvailable(day, hour) || isBooked(day, hour)) return;
    if (isSlotLockedByDate(dayDate, hour)) return;

    if (multiSelect) {
      setSelected(prev => {
        const exists = prev.some(s => s.day === day && s.hour === hour);
        if (exists) return prev.filter(s => !(s.day === day && s.hour === hour));
        if (requiredCount && prev.length >= requiredCount) return prev; // limite pack
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
      <div className="bg-white p-6 rounded-2xl shadow-2xl max-w-4xl w-full relative border border-gray-100">
        <button
          className="absolute right-3 top-3 text-gray-500 hover:text-gray-700"
          onClick={onClose}
          aria-label="Fermer"
        >
          ✕
        </button>

        <h3 className="text-xl md:text-2xl font-extrabold text-slate-900 mb-1">
          {multiSelect ? 'Choisissez un ou plusieurs créneaux' : 'Choisissez un créneau'}
        </h3>

        {requiredCount && (
          <div className="mb-3 text-sm text-slate-700">
            Pack : sélectionnez <b>{requiredCount}</b> créneau(x). Reste à choisir : <b>{need}</b>.
          </div>
        )}

        {!canBook && (
          <div className="mb-3 rounded-xl border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-sm">
            Les comptes <b>professeurs</b> ne peuvent pas réserver de cours. Connectez-vous en élève/parent.
          </div>
        )}

        {/* Légende */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-700 mb-3 p-2 rounded-xl bg-gray-50 border border-gray-200">
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
            <span className="inline-block w-3 h-3 rounded bg-gray-200 border" /> Indisponible
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded bg-gray-300 border" /> Verrouillé (passé / &lt;= +1h)
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

        {/* ======= NOUVEAU : mini-calendrier mensuel + sélection de la semaine ======= */}
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
                  const isPast = (() => {
                    const a = new Date(day); a.setHours(0,0,0,0);
                    return a.getTime() < todayMidnight.getTime();
                  })();
                  const isActiveWeek = startOfWeekMon(day).getTime() === startOfWeekMon(weekAnchor).getTime();
                  return (
                    <button
                      key={j}
                      type="button"
                      disabled={isPast}
                      onClick={()=> setWeekAnchor(startOfWeekMon(day))}
                      className={[
                        "py-1 rounded border text-center",
                        isPast ? "text-gray-300 bg-gray-50 cursor-not-allowed"
                               : (isActiveWeek ? "bg-primary/10 border-primary/30 text-primary"
                                               : "bg-white hover:bg-gray-50")
                      ].join(' ')}
                      title={isPast ? "Jour passé" : "Éditer cette semaine"}
                    >
                      {day.getDate()}
                    </button>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Grille des créneaux (SEMAINE ACTIVE) */}
        <div className="overflow-x-auto">
          <table className="table-auto border text-xs mb-3">
            <thead>
              <tr className="bg-white">
                <th className="px-2 py-2"></th>
                {hours.map((h) => (
                  <th key={h} className="px-2 py-2 font-semibold text-slate-700">{h}h</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orderDays.map((dayLabel, idx) => {
                const dayDate = activeWeekDays[idx]; // date réelle
                return (
                  <tr key={dayLabel}>
                    <td className="font-bold px-2 py-2 text-slate-900">
                      {dayLabel}
                      <span className="ml-1 text-[10px] text-gray-400">
                        ({dayDate.getDate()}/{String(dayDate.getMonth()+1).padStart(2,'0')})
                      </span>
                    </td>
                    {hours.map((h) => {
                      const booked = isBooked(dayLabel, h);
                      const dispo = isAvailable(dayLabel, h);
                      const locked = isSlotLockedByDate(dayDate, h);
                      const sel = !locked && isSelected(dayLabel, h);
                      const remaining = remainingFor(dayLabel, h);

                      let classes = 'relative w-9 h-9 rounded-lg shadow flex items-center justify-center select-none transition ';
                      if (!canBook) {
                        classes += 'bg-gray-100 text-gray-300 cursor-not-allowed';
                      } else if (booked) {
                        classes += 'bg-red-500 text-white cursor-not-allowed';
                      } else if (locked) {
                        classes += 'bg-gray-300 text-white cursor-not-allowed'; // 🔒
                      } else if (sel) {
                        classes += 'bg-secondary text-white';
                      } else if (dispo) {
                        classes += 'bg-green-500 text-white hover:opacity-90';
                      } else {
                        classes += 'bg-gray-100 text-gray-400 cursor-not-allowed';
                      }

                      const baseTitle = booked
                        ? 'Créneau déjà réservé'
                        : locked
                        ? 'Verrouillé (passé ou avant +1h)'
                        : dispo
                        ? (sel ? 'Sélectionné' : 'Disponible')
                        : 'Indisponible';
                      const title = !canBook ? 'Réservation désactivée pour les professeurs' : baseTitle;

                      const disabledByPack =
                        canBook && dispo && !booked && !locked && !sel && requiredCount && selected.length >= requiredCount;

                      return (
                        <td key={h} className="px-1 py-1">
                          <button
                            type="button"
                            disabled={!canBook || !dispo || booked || locked || disabledByPack}
                            onClick={() => toggleSelect(dayLabel, h)}
                            className={classes + (disabledByPack ? ' opacity-60' : '')}
                            title={title}
                            aria-label={remaining !== null ? `${title}. Places restantes : ${remaining}` : title}
                          >
                            {booked ? '❌' : sel ? '✔' : ''}

                            {remaining !== null && !booked && !locked && canBook && (
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
                );
              })}
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

        <p className="mt-2 text-[11px] text-gray-500">
          Les créneaux **d’aujourd’hui** ne sont disponibles qu’à partir de <b>{nowHour >= 23 ? 'demain 00h' : `${String(nowHour + 1).padStart(2,'0')}:00`}</b>. Les jours passés sont verrouillés.
        </p>
      </div>
    </div>
  );
}