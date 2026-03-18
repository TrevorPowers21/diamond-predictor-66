import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, TrendingUp } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const fmt = (v: number | null | undefined, digits = 3) => (v == null ? "—" : Number(v).toFixed(digits));
const fmtWhole = (v: number | null | undefined) => (v == null ? "—" : Math.round(v).toString());

const nilFormat = (v: number | null | undefined) => {
  if (v == null) return "—";
  return `$${Math.round(v).toLocaleString()}`;
};

function MetricCard({ title, value, subtitle }: { title: string; value: string; subtitle?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold tracking-tight">{value}</div>
        {subtitle ? <p className="text-xs text-muted-foreground mt-1">{subtitle}</p> : null}
      </CardContent>
    </Card>
  );
}

export default function PitcherProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: player, isLoading } = useQuery({
    queryKey: ["pitcher-profile-player", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("players")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: seasonStats = [] } = useQuery({
    queryKey: ["pitcher-profile-season-stats", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("season_stats")
        .select("*")
        .eq("player_id", id!)
        .order("season", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: predictions = [] } = useQuery({
    queryKey: ["pitcher-profile-predictions", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_predictions")
        .select("*")
        .eq("player_id", id!)
        .eq("status", "active");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: nilValuation } = useQuery({
    queryKey: ["pitcher-profile-nil", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nil_valuations")
        .select("*")
        .eq("player_id", id!)
        .order("season", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const latestStats = useMemo(() => seasonStats[0] || null, [seasonStats]);
  const activePrediction = useMemo(() => predictions[0] || null, [predictions]);
  const fullName = `${player?.first_name || ""} ${player?.last_name || ""}`.trim() || "Pitcher";

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="p-6 text-muted-foreground">Loading pitcher profile…</div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" className="gap-2" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <Badge variant="secondary" className="font-medium">Pitcher Profile</Badge>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-2xl md:text-3xl">{fullName}</CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-2">
              <span>{player?.team || "—"}</span>
              <span>•</span>
              <span>{player?.conference || "—"}</span>
              <span>•</span>
              <span>{player?.position || "P"}</span>
              <span>•</span>
              <span>{player?.handedness || "—"}</span>
            </CardDescription>
          </CardHeader>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <MetricCard title="Market Value" value={nilFormat(nilValuation?.projected_value ?? null)} />
          <MetricCard title="pWAR" value="—" subtitle="Pitching WAR model pending" />
          <MetricCard
            title="Internal Pitching Rating"
            value={activePrediction?.power_rating_plus != null ? fmtWhole(activePrediction.power_rating_plus) : "—"}
            subtitle="Template value for pitcher-specific model"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-base">Pitcher Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between"><span className="text-muted-foreground">Class</span><span>{player?.class_year || "—"}</span></div>
              <div className="flex items-center justify-between"><span className="text-muted-foreground">Throws</span><span>{player?.throws_hand || player?.handedness || "—"}</span></div>
              <div className="flex items-center justify-between"><span className="text-muted-foreground">Bats</span><span>{player?.bats_hand || "—"}</span></div>
              <div className="flex items-center justify-between"><span className="text-muted-foreground">Height</span><span>{player?.height_inches ? `${player.height_inches}"` : "—"}</span></div>
              <div className="flex items-center justify-between"><span className="text-muted-foreground">Weight</span><span>{player?.weight ? `${player.weight} lbs` : "—"}</span></div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">2025 Pitching Stats</CardTitle>
              <CardDescription>Template matches hitter profile structure; pitcher-specific calculations come next.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                <div className="rounded border p-2"><div className="text-muted-foreground text-xs">Season</div><div className="font-semibold">{latestStats?.season ?? "—"}</div></div>
                <div className="rounded border p-2"><div className="text-muted-foreground text-xs">IP</div><div className="font-semibold">{fmt(latestStats?.innings_pitched ?? null, 1)}</div></div>
                <div className="rounded border p-2"><div className="text-muted-foreground text-xs">ERA</div><div className="font-semibold">{fmt(latestStats?.era ?? null, 2)}</div></div>
                <div className="rounded border p-2"><div className="text-muted-foreground text-xs">WHIP</div><div className="font-semibold">{fmt(latestStats?.whip ?? null, 2)}</div></div>
                <div className="rounded border p-2"><div className="text-muted-foreground text-xs">K</div><div className="font-semibold">{fmtWhole(latestStats?.pitch_strikeouts ?? null)}</div></div>
                <div className="rounded border p-2"><div className="text-muted-foreground text-xs">BB</div><div className="font-semibold">{fmtWhole(latestStats?.pitch_walks ?? null)}</div></div>
                <div className="rounded border p-2"><div className="text-muted-foreground text-xs">W-L</div><div className="font-semibold">{latestStats ? `${fmtWhole(latestStats.wins)}-${fmtWhole(latestStats.losses)}` : "—"}</div></div>
                <div className="rounded border p-2"><div className="text-muted-foreground text-xs">SV</div><div className="font-semibold">{fmtWhole(latestStats?.saves ?? null)}</div></div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4" />Projected Outcomes</CardTitle>
            <CardDescription>
              Independent pitcher projection template. We will add pitcher equations and weighted outputs next.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
              <div className="rounded border p-2"><div className="text-muted-foreground text-xs">pERA</div><div className="font-semibold">—</div></div>
              <div className="rounded border p-2"><div className="text-muted-foreground text-xs">pWHIP</div><div className="font-semibold">—</div></div>
              <div className="rounded border p-2"><div className="text-muted-foreground text-xs">pK/9</div><div className="font-semibold">—</div></div>
              <div className="rounded border p-2"><div className="text-muted-foreground text-xs">pBB/9</div><div className="font-semibold">—</div></div>
              <div className="rounded border p-2"><div className="text-muted-foreground text-xs">pWAR</div><div className="font-semibold">—</div></div>
            </div>
            <Separator />
            <p className="text-xs text-muted-foreground">
              This page is intentionally separate from hitter profile logic so pitcher-specific adjustments can be implemented safely.
            </p>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

