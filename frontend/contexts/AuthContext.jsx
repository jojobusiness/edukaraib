import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { auth } from '../lib/firebase';
import { onAuthStateChanged, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { toast } from 'sonner';

const AuthCtx = createContext({ user: null, authReady: false });

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const prevUserRef = useRef(undefined);

  useEffect(() => {
    // Force token refresh when tab regains focus (évite les 401 silencieux)
    const handleFocus = () => {
      if (auth.currentUser) auth.currentUser.getIdToken(true).catch(() => {});
    };
    window.addEventListener('focus', handleFocus);

    setPersistence(auth, browserLocalPersistence).finally(() => {
      const unsub = onAuthStateChanged(auth, (u) => {
        // Si l'utilisateur était connecté et devient null → session expirée
        if (!u && prevUserRef.current) {
          toast.info('Session expirée. Reconnecte-toi pour continuer.', { duration: 8000 });
        }
        prevUserRef.current = u;
        setUser(u);
        setAuthReady(true);
      });
      return () => unsub();
    });

    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  return (
    <AuthCtx.Provider value={{ user, authReady }}>
      {children}
    </AuthCtx.Provider>
  );
}
export const useAuth = () => useContext(AuthCtx);