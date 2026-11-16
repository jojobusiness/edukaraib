import React, { useMemo, useState } from 'react';
import { heuresLe, fuseauDispos, aujourdhui } from '../../api/_dispos.mjs';
import {
  JOURS, instantLocal, partiesLocales, lundiDe, ajouterJours, fuseauValide, fuseauNavigateur,
  nomFuseau, formatHeure,
} from '../../api/_fuseaux.mjs';

// Calendrier de réservation côté famille (refonte du 16/11/2026, PLAN_DISPOS_PROFS).
//
// Chaque case est un INSTANT : « lundi 17 h chez la famille ». On le traduit
// dans le fuseau du prof (lundi 18 h en Guyane) pour savoir s'il est libre :
// horaires habituels ou semaine particulière (api/_dispos.mjs). Les créneaux
// envoyés à la réservation restent exprimés chez le prof (slot_day, slot_hour,
// date, week : compatibilité avec tous les cours existants) et portent
// l'instant (startAt, start_utc) + fuseau_prof.
// Prof sans fuseau connu (vieux comptes) : ses heures sont lues dans le fuseau
// de la famille, comme avant le 16/11 — aucune régression.

const DEFAULT_DAYS = JOURS;
const DAY_INDEX = Object.fromEntries(JOURS.map((j, i) => [j, i]));
const jjmm = (date) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const HORIZON_JOURS = 84; // ouverture sur la 1re semaine qui a des créneaux, 12 semaines max

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

  freeCount = 0,
  showFreeLegend = true,
  promoFreeCount = 0,   // ✅ AJOUT

  fuseauFamille = null, // users/{uid}.timezone de celui qui réserve (16/11/2026)
}) {
  const [selected, setSelected] = useState([]);

  const [giftFlash, setGiftFlash] = useState(null);
  const [promoFlash, setPromoFlash] = useState(null);

  // Fuseaux : celui de la famille (affichage), celui du prof (saisie des heures)
  const tzVue = fuseauValide(fuseauFamille) ? fuseauFamille : (fuseauNavigateur() || 'America/Cayenne');
  const tzProf = fuseauDispos(availability) || tzVue;
  const conversion = tzProf !== tzVue;

  // Tri stable : instant
  const sortedSelected = useMemo(() => {
    return [...selected].sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
  }, [selected]);

  const requiredN = requiredCount ? Number(requiredCount) : null;

  // Clé unique d’un créneau, dans les termes du prof
  const slotKey = (s) => `${s.day}:${s.hour}:${s.date || ''}`;

  const totalFreeN = Math.max(0, Number(freeCount) || 0);
  const promoFreeN = Math.min(totalFreeN, Math.max(0, Number(promoFreeCount) || 0));
  const packFreeN = Math.max(0, totalFreeN - promoFreeN);

  const packFreeKeys = useMemo(() => new Set(sortedSelected.slice(0, packFreeN).map(slotKey)), [sortedSelected, packFreeN]);
  const promoFreeKeys = useMemo(() => new Set(sortedSelected.slice(packFreeN, packFreeN + promoFreeN).map(slotKey)), [sortedSelected, packFreeN, promoFreeN]);

  // Fermer avec Esc
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Horloge : les créneaux se verrouillent d'eux-mêmes chaque minute
  const [nowTick, setNowTick] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const aujVue = aujourdhui(nowTick, tzVue);

  // ------- Semaine affichée (lundi, chez la famille) -------
  const [lundiVue, setLundiVue] = useState(() => {
    // 02/11/2026 : s'ouvre sur la première semaine qui a des créneaux.
    const maintenant = Date.now();
    const aujProf = aujourdhui(maintenant, tzProf);
    for (let n = 0; n < HORIZON_JOURS; n += 1) {
      const d = ajouterJours(aujProf, n);
      const h = heuresLe(availability, d).find((x) => instantLocal(d, x, tzProf).getTime() > maintenant);
      if (h != null) return lundiDe(partiesLocales(instantLocal(d, h, tzProf), tzVue).date);
    }
    return lundiDe(aujourdhui(maintenant, tzVue));
  });
  const [moisCurseur, setMoisCurseur] = useState(() => `${lundiVue.slice(0, 7)}-01`);
  const datesVue = useMemo(() => JOURS.map((_, i) => ajouterJours(lundiVue, i)), [lundiVue]);

  // Case (jour i, heure h chez la famille) → créneau chez le prof
  const cellules = useMemo(() => {
    const m = new Map();
    datesVue.forEach((date, i) => {
      for (let h = 0; h < 24; h += 1) {
        const instant = instantLocal(date, h, tzVue);
        const p = partiesLocales(instant, tzProf);
        const dispo = p.minute === 0 && heuresLe(availability, p.date).includes(p.heure);
        m.set(`${i}:${h}`, {
          instant,
          dispo,
          slot: { day: p.jour, hour: p.heure, date: p.date, week: lundiDe(p.date) },
          heureProf: formatHeure(p.heure, p.minute),
          jourProfDifferent: p.date !== date,
        });
      }
    });
    return m;
  }, [datesVue, tzVue, tzProf, availability]);
  const cellule = (i, h) => cellules.get(`${i}:${h}`);

  // bookedMap : clés dans les termes du prof (comme les cours en base)
  const bookedMap = useMemo(() => {
    const m = new Map();
    const add = (key, studentIds = []) => {
      if (!key) return;
      const prev = m.get(key) || { any: false, mine: new Set() };
      prev.any = true;
      if (Array.isArray(myStudentIds) && myStudentIds.length && Array.isArray(studentIds)) {
        studentIds.forEach((sid) => { if (myStudentIds.includes(sid)) prev.mine.add(sid); });
      }
      m.set(key, prev);
    };
    (bookedSlots || []).forEach((it) => {
      const { day, hour } = it || {};
      if (!day || typeof hour !== 'number') return;
      const groupIds = Array.isArray(it.participant_ids) ? it.participant_ids : [];
      const studentsForThis = [...(it.student_id ? [it.student_id] : []), ...groupIds];
      if (it.date) add(`${day}:${hour}:${String(it.date).slice(0, 10)}`, studentsForThis);
      if (it.startAt) {
        const d = new Date(it.startAt?.toDate ? it.startAt.toDate() : it.startAt);
        if (!Number.isNaN(d.getTime())) add(`${day}:${hour}:${partiesLocales(d, tzProf).date}`, studentsForThis);
      }
      if (it.week) add(`${day}:${hour}:${it.week}`, studentsForThis);
    });
    return m;
  }, [bookedSlots, myStudentIds, tzProf]);

  const remainingFor = ({ day, hour, date, week }) => {
    for (const k of [`${day}:${hour}:${date}`, `${day}:${hour}:${week}`, `${day}:${hour}`]) {
      if (typeof remainingBySlot?.[k] === 'number') return remainingBySlot[k];
    }
    return null;
  };
  const entreeReservee = ({ day, hour, date, week }) => {
    const parDate = bookedMap.get(`${day}:${hour}:${date}`);
    const parSemaine = bookedMap.get(`${day}:${hour}:${week}`);
    return { any: !!(parDate?.any || parSemaine?.any), mine: parDate?.mine?.size ? parDate.mine : parSemaine?.mine };
  };
  const isBooked = (slot) => entreeReservee(slot).any;
  const myBookedCount = (slot) => entreeReservee(slot).mine?.size || 0;
  const myBookedNames = (slot) => Array.from(entreeReservee(slot).mine || []).map((sid) => idToName[sid] || sid);

  const estVerrouille = (c) => c.instant.getTime() <= nowTick;
  const isSelected = (slot) => selected.some((s) => slotKey(s) === slotKey(slot));

  // Quand les dispos changent, on enlève seulement les créneaux qui n'existent plus
  React.useEffect(() => {
    setSelected((prev) => (prev.length
      ? prev.filter((s) => heuresLe(availability, s.date).includes(s.hour))
      : prev));
  }, [availability]);

  // Heures (chez la famille) à afficher pour la semaine
  const hours = useMemo(() => {
    const toutes = [];
    for (let i = 0; i < 7; i += 1) for (let h = 0; h < 24; h += 1) if (cellule(i, h)?.dispo) toutes.push(h);
    if (!toutes.length) return Array.from({ length: 12 }, (_, i) => i + 8);
    const min = Math.min(...toutes);
    const max = Math.max(...toutes);
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellules]);

  // -------- Actions UI --------
  const toggleSelect = (i, h) => {
    if (!canBook) return;
    const c = cellule(i, h);
    if (!c || !c.dispo || isBooked(c.slot) || estVerrouille(c)) return;
    const k = slotKey(c.slot);
    const entree = {
      ...c.slot,
      startAt: c.instant,
      start_utc: c.instant.toISOString(),
      fuseau_prof: tzProf,
      fuseau_famille: tzVue,
      vue: { date: datesVue[i], hour: h },
    };

    if (!multiSelect) { setSelected([entree]); return; }

    setSelected((prev) => {
      if (prev.some((s) => slotKey(s) === k)) return prev.filter((s) => slotKey(s) !== k);
      if (requiredN && prev.length >= requiredN) return prev;
      const next = [...prev, entree];

      // 🎁/🎟️ animation si ce créneau devient "gratuit"
      if (totalFreeN > 0) {
        const idx = [...next].sort((a, b) => new Date(a.startAt) - new Date(b.startAt)).findIndex((s) => slotKey(s) === k);
        if (idx !== -1 && idx < totalFreeN) {
          if (idx < packFreeN) { setGiftFlash(k); window.setTimeout(() => setGiftFlash(null), 650); }
          else { setPromoFlash(k); window.setTimeout(() => setPromoFlash(null), 850); }
        }
      }
      return next;
    });
  };

  const handleSubmit = () => {
    if (!canBook) return;
    if (!selected.length) return;
    if (requiredN && selected.length !== requiredN) return; // impose exact
    if (multiSelect) onBook(sortedSelected); else onBook(sortedSelected[0]);
  };

  const need = requiredN ? (requiredN - selected.length) : null;

  // Calendrier du mois (chez la famille)
  const premierLundi = lundiDe(moisCurseur);
  const semainesMois = Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => ajouterJours(premierLundi, w * 7 + d)));
  const changerMois = (n) => {
    const [y, m] = moisCurseur.split('-').map(Number);
    setMoisCurseur(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10));
  };
  const nomMois = new Date(`${moisCurseur}T12:00:00Z`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const libelleCreneau = (s) => {
    const v = s.vue || { date: s.date, hour: s.hour };
    const jour = new Date(`${v.date}T12:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    return conversion
      ? `${jour} · ${formatHeure(v.hour)} chez vous · ${formatHeure(s.hour)} pour le prof`
      : `${jour} · ${formatHeure(v.hour)}`;
  };

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
            Pack : sélectionnez <b>{requiredN}</b> créneau(x). Reste à choisir : <b>{need}</b>.
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
          {showFreeLegend && packFreeN > 0 && (
            <span className="inline-flex items-center gap-1">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-amber-50 border border-amber-200">
                🎁
              </span>
              = Offert (pack)
            </span>
          )}

          {showFreeLegend && promoFreeN > 0 && (
            <span className="inline-flex items-center gap-1">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-emerald-50 border border-emerald-200">
                🎟️
              </span>
              = Bonus (code promo)
            </span>
          )}
        </div>

        {conversion && (
          <div className="mb-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
            Horaires affichés à <b>l'heure de chez vous ({nomFuseau(tzVue)})</b>. Le professeur est à l'heure de {nomFuseau(tzProf)} : son heure est indiquée sous chaque créneau choisi.
          </div>
        )}

        {/* Mini-calendrier mensuel + sélection de la semaine (chez la famille) */}
        <div className="mb-3 bg-white rounded-xl border shadow-sm p-3">
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={() => changerMois(-1)} className="px-2 py-1 text-sm rounded border hover:bg-gray-50" aria-label="Mois précédent">‹</button>
            <div className="font-semibold capitalize">{nomMois}</div>
            <button type="button" onClick={() => changerMois(1)} className="px-2 py-1 text-sm rounded border hover:bg-gray-50" aria-label="Mois suivant">›</button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-[11px]">
            {JOURS.map((h) => <div key={h} className="text-center text-gray-500">{h}</div>)}
            {semainesMois.flat().map((d) => {
              const isPast = d < aujVue;
              const isActiveWeek = lundiDe(d) === lundiVue;
              return (
                <button
                  key={d}
                  type="button"
                  disabled={isPast}
                  onClick={() => setLundiVue(lundiDe(d))}
                  className={[
                    'py-1 rounded border text-center',
                    isPast ? 'text-gray-300 bg-gray-50 cursor-not-allowed'
                      : (isActiveWeek ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-white hover:bg-gray-50'),
                  ].join(' ')}
                  title={isPast ? 'Jour passé' : 'Voir cette semaine'}
                >
                  {Number(d.slice(8, 10))}
                </button>
              );
            })}
          </div>
        </div>

        {/* Grille des créneaux (SEMAINE ACTIVE, heures de la famille) */}
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
              {orderDays.map((dayLabel) => {
                const i = DAY_INDEX[dayLabel] ?? 0;
                return (
                  <tr key={dayLabel}>
                    <td className="font-semibold px-2 py-2 text-slate-900">
                      {dayLabel}
                      <span className="ml-1 text-[10px] text-gray-400">({jjmm(datesVue[i])})</span>
                    </td>
                    {hours.map((h) => {
                      const c = cellule(i, h);
                      const slot = c.slot;
                      const booked = isBooked(slot);
                      const dispo = c.dispo;
                      const locked = estVerrouille(c);
                      const sel = !locked && isSelected(slot);
                      const remaining = remainingFor(slot);
                      const mesResa = myBookedCount(slot);

                      let classes = 'relative w-9 h-9 rounded-lg shadow flex items-center justify-center select-none transition ';
                      if (!canBook) classes += 'bg-gray-100 text-gray-300 cursor-not-allowed';
                      else if (booked) classes += 'bg-red-500 text-white cursor-not-allowed';
                      else if (locked) classes += 'bg-gray-300 text-white cursor-not-allowed'; // 🔒
                      else if (sel) classes += 'bg-secondary text-white';
                      else if (dispo) classes += 'bg-green-500 text-white hover:opacity-90';
                      else classes += 'bg-gray-100 text-gray-400 cursor-not-allowed';

                      const heureProf = conversion ? ` · ${c.heureProf}${c.jourProfDifferent ? ` le ${jjmm(slot.date)}` : ''} pour le prof` : '';
                      const baseTitle = booked ? 'Créneau déjà réservé'
                        : locked ? 'Verrouillé (passé)'
                          : dispo ? `${sel ? 'Sélectionné' : 'Disponible'} : ${h} h chez vous${heureProf}`
                            : 'Indisponible';
                      const title = !canBook ? 'Réservation désactivée pour les professeurs' : baseTitle;

                      const disabledByPack = canBook && dispo && !booked && !locked && !sel && requiredCount && selected.length >= requiredCount;
                      const thisKey = slotKey(slot);
                      const isPackFree = sel && packFreeKeys.has(thisKey);
                      const isPromoFree = sel && promoFreeKeys.has(thisKey);
                      const isGiftAnimating = giftFlash === thisKey;
                      const isPromoAnimating = promoFlash === thisKey;

                      return (
                        <td key={h} className="px-1 py-1">
                          <button
                            type="button"
                            disabled={!canBook || !dispo || booked || locked || disabledByPack}
                            onClick={() => toggleSelect(i, h)}
                            className={classes + (disabledByPack ? ' opacity-60' : '')}
                            title={title}
                            aria-label={remaining !== null ? `${title}. Places restantes : ${remaining}` : title}
                          >
                            {booked ? '❌' : sel ? '✔' : ''}

                            {isPackFree && (
                              <span
                                className={['absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center', 'bg-amber-50 border border-amber-200 text-base', isGiftAnimating ? 'animate-bounce' : ''].join(' ')}
                                title="Heure offerte (pack)"
                              >
                                🎁
                              </span>
                            )}

                            {isPromoFree && (
                              <span className="absolute -bottom-1 -right-1 w-6 h-6">
                                {isPromoAnimating && <span className="absolute inset-0 rounded-full bg-emerald-300/40 animate-ping" />}
                                <span
                                  className={['relative w-6 h-6 rounded-full flex items-center justify-center', 'bg-emerald-50 border border-emerald-200 text-base', isPromoAnimating ? 'animate-pulse' : ''].join(' ')}
                                  title="Heure bonus (code promo)"
                                >
                                  🎟️
                                </span>
                              </span>
                            )}

                            {remaining !== null && dispo && !booked && !locked && canBook && (
                              <span
                                className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] leading-[18px] text-center pointer-events-none"
                                title={`Places restantes : ${remaining}`}
                              >
                                {remaining}
                              </span>
                            )}

                            {mesResa > 0 && (
                              <span
                                className="absolute -bottom-1 -left-1 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-[10px] leading-[18px] text-center"
                                title={`Réservé pour : ${myBookedNames(slot).join(', ')}`}
                              >
                                {mesResa}
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

        {sortedSelected.length > 0 && (
          <ul className="mb-2 space-y-1 text-xs text-slate-700" data-testid="creneaux-choisis">
            {sortedSelected.map((s) => (
              <li key={slotKey(s)} className="flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-secondary" />
                {libelleCreneau(s)}
              </li>
            ))}
          </ul>
        )}

        <button
          className="w-full bg-primary text-white py-3 rounded-xl font-semibold shadow mt-2 disabled:opacity-60 hover:bg-primary/90"
          onClick={handleSubmit}
          disabled={
            !canBook ||
            !selected.length ||
            (requiredN && selected.length !== requiredN)
          }
          title={!canBook ? 'La réservation est désactivée pour les professeurs' : undefined}
        >
          {requiredCount
            ? `Réserver ${selected.length}/${requiredN} créneau(x)`
            : (multiSelect
                ? `Réserver ${selected.length} créneau${selected.length > 1 ? 'x' : ''}`
                : 'Réserver ce créneau')}
        </button>

        <p className="mt-2 text-[11px] text-gray-500">
          Un créneau se réserve jusqu'à l'heure de son début. Les jours passés sont verrouillés.
        </p>
      </div>
    </div>
  );
}