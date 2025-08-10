import { Navigate } from "react-router-dom";
import { useUserRole } from "../hooks/useUserRole";

export default function RequireRole({ roles, children }) {
  const { role, loading } = useUserRole();
  if (loading) return null;
  if (!role) return <Navigate to="/login" replace />;
  if (!roles.includes(role)) {
    // Option : rediriger vers un dashboard par rôle
    return <Navigate to={`/${role}`} replace />;
  }
  return children;
}