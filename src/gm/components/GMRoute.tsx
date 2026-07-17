import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import RoleGuard from "@/components/RoleGuard";

/**
 * Gate for all /gm/* routes (the General Manager interface).
 *
 * - Must be signed in (ProtectedRoute wraps this upstream).
 * - For now, access = superadmin OR team_admin. A dedicated `gm_user` team role
 *   is a later migration; access assignment is intentionally deferred.
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
  return <RoleGuard allow={["superadmin", "team_admin"]}>{children}</RoleGuard>;
}
