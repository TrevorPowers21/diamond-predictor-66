import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { lazy, Suspense } from "react";
import Index from "./pages/Index";

// Savant — internal-only, gated, lazy-loaded so RSTR IQ users never download it.
// Do not link to /savant/* from any RSTR IQ nav.
const SavantRoute = lazy(() => import("@/savant/components/SavantRoute"));
const SavantLayout = lazy(() => import("@/savant/components/SavantLayout"));
const SavantHome = lazy(() => import("@/savant/pages/SavantHome"));
const SavantLeaderboards = lazy(() => import("@/savant/pages/LeaderboardsPage"));
const SavantConferenceStats = lazy(() => import("@/savant/pages/ConferenceStatsPage"));
const SavantTeamsList = lazy(() => import("@/savant/pages/TeamsListPage"));
const SavantTeamProfile = lazy(() => import("@/savant/pages/TeamProfilePage"));
const SavantHitterPage = lazy(() => import("@/savant/pages/HitterPage"));
const SavantPitcherPage = lazy(() => import("@/savant/pages/PitcherPage"));
import TransferPortal from "./pages/TransferPortal";
import ReturningPlayers from "./pages/ReturningPlayers";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import ProtectedRoute from "@/components/ProtectedRoute";
import NotFound from "./pages/NotFound";
import DevWeights from "./pages/DevWeights";
import PlayerComparison from "./pages/PlayerComparison";
import PlayerProfile from "./pages/PlayerProfile";
import PitcherProfile from "./pages/PitcherProfile";
import Teams from "./pages/Teams";
import TeamBuilder from "./pages/TeamBuilder";
import AdminDashboard from "./pages/AdminDashboard";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/dashboard/portal" element={<ProtectedRoute><TransferPortal /></ProtectedRoute>} />
            <Route path="/dashboard/returning" element={<ProtectedRoute><ReturningPlayers /></ProtectedRoute>} />
            <Route path="/dashboard/dev-weights" element={<ProtectedRoute><DevWeights /></ProtectedRoute>} />
            {/* NIL Valuations route intentionally disabled for now; keep page for rework later. */}
            {/* <Route path="/dashboard/nil" element={<ProtectedRoute><NilValuations /></ProtectedRoute>} /> */}
            <Route path="/dashboard/compare" element={<ProtectedRoute><PlayerComparison /></ProtectedRoute>} />
            <Route path="/dashboard/teams" element={<ProtectedRoute><Teams /></ProtectedRoute>} />
            <Route path="/dashboard/player/:id" element={<ProtectedRoute><PlayerProfile /></ProtectedRoute>} />
            <Route path="/dashboard/pitcher/:id" element={<ProtectedRoute><PitcherProfile /></ProtectedRoute>} />
            <Route path="/dashboard/team-builder" element={<ProtectedRoute><TeamBuilder /></ProtectedRoute>} />
            <Route path="/dashboard/admin" element={<ProtectedRoute><AdminDashboard /></ProtectedRoute>} />
            <Route path="/dashboard/*" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            {/* Savant — internal only. Gated by SavantRoute (auth + email allowlist). */}
            <Route
              path="/savant"
              element={
                <ProtectedRoute>
                  <Suspense fallback={null}>
                    <SavantRoute><SavantLayout /></SavantRoute>
                  </Suspense>
                </ProtectedRoute>
              }
            >
              <Route index element={<Suspense fallback={null}><SavantHome /></Suspense>} />
              <Route path="leaderboards" element={<Suspense fallback={null}><SavantLeaderboards /></Suspense>} />
              <Route path="conferences" element={<Suspense fallback={null}><SavantConferenceStats /></Suspense>} />
              <Route path="teams" element={<Suspense fallback={null}><SavantTeamsList /></Suspense>} />
              <Route path="team/:id" element={<Suspense fallback={null}><SavantTeamProfile /></Suspense>} />
              <Route path="hitter/:id" element={<Suspense fallback={null}><SavantHitterPage /></Suspense>} />
              <Route path="pitcher/:id" element={<Suspense fallback={null}><SavantPitcherPage /></Suspense>} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
