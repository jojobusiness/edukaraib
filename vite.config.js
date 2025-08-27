import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: '.',                 // <-- index.html reste à la racine
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true }, // => dist (à la racine)
});