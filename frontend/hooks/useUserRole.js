import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../lib/firebase";
import { doc, getDoc } from "firebase/firestore";

/**
 * Lit le rôle de l'utilisateur connecté depuis Firestore.
 * ✅ Utilise onAuthStateChanged pour ne pas rater la restauration de session
 *    (évite le null prématuré au refresh qui redirectait vers /login à tort)
 */
export function useUserRole() {
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setRole(null);
        setLoading(false);
        return;
      }
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        setRole(snap.exists() ? (snap.data()?.role || null) : null);
      } catch {
        setRole(null);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, []);

  return { role, loading };
}