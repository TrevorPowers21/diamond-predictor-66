import { Navigate } from "react-router-dom";
import { Activity } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

type AllowedRole = "superadmin" | "team_admin" | "general_user";

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
  // Otherwise the user's TEAM role (from user_team_access) must be in `allow`. Written generically
  // rather than special-casing team_admin, so adding a role means changing the caller, not this file.
  const allowed =
    isSuperadmin ||
    (!!userTeamRole && allow.includes(userTeamRole as AllowedRole));

  if (!allowed) return <Navigate to={redirectTo} replace />;
  return <>{children}</>;
}
