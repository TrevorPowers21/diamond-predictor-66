import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider, Outlet, useLocation } from "react-router-dom";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { AuthProvider } from "@/hooks/useAuth";
import { Suspense, useEffect, useRef } from "react";
import { lazyWithReload } from "@/lib/lazyWithReload";
import { capturePageView, capturePageLeave } from "@/lib/posthog";
import Index from "./pages/Index";


// GM (front office) — gated + lazy-loaded so Player Evaluation users never
// download it. Do not link to /gm/* from Player Evaluation nav except the toggle.
const GMRoute = lazyWithReload(() => import("@/gm/components/GMRoute"));
const GMLayout = lazyWithReload(() => import("@/gm/components/GMLayout"));
const GMRoster = lazyWithReload(() => import("@/gm/pages/GMRoster"));
const GMHome = lazyWithReload(() => import("@/gm/pages/GMHome"));
const GMAnalytics = lazyWithReload(() => import("@/gm/pages/GMAnalytics"));
const GMRecruits = lazyWithReload(() => import("@/gm/pages/GMRecruits"));
const GMScenarios = lazyWithReload(() => import("@/gm/pages/GMScenarios"));
const GMTargets = lazyWithReload(() => import("@/gm/pages/GMTargets"));
const GMAllocations = lazyWithReload(() => import("@/gm/pages/GMAllocations"));
const GMContracts = lazyWithReload(() => import("@/gm/pages/GMContracts"));
const GMSettings = lazyWithReload(() => import("@/gm/pages/GMSettings"));
const PlayerHub = lazyWithReload(() => import("@/pages/PlayerHub"));
import TransferPortal from "./pages/TransferPortal";
import ReturningPlayers from "./pages/ReturningPlayers";
import WarRoom from "./pages/WarRoom";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import ProtectedRoute from "@/components/ProtectedRoute";
import NotFound from "./pages/NotFound";
import DevWeights from "./pages/DevWeights";
import PlayerComparison from "./pages/PlayerComparison";
import DashboardLayout from "@/components/DashboardLayout";
import PlayerProfile from "./pages/PlayerProfile";
import PitcherProfile from "./pages/PitcherProfile";
import PlayerStatsPage from "./pages/PlayerStatsPage";
import PitcherStatsPage from "./pages/PitcherStatsPage";
import TeamBuilder from "./pages/TeamBuilder";
import AdminDashboard from "./pages/AdminDashboard";
import AdminTeams from "./pages/admin/AdminTeams";
import AdminUsers from "./pages/admin/AdminUsers";
import RoleGuard from "@/components/RoleGuard";
import HighFollowList from "./pages/HighFollowList";
import Targets from "./pages/Targets";
import Settings from "./pages/Settings";
const MobileRecruiting = lazyWithReload(() => import("./pages/mobile/MobileRecruiting"));

const queryClient = new QueryClient();

// Fires $pageleave → $pageview on every React Router navigation.
// Required for SPAs: PostHog's auto capture only fires on browser load/unload,
// not on client-side route changes. prevPath ref gives accurate time-on-page.
function PostHogPageView() {
  const location = useLocation();
  const prevPath = useRef<string | null>(null);

  // Fire pageleave on tab close / visibility change so session duration is accurate
  useEffect(() => {
    const handleLeave = () => {
      if (prevPath.current) capturePageLeave(prevPath.current);
    };
    window.addEventListener("beforeunload", handleLeave);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") handleLeave();
    });
    return () => window.removeEventListener("beforeunload", handleLeave);
  }, []);

  // Fire pageleave for previous route, then pageview for new route
  useEffect(() => {
    if (prevPath.current !== null) {
      capturePageLeave(prevPath.current);
    }
    capturePageView(location.pathname);
    prevPath.current = location.pathname;
  }, [location.pathname]);

  return null;
}

