import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

/**
 * Player Evaluation ⇄ Front Office switch. Lives in the top bar, in line with
 * the "Viewing as" team switcher, on BOTH areas. Segmented control: both options
 * show, the current area is highlighted gold, the other is a clickable link.
 * Only users with Front Office access see it (superadmin / team_admin for now;
 * a dedicated gm_user role is a later migration).
 */
export default function AreaToggle({ current }: { current: "eval" | "gm" }) {
  const { isSuperadmin, userTeamRole } = useAuth();
  const hasFrontOfficeAccess = isSuperadmin || userTeamRole === "team_admin";
  if (!hasFrontOfficeAccess) return null;

  const items = [
    { key: "eval" as const, label: "Player Evaluation", href: "/dashboard" },
    { key: "gm" as const, label: "Front Office", href: "/gm" },
  ];

  return (
    <div className="inline-flex h-8 items-center rounded-md border border-border/60 bg-muted/30 p-0.5 text-[11px] font-semibold">
      {items.map((it) => {
        const active = it.key === current;
        return (
          <Link
            key={it.key}
            to={it.href}
            className={cn(
              "rounded px-3 py-1 transition-colors duration-150 cursor-pointer whitespace-nowrap",
              active ? "bg-[#D4AF37] text-[#0a0f1e]" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {it.label}
          </Link>
        );
      })}
    </div>
  );
}
