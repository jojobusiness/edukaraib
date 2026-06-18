import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import App from './App';
import './styles/index.css';
import { inject } from '@vercel/analytics';
import { AuthProvider } from './contexts/AuthContext';
import { AppGuards } from './setup/mobile-and-errors';
import { initAmplitude } from './lib/amplitude';

if (import.meta.env.PROD) {
  inject();
  initAmplitude(); // funnels/rétention — PROD only pour ne pas polluer avec le dev local
}

// Apres un deploiement, les chunks de l'ancien build n'existent plus (404)
// -> page blanche pour les onglets restes ouverts. On recharge une fois
// pour recuperer le build a jour (garde anti-boucle 10s via sessionStorage).
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  const k = 'chunk_reload_ts';
  const last = Number(sessionStorage.getItem(k) || 0);
  if (Date.now() - last > 10_000) {
    sessionStorage.setItem(k, String(Date.now()));
    window.location.reload();
  }
});

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  enabled: !!import.meta.env.VITE_SENTRY_DSN,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration({
      maskAllText: false,
      blockAllMedia: false,
    }),
  ],
  // Bruit tiers : erreurs injectées par les navigateurs in-app (Instagram, Facebook,
  // TikTok...). Ex : "Java object is gone" vient du logger de perf d'Instagram quand
  // l'utilisateur quitte la page — aucun rapport avec notre code, mais Sentry les capte
  // via son wrapper addEventListener. On les ignore pour ne pas polluer + faux pings.
  ignoreErrors: [
    'Java object is gone',            // navigateur in-app Instagram/Meta (Android)
    'Error invoking postMessage',
    "window.webkit.messageHandlers",  // navigateur in-app Facebook/Meta (iOS WKWebView)
    'ResizeObserver loop',
  ],
  denyUrls: [
    /iabjs:\/\//i,                       // scripts injectés par les in-app browsers
    /navigation_performance_logger/i,    // logger interne Instagram/Meta
    /graph\.(instagram|facebook)\.com/i,
  ],
  tracesSampleRate: 0.2,       // 20% des transactions (performances)
  replaysSessionSampleRate: 0.05,
  replaysOnErrorSampleRate: 1.0, // 100% des sessions avec erreur
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppGuards>
      <AuthProvider>
        <App />
      </AuthProvider>
    </AppGuards>
  </React.StrictMode>
);