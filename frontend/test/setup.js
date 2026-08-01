// Environnement des tests de rendu — harmonisé avec Factur'Peyi (01/08/2026),
// adapté à l'architecture EduKaraib (rôles multiples, Sentry, visio Jitsi).
//
// Objectif : monter chaque page comme le ferait un navigateur, SANS réseau ni
// identifiants. Tout ce qui sort de l'application est remplacé par un double.
// Ce qui reste testé, c'est le cas le plus dur pour une page : aucune donnée.

import { vi, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => cleanup());

// ── Firestore ──────────────────────────────────────────────────────────────
// Chaque lecture renvoie une collection vide : c'est le scénario qui révèle les
// accès non protégés (`docs[0].data().x` sur une liste vide, etc.).
const snapshotVide = { docs: [], size: 0, empty: true, forEach: () => {} };
const docVide = { exists: () => false, data: () => undefined, id: 'test' };

vi.mock('firebase/firestore', () => ({
  initializeFirestore: vi.fn(() => ({})),
  getFirestore: vi.fn(() => ({})),
  persistentLocalCache: vi.fn(() => ({})),
  persistentMultipleTabManager: vi.fn(() => ({})),
  memoryLocalCache: vi.fn(() => ({})),
  collection: vi.fn(() => ({})),
  collectionGroup: vi.fn(() => ({})),
  doc: vi.fn(() => ({})),
  getDocs: vi.fn(async () => snapshotVide),
  getDoc: vi.fn(async () => docVide),
  addDoc: vi.fn(async () => ({ id: 'nouveau' })),
  setDoc: vi.fn(async () => {}),
  updateDoc: vi.fn(async () => {}),
  deleteDoc: vi.fn(async () => {}),
  onSnapshot: vi.fn(() => () => {}),
  query: vi.fn(() => ({})),
  where: vi.fn(() => ({})),
  orderBy: vi.fn(() => ({})),
  limit: vi.fn(() => ({})),
  startAfter: vi.fn(() => ({})),
  writeBatch: vi.fn(() => ({
    set: vi.fn(), update: vi.fn(), delete: vi.fn(), commit: vi.fn(async () => {}),
  })),
  runTransaction: vi.fn(async () => {}),
  serverTimestamp: vi.fn(() => new Date()),
  increment: vi.fn((n) => n),
  arrayUnion: vi.fn((...v) => v),
  arrayRemove: vi.fn((...v) => v),
  deleteField: vi.fn(() => undefined),
  Timestamp: {
    now: () => ({ toDate: () => new Date(), seconds: 0 }),
    fromDate: (d) => ({ toDate: () => d, seconds: 0 }),
  },
}));

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({ currentUser: null })),
  onAuthStateChanged: vi.fn(() => () => {}),
  setPersistence: vi.fn(async () => {}),
  browserLocalPersistence: {},
  signOut: vi.fn(async () => {}),
  signInWithEmailAndPassword: vi.fn(async () => ({})),
  createUserWithEmailAndPassword: vi.fn(async () => ({})),
  sendPasswordResetEmail: vi.fn(async () => {}),
  confirmPasswordReset: vi.fn(async () => {}),
  verifyPasswordResetCode: vi.fn(async () => 'test@exemple.fr'),
  applyActionCode: vi.fn(async () => {}),
  updateProfile: vi.fn(async () => {}),
  updatePassword: vi.fn(async () => {}),
  deleteUser: vi.fn(async () => {}),
  reauthenticateWithCredential: vi.fn(async () => ({})),
  reauthenticateWithPopup: vi.fn(async () => ({})),
  signInWithPopup: vi.fn(async () => ({})),
  EmailAuthProvider: { credential: vi.fn() },
  GoogleAuthProvider: class {
    setCustomParameters() {}
    addScope() {}
  },
}));

vi.mock('firebase/storage', () => ({
  getStorage: vi.fn(() => ({})),
  ref: vi.fn(() => ({})),
  uploadBytes: vi.fn(async () => ({})),
  uploadBytesResumable: vi.fn(() => ({
    on: vi.fn(), then: vi.fn(), snapshot: { ref: {} },
  })),
  getDownloadURL: vi.fn(async () => 'https://exemple.test/photo.png'),
  deleteObject: vi.fn(async () => {}),
}));

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({})),
  getApps: vi.fn(() => []),
  getApp: vi.fn(() => ({})),
}));

// Le module firebase local exporte des instances déjà initialisées : on les
// remplace pour éviter toute connexion réseau au chargement d'une page.
vi.mock('../lib/firebase', () => ({
  db: {},
  auth: { currentUser: { uid: 'u1', email: 'test@exemple.fr', getIdToken: async () => 'jeton' } },
  storage: {},
  default: {},
}));

// ── Sentry ─────────────────────────────────────────────────────────────────
// Spécifique EduKaraib : Factur'Peyi n'a pas encore Sentry. Sans ce double, les
// pages instrumentées tenteraient d'envoyer des événements pendant les tests.
vi.mock('@sentry/react', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  withScope: vi.fn((fn) => fn({ setExtras: vi.fn(), setTag: vi.fn() })),
  browserTracingIntegration: vi.fn(() => ({})),
  replayIntegration: vi.fn(() => ({})),
  ErrorBoundary: ({ children }) => children,
}));

// ── Réseau ─────────────────────────────────────────────────────────────────
global.fetch = vi.fn(async () => ({
  ok: true,
  status: 200,
  json: async () => ({}),
  text: async () => '',
  arrayBuffer: async () => new ArrayBuffer(0),
}));

// ── API navigateur absentes de jsdom ───────────────────────────────────────
global.URL.createObjectURL = vi.fn(() => 'blob:test');
global.URL.revokeObjectURL = vi.fn();
window.scrollTo = vi.fn();
window.matchMedia = window.matchMedia || ((q) => ({
  matches: false, media: q, onchange: null,
  addListener: () => {}, removeListener: () => {},
  addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
}));
global.IntersectionObserver = class {
  observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
};
global.ResizeObserver = class {
  observe() {} unobserve() {} disconnect() {}
};
// Jitsi (visio) injecte un script externe et lit `window.JitsiMeetExternalAPI`.
window.JitsiMeetExternalAPI = class {
  addEventListener() {} removeEventListener() {} dispose() {} executeCommand() {}
};
