import { Navigate } from "react-router-dom";
import { useUserRole } from "../hooks/useUserRole";

// ✅ Routes corrigées — les anciennes /${role} aboutissaient sur des 404
const ROLE_HOME = {
  student:    "/dashboard-eleve",
  parent:     "/parent/dashboard",
  teacher:    "/prof/dashboard",
  admin:      "/admin/dashboard",
  influencer: "/influencer/dashboard",
};

export default function RequireRole({ roles, children }) {
  const { role, loading } = useUserRole();

  if (loading) return null;
  if (!role) return <Navigate to="/login" replace />;
  if (!roles.includes(role)) {
    const fallback = ROLE_HOME[role] || "/smart-dashboard";
    return <Navigate to={fallback} replace />;
  }
  return children;
}
