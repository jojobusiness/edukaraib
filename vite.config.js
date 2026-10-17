import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';

/* La version du site = le commit déployé par Vercel (17/10/2026). Publiée dans
   /version.json pour que les onglets déjà ouverts sachent qu'un nouveau build
   existe — voir frontend/lib/miseAJour.js. Même mécanique que Factur'Peyi
   (10/10) et Belmyre (14/10). */
const VERSION = (process.env.VERCEL_GIT_COMMIT_SHA || 'local').slice(0, 7);

/* Le fichier vit à la RACINE du site, pas dans /assets : son adresse est fixe,
   c'est son contenu qui change à chaque déploiement. */
const publierVersion = () => ({
  name: 'publier-version',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'version.json',
      source: JSON.stringify({ version: VERSION, build: new Date().toISOString() }),
    });
  },
});


export default defineConfig({
  root: '.',
  base: '/',
  test: {
    // Les pages sont rendues dans un DOM simulé, sans navigateur ni réseau.
    environment: 'jsdom',
    // jsdom embarque des dépendances ESM que le pool 'forks' (require) ne sait
    // pas charger : les threads les gèrent nativement.
    pool: 'threads',
    globals: false,
    setupFiles: ['./frontend/test/setup.js'],
    include: ['frontend/**/*.test.{js,jsx}'],
    // Un test de rendu qui traîne signale presque toujours une boucle infinie.
    testTimeout: 15000,
  },
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(VERSION),
  },
  plugins: [
    react(),
    publierVersion(),
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