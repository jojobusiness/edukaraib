import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: '.',                 // <-- index.html reste à la racine
  base: '/',                // garantit des chemins corrects en prod
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true }, // => dist (à la racine)
});