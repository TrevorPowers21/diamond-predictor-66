import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { usePlayerAuth } from "@/hooks/usePlayerAuth";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity } from "lucide-react";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30000;

type PendingStatus = "pending" | "active" | "past_due" | "canceled" | "not_found";

// This page runs with no Supabase session — the public checkout flow takes
// payment before any account exists, so there's nothing to read
// player_entitlements through RLS with. Instead it polls the public
// get-pending-purchase-status function by subscriptionId (from Checkout's
// navigate state, or the return_url query params if a 3DS redirect lost
// that state). The webhook remains the sole source of truth for whether
// payment actually went through — this page never trusts
// stripe.confirmPayment()'s client-side result.
export default function CheckoutComplete() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = usePlayerAuth();
  const state = location.state as { subscriptionId?: string; email?: string } | null;
  const params = new URLSearchParams(location.search);
  const subscriptionId = state?.subscriptionId ?? params.get("subscriptionId") ?? null;
  const email = state?.email ?? params.get("email") ?? undefined;
  const [status, setStatus] = useState<PendingStatus | "checking">("checking");

  useEffect(() => {
    if (!subscriptionId) return;
    let cancelled = false;

    const fetchStatus = async () => {
      const { data } = await supabase.functions.invoke("get-pending-purchase-status", {
        body: { subscriptionId },
      });
      if (!cancelled && data?.status) setStatus(data.status as PendingStatus);
    };

    fetchStatus();
    const pollHandle = setInterval(fetchStatus, POLL_INTERVAL_MS);
    const timeoutHandle = setTimeout(() => clearInterval(pollHandle), POLL_TIMEOUT_MS);

    return () => {
      cancelled = true;
      clearInterval(pollHandle);
      clearTimeout(timeoutHandle);
    };
  }, [subscriptionId]);

  // Once the webhook confirms the membership is active: an already-logged-in
  // member (the past-due recovery path — they have an account already) goes
  // straight to /plans, same as before this page supported anonymous
  // checkout. An anonymous purchaser has no account yet at all — they go set
  // a password, which is what actually creates one and claims this purchase.
  useEffect(() => {
    if (status !== "active" || !subscriptionId) return;
    if (user) {
      navigate("/plans", { replace: true });
    } else {
      navigate("/create-account", { replace: true, state: { subscriptionId, email } });
    }
  }, [status, subscriptionId, email, user, navigate]);

  if (!subscriptionId) {
    return (
      <StatusCard
        title="Nothing to confirm"
        description="We couldn't find a checkout in progress."
        action={
          <Button asChild className="w-full cursor-pointer">
            <Link to="/plans">Back to plans</Link>
          </Button>
        }
      />
    );
  }

  if (status === "past_due" || status === "canceled" || status === "not_found") {
    return (
      <StatusCard
        title="We couldn't confirm your payment"
        description="Your card wasn't charged successfully. You can try again from the plans page."
        action={
          <Button asChild className="w-full cursor-pointer">
            <Link to="/plans">Back to plans</Link>
          </Button>
        }
      />
    );
  }

  return (
    <StatusCard
      title="Confirming your payment"
      description="This can take a minute. If this doesn't update soon, check your email or try again."
      loading
    />
  );
}

function StatusCard({
  title,
  description,
  loading,
  action,
}: {
  title: string;
  description: string;
  loading?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-border/50">
        <CardHeader className="text-center space-y-3">
          {loading && <Activity className="mx-auto h-6 w-6 animate-spin text-primary" />}
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {action && <div className="px-6 pb-6">{action}</div>}
      </Card>
    </div>
  );
}
