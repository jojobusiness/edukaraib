import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

// Config alignée sur celle de Factur'Peyi (harmonisation du 01/08/2026).
// Le but n'est pas le style : c'est d'attraper la classe de bug qui a coûté
// 24 h de page blanche en production sur Factur'Peyi le 29/07/2026 —
// un composant utilisé dans le JSX sans être importé.

// `catch {}` volontaire (best-effort : analytics, storage, parsing tolérant) est
// un idiome assumé de ce code : 146 occurrences. En erreur, il noyait les vrais
// signaux sous du bruit — c'est précisément ce qui rend un lint inutile.
const communes = {
  'no-empty': ['error', { allowEmptyCatch: true }],
};

export default [
  { ignores: ['dist/**', 'node_modules/**', 'functions/node_modules/**', 'public/**'] },

  {
    // Code serveur : fonctions Vercel (.mjs/.js) et scripts one-shot à la racine.
    // Sans ce bloc, `process`, `Buffer` et `console` remontent en `no-undef` —
    // du bruit qui masque les VRAIES variables non définies.
    // `*.js` couvre aussi les fichiers de config racine (vite, tailwind, postcss,
    // eslint) : sans eux, 4 fichiers échappaient entièrement au lint.
    files: ['api/**/*.{js,mjs}', '*.mjs', '*.js'],
    languageOptions: {
      globals: { ...globals.node },
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      ...js.configs.recommended.rules,
      ...communes,
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },

  {
    // Cloud Functions Firebase : CommonJS (`require`, `module`, `exports`).
    files: ['functions/**/*.js'],
    languageOptions: {
      globals: { ...globals.node },
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
    },
    rules: {
      ...js.configs.recommended.rules,
      ...communes,
      // `context` est imposé par la signature des triggers Firebase même inutilisé.
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_|^context$' }],
    },
  },

  {
    // Tests : Node (Buffer, global) + navigateur simulé par jsdom.
    files: ['frontend/test/**/*.{js,jsx}', '**/*.test.{js,jsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },

  {
    files: ['frontend/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: { react, 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    settings: { react: { version: 'detect' } },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      ...communes,

      // ⚠️ NE PAS RETIRER — `no-undef` ne voit PAS les noms d'éléments JSX.
      // Un composant utilisé sans import passe `vite build` ET le lint standard,
      // puis lève une ReferenceError au rendu : page blanche en production.
      // Seule cette règle attrape ce cas.
      'react/jsx-no-undef': 'error',

      // Marquent les composants/React importés comme « utilisés »
      // (sinon no-unused-vars les signalerait à tort).
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',

      'no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
      'react-refresh/only-export-components': 'off',

      // Un sélecteur de variante écrit `\u{FE0F}` est une intention explicite de
      // l'auteur ; c'est le littéral emoji collé dans une classe qui est piégeux
      // (il s'y décompose en silence). L'option ne tolère que la forme échappée.
      'no-misleading-character-class': ['error', { allowEscape: true }],
    },
  },
];
