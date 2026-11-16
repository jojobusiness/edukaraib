// Boîte qui reçoit TOUTES les alertes destinées à l'équipe (16/11/2026).
//
// Décision de Joseph : contact@edukaraib.com pour tout (boîte Zoho lue chaque
// jour). Avant : la boîte Gmail du compte, plus lue → l'alerte du 16/11 est restée
// non lue. Les Cloud Functions lisent la même valeur (functions/.env, ADMIN_INBOX).
export const ADMIN_INBOX = process.env.ADMIN_INBOX || 'contact@edukaraib.com';

export const DELAI_ADMIN_MS = 2 * 60 * 60 * 1000;
const enDate = (v) => (v?.toDate ? v.toDate() : v ? new Date(v) : null);

/** Vrai si un message à l'admin attend depuis 2 h sans réponse ni rappel (suivi_messages_admin). */
export function rappelAdminDu(s, maintenant = new Date()) {
  const depuis = enDate(s?.premier_sans_reponse_at);
  if (!depuis || s.repondu_at || s.rappel_at) return false;
  return maintenant - depuis >= DELAI_ADMIN_MS;
}
