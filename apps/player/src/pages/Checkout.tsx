import { useEffect, useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader } from "@/components/ui/card";
import { Activity } from "lucide-react";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

type Plan = "six_month" | "twelve_month";
interface ShippingAddress {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
}
interface CheckoutState {
  plan: Plan;
  addPolarLoop?: boolean;
  shippingAddress?: ShippingAddress;
}

function CheckoutForm() {
  const stripe = useStripe();
  const elements = useElements();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);

    // redirect: 'if_required' keeps the player on this page unless their
    // bank truly requires a redirect (e.g. some 3DS flows) — in the common
    // case we go straight to /checkout/complete, which is the actual
    // source of truth (the webhook), not this client-side result.
    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}/checkout/complete` },
      redirect: "if_required",
    });

    if (confirmError) {
      setError(confirmError.message ?? "Payment could not be confirmed.");
      setSubmitting(false);
      return;
    }

    navigate("/checkout/complete");
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 px-6 pb-6">
      <PaymentElement />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full cursor-pointer" disabled={!stripe || submitting}>
        {submitting ? "Processing..." : "Confirm payment"}
      </Button>
    </form>
  );
}

export default function Checkout() {
  const location = useLocation();
  const checkoutState = location.state as CheckoutState | null;
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!checkoutState?.plan) return;
    let cancelled = false;
    supabase.functions
      .invoke("create-athlete-monitoring-intent", {
        body: {
          plan: checkoutState.plan,
          addPolarLoop: checkoutState.addPolarLoop,
          shippingAddress: checkoutState.shippingAddress,
        },
      })
      .then(({ data, error: invokeError }) => {
        if (cancelled) return;
        if (invokeError || !data?.clientSecret) {
          setError(data?.error ?? invokeError?.message ?? "Could not start checkout.");
          return;
        }
        setClientSecret(data.clientSecret);
      });
    return () => {
      cancelled = true;
    };
  }, [checkoutState]);

  const options = useMemo(() => (clientSecret ? { clientSecret } : undefined), [clientSecret]);

  // Direct navigation/refresh with no plan chosen — nothing to check out.
  if (!checkoutState?.plan) return <Navigate to="/plans" replace />;

  const planLabel = checkoutState.plan === "twelve_month" ? "Year Round" : "6 Month";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold" style={{ color: "#0D1B3E" }}>
            {planLabel}
          </h1>
          <p className="text-sm text-muted-foreground">
            {checkoutState.addPolarLoop ? "Includes a Polar Loop wearable" : "Membership checkout"}
          </p>
        </div>

        <Card className="border-border/50">
          <CardHeader />
          {error && (
            <div className="px-6 pb-6">
              <CardDescription className="text-destructive">{error}</CardDescription>
            </div>
          )}
          {!error && !clientSecret && (
            <div className="flex justify-center pb-6">
              <Activity className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}
          {!error && clientSecret && options && (
            <Elements stripe={stripePromise} options={options}>
              <CheckoutForm />
            </Elements>
          )}
        </Card>
      </div>
    </div>
  );
}
