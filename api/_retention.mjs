// Conservation des conversations — règle unique (15/10/2026).
//
// Décision de Joseph : on conserve **12 mois**, puis on purge. Pourquoi les
// deux à la fois :
// - CONSERVER, parce qu'un harcèlement, une arnaque ou un litige se règlent
//   avec la preuve de ce qui a été écrit. Depuis le 15/10, un participant ne
//   peut plus détruire la conversation : il la masque pour lui seul.
// - PURGER, parce que « on garde pour toujours » n'est pas une politique de
//   conservation : le RGPD (art. 5-1-e) impose une durée définie et annoncée.
//   Plus de données gardées = plus de responsabilité le jour d'une fuite.
//
// ⚠️ Une conversation touchée par un signalement est GELÉE (`conservation_litige`)
// et échappe à la purge : c'est exactement le dossier qu'on voudra produire.

export const MOIS_CONSERVATION = 12;

const toDate = (v) => (v?.toDate ? v.toDate() : v ? new Date(v) : null);

/** Date de la dernière activité connue d'une conversation. */
export function derniereActivite(conv = {}) {
  return toDate(conv.lastSentAt) || toDate(conv.created_at) || null;
}

/**
 * Cette conversation doit-elle être purgée ?
 * @returns {{ purger: boolean, raison: string }}
 */
export function aPurger(conv = {}, { maintenant = new Date(), mois = MOIS_CONSERVATION } = {}) {
  if (conv.conservation_litige) return { purger: false, raison: 'gelée pour litige ou signalement' };
  const date = derniereActivite(conv);
  if (!date) return { purger: false, raison: 'aucune date, on ne devine pas' };
  const limite = new Date(maintenant);
  limite.setMonth(limite.getMonth() - mois);
  return date < limite
    ? { purger: true, raison: `inactive depuis plus de ${mois} mois` }
    : { purger: false, raison: 'dans la période de conservation' };
}