// Root layout wraps all routes so PostHogPageView has access to useLocation.
function RootLayout() {
  return (
    <>
      <PostHogPageView />
      <Outlet />
    </>
  );
}

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: "/", element: <Index /> },
      { path: "/auth", element: <Auth /> },
      { path: "/dashboard", element: <ProtectedRoute><Dashboard /></ProtectedRoute> },
      { path: "/dashboard/portal", element: <ProtectedRoute><TransferPortal /></ProtectedRoute> },
      { path: "/dashboard/returning", element: <ProtectedRoute><ReturningPlayers /></ProtectedRoute> },
      { path: "/dashboard/war-room", element: <ProtectedRoute><WarRoom /></ProtectedRoute> },
      { path: "/dashboard/dev-weights", element: <ProtectedRoute><DevWeights /></ProtectedRoute> },
      // { path: "/dashboard/nil", element: <ProtectedRoute><NilValuations /></ProtectedRoute> },
      { path: "/dashboard/compare", element: <ProtectedRoute><PlayerComparison /></ProtectedRoute> },
      { path: "/player/:playerId", element: <ProtectedRoute><DashboardLayout><Suspense fallback={null}><PlayerHub /></Suspense></DashboardLayout></ProtectedRoute> },
      { path: "/dashboard/player/:id", element: <ProtectedRoute><PlayerProfile /></ProtectedRoute> },
      { path: "/dashboard/player/:id/stats", element: <ProtectedRoute><PlayerStatsPage /></ProtectedRoute> },
      { path: "/dashboard/pitcher/:id", element: <ProtectedRoute><PitcherProfile /></ProtectedRoute> },
      { path: "/dashboard/pitcher/:id/stats", element: <ProtectedRoute><PitcherStatsPage /></ProtectedRoute> },
      { path: "/dashboard/team-builder", element: <ProtectedRoute><TeamBuilder /></ProtectedRoute> },
      { path: "/dashboard/targets", element: <ProtectedRoute><Targets /></ProtectedRoute> },
      // Mobile recruiting board — phone-first coach tool (freshman/JUCO recruits + dated timeline notes)
      { path: "/m/recruiting", element: <ProtectedRoute><Suspense fallback={null}><MobileRecruiting /></Suspense></ProtectedRoute> },
      // Legacy /dashboard/high-follow URL still works — renders the standalone page so bookmarks don't break.
      { path: "/dashboard/high-follow", element: <ProtectedRoute><HighFollowList /></ProtectedRoute> },
      { path: "/dashboard/admin", element: <ProtectedRoute><AdminDashboard /></ProtectedRoute> },
      { path: "/dashboard/settings", element: <ProtectedRoute><Settings /></ProtectedRoute> },
      {
        path: "/dashboard/admin/teams",
        element: (
          <ProtectedRoute>
            <RoleGuard allow={["superadmin"]}><AdminTeams /></RoleGuard>
          </ProtectedRoute>
        ),
      },
      {
        path: "/dashboard/admin/users",
        element: (
          <ProtectedRoute>
            <RoleGuard allow={["superadmin", "team_admin"]}><AdminUsers /></RoleGuard>
          </ProtectedRoute>
        ),
      },
      { path: "/dashboard/*", element: <ProtectedRoute><Dashboard /></ProtectedRoute> },
      // GM (front office) — gated by GMRoute (auth + superadmin/team_admin).
      {
        path: "/gm",
        element: (
          <ProtectedRoute>
            <Suspense fallback={null}>
              <GMRoute><GMLayout /></GMRoute>
            </Suspense>
          </ProtectedRoute>
        ),
        children: [
          { index: true, element: <Suspense fallback={null}><GMHome /></Suspense> },
          { path: "roster", element: <Suspense fallback={null}><GMRoster /></Suspense> },
          { path: "scenarios", element: <Suspense fallback={null}><GMScenarios /></Suspense> },
          { path: "targets", element: <Suspense fallback={null}><GMTargets /></Suspense> },
          { path: "allocations", element: <Suspense fallback={null}><GMAllocations /></Suspense> },
          { path: "contracts", element: <Suspense fallback={null}><GMContracts /></Suspense> },
          { path: "player/:playerId", element: <Suspense fallback={null}><PlayerHub /></Suspense> },
          { path: "analytics", element: <Suspense fallback={null}><GMAnalytics /></Suspense> },
          { path: "recruiting", element: <Suspense fallback={null}><GMRecruits /></Suspense> },
          { path: "settings", element: <Suspense fallback={null}><GMSettings /></Suspense> },
        ],
      },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <SpeedInsights />
        <RouterProvider router={router} />
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
