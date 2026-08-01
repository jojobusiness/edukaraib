// Enveloppe de rendu commune aux tests : les fournisseurs de contexte dont
// dépendent toutes les pages (routeur, authentification).

import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

/** Utilisateur de test : un compte authentifié représentatif. */
export const UTILISATEUR_TEST = {
  uid: 'u1',
  email: 'test@exemple.fr',
  displayName: 'Compte de test',
  getIdToken: async () => 'jeton',
};

/**
 * `useAuth` est remplacé plutôt que d'exécuter le vrai AuthContext : celui-ci
 * s'abonne à Firebase Auth et resterait indéfiniment à `authReady: false`, ce
 * qui ferait passer tous les tests sur un écran de chargement — donc sans rien
 * vérifier.
 */
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: UTILISATEUR_TEST, authReady: true }),
  AuthProvider: ({ children }) => children,
}));

/** Monte un composant avec tous les fournisseurs nécessaires. */
export function rendre(ui, { route = '/' } = {}) {
  return render(<MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>);
}
