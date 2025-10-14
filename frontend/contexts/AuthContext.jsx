import { createContext, useContext, useEffect, useState } from 'react';
import { auth } from '../lib/firebase';
import { onAuthStateChanged, setPersistence, browserLocalPersistence } from 'firebase/auth';

const AuthCtx = createContext({ user: null, authReady: false });

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    // ✅ Persistance locale pour ne pas être déconnecté au refresh
    setPersistence(auth, browserLocalPersistence).finally(() => {
      const unsub = onAuthStateChanged(auth, (u) => {
        setUser(u);
        setAuthReady(true);
      });
      return () => unsub();
    });
  }, []);

  return (
    <AuthCtx.Provider value={{ user, authReady }}>
      {children}
    </AuthCtx.Provider>
  );
}
export const useAuth = () => useContext(AuthCtx);