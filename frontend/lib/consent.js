// Gestion du consentement cookies/traceurs (RGPD).
// Par défaut, GA (Consent Mode v2) et le Meta Pixel sont en attente (denied/revoke),
// fixé dans index.html. Ici on applique/relâche selon le choix de l'utilisateur.

const KEY = 'cookie_consent_v1'; // 'granted' | 'denied'

export function getStoredConsent() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

/** Propage le choix aux outils de tracking (sans persister). */
export function applyConsent(granted) {
  if (typeof window === 'undefined') return;

  // Google Consent Mode v2
  if (typeof window.gtag === 'function') {
    window.gtag('consent', 'update', {
      ad_storage: granted ? 'granted' : 'denied',
      analytics_storage: granted ? 'granted' : 'denied',
      ad_user_data: granted ? 'granted' : 'denied',
      ad_personalization: granted ? 'granted' : 'denied',
    });
  }

  // Meta Pixel — grant relâche les événements mis en attente (dont le PageView initial)
  if (typeof window.fbq === 'function') {
    window.fbq('consent', granted ? 'grant' : 'revoke');
  }
}

/** Persiste le choix ET le propage. */
export function setConsent(granted) {
  try { localStorage.setItem(KEY, granted ? 'granted' : 'denied'); } catch { /* no-op */ }
  applyConsent(granted);
}
