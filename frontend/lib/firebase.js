import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  setPersistence,
  browserLocalPersistence
} from 'firebase/auth';
import {
  initializeFirestore
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyDoPTDEtgcROB-PkLehddqr3Lpy_nM5P4A",
  authDomain: "edukaraib.firebaseapp.com",
  projectId: "edukaraib",
  // ✅ Le bucket correct est <project-id>.appspot.com
  storageBucket: "edukaraib.firebasestorage.app",
  messagingSenderId: "827164038836",
  appId: "1:827164038836:web:8f0ce9776e18d1b03da9e1",
};

// Initialise Firebase
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// ✅ Firestore avec détection automatique du long-polling
export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true, // bascule auto si websocket échoue
  useFetchStreams: false                   // évite bugs Chrome/Edge
});

// ✅ Auth avec persistance locale pour éviter les déconnexions au refresh
export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(() => {});

// ✅ Storage inchangé
export const storage = getStorage(app);

export default app;