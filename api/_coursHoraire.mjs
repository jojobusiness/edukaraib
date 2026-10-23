// « Le cours a-t-il eu lieu ? » — une seule règle pour tout le serveur (23/10/2026).
//
// Avant, un prof pouvait passer un cours en « completed » AVANT qu'il ait eu
// lieu, et déclencher aussitôt son virement (/api/trigger-payout) : la
// famille payait un cours qui n'était pas encore donné. On ne verse plus
// rien avant la fin prévue du cours (début + 1 h). Module pur.

const UNE_HEURE = 60 * 60 * 1000;

/** Date de début du cours, ou null si on ne la connaît pas. */
export function debutDuCours(l) {
  if (!l) return null;
  for (const v of [l.startAt, l.start_datetime]) {
    if (!v) continue;
    if (typeof v.toDate === 'function') return v.toDate();
    if (typeof v.seconds === 'number') return new Date(v.seconds * 1000);
    const d = v instanceof Date ? v : new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (l.date && typeof l.slot_hour === 'number') {
    const d = new Date(`${String(l.date).slice(0, 10)}T${String(l.slot_hour).padStart(2, '0')}:00:00`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/**
 * true si la fin prévue du cours est passée. Un cours sans date connue est
 * considéré comme passé (anciens cours), pour ne bloquer aucun prof à tort.
 */
export function coursTermine(l, maintenant = Date.now()) {
  const d = debutDuCours(l);
  if (!d) return true;
  const duree = Math.min(Math.max(Number(l.duration_hours) || 1, 1), 8) * UNE_HEURE;
  return maintenant >= d.getTime() + duree;
}
