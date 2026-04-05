import { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
  Diamond,
} from "lucide-react";
import { useState, useEffect } from "react";

const navItems = [
  { label: "Overview", href: "/dashboard", icon: BarChart3 },
  { label: "Transfer Portal", href: "/dashboard/portal", icon: Users },
  { label: "Team Builder", href: "/dashboard/team-builder", icon: Hammer },
  { label: "Player Dashboard", href: "/dashboard/returning", icon: Activity },
  { label: "Compare", href: "/dashboard/compare", icon: GitCompare },
  { label: "Admin", href: "/dashboard/admin", icon: ShieldCheck },
  { label: "Settings", href: "/dashboard/settings", icon: Settings },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { user, signOut, roles } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col transition-transform lg:static lg:translate-x-0",
          "bg-[#070e1f] text-[#c8cdd5] border-r border-[#1a2744]",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Brand — RSTR IQ logo */}
        <div className="flex items-center justify-center px-5 pt-4 pb-2">
          <img src="/rstr-iq-logo.png" alt="RSTR IQ" className="h-[60px] w-auto" />
        </div>

        <div className="mx-4 border-t border-[#1a2744]" />

        {/* Nav */}
        <nav className="flex-1 space-y-0.5 px-3 py-3">
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#5a6478]">Main</div>
          {navItems.slice(0, 5).map((item) => {
            const isActive = location.pathname === item.href;
            return (
              <Link
                key={item.href}
                to={item.href}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-all",
                  isActive
                    ? "bg-[#D4AF37]/15 text-[#D4AF37]"
                    : "text-[#8892a4] hover:bg-[#131f36] hover:text-[#c8cdd5]"
                )}
              >
                <item.icon className={cn("h-4 w-4", isActive && "text-[#D4AF37]")} />
                {item.label}
              </Link>
            );
          })}

          <div className="px-3 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#5a6478]">System</div>
          {navItems.slice(5).map((item) => {
            const isActive = location.pathname === item.href;
            return (
              <Link
                key={item.href}
                to={item.href}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-all",
                  isActive
                    ? "bg-[#D4AF37]/15 text-[#D4AF37]"
                    : "text-[#8892a4] hover:bg-[#131f36] hover:text-[#c8cdd5]"
                )}
              >
                <item.icon className={cn("h-4 w-4", isActive && "text-[#D4AF37]")} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* User */}
        <div className="mx-4 border-t border-[#1a2744]" />
        <div className="p-4 space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#D4AF37]/15 text-[11px] font-bold text-[#D4AF37]">
              {(user?.email || "?")[0].toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium truncate text-[#8892a4]">{user?.email}</div>
              {roles.length > 0 && (
                <div className="flex gap-1 mt-0.5">
                  {roles.map((r) => (
                    <span key={r} className="text-[10px] font-medium text-[#D4AF37] capitalize">{r}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-[#5a6478] hover:text-[#c8cdd5] hover:bg-[#131f36] text-xs h-8" onClick={handleSignOut}>
            <LogOut className="h-3.5 w-3.5" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center gap-3 border-b border-border/60 px-4 py-2.5 lg:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden h-8 w-8" onClick={() => setSidebarOpen(true)}>
            <Menu className="h-4 w-4" />
          </Button>
          <h1 className="text-sm font-semibold text-muted-foreground">
            {navItems.find((i) => i.href === location.pathname)?.label ?? "Dashboard"}
          </h1>
        </header>

        <main className="flex-1 overflow-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
