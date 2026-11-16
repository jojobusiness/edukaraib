import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { auth, db } from '../lib/firebase';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { fuseauProbable, fuseauNavigateur, fuseauValide } from '../../api/_fuseaux.mjs';
import { marquerVenue } from '../lib/derniereVenue';
import { onAuthStateChanged, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { toast } from 'sonner';
import { codeARattacher, noterCodeRattache } from '../lib/bacCampaign';

const AuthCtx = createContext({ user: null, authReady: false });

function completerFuseau(u) {
  if (!u?.uid) return;
  const cle = `edk_fuseau_${u.uid}`;
  try { if (sessionStorage.getItem(cle)) return; sessionStorage.setItem(cle, '1'); } catch { /* navigation privée */ }
  const ref = doc(db, 'users', u.uid);
  getDoc(ref).then((snap) => {
    const d = snap.exists() ? snap.data() : null;
    if (!d || fuseauValide(d.timezone)) return null;
    const tz = fuseauProbable({ navigateur: fuseauNavigateur(), pays: d.pays_inscription });
    return tz ? updateDoc(ref, { timezone: tz }) : null;
  }).catch(() => {});
}

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
        // Trace de passage, au plus une par jour : sans elle, on ne sait pas
        // distinguer « il a vu l'écran et n'a rien fait » de « il n'est jamais
        // revenu ». Volontairement non attendue et silencieuse : une statistique
        // ne doit jamais retarder ni bloquer une connexion.
        marquerVenue(u, (uid) => updateDoc(doc(db, 'users', uid), { lastSeenAt: serverTimestamp() }));
        // Fuseau du compte (16/11/2026) : rempli à la connexion s'il manque.
        // Une fois par session, silencieux : ne bloque jamais une connexion.
        completerFuseau(u);
        // Déjà inscrit et arrivé par le lien d'un partenaire : le code suit le compte,
        // même s'il paie plus tard sur un autre navigateur (TikTok puis Safari).
        const code = codeARattacher(u?.uid);
        if (code) {
          updateDoc(doc(db, 'users', u.uid), { code_campagne: code })
            .then(() => noterCodeRattache(u.uid, code))
            .catch(() => {});
        }
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