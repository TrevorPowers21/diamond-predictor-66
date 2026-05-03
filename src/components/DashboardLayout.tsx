import { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import TeamSwitcher from "@/components/TeamSwitcher";
import {
  Activity,
  BarChart3,
  Users,
  GitCompare,
  Settings,
  LogOut,
  Menu,
  Hammer,
  ShieldCheck,
  ChevronRight,
  Star,
  Building2,
  UserCog,
} from "lucide-react";
import { useState, useEffect } from "react";

const navItems = [
  { label: "Overview", href: "/dashboard", icon: BarChart3, description: "Top 10 leaderboard" },
  { label: "Transfer Portal", href: "/dashboard/portal", icon: Users, description: "Simulate transfers" },
  { label: "Team Builder", href: "/dashboard/team-builder", icon: Hammer, description: "Build your roster" },
  { label: "Player Dashboard", href: "/dashboard/returning", icon: Activity, description: "All player stats" },
  { label: "High Follow", href: "/dashboard/high-follow", icon: Star, description: "Your watchlist" },
  { label: "Compare", href: "/dashboard/compare", icon: GitCompare, description: "Side-by-side analysis" },
];

type SystemItem = {
  label: string;
  href: string;
  icon: typeof Settings;
  requires?: "superadmin" | "team_admin";
};

const systemItems: SystemItem[] = [
  { label: "Admin", href: "/dashboard/admin", icon: ShieldCheck },
  { label: "Customer Teams", href: "/dashboard/admin/teams", icon: Building2, requires: "superadmin" },
  { label: "Team Members", href: "/dashboard/admin/users", icon: UserCog, requires: "team_admin" },
  { label: "Settings", href: "/dashboard/settings", icon: Settings },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { user, signOut, roles, isSuperadmin, userTeamRole } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const visibleSystemItems = systemItems.filter((item) => {
    if (!item.requires) return true;
    if (item.requires === "superadmin") return isSuperadmin;
    if (item.requires === "team_admin") return isSuperadmin || userTeamRole === "team_admin";
    return false;
  });

  useEffect(() => {
    setSidebarOpen(false);
    if (typeof document !== "undefined") {
      document.body.style.pointerEvents = "auto";
    }
  }, [location.pathname]);

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  return (
    <div className="flex h-screen bg-background">
      {/* Mobile overlay */}
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

        {/* Main Nav */}
        <nav className="flex-1 px-3 py-3 space-y-1">
          <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#4a5568]">Navigation</div>
          {navItems.map((item) => {
            const isActive = location.pathname === item.href;
            return (
              <Link
                key={item.href}
                to={item.href}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  "group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all duration-150 cursor-pointer",
                  isActive
                    ? "bg-[#D4AF37]/12 text-[#D4AF37] shadow-[inset_2px_0_0_#D4AF37]"
                    : "text-[#8892a4] hover:bg-[#111c33] hover:text-[#d0d5dd]"
                )}
              >
                <item.icon className={cn("h-4 w-4 shrink-0", isActive ? "text-[#D4AF37]" : "text-[#5a6478] group-hover:text-[#8892a4]")} />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium leading-tight">{item.label}</div>
                  {isActive && (
                    <div className="text-[10px] text-[#D4AF37]/60 mt-0.5 leading-tight">{item.description}</div>
                  )}
                </div>
                {isActive && <ChevronRight className="h-3 w-3 text-[#D4AF37]/40 shrink-0" />}
              </Link>
            );
          })}

          <div className="px-3 pt-4 pb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#4a5568]">System</div>
          {visibleSystemItems.map((item) => {
            const isActive = location.pathname === item.href;
            return (
              <Link
                key={item.href}
                to={item.href}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-150 cursor-pointer",
                  isActive
                    ? "bg-[#D4AF37]/12 text-[#D4AF37]"
                    : "text-[#5a6478] hover:bg-[#111c33] hover:text-[#8892a4]"
                )}
              >
                <item.icon className={cn("h-4 w-4", isActive && "text-[#D4AF37]")} />
                {item.label}
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
          <h1 className="text-sm font-semibold text-muted-foreground">
            {[...navItems, ...systemItems].find((i) => i.href === location.pathname)?.label ?? "Dashboard"}
          </h1>
          <div className="ml-auto">
            <TeamSwitcher />
          </div>
        </header>

        <main className="flex-1 overflow-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
