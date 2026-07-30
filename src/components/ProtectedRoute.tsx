import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Activity } from "lucide-react";

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading, devBypassed, isRecoveringPassword } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Activity className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // While recovering, force the user back to /auth to set a new password.
  if (isRecoveringPassword) return <Navigate to="/auth" replace />;

  // Not logged in → send to /auth but REMEMBER where they were headed, so a
  // shared deep link (e.g. /m/recruiting) lands them back there after login
  // instead of the dashboard.
  if (!session && !devBypassed) {
    const dest = location.pathname + location.search;
    return <Navigate to={`/auth?redirect=${encodeURIComponent(dest)}`} replace />;
  }

  return <>{children}</>;
}
