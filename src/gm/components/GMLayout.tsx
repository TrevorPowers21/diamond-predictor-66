import { Link, useLocation, Outlet } from "react-router-dom";
import TeamSwitcher from "@/components/TeamSwitcher";
import { GOLD, NAVY_BG, NAVY_CARD, NAVY_BORDER } from "@/gm/lib/theme";

// GM-interface tabs. Money / Notes / Eligibility are scaffolded placeholders
// until their phases land; Roster (index) is the two-way-synced team view.
const TABS = [
  { label: "Roster", path: "/gm", exact: true },
  { label: "Money", path: "/gm/money" },
  { label: "Notes", path: "/gm/notes" },
  { label: "Eligibility", path: "/gm/eligibility" },
] as const;

export default function GMLayout() {
  const location = useLocation();

  return (
    <div className="min-h-screen text-white" style={{ backgroundColor: NAVY_BG }}>
      {/* Header */}
      <div style={{ background: "linear-gradient(180deg, #0a1428 0%, #040810 100%)" }}>
        <div className="mx-auto max-w-7xl px-6 pt-6 pb-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.3em]" style={{ color: GOLD }}>
                RSTR IQ · Front Office
              </div>
              <h1
                className="mt-1 text-4xl font-bold leading-none tracking-tight"
                style={{ color: "#FFFFFF", fontFamily: "'Oswald', sans-serif" }}
              >
                GM Interface
              </h1>
            </div>
            <TeamSwitcher />
          </div>

          {/* View toggle: Player Evaluation ⇄ GM Interface */}
          <div
            className="mt-4 inline-flex overflow-hidden rounded-full border text-[11px] font-bold uppercase tracking-[0.15em]"
            style={{ borderColor: NAVY_BORDER, backgroundColor: NAVY_CARD }}
          >
            <Link
              to="/dashboard"
              className="px-4 py-1.5 text-white/45 transition-colors hover:text-white/80"
              style={{ fontFamily: "'Oswald', sans-serif" }}
            >
              Player Evaluation
            </Link>
            <span
              className="px-4 py-1.5"
              style={{ backgroundColor: GOLD, color: "#0a0f1e", fontFamily: "'Oswald', sans-serif" }}
            >
              GM Interface
            </span>
          </div>
        </div>

        {/* Tab bar */}
        <div className="border-b" style={{ borderColor: NAVY_BORDER }}>
          <div className="mx-auto max-w-7xl px-6">
            <nav className="flex gap-0">
              {TABS.map((tab) => {
                const isActive = tab.exact
                  ? location.pathname === tab.path
                  : location.pathname.startsWith(tab.path);
                return (
                  <Link
                    key={tab.path}
                    to={tab.path}
                    className="relative cursor-pointer px-5 py-3 text-[11px] font-bold uppercase tracking-[0.2em] transition-colors duration-150 hover:text-[#E8C24E]"
                    style={{ color: isActive ? GOLD : "rgba(255,255,255,0.45)", fontFamily: "'Oswald', sans-serif" }}
                  >
                    {tab.label}
                    {isActive && (
                      <span className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ backgroundColor: GOLD }} />
                    )}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      </div>

      {/* Page content */}
      <div className="mx-auto max-w-7xl px-6 py-6">
        <Outlet />
      </div>
    </div>
  );
}
