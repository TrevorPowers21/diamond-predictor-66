import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import NotFound from "@/pages/NotFound";
import { isSavantAllowed } from "@/savant/lib/allowlist";

/**
 * Gate for all /savant/* routes.
 *
 * - Must be signed in
 * - Email must be on the Savant allowlist
 * - Otherwise: render NotFound (we do not reveal that Savant exists)
 * - Always sets noindex so leaked URLs cannot end up in search engines
 */
export default function SavantRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

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
  if (!user || !isSavantAllowed(user.email)) return <NotFound />;
  return <>{children}</>;
}
