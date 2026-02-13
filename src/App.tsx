import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import Index from "./pages/Index";
import TransferPortal from "./pages/TransferPortal";
import ReturningPlayers from "./pages/ReturningPlayers";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import ProtectedRoute from "@/components/ProtectedRoute";
import NotFound from "./pages/NotFound";
import DataSync from "./pages/DataSync";
import DevWeights from "./pages/DevWeights";
import NilValuations from "./pages/NilValuations";
import PlayerComparison from "./pages/PlayerComparison";
import Teams from "./pages/Teams";

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
            <Route path="/dashboard/sync" element={<ProtectedRoute><DataSync /></ProtectedRoute>} />
            <Route path="/dashboard/portal" element={<ProtectedRoute><TransferPortal /></ProtectedRoute>} />
            <Route path="/dashboard/returning" element={<ProtectedRoute><ReturningPlayers /></ProtectedRoute>} />
            <Route path="/dashboard/dev-weights" element={<ProtectedRoute><DevWeights /></ProtectedRoute>} />
            <Route path="/dashboard/nil" element={<ProtectedRoute><NilValuations /></ProtectedRoute>} />
            <Route path="/dashboard/compare" element={<ProtectedRoute><PlayerComparison /></ProtectedRoute>} />
            <Route path="/dashboard/teams" element={<ProtectedRoute><Teams /></ProtectedRoute>} />
            <Route path="/dashboard/*" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
