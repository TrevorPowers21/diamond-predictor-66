import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import RoleGuard from "@/components/RoleGuard";

/**
 * Gate for all /gm/* routes (the General Manager interface).
 *
 * - Must be signed in (ProtectedRoute wraps this upstream).
 * - Access = superadmin OR ANY member of a customer team (team_admin or general_user).
 *   Widened 2026-09-02 (Trevor): general_user needs Front Office too, for now.
 *
 *   This matches what the DATABASE already allowed — all 18 gm_* tables scope by
 *   `is_team_member(customer_team_id)`, not `is_team_admin_of`. The UI was the only thing
 *   restricting it, so this removes a gate that existed in two places and nowhere else.
 * - noindex so the area never lands in search engines.
 */
export default function GMRoute({ children }: { children: React.ReactNode }) {
  const { loading } = useAuth();

  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  if (loading) return null;
  return <RoleGuard allow={["superadmin", "team_admin", "general_user"]}>{children}</RoleGuard>;
}
