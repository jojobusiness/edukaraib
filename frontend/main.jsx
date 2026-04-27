import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import App from './App';
import './styles/index.css';
import { inject } from '@vercel/analytics';
import { AuthProvider } from './contexts/AuthContext';
import { AppGuards } from './setup/mobile-and-errors';

if (import.meta.env.PROD) inject();

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