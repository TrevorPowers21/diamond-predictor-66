import { Navigate } from "react-router-dom";
import { Activity } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

type AllowedRole = "superadmin" | "team_admin";

interface RoleGuardProps {
  allow: AllowedRole[];
  redirectTo?: string;
  children: React.ReactNode;
}

export default function RoleGuard({ allow, redirectTo = "/dashboard", children }: RoleGuardProps) {
  const { isSuperadmin, userTeamRole, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Activity className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Superadmins are implicitly allowed for any role check below.
  const allowed =
    isSuperadmin ||
    (allow.includes("team_admin") && userTeamRole === "team_admin");

  if (!allowed) return <Navigate to={redirectTo} replace />;
  return <>{children}</>;
}
