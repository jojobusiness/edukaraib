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
  myStudentIds = [],     // ⬅️ IDs des enfants du parent (optionnel)
  idToName = {},         // ⬅️ { [id]: "Nom complet" } pour l’infobulle (optionnel)
}) {
  const [selected, setSelected] = useState([]);

  // Fermer avec Esc
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // ------- Navigation mois + semaine active -------
  const [monthCursor, setMonthCursor] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; });
  const [weekAnchor, setWeekAnchor]   = useState(() => startOfWeekMon(new Date()));

  const activeWeekDays = useMemo(() => {
    const out = [];
    const start = startOfWeekMon(weekAnchor);
    for (let i = 0; i < 7; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      out.push(d);
    }
    return out;
  }, [weekAnchor]);

  // -------- Verrous temporels (+1h) --------
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

  // -------- Helpers dépendants de la semaine active (⚠ ordre important) --------

  // Date réelle (objet Date) d’un label 'Lun'..'Dim' pour la semaine active
  const dateForLabel = (label) => {
    const idx = DAY_INDEX[label] ?? 0;
    return activeWeekDays[idx];
  };

  // YYYY-MM-DD du jour (dans la semaine active) pour un label 'Lun'..'Dim'
  const dayDateKey = (label) => {
    const d = dateForLabel(label);
    return d ? d.toISOString().slice(0,10) : null;
  };

  // ISO du lundi de la semaine active (ex: "2025-11-10")
  const activeWeekKey = React.useMemo(() => {
    const d = startOfWeekMon(weekAnchor);
    return d.toISOString().slice(0,10);
  }, [weekAnchor]);

  // bookedMap sensible à la semaine (avec fallback jour:heure)
  const bookedMap = useMemo(() => {
    // Map key -> { any: boolean, mine: Set<studentId> }
    const m = new Map();
    const add = (key, studentIds = []) => {
      if (!key) return;
      const prev = m.get(key) || { any: false, mine: new Set() };
      prev.any = true;
      // Marque mes enfants spécifiquement
      if (Array.isArray(myStudentIds) && myStudentIds.length && Array.isArray(studentIds)) {
        studentIds.forEach(sid => { if (myStudentIds.includes(sid)) prev.mine.add(sid); });
      }
      m.set(key, prev);
    };
    (bookedSlots || []).forEach((it) => {
      const { day, hour } = it || {};
      if (!day || typeof hour !== 'number') return;
      // On récupère tous les IDs possiblement concernés par la résa
      const groupIds = Array.isArray(it.participant_ids) ? it.participant_ids : [];
      const studentsForThis = [
        ...(it.student_id ? [it.student_id] : []),
        ...groupIds,
      ];
      // 1) clé par date exacte si fournie
      if (it.date) add(`${day}:${hour}:${String(it.date).slice(0,10)}`, studentsForThis);
      // 2) clé par date dérivée de startAt si présent
      if (it.startAt) {
        const d = new Date(it.startAt);
        if (!isNaN(d)) add(`${day}:${hour}:${d.toISOString().slice(0,10)}`, studentsForThis);
      }
      // 3) clé par semaine si fournie
      if (it.week) add(`${day}:${hour}:${it.week}`, studentsForThis);
    });
    return m;
  }, [bookedSlots, myStudentIds]);

