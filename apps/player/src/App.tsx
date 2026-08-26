import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { PlayerAuthProvider } from "@/hooks/usePlayerAuth";
import Login from "@/pages/Login";
import SetPassword from "@/pages/SetPassword";
import PlanSelect from "@/pages/PlanSelect";
import CheckoutComplete from "@/pages/CheckoutComplete";
import CreateAccount from "@/pages/CreateAccount";

// Lazy: Checkout loads the full Stripe.js SDK at module scope. Statically
// importing it pulled that SDK (and its js.stripe.com/m.stripe.com/
// r.stripe.com network calls) into every route, including Login and
// SetPassword, which never touch Stripe.
const Checkout = lazy(() => import("@/pages/Checkout"));

// /plans, /checkout, /checkout/complete, and /create-account are all public
// — the funnel is landing -> pick a plan -> pay -> THEN create an account,
// not the other way around. PlanSelect itself renders PlayerHome instead of
// the purchase flow for anyone who's already logged in with an active
// membership, so a returning member landing here isn't shown checkout
// again. /login and /set-password stay for that return trip.
export default function App() {
  return (
    <PlayerAuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/plans" replace />} />
          <Route path="/login" element={<Login />} />
          <Route path="/set-password" element={<SetPassword />} />
          <Route path="/plans" element={<PlanSelect />} />
          <Route
            path="/checkout"
            element={
              <Suspense fallback={null}>
                <Checkout />
              </Suspense>
            }
          />
          <Route path="/checkout/complete" element={<CheckoutComplete />} />
          <Route path="/create-account" element={<CreateAccount />} />
          <Route path="*" element={<Navigate to="/plans" replace />} />
        </Routes>
      </BrowserRouter>
    </PlayerAuthProvider>
  );
}
