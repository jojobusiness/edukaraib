import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';

export default defineConfig({
  root: '.',
  base: '/',
  plugins: [
    react(),
    sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: true,
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true, // requis pour que Sentry puisse afficher le code source dans les erreurs
    rollupOptions: {
      output: {
        // Vendors stables dans des chunks dedies : leur hash ne change pas
        // entre deploiements -> cache navigateur reutilise, seul le code
        // de l'app est retelecharge
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage'],
          'vendor-sentry': ['@sentry/react'],
        },
      },
    },
  },
});