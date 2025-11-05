import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/index.css';
import { inject } from '@vercel/analytics';
import { AuthProvider } from './contexts/AuthContext';
if (import.meta.env.PROD) inject();
import { AppGuards } from './setup/mobile-and-errors';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <AppGuards>
        <App />
      </AppGuards>
    </AuthProvider>
  </React.StrictMode>
);