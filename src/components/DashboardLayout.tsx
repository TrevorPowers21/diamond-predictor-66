import { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Activity,
  BarChart3,
  Users,
  DollarSign,
  GitCompare,
  Settings,
  LogOut,
  Menu,
  X,
  FileSpreadsheet,
  Scale,
  Building2,
  Hammer,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { useEffect } from "react";

const navItems = [
  { label: "Overview", href: "/dashboard", icon: BarChart3 },
  { label: "Player Dashboard", href: "/dashboard/returning", icon: Activity },
  { label: "Transfer Portal", href: "/dashboard/portal", icon: Users },
  { label: "NIL Valuations", href: "/dashboard/nil", icon: DollarSign },
  { label: "Compare", href: "/dashboard/compare", icon: GitCompare },
  { label: "Teams", href: "/dashboard/teams", icon: Building2 },
  { label: "Team Builder", href: "/dashboard/team-builder", icon: Hammer },
  { label: "Admin", href: "/dashboard/admin", icon: ShieldCheck },
  { label: "Data Sync", href: "/dashboard/sync", icon: FileSpreadsheet },
  { label: "Settings", href: "/dashboard/settings", icon: Settings },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { user, signOut, roles } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    setSidebarOpen(false);
    // Defensive reset: sometimes UI libraries can leave body pointer lock behind.
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
      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-card transition-transform lg:static lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center gap-2 border-b border-border px-5 py-4">
          <Activity className="h-6 w-6 text-primary" />
          <span className="text-lg font-bold tracking-tight">Diamond Analytics</span>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map((item) => {
            const isActive = location.pathname === item.href;
            return (
              <Link
                key={item.href}
                to={item.href}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border p-4">
          <div className="mb-3 text-xs text-muted-foreground truncate">{user?.email}</div>
          {roles.length > 0 && (
            <div className="mb-3 flex gap-1 flex-wrap">
              {roles.map((r) => (
                <span key={r} className="rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary capitalize">
                  {r}
                </span>
              ))}
            </div>
          )}
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-muted-foreground" onClick={handleSignOut}>
            <LogOut className="h-4 w-4" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center gap-4 border-b border-border px-4 py-3 lg:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-semibold">
            {navItems.find((i) => i.href === location.pathname)?.label ?? "Dashboard"}
          </h1>
        </header>

        <main className="flex-1 overflow-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
