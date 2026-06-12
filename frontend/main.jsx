import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import App from './App';
import './styles/index.css';
import { inject } from '@vercel/analytics';
import { AuthProvider } from './contexts/AuthContext';
import { AppGuards } from './setup/mobile-and-errors';

if (import.meta.env.PROD) inject();

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