import { useEffect, useState } from "react";
import { auth, db } from "../lib/firebase";
import { doc, getDoc, collection, query, where, getDocs, limit } from "firebase/firestore";

/**
 * Lit le rôle de l'utilisateur connecté depuis Firestore.
 * - d'abord /users/{uid}
 * - sinon fallback sur where("uid","==",uid)
 */
export function useUserRole() {
  const [role, setRole] = useState(null);     // "student" | "teacher" | "parent" | null
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const run = async () => {
      const user = auth.currentUser;
      if (!user) { setRole(null); setLoading(false); return; }

      let resultRole = null;

      // 1) users/{uid}
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (snap.exists()) resultRole = snap.data()?.role || null;
      } catch {}

      // 2) where uid == <uid>
      if (!resultRole) {
        try {
          const q = query(collection(db, "users"), where("uid", "==", user.uid), limit(1));
          const s = await getDocs(q);
          if (!s.empty) resultRole = s.docs[0].data()?.role || null;
        } catch {}
      }

      setRole(resultRole);
      setLoading(false);
    };
    run();
  }, []);

  return { role, loading };
}