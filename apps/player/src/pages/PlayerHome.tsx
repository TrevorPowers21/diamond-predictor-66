import { useEffect, useState } from "react";
import { usePlayerAuth } from "@/hooks/usePlayerAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import StaffContact from "@/components/StaffContact";
import { Activity, MessageCircle, Salad, Watch, CalendarClock, ClipboardCheck } from "lucide-react";

interface EntitlementRow {
  plan: "six_month" | "twelve_month" | null;
  current_period_end: string | null;
  cancel_at: string | null;
}

const PLAN_LABEL: Record<string, string> = {
  six_month: "6 Month",
  twelve_month: "Year Round",
};

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

// Shown whenever a member's entitlement is active — right after checkout,
// and on every subsequent login. Previously there was no real destination
// for an active member (just a bare "you're all set" card with no
// navigation), which is what made the app feel like it dead-ended.
export default function PlayerHome() {
  const { user, signOut } = usePlayerAuth();
  const [firstName, setFirstName] = useState<string | null>(null);
  const [entitlement, setEntitlement] = useState<EntitlementRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      supabase.from("player_accounts").select("first_name").eq("user_id", user.id).maybeSingle(),
      supabase
        .from("player_entitlements")
        .select("plan, current_period_end, cancel_at")
        .eq("user_id", user.id)
        .eq("product", "athlete_monitoring")
        .maybeSingle(),
    ]).then(([accountRes, entitlementRes]) => {
      setFirstName(accountRes.data?.first_name ?? null);
      setEntitlement(entitlementRes.data ?? null);
      setLoading(false);
    });
  }, [user]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Activity className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const planLabel = entitlement?.plan ? PLAN_LABEL[entitlement.plan] : "Membership";
  const renewDate = formatDate(entitlement?.current_period_end ?? null);
  const endDate = formatDate(entitlement?.cancel_at ?? null);

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b border-border/50 px-6 py-4">
        <img src="/rstr-iq-logo.png" alt="RSTR IQ" className="logo-navy h-7 w-auto" />
        <button onClick={() => signOut()} className="text-sm text-muted-foreground underline cursor-pointer">
          Sign out
        </button>
      </header>

      <div className="mx-auto max-w-3xl space-y-8 p-6 py-10">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">Welcome{firstName ? `, ${firstName}` : ""}</p>
          <h1 className="text-2xl font-bold" style={{ color: "#0D1B3E" }}>
            {planLabel} Membership — Active
          </h1>
          {renewDate && endDate && (
            <p className="text-sm text-muted-foreground">
              Next charge {renewDate}. Runs through {endDate} — does not renew automatically.
            </p>
          )}
        </div>

        <Card className="border-border/50">
          <CardHeader>
            <CardTitle>What happens next</CardTitle>
            <CardDescription>Your program starts with your coach, not a checklist.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <NextStep
              icon={<ClipboardCheck className="h-5 w-5" style={{ color: "#D4AF37" }} />}
              title="You'll hear from us within 1 business day"
              description="We'll reach out to set up your onboarding assessment — in person or remote. Online scheduling is coming soon."
            />
            <NextStep
              icon={<Watch className="h-5 w-5" style={{ color: "#D4AF37" }} />}
              title="Connect a wearable"
              description="Polar Loop, Whoop, Garmin, or Oura — whatever you're wearing, your coach factors it into your program."
            />
            <NextStep
              icon={<MessageCircle className="h-5 w-5" style={{ color: "#D4AF37" }} />}
              title="Direct line to your coach"
              description="Questions between sessions go straight to your coach, not a queue."
            />
            <NextStep
              icon={<CalendarClock className="h-5 w-5" style={{ color: "#D4AF37" }} />}
              title="Weekly program reviews"
              description="Your training, recovery, and nutrition data get reviewed and adjusted every week."
            />
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader>
            <CardTitle>What's included</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <NextStep
              icon={<Activity className="h-5 w-5" style={{ color: "#D4AF37" }} />}
              title="Strength & conditioning"
              description="Customized S&C and throwing programs, built from your assessment results."
            />
            <NextStep
              icon={<Salad className="h-5 w-5" style={{ color: "#D4AF37" }} />}
              title="Nutrition targets"
              description="Individualized fueling targets and a nutrition audit at onboarding."
            />
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardContent className="flex items-center justify-between pt-6">
            <div>
              <p className="text-sm font-medium">Need something sooner?</p>
              <p className="text-sm text-muted-foreground">Reach out directly — don't wait on the queue.</p>
            </div>
            <StaffContact name="Will Barker" email="will.barker@rstriq.com" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function NextStep({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
