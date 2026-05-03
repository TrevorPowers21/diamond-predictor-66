import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Activity } from "lucide-react";

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading, devBypassed, isRecoveringPassword } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Activity className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // While recovering, force the user back to /auth to set a new password.
  if (isRecoveringPassword) return <Navigate to="/auth" replace />;

  if (!session && !devBypassed) return <Navigate to="/auth" replace />;

  return <>{children}</>;
}
