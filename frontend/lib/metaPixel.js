// Helper centralisé Meta Pixel (côté navigateur).
// Le pixel de base (init + 1er PageView) est chargé dans index.html.
// Ici : les événements du tunnel, avec garde si fbq n'est pas chargé (bloqueur de pub, etc.).
//
// Mirroring Amplitude : chaque event du tunnel envoyé à Meta part AUSSI vers Amplitude
// (funnels/rétention). ampTrack est gardé en interne (no-op si Amplitude pas initialisé).

import { ampTrack } from './amplitude';

export const META_PIXEL_ID = '902547262470626';

const ready = () => typeof window !== 'undefined' && typeof window.fbq === 'function';

/** Événement standard Meta. options peut contenir { eventID } pour la déduplication avec le CAPI serveur. */
export function pixelTrack(event, params = {}, options = undefined) {
  ampTrack(event, params);
  if (!ready()) return;
  try { window.fbq('track', event, params, options); } catch { /* no-op */ }
}

/** Événement personnalisé. */
export function pixelTrackCustom(event, params = {}) {
  ampTrack(event, params);
  if (!ready()) return;
  try { window.fbq('trackCustom', event, params); } catch { /* no-op */ }
}

/** PageView manuel pour les navigations SPA (le 1er PageView part depuis index.html). */
export function pixelPageView() {
  if (!ready()) return;
  try { window.fbq('track', 'PageView'); } catch { /* no-op */ }
}
