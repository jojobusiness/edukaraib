export function formatDateMaybe(ts) {
  if (!ts) return '';
  if (typeof ts?.toDate === 'function') return ts.toDate().toLocaleString('fr-FR');
  if (typeof ts?.seconds === 'number') return new Date(ts.seconds * 1000).toLocaleString('fr-FR');
  if (typeof ts === 'number') return new Date(ts).toLocaleString('fr-FR');
  if (typeof ts === 'string') {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? '' : d.toLocaleString('fr-FR');
  }
  return '';
}

const pad2 = (n) => String(n).padStart(2, '0');

export function whenString(lesson) {
  const s = formatDateMaybe(lesson?.start_datetime);
  if (s) return `📅 ${s}`;
  if (lesson?.slot_day || lesson?.slot_hour != null) {
    const d = lesson.slot_day || '';
    const h = lesson.slot_hour != null ? `${pad2(lesson.slot_hour)}:00` : '';
    const sep = d && h ? ' • ' : '';
    return `📅 ${d}${sep}${h}`.trim();
  }
  return '📅 Date ?';
}