// places restantes (date > semaine, pas de fallback global)
const remainingFor = (day, hour) => {
  const dkey = dayDateKey(day);
  const wkKey = `${day}:${hour}:${activeWeekKey}`;
  if (dkey && typeof remainingBySlot?.[`${day}:${hour}:${dkey}`] === 'number') {
    return remainingBySlot[`${day}:${hour}:${dkey}`];
  }
  if (typeof remainingBySlot?.[wkKey] === 'number') {
    return remainingBySlot[wkKey];
  }
  return null;
};

  // ✅ Y a-t-il une résa ? (utilise la structure {any, mine})
  const isBooked = (day, hour) => {
    const dkey = dayDateKey(day);
    if (dkey && bookedMap.get(`${day}:${hour}:${dkey}`)?.any) return true;
    if (bookedMap.get(`${day}:${hour}:${activeWeekKey}`)?.any) return true;
    return false;
  };

  // ✅ Combien de MES enfants ont une résa sur ce créneau ?
  const myBookedCount = (day, hour) => {
    const dkey = dayDateKey(day);
    const byDate = dkey ? bookedMap.get(`${day}:${hour}:${dkey}`) : null;
    const byWeek = bookedMap.get(`${day}:${hour}:${activeWeekKey}`);
    const set = byDate?.mine?.size ? byDate.mine : byWeek?.mine;
    return set ? set.size : 0;
  };

  // ✅ Noms des enfants pour le tooltip
  const myBookedNames = (day, hour) => {
    const dkey = dayDateKey(day);
    const byDate = dkey ? bookedMap.get(`${day}:${hour}:${dkey}`) : null;
    const byWeek = bookedMap.get(`${day}:${hour}:${activeWeekKey}`);
    const set = byDate?.mine?.size ? byDate.mine : byWeek?.mine;
    if (!set || set.size === 0) return [];
    return Array.from(set).map(sid => idToName[sid] || sid);
  };

  const isAvailable = (day, hour) => Array.isArray(availability[day]) && availability[day].includes(hour);
  const isSelected  = (day, hour) => selected.some(s => s.day === day && s.hour === hour);

  // 🧠 Quand on change de semaine (ou que le planning change), ne garder que les créneaux encore valides
  React.useEffect(() => {
    setSelected((prev) => {
      if (!Array.isArray(prev) || prev.length === 0) return prev;
      return prev.filter(({ day, hour }) => {
        const stillAvailable = Array.isArray(availability[day]) && availability[day].includes(hour);
        if (!stillAvailable) return false;

        const dayDate = dateForLabel(day); // semaine active actuelle
        if (isSlotLockedByDate(dayDate, hour)) return false;

        if (isBooked(day, hour)) return false;

        const rem = remainingFor(day, hour);
        if (rem !== null && rem <= 0) return false;

        return true;
      });
    });
  }, [weekAnchor, availability, remainingBySlot, bookedSlots]); // filtrage intelligent

  // Heures à afficher
  const hours = useMemo(() => {
    const all = Object.values(availability || {})
      .flat()
      .filter((h) => Number.isInteger(h));

    if (all.length === 0) {
      // défaut 8h → 19h
      return Array.from({ length: 12 }, (_, i) => i + 8);
    }

    const min = Math.max(0, Math.min(...all));
    const max = Math.min(23, Math.max(...all));

    return Array.from({ length: (max - min + 1) }, (_, i) => min + i);
  }, [availability]);

  // -------- Actions UI --------
  const toggleSelect = (day, hour) => {
    if (!canBook) return;

    const dayDate = dateForLabel(day); // Date réelle de ce jour dans la semaine affichée
    if (!dayDate) return;

    if (!isAvailable(day, hour) || isBooked(day, hour)) return;
    if (isSlotLockedByDate(dayDate, hour)) return;

    // On construit une date complète à partir du dayDate de la semaine affichée
    const dateStr = dayDate.toISOString().slice(0, 10); // "YYYY-MM-DD"
    const week = activeWeekKey;                         // lundi de la semaine (clé)
    const startAt = new Date(dayDate);
    startAt.setHours(hour, 0, 0, 0);

    if (multiSelect) {
      setSelected((prev) => {
        const exists = prev.some((s) => s.day === day && s.hour === hour);
        if (exists) {
          // on retire si on reclique
          return prev.filter((s) => !(s.day === day && s.hour === hour));
        }
        if (requiredCount && prev.length >= requiredCount) return prev; // limite pack

        return [
          ...prev,
          { day, hour, date: dateStr, week, startAt },
        ];
      });
    } else {
      setSelected([{ day, hour, date: dateStr, week, startAt }]);
    }
  };

  const handleSubmit = () => {
    if (!canBook) return;
    if (!selected.length) return;
    if (requiredCount && selected.length !== requiredCount) return; // impose exact
    if (multiSelect) onBook(selected); else onBook(selected[0]);
  };

  const need = requiredCount ? (requiredCount - selected.length) : null;

  // -------- RENDER --------
  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-40 bg-black/30"
      onClick={onClose}
    >
      <div
        className="bg-white p-6 rounded-2xl shadow-2xl max-w-3xl w-full relative border border-gray-100 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="absolute right-3 top-3 text-gray-500 hover:text-gray-700"
          onClick={onClose}
          aria-label="Fermer"
        >
          ✕
        </button>

        <h3 className="text-xl md:text-2xl font-semibold text-slate-900 mb-1">
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

        {/* Mini-calendrier mensuel + sélection de la semaine */}
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
                    <td className="font-semibold px-2 py-2 text-slate-900">
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

                            {/* 🔵 remets CE bloc */}
                            {remaining !== null && !booked && !locked && canBook && (
                              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] leading-[18px] text-center pointer-events-none" title={`Places restantes : ${remaining}`}>
                                {remaining}
                              </span>
                            )}                  

                            {myBookedCount(dayLabel, h) > 0 && (
                              <span
                                className="absolute -bottom-1 -left-1 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-[10px] leading-[18px] text-center"
                                title={`Réservé pour : ${myBookedNames(dayLabel, h).join(', ')}`}
                              >
                                {myBookedCount(dayLabel, h)}
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
          Les créneaux d’aujourd’hui ne sont disponibles qu’à partir de <b>{nowHour >= 23 ? 'demain 00h' : `${String(nowHour + 1).padStart(2,'0')}:00`}</b>. Les jours passés sont verrouillés.
        </p>
      </div>
    </div>
  );
}