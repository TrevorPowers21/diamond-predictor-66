import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

const Index = () => {
  const { session, loading } = useAuth();
  
  if (loading) return null;
  
  return session ? <Navigate to="/dashboard" replace /> : <Navigate to="/auth" replace />;
};

export default Index;
