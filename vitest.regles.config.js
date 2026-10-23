// Tests des règles Firestore sur l'émulateur (23/10/2026) — séparés de
// `npm test` : ils ont besoin de l'émulateur, lancé par `npm run test:regles`.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['frontend/test-regles/**/*.spec.js'],
    testTimeout: 20000,
    fileParallelism: false,
  },
});
