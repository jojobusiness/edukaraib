import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { auth, db } from "../lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

export default function SmartDashboard() {
  const navigate = useNavigate();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      try {
        if (!user) {
          // Pas connecté → on va sur /login,
          // ta mécanique "lastRoute" fera revenir ici après connexion
          navigate("/login", { replace: true });
          return;
        }
        // Récupère le rôle
        const snap = await getDoc(doc(db, "users", user.uid));
        const role = snap.exists() ? snap.data()?.role : null;

        // Route par rôle
        if (role === "teacher") return navigate("/prof/dashboard", { replace: true });
        if (role === "parent")  return navigate("/parent/dashboard", { replace: true });
        if (role === "admin")   return navigate("/admin/dashboard", { replace: true });

        // Élève (ou fallback)
        return navigate("/dashboard-eleve", { replace: true });
      } catch {
        // Fallback si erreur Firestore
        navigate("/dashboard-eleve", { replace: true });
      }
    });
    return () => unsub();
  }, [navigate]);

  return (
    <div className="min-h-screen grid place-items-center text-gray-500">
      Redirection vers votre tableau de bord…
    </div>
  );
}