import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Activity } from "lucide-react";

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();

  // allow bypass in development or when explicitly enabled
  const bypassEnabled = import.meta.env.VITE_BYPASS_AUTH === 'true' || import.meta.env.MODE === 'development';

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Activity className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!session && !bypassEnabled) return <Navigate to="/auth" replace />;

  return <>{children}</>;
}
