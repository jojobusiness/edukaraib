import { useEffect, useState } from "react";
import { auth, db } from "../lib/firebase";
import { doc, getDoc } from "firebase/firestore";

export function useUserRole() {
  const [role, setRole] = useState(null);     // "student" | "teacher" | "parent" | null
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const run = async () => {
      const user = auth.currentUser;
      if (!user) { setRole(null); setLoading(false); return; }
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        setRole(snap.exists() ? (snap.data().role || null) : null);
      } catch {
        setRole(null);
      } finally {
        setLoading(false);
      }
    };
    run();
  }, []);

  return { role, loading };
}
