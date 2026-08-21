import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { usePlayerAuth } from "@/hooks/usePlayerAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity } from "lucide-react";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30000;

type EntitlementStatus = "inactive" | "pending" | "active" | "past_due" | "canceled";

// The webhook is the sole source of truth for whether the payment actually
// went through — this page never trusts stripe.confirmPayment()'s
// client-side result. It subscribes to the player's own entitlement row
// (RLS still applies, so this is safe) with a short-poll fallback in case
// realtime is unavailable, and only reports success once status flips to
// 'active' in the database.
export default function CheckoutComplete() {
  const { user } = usePlayerAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<EntitlementStatus | "checking">("checking");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const fetchStatus = async () => {
      const { data } = await supabase
        .from("player_entitlements")
        .select("status")
        .eq("user_id", user.id)
        .eq("product", "athlete_monitoring")
        .maybeSingle();
      if (!cancelled && data?.status) setStatus(data.status as EntitlementStatus);
    };

    fetchStatus();

    const channel = supabase
      .channel(`player_entitlements:${user.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "player_entitlements", filter: `user_id=eq.${user.id}` },
        (payload) => {
          if (!cancelled) setStatus(payload.new.status as EntitlementStatus);
        },
      )
      .subscribe();

    const pollHandle = setInterval(fetchStatus, POLL_INTERVAL_MS);
    const timeoutHandle = setTimeout(() => clearInterval(pollHandle), POLL_TIMEOUT_MS);

    return () => {
      cancelled = true;
      clearInterval(pollHandle);
      clearTimeout(timeoutHandle);
      supabase.removeChannel(channel);
    };
  }, [user]);

  // Once the webhook confirms the membership is active, go straight to the
  // real player home rather than showing a dead-end "you're all set" card
  // with nowhere else to go — /plans renders PlayerHome for active members,
  // and it's the same destination they'll land on for every future login.
  useEffect(() => {
    if (status === "active") navigate("/plans", { replace: true });
  }, [status, navigate]);

  if (status === "past_due" || status === "inactive") {
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
