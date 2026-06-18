// Helper centralisé Amplitude (analytics produit : funnels, rétention, cohortes).
// Init appelée une seule fois dans main.jsx, en PROD uniquement (pas de pollution
// avec les events de dev local). Calqué sur metaPixel.js : tout est gardé pour ne
// jamais casser le rendu si le SDK n'est pas chargé (bloqueur, échec réseau, etc.).
//
// ⚠️ Le SDK est chargé en IMPORT DYNAMIQUE (chunk séparé, hors bundle critique) :
// le pixel autocapture est lourd (~60 Ko gzip) et on ne veut pas plomber le LCP des
// landings (/bac, 88 % trafic froid mobile). On l'initialise après le 1er rendu.

// Clé client publique (comme META_PIXEL_ID). Override possible via env Vercel.
export const AMPLITUDE_API_KEY =
  import.meta.env.VITE_AMPLITUDE_API_KEY || '70801e37c57d797fe6fbaf4b555798ca';

let amp = null;       // module Amplitude une fois chargé
let started = false;

const whenIdle = (cb) =>
  typeof window !== 'undefined' && 'requestIdleCallback' in window
    ? window.requestIdleCallback(cb, { timeout: 3000 })
    : setTimeout(cb, 1200);

/** Initialise Amplitude une seule fois, après le rendu (chunk async). À appeler en PROD. */
export function initAmplitude() {
  if (started || typeof window === 'undefined' || !AMPLITUDE_API_KEY) return;
  started = true;
  whenIdle(async () => {
    try {
      amp = await import('@amplitude/analytics-browser');
      amp.init(AMPLITUDE_API_KEY, {
        serverZone: 'EU', // ⚠️ projet EU (app.eu.amplitude.com) — sans ça le SDK poste
                          // vers l'endpoint US api2.amplitude.com → 400 "Invalid API key".
        autocapture: true, // pages vues, clics, formulaires, sessions — zéro code en plus
        defaultTracking: { sessions: true },
      });
    } catch { amp = null; /* no-op */ }
  });
}

/** Event personnalisé Amplitude. No-op tant que le SDK n'est pas chargé (dev/local). */
export function ampTrack(event, props = {}) {
  if (!amp) return;
  try { amp.track(event, props); } catch { /* no-op */ }
}

/** Associe les events à un utilisateur connecté (uid Firebase). */
export function ampIdentify(userId) {
  if (!amp || !userId) return;
  try { amp.setUserId(userId); } catch { /* no-op */ }
}
