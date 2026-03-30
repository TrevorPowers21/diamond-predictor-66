import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Activity } from "lucide-react";

const Index = () => {
  const { session, loading } = useAuth();
  
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Activity className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  
  return session ? <Navigate to="/dashboard" replace /> : <Navigate to="/auth" replace />;
};

export default Index;
