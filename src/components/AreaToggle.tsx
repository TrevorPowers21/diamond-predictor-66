import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

/**
 * Top-level area tabs — Player Evaluation / Front Office (more to come). Rendered
 * far-left in the top bar (where the page title used to sit). Styled like a tab
 * bar: the current area is gold with a gold underline; the others are clickable
 * links. Designed to grow — add entries to `items`.
 *
 * Only users with Front Office access see the tabs: superadmin, or ANY member of a customer team.
 * ⚠ This MUST stay in agreement with GMRoute's `allow` list — if the tab shows but the route guard
 * disagrees, clicking it bounces the user back to /dashboard.
 */
export function useHasFrontOfficeAccess() {
  const { isSuperadmin, userTeamRole } = useAuth();
  return isSuperadmin || !!userTeamRole;
}

export default function AreaToggle({ current }: { current: "eval" | "gm" }) {
  const hasAccess = useHasFrontOfficeAccess();
  if (!hasAccess) return null;

  const items = [
    { key: "eval" as const, label: "Player Evaluation", href: "/dashboard" },
    { key: "gm" as const, label: "Front Office", href: "/gm" },
  ];

  return (
    // self-stretch + -my-2.5 cancel the header's vertical padding so the gold
    // underline sits flush on the header's bottom border, like a real tab bar.
    <nav className="flex self-stretch -my-2.5">
      {items.map((it) => {
        const active = it.key === current;
        return (
          <Link
            key={it.key}
            to={it.href}
            className={cn(
              "relative flex items-center px-3 text-[13px] font-semibold transition-colors duration-150 cursor-pointer whitespace-nowrap",
              active ? "text-[#D4AF37]" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {it.label}
            {active && <span className="absolute inset-x-0 bottom-0 h-[2px] bg-[#D4AF37]" />}
          </Link>
        );
      })}
    </nav>
  );
}
