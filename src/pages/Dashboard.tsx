import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Users, Activity, DollarSign, TrendingUp, BarChart3, ArrowRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell } from "recharts";
import { cn } from "@/lib/utils";

export default function Dashboard() {
  const { devBypassed, disableDevBypass } = useAuth();
  const serviceKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  const { data: stats } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const [transferRes, returnerRes, nilRes, conferenceRes] = await Promise.all([
        supabase.from("player_predictions").select("id, p_ops, p_wrc_plus, players!inner(first_name, last_name)", { count: "exact" }).eq("model_type", "transfer").eq("variant", "regular"),
        supabase.from("player_predictions").select("id, p_ops, p_wrc_plus, players!inner(first_name, last_name)", { count: "exact" }).eq("model_type", "returner").eq("variant", "regular"),
        supabase.from("nil_valuations").select("id, estimated_value", { count: "exact" }),
        supabase.from("power_ratings").select("id", { count: "exact" }).eq("season", 2025),
      ]);

      const transferPlayers = transferRes.data || [];
      const returnerPlayers = returnerRes.data || [];
      const nilData = nilRes.data || [];

      const avgTransferOps = transferPlayers.length
        ? transferPlayers.reduce((s, p) => s + (p.p_ops ?? 0), 0) / transferPlayers.length
        : 0;
      const avgReturnerWrc = returnerPlayers.length
        ? returnerPlayers.reduce((s, p) => s + (p.p_wrc_plus ?? 0), 0) / returnerPlayers.length
        : 0;
      const totalNilValue = nilData.reduce((s, n) => s + (n.estimated_value ?? 0), 0);

      // Top 5 transfer by pOPS
      const topTransfer = [...transferPlayers]
        .sort((a, b) => (b.p_ops ?? 0) - (a.p_ops ?? 0))
        .slice(0, 5)
        .map((p: any) => ({
          name: `${p.players.first_name[0]}. ${p.players.last_name}`,
          value: p.p_ops ?? 0,
        }));

      // Top 5 returner by wRC+
      const topReturner = [...returnerPlayers]
        .filter((p) => p.p_wrc_plus != null)
        .sort((a, b) => (b.p_wrc_plus ?? 0) - (a.p_wrc_plus ?? 0))
        .slice(0, 5)
        .map((p: any) => ({
          name: `${p.players.first_name[0]}. ${p.players.last_name}`,
          value: p.p_wrc_plus ?? 0,
        }));

      return {
        transferCount: transferRes.count ?? 0,
        returnerCount: returnerRes.count ?? 0,
        nilCount: nilRes.count ?? 0,
        conferenceCount: conferenceRes.count ?? 0,
        avgTransferOps,
        avgReturnerWrc,
        totalNilValue,
        topTransfer,
        topReturner,
      };
    },
  });

  const cards = [
    { label: "Portal Players", value: stats?.transferCount ?? "—", sub: `Avg pOPS: ${stats ? stats.avgTransferOps.toFixed(3) : "—"}`, icon: Users, color: "text-primary", href: "/dashboard/portal" },
    { label: "Returning Players", value: stats?.returnerCount ?? "—", sub: `Avg wRC+: ${stats ? stats.avgReturnerWrc.toFixed(0) : "—"}`, icon: Activity, color: "text-accent", href: "/dashboard/returning" },
    { label: "NIL Valuations", value: stats?.nilCount ?? "—", sub: stats ? `$${(stats.totalNilValue / 1000).toFixed(0)}k total` : "—", icon: DollarSign, color: "text-[hsl(var(--success))]", href: "/dashboard/nil" },
    { label: "Conferences Tracked", value: stats?.conferenceCount ?? "—", sub: "2025 season", icon: BarChart3, color: "text-[hsl(var(--warning))]", href: "/dashboard/sync" },
  ];

  const chartConfig = {
    value: { label: "Score", color: "hsl(var(--primary))" },
  };

  return (
    <DashboardLayout>
      {devBypassed && !serviceKey && (
        <div className="bg-yellow-100 border border-yellow-300 text-yellow-800 p-3 rounded mb-4 space-y-2">
          <p>Warning: Dev bypass active but no service role key provided. Data may be empty.</p>
          <button
            className="text-sm text-blue-600 underline"
            onClick={() => {
              disableDevBypass();
              window.location.href = '/auth';
            }}
          >
            Return to login
          </button>
        </div>
      )}
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-muted-foreground">Your college baseball analytics at a glance.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((s) => (
            <Link key={s.label} to={s.href} className="group">
              <Card className="transition-colors group-hover:border-primary/40">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">{s.label}</CardTitle>
                  <s.icon className={cn("h-4 w-4", s.color)} />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{s.value}</div>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    {s.sub}
                    <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        {/* Charts row */}
        <div className="grid gap-4 lg:grid-cols-2">
          {stats?.topTransfer && stats.topTransfer.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top Transfer Portal (pOPS)</CardTitle>
                <CardDescription>Highest projected OPS for portal entrants</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={chartConfig} className="h-[200px]">
                  <BarChart data={stats.topTransfer} layout="vertical" margin={{ left: 80, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" domain={[0, "auto"]} tickFormatter={(v) => v.toFixed(3)} />
                    <YAxis type="category" dataKey="name" width={75} tick={{ fontSize: 12 }} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                      {stats.topTransfer.map((_, i) => (
                        <Cell key={i} fill={i === 0 ? "hsl(var(--accent))" : "hsl(var(--primary))"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          )}

          {stats?.topReturner && stats.topReturner.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top Returning Players (wRC+)</CardTitle>
                <CardDescription>Highest projected wRC+ for returning roster</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={chartConfig} className="h-[200px]">
                  <BarChart data={stats.topReturner} layout="vertical" margin={{ left: 80, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" domain={[0, "auto"]} />
                    <YAxis type="category" dataKey="name" width={75} tick={{ fontSize: 12 }} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                      {stats.topReturner.map((_, i) => (
                        <Cell key={i} fill={i === 0 ? "hsl(var(--accent))" : "hsl(var(--primary))"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
