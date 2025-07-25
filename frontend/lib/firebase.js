import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDoPTDEtgcROB-PkLehddqr3Lpy_nM5P4A",
  authDomain: "edukaraib.firebaseapp.com",
  projectId: "edukaraib",
  storageBucket: "edukaraib.firebasestorage.app",
  messagingSenderId: "827164038836",
  appId: "1:827164038836:web:8f0ce9776e18d1b03da9e1",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);