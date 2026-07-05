import { useState, useEffect } from "react";
import { useLocation, useNavigate, Outlet } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import TeamSwitcher from "@/components/TeamSwitcher";
import AreaToggle from "@/components/AreaToggle";
import { LogOut, Menu } from "lucide-react";

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

        {/* The GM area is one page — the area toggle lives in the top bar. */}
        <nav className="flex-1 px-3 py-3 space-y-1" />

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
          <h1 className="text-sm font-semibold text-muted-foreground">Roster</h1>
          <div className="ml-auto flex items-center gap-3">
            <AreaToggle current="gm" />
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
