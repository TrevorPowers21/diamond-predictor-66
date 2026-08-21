import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { usePlayerAuth } from "@/hooks/usePlayerAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Activity, Dumbbell, Salad, Watch, MessageCircle, CalendarClock, Ruler } from "lucide-react";
import PlayerHome from "@/pages/PlayerHome";
import StaffContact from "@/components/StaffContact";

type EntitlementStatus = "inactive" | "pending" | "active" | "past_due" | "canceled";
type Plan = "six_month" | "twelve_month";

const shippingSchema = z.object({
  name: z.string().min(1, "Required"),
  line1: z.string().min(1, "Required"),
  line2: z.string().optional(),
  city: z.string().min(1, "Required"),
  state: z.string().min(1, "Required"),
  postal_code: z.string().min(1, "Required"),
  country: z.string().min(1, "Required"),
});
type ShippingForm = z.infer<typeof shippingSchema>;

export default function PlanSelect() {
  const { user, signOut } = usePlayerAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<EntitlementStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [addPolarLoop, setAddPolarLoop] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ShippingForm>({ resolver: zodResolver(shippingSchema), defaultValues: { country: "US" } });

  useEffect(() => {
    if (!user) return;
    supabase
      .from("player_entitlements")
      .select("status")
      .eq("user_id", user.id)
      .eq("product", "athlete_monitoring")
      .maybeSingle()
      .then(({ data }) => {
        setStatus((data?.status as EntitlementStatus) ?? "inactive");
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

  // Active members land on the real home, not a bolt-on "you're all set"
  // card — this is the same destination they'll return to on every future
  // login, not just right after checkout.
  if (status === "active") return <PlayerHome />;

  const isPastDue = status === "past_due";

  const goToCheckout = (shippingAddress?: ShippingForm) => {
    if (!selectedPlan) return;
    navigate("/checkout", { state: { plan: selectedPlan, addPolarLoop, shippingAddress } });
  };

  const onContinue = handleSubmit(
    (values) => goToCheckout(addPolarLoop ? values : undefined),
    () => {
      // Validation only matters when the Polar Loop checkbox is checked —
      // if it's unchecked, react-hook-form still validates on submit, so
      // bypass it entirely in that case.
      if (!addPolarLoop) goToCheckout();
    },
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-2xl space-y-10 py-8">
        <div className="text-center space-y-2">
          <img src="/rstr-iq-logo.png" alt="RSTR IQ" className="logo-navy mx-auto h-8 w-auto" />
          <h1 className="text-2xl font-bold" style={{ color: "#0D1B3E" }}>
            Athlete Monitoring
          </h1>
          <p className="mx-auto max-w-lg text-sm text-muted-foreground">
            {isPastDue
              ? "Your last payment didn't go through. Choose a membership below to keep access."
              : "Year-round strength & conditioning, throwing programs, nutrition, and recovery — built from real assessment data and reviewed by your coach every week."}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Feature
            icon={<Ruler className="h-5 w-5" />}
            title="Real assessment data"
            description="DARI motion screening, pitching biomechanics, ground force plates, conditioning testing, and TrackMan — not guesswork."
          />
          <Feature
            icon={<Dumbbell className="h-5 w-5" />}
            title="Built from your results"
            description="Strength & conditioning and throwing programs periodized to your own numbers, not a generic template."
          />
          <Feature
            icon={<Salad className="h-5 w-5" />}
            title="Nutrition, dialed in"
            description="Individualized fueling targets and a full nutrition audit at onboarding."
          />
          <Feature
            icon={<Watch className="h-5 w-5" />}
            title="Wearable-informed"
            description="Recovery and HRV data from Polar, Whoop, Garmin, or Oura feeds directly into your program."
          />
          <Feature
            icon={<CalendarClock className="h-5 w-5" />}
            title="Weekly program reviews"
            description="Your coach reviews training, recovery, and nutrition data every week and adjusts your program."
          />
          <Feature
            icon={<MessageCircle className="h-5 w-5" />}
            title="Direct coach access"
            description="Message your coach directly between sessions, plus scheduled coaching calls — no chatbot, no queue."
          />
        </div>

        <div>
          <div className="grid gap-6 sm:grid-cols-2">
            <PlanCard
              title="Year Round"
              price="$250/mo"
              description="4 two-hour assessments across the year — quarterly checkpoints on your progress."
              selected={selectedPlan === "twelve_month"}
              onSelect={() => setSelectedPlan("twelve_month")}
            />
            <PlanCard
              title="6 Month"
              price="$300/mo"
              description="An initial assessment plus one retest — a focused window to build and measure change."
              selected={selectedPlan === "six_month"}
              onSelect={() => setSelectedPlan("six_month")}
            />
          </div>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Billed monthly, no auto-renewal — your membership ends on its own at the end of the term. Hybrid or
            fully remote. Athletes must be 14+; parents enroll athletes under 18.
          </p>
        </div>

        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base">Add a Polar Loop</CardTitle>
            <CardDescription>
              Recommended, not required — $200 + $8 shipping, added to your first charge. 24/7 heart rate and HRV
              tracking with up to 8 days of battery, so it's actually worn consistently rather than charged and
              forgotten. Already wearing a Whoop, Garmin, or Oura? Keep using it — your coach works with whatever
              you've got.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3">
              <Checkbox
                id="polar-loop"
                checked={addPolarLoop}
                onCheckedChange={(checked) => setAddPolarLoop(checked === true)}
                className="mt-1"
              />
              <Label htmlFor="polar-loop" className="cursor-pointer">
                Add a Polar Loop to my first charge (a card processing fee is itemized separately)
              </Label>
            </div>

            {addPolarLoop && (
              <div className="space-y-4 border-t pt-4">
                <p className="text-sm text-muted-foreground">Shipping address</p>
                <div className="space-y-2">
                  <Label htmlFor="name">Full name</Label>
                  <Input id="name" autoComplete="name" {...register("name")} />
                  {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="line1">Address</Label>
                  <Input id="line1" autoComplete="address-line1" {...register("line1")} />
                  {errors.line1 && <p className="text-sm text-destructive">{errors.line1.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="line2">Apt / suite (optional)</Label>
                  <Input id="line2" autoComplete="address-line2" {...register("line2")} />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="city">City</Label>
                    <Input id="city" autoComplete="address-level2" {...register("city")} />
                    {errors.city && <p className="text-sm text-destructive">{errors.city.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="state">State</Label>
                    <Input id="state" autoComplete="address-level1" {...register("state")} />
                    {errors.state && <p className="text-sm text-destructive">{errors.state.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="postal_code">ZIP</Label>
                    <Input id="postal_code" autoComplete="postal-code" {...register("postal_code")} />
                    {errors.postal_code && <p className="text-sm text-destructive">{errors.postal_code.message}</p>}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Button className="w-full cursor-pointer" disabled={!selectedPlan} onClick={onContinue}>
          Continue to checkout
        </Button>

        <Card className="border-border/50">
          <CardContent className="flex items-center justify-between pt-6">
            <div>
              <p className="text-sm font-medium">Questions before you sign up?</p>
              <p className="text-sm text-muted-foreground">
                Reach out directly — after you sign up, you'll hear from us within 1 business day.
              </p>
            </div>
            <StaffContact name="Will Barker" email="will.barker@rstriq.com" />
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          <button onClick={() => signOut()} className="underline cursor-pointer">
            Sign out
          </button>
        </p>
      </div>
    </div>
  );
}

function Feature({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex gap-3 rounded-lg border border-border/50 p-4">
      <div className="mt-0.5 shrink-0" style={{ color: "#D4AF37" }}>
        {icon}
      </div>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function PlanCard({
  title,
  price,
  description,
  selected,
  onSelect,
}: {
  title: string;
  price: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Card
      className={cn("cursor-pointer border-border/50 transition-colors", selected && "border-primary")}
      onClick={onSelect}
    >
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>{title}</span>
          <span style={{ color: "#D4AF37" }}>{price}</span>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardFooter>
        <div
          className={cn(
            "w-full rounded-md border py-2 text-center text-sm",
            selected ? "border-primary bg-primary/10 text-primary" : "border-input text-muted-foreground",
          )}
        >
          {selected ? "Selected" : "Select"}
        </div>
      </CardFooter>
    </Card>
  );
}
