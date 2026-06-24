import { Link, useLocation } from "react-router-dom";

interface PlayerPageTabsProps {
  /** Player UUID from the URL. */
  playerId: string;
  /** "player" for hitter pages, "pitcher" for pitcher pages — used to build the route. */
  kind: "player" | "pitcher";
}

/**
 * Horizontal subtab strip used on both the player Overview (Profile) and
 * Season Stats pages. Active tab is highlighted; inactive is a clickable
 * link to the sibling route.
 *
 * Future tabs (GM, Player Development, etc.) get added here.
 */
export default function PlayerPageTabs({ playerId, kind }: PlayerPageTabsProps) {
  const location = useLocation();
  const base = `/dashboard/${kind}/${playerId}`;
  const isStats = location.pathname.endsWith("/stats");

  const tabs = [
    { label: "Overview", to: base, active: !isStats },
    { label: "Season Stats", to: `${base}/stats`, active: isStats },
  ];

  return (
    <div className="border-b border-[#1f2d52]">
      <nav className="flex gap-1">
        {tabs.map((tab) => (
          <Link
            key={tab.label}
            to={tab.to}
            // Preserve location.state (returnTo, etc.) so the Overview's Back
            // button still knows where the user came from after switching tabs.
            // Without this, a coach who lands on Overview from Player Dashboard,
            // tabs over to Stats, then tabs back, would have Back send them
            // to Stats instead of Player Dashboard.
            state={location.state}
            replace
            className={`relative cursor-pointer px-4 py-2.5 font-[Oswald] text-sm font-bold uppercase tracking-wider transition-colors duration-150 ${
              tab.active
                ? "text-[#D4AF37]"
                : "text-white/60 hover:text-white"
            }`}
          >
            {tab.label}
            {tab.active && (
              <span className="absolute inset-x-0 bottom-[-1px] h-[2px] bg-[#D4AF37]" />
            )}
          </Link>
        ))}
      </nav>
    </div>
  );
}
