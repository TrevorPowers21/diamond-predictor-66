import { useState, useEffect } from "react";
import { useLocation, useNavigate, Outlet, Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import TeamSwitcher from "@/components/TeamSwitcher";
import AreaToggle from "@/components/AreaToggle";
import { LogOut, Menu, LayoutDashboard, Users, BarChart3, ClipboardList, FlaskConical, Target, ChevronRight } from "lucide-react";

const NAV = [
  { label: "Dashboard", href: "/gm", icon: LayoutDashboard, description: "Front office overview" },
  { label: "Roster Management", href: "/gm/roster", icon: Users, description: "Budget, builds & departures" },
  { label: "Target Board", href: "/gm/targets", icon: Target, description: "Watchlist, offers & add to roster" },
  { label: "The Situation Room", href: "/gm/scenarios", icon: FlaskConical, description: "What-if & build compare" },
  { label: "Program Analytics", href: "/gm/analytics", icon: BarChart3, description: "Pay per position & per win" },
  { label: "Recruiting Board", href: "/gm/recruiting", icon: ClipboardList, description: "Future classes & commits" },
];

/**
 * Front Office (GM) shell — same chrome as the Player Evaluation dashboard. The
 * sidebar's only nav is the Player Evaluation ⇄ Front Office toggle (the GM area
 * is one Team-Builder-style roster page). Budget-allotment settings will be a
 * header button; player profiles are click-throughs.
 */
export default function GMLayout() {
  const { user, signOut, roles } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    setSidebarOpen(false);
    if (typeof document !== "undefined") document.body.style.pointerEvents = "auto";
  }, [location.pathname]);

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  return (
    <div className="flex h-screen bg-background">
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col transition-transform duration-200 lg:static lg:translate-x-0",
          "bg-[#070e1f] text-[#c8cdd5]",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Brand */}
        <div className="flex items-center justify-center px-5 pt-5 pb-3">
          <img src="/rstr-iq-logo.png" alt="RSTR IQ" className="h-[60px] w-auto" />
        </div>
        <div className="mx-5 border-t border-[#1a2744]/60" />

        {/* Nav */}
        <nav className="flex-1 px-3 py-3 space-y-1">
          <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#4a5568]">Navigation</div>
          {NAV.map((item) => {
            const isActive = item.href === "/gm" ? location.pathname === "/gm" : location.pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                to={item.href}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  "group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all duration-150 cursor-pointer",
                  isActive
                    ? "bg-[#D4AF37]/12 text-[#D4AF37] shadow-[inset_2px_0_0_#D4AF37]"
                    : "text-[#8892a4] hover:bg-[#111c33] hover:text-[#d0d5dd]",
                )}
              >
                <item.icon className={cn("h-4 w-4 shrink-0", isActive ? "text-[#D4AF37]" : "text-[#5a6478] group-hover:text-[#8892a4]")} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium leading-tight">{item.label}</div>
                  {isActive && <div className="mt-0.5 text-[10px] leading-tight text-[#D4AF37]/60">{item.description}</div>}
                </div>
                {isActive && <ChevronRight className="h-3 w-3 shrink-0 text-[#D4AF37]/40" />}
              </Link>
            );
          })}
        </nav>

        {/* User */}
        <div className="mx-5 border-t border-[#1a2744]/60" />
        <div className="p-4">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#D4AF37]/20 to-[#D4AF37]/5 text-[12px] font-bold text-[#D4AF37] ring-1 ring-[#D4AF37]/20">
              {(user?.email || "?")[0].toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium truncate text-[#8892a4]">{user?.email}</div>
              {roles.length > 0 && (
                <div className="flex gap-1.5 mt-0.5">
                  {roles.map((r) => (
                    <span key={r} className="text-[9px] font-semibold uppercase tracking-wider text-[#D4AF37]/70 bg-[#D4AF37]/8 px-1.5 py-0.5 rounded">{r}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-[#4a5568] hover:text-[#c8cdd5] hover:bg-[#111c33] text-xs h-8 rounded-lg transition-colors duration-150"
            onClick={handleSignOut}
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center gap-3 border-b border-border/60 px-4 py-2.5 lg:px-6 bg-background/80 backdrop-blur-sm">
          <Button variant="ghost" size="icon" className="lg:hidden h-8 w-8" onClick={() => setSidebarOpen(true)}>
            <Menu className="h-4 w-4" />
          </Button>
          <AreaToggle current="gm" />
          <div className="ml-auto">
            <TeamSwitcher />
          </div>
        </header>

        <main className="flex-1 overflow-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
