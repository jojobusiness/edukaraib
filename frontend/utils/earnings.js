export const COMMISSION_RATE = 0.05; // 5%

export const fmtEUR = (n) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })
    .format(Number(n || 0));

export const toNum = (v) => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Ordre préféré pour dater le revenu
export const getRevenueDate = (l) => {
  const ts = l?.paid_at || l?.completed_at || l?.start_datetime || l?.created_at;
  if (!ts) return new Date();
  if (typeof ts?.toDate === 'function') return ts.toDate();
  if (typeof ts?.seconds === 'number') return new Date(ts.seconds * 1000);
  const d = new Date(ts);
  return Number.isFinite(d.getTime()) ? d : new Date();
};

// Montant payé : total > fallback (prix/h × durée)
export const getPaidAmount = (l) => {
  const total =
    toNum(l.total_amount) ||
    toNum(l.total_price) ||
    toNum(l.amount_paid) ||
    toNum(l.amount);

  if (total > 0) return total;

  const pph = toNum(l.price_per_hour);
  const hours = toNum(l.duration_hours) || toNum(l.hours) || 1;
  return pph * hours;
};

export const monthLabel = (i) =>
  new Date(2000, i, 1).toLocaleString('fr-FR', { month: 'short' });