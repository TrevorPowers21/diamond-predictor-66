import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { PlayerAuthProvider } from "@/hooks/usePlayerAuth";
import ProtectedPlayerRoute from "@/components/ProtectedPlayerRoute";
import Login from "@/pages/Login";
import SetPassword from "@/pages/SetPassword";
import PlanSelect from "@/pages/PlanSelect";
import CheckoutComplete from "@/pages/CheckoutComplete";

// Lazy: Checkout loads the full Stripe.js SDK at module scope. Statically
// importing it pulled that SDK (and its js.stripe.com/m.stripe.com/
// r.stripe.com network calls) into every route, including Login and
// SetPassword, which never touch Stripe.
const Checkout = lazy(() => import("@/pages/Checkout"));

export default function App() {
  return (
    <PlayerAuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<Login />} />
          <Route path="/set-password" element={<SetPassword />} />
          <Route
            path="/plans"
            element={
              <ProtectedPlayerRoute>
                <PlanSelect />
              </ProtectedPlayerRoute>
            }
          />
          <Route
            path="/checkout"
            element={
              <ProtectedPlayerRoute>
                <Suspense fallback={null}>
                  <Checkout />
                </Suspense>
              </ProtectedPlayerRoute>
            }
          />
          <Route
            path="/checkout/complete"
            element={
              <ProtectedPlayerRoute>
                <CheckoutComplete />
              </ProtectedPlayerRoute>
            }
          />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </PlayerAuthProvider>
  );
}
