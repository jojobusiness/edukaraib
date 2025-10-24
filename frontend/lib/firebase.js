import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
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

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// 🔒 Garantit la persistance locale de la session (évite le kick vers /login au refresh)
setPersistence(auth, browserLocalPersistence).catch(() => {});

export default app;