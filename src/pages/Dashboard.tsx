import { useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell, LabelList } from "recharts";
import { useAuth } from "@/hooks/useAuth";
import { Link, useNavigate } from "react-router-dom";
import { Users, TrendingUp, Trophy, MapPin } from "lucide-react";
import {
  DEFAULT_NIL_TIER_MULTIPLIERS,
  getProgramTierMultiplierByConference,
  getPositionValueMultiplier,
} from "@/lib/nilProgramSpecific";
import { profileRouteFor, isPitcherProfile } from "@/lib/profileRoutes";

type MetricKey = "p_avg" | "p_obp" | "p_slg" | "p_ops" | "p_iso" | "p_wrc_plus" | "owar" | "nil_value";
type PoolKey = "all" | string;

type PlayerRow = {
  player_id: string;
  model_type: "returner" | "transfer" | string;
  first_name: string;
  last_name: string;
  team: string | null;
  from_team: string | null;
  conference: string | null;
  position: string | null;
  p_avg: number | null;
  p_obp: number | null;
  p_slg: number | null;
  p_ops: number | null;
  p_iso: number | null;
  p_wrc_plus: number | null;
  nil_value: number | null;
};

const METRICS: { key: MetricKey; label: string }[] = [
  { key: "p_avg", label: "pAVG" },
  { key: "p_obp", label: "pOBP" },
  { key: "p_slg", label: "pSLG" },
  { key: "p_ops", label: "pOPS" },
  { key: "p_iso", label: "pISO" },
  { key: "p_wrc_plus", label: "pWRC+" },
  { key: "owar", label: "oWAR" },
  { key: "nil_value", label: "NIL" },
];

const compactDollar = new Intl.NumberFormat("en-US", {
  notation: "compact",
  compactDisplay: "short",
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 1,
});

const formatCompactUsd = (value: number | null) =>
  value == null ? "-" : compactDollar.format(value).replace("k", "K").replace("m", "M").replace("b", "B");

const formatMetric = (metric: MetricKey, value: number | null) => {
  if (value == null) return "-";
  if (metric === "p_wrc_plus") return Math.round(value).toString();
  if (metric === "nil_value") return formatCompactUsd(value);
  if (metric === "owar") return value.toFixed(2);
  return value.toFixed(3);
};

const tickFormat = (metric: MetricKey, value: number) => {
  if (metric === "nil_value") return formatCompactUsd(value);
  if (metric === "p_wrc_plus") return Math.round(value).toString();
  if (metric === "owar") return value.toFixed(1);
  return value.toFixed(3);
};

const computeOWar = (wrcPlus: number | null | undefined): number | null => {
  if (wrcPlus == null) return null;
  const pa = 260;
  const runsPerPa = 0.13;
  const replacementRuns = (pa / 600) * 25;
  const offValue = (wrcPlus - 100) / 100;
  const raa = offValue * pa * runsPerPa;
  const rar = raa + replacementRuns;
  return rar / 10;
};


export default function Dashboard() {
  const { devBypassed, disableDevBypass } = useAuth();
  const navigate = useNavigate();
  const serviceKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  const [metric, setMetric] = useState<MetricKey>("p_avg");
  const [pool, setPool] = useState<PoolKey>("all");

  const { data: players = [], isLoading } = useQuery({
    queryKey: ["overview-top10-base"],
    queryFn: async () => {
      const [predRes, nilRes] = await Promise.all([
        supabase
          .from("player_predictions")
          .select(
            "id, player_id, model_type, variant, status, p_avg, p_obp, p_slg, p_ops, p_iso, p_wrc_plus, players!inner(first_name, last_name, team, from_team, conference, position)",
          )
          .eq("variant", "regular")
          .in("status", ["active", "departed"])
          .in("model_type", ["returner", "transfer"]),
        supabase.from("nil_valuations").select("player_id, estimated_value, season"),
      ]);

      if (predRes.error) throw predRes.error;
      if (nilRes.error) throw nilRes.error;

      const nilByPlayer = new Map<string, { season: number; value: number | null }>();
      for (const row of nilRes.data || []) {
        const existing = nilByPlayer.get(row.player_id);
        if (!existing || (row.season ?? 0) > existing.season) {
          nilByPlayer.set(row.player_id, { season: row.season ?? 0, value: row.estimated_value ?? null });
        }
      }

      const rankRow = (row: any) => {
        const coverage = [row.p_avg, row.p_obp, row.p_slg, row.p_ops, row.p_iso, row.p_wrc_plus].filter((v) => v != null).length;
        return coverage + (row.model_type === "transfer" ? 0.1 : 0);
      };

      const bestByPlayer = new Map<string, any>();
      for (const row of predRes.data || []) {
        const existing = bestByPlayer.get(row.player_id);
        if (!existing || rankRow(row) > rankRow(existing)) bestByPlayer.set(row.player_id, row);
      }

      const out: PlayerRow[] = [];
      for (const row of bestByPlayer.values()) {
        const nil = nilByPlayer.get(row.player_id);
        out.push({
          player_id: row.player_id,
          model_type: row.model_type,
          first_name: row.players.first_name,
          last_name: row.players.last_name,
          team: row.players.team ?? null,
          from_team: row.players.from_team ?? null,
          conference: row.players.conference ?? null,
          position: row.players.position ?? null,
          p_avg: row.p_avg,
          p_obp: row.p_obp,
          p_slg: row.p_slg,
          p_ops: row.p_ops,
          p_iso: row.p_iso,
          p_wrc_plus: row.p_wrc_plus,
          nil_value: nil?.value ?? null,
        });
      }

      return out;
    },
  });

  const conferenceOptions = useMemo(() => {
    return [...new Set(players.map((p) => (p.conference || "").trim()).filter(Boolean))].sort();
  }, [players]);

  const top10 = useMemo(() => {
    const source = pool === "all" ? players : players.filter((p) => (p.conference || "").trim() === pool);
    return source
      .map((p) => {
        const owarValue = computeOWar(p.p_wrc_plus);
        const fallbackNilValue =
          owarValue == null
            ? null
            : owarValue *
              25000 *
              getProgramTierMultiplierByConference(p.conference, DEFAULT_NIL_TIER_MULTIPLIERS) *
              getPositionValueMultiplier(p.position);
        const resolvedNilValue = p.nil_value ?? fallbackNilValue;
        const value =
          metric === "owar"
            ? owarValue
            : metric === "nil_value"
              ? resolvedNilValue
              : (p[metric] as number | null);
        return {
          ...p,
          metric_value: value,
          chart_name: `${p.first_name[0]}. ${p.last_name}`,
          full_name: `${p.first_name} ${p.last_name}`,
          school: p.from_team || p.team || "-",
        };
      })
      .filter((p) => p.metric_value != null)
      .sort((a, b) => (b.metric_value ?? -Infinity) - (a.metric_value ?? -Infinity))
      .slice(0, 10);
  }, [players, metric, pool]);

  const chartData = top10.map((p, idx) => ({
    name: `${idx + 1}. ${p.chart_name}`,
    value: p.metric_value ?? 0,
    valueLabel: formatMetric(metric, p.metric_value ?? null),
    player_id: p.player_id,
    position: p.position,
  }));

  const chartConfig = {
    value: { label: METRICS.find((m) => m.key === metric)?.label ?? metric, color: "hsl(var(--primary))" },
  };

  const metricLabel = METRICS.find((m) => m.key === metric)?.label ?? metric;

  return (
    <DashboardLayout>
      {devBypassed && !serviceKey && (
        <div className="mb-4 space-y-2 rounded border border-yellow-300 bg-yellow-100 p-3 text-yellow-800">
          <p>Warning: Dev bypass active but no service role key provided. Data may be empty.</p>
          <button
            className="text-sm text-blue-600 underline"
            onClick={() => {
              disableDevBypass();
              window.location.href = "/auth";
            }}
          >
            Return to login
          </button>
        </div>
      )}

      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Overview</h2>
          <p className="text-muted-foreground text-sm">
            {isLoading ? "Loading…" : "Top 10 projected outcomes across the player pool."}
          </p>
        </div>

        <Card>
          <CardHeader className="pb-3 space-y-4">
            {/* Metric tabs + pool dropdown row */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Tabs value={metric} onValueChange={(v) => setMetric(v as MetricKey)}>
                <TabsList className="flex-wrap h-auto gap-1">
                  {METRICS.map((m) => (
                    <TabsTrigger key={m.key} value={m.key} className="text-xs px-3 py-1.5">
                      {m.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>

              <div className="min-w-[180px]">
                <Select value={pool} onValueChange={(v) => setPool(v as PoolKey)}>
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue placeholder="All Conferences" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Conferences</SelectItem>
                    {conferenceOptions.map((conf) => (
                      <SelectItem key={conf} value={conf}>{conf}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <CardTitle className="text-sm font-semibold text-muted-foreground">
              Top 10 — {metricLabel}{pool !== "all" ? ` · ${pool}` : ""}
            </CardTitle>
          </CardHeader>

          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
            ) : top10.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">No data available for this metric / pool.</div>
            ) : (
              <div className="grid lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x items-stretch">
                {/* Ranked cards list */}
                <div className="divide-y">
                  {top10.map((row, idx) => (
                      <div key={`${row.player_id}-${idx}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center text-xs font-semibold text-muted-foreground tabular-nums">
                          {idx + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <Link
                            to={profileRouteFor(row.player_id, row.position)}
                            className="block truncate text-sm font-semibold text-primary hover:underline"
                          >
                            {row.full_name}
                          </Link>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <span className="truncate">{row.school}</span>
                            {row.position && (
                              <>
                                <span>·</span>
                                <span>{row.position}</span>
                              </>
                            )}
                            {row.model_type === "transfer" && (
                              <>
                                <span>·</span>
                                <span className="text-accent-foreground font-medium">Transfer</span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="ml-2 font-mono text-sm font-bold tabular-nums">
                          {formatMetric(metric, row.metric_value)}
                        </div>
                      </div>
                  ))}
                </div>

                {/* Bar chart */}
                <div className="p-4 overflow-hidden flex flex-col">
                  <ChartContainer config={chartConfig} className="flex-1 min-h-0 w-full overflow-hidden">
                    <BarChart data={chartData} layout="vertical" barCategoryGap="30%" margin={{ left: 8, right: 72, top: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis
                        type="number"
                        domain={[0, "auto"]}
                        tickFormatter={(v) => tickFormat(metric, Number(v))}
                        tick={{ fontSize: 10 }}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={108}
                        tick={(props: any) => {
                          const { x, y, payload } = props;
                          const row = chartData.find((d) => d.name === payload.value);
                          return (
                            <text
                              x={x}
                              y={y}
                              dy={4}
                              textAnchor="end"
                              className="fill-primary underline cursor-pointer"
                              fontSize={11}
                              onClick={() => row?.player_id && navigate(profileRouteFor(row.player_id, row.position))}
                            >
                              {payload.value}
                            </text>
                          );
                        }}
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar
                        dataKey="value"
                        radius={[0, 4, 4, 0]}
                        onClick={(data: any) => {
                          const pid = data?.payload?.player_id;
                          if (pid) navigate(profileRouteFor(pid, data?.payload?.position));
                        }}
                      >
                        <LabelList
                          dataKey="valueLabel"
                          position="right"
                          offset={8}
                          className="fill-foreground"
                          fontSize={11}
                        />
                        {chartData.map((_, i) => (
                          <Cell key={i} fill={i === 0 ? "hsl(var(--accent))" : "hsl(var(--primary))"} style={{ cursor: "pointer" }} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ChartContainer>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        {/* Summary metric cards */}
        {!isLoading && players.length > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6 pb-4 px-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Users className="h-4 w-4" />
                  <span className="text-xs font-medium">Total Players Tracked</span>
                </div>
                <p className="text-2xl font-bold tabular-nums">
                  {pool === "all"
                    ? players.length.toLocaleString()
                    : players.filter((p) => (p.conference || "").trim() === pool).length.toLocaleString()}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6 pb-4 px-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <TrendingUp className="h-4 w-4" />
                  <span className="text-xs font-medium">Pool Avg — {metricLabel}</span>
                </div>
                <p className="text-2xl font-bold tabular-nums">
                  {(() => {
                    const source = pool === "all" ? players : players.filter((p) => (p.conference || "").trim() === pool);
                    const values = source
                      .map((p) => {
                        if (metric === "owar") return computeOWar(p.p_wrc_plus);
                        if (metric === "nil_value") return p.nil_value;
                        return p[metric] as number | null;
                      })
                      .filter((v): v is number => v != null);
                    if (values.length === 0) return "-";
                    const avg = values.reduce((a, b) => a + b, 0) / values.length;
                    return formatMetric(metric, avg);
                  })()}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6 pb-4 px-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Trophy className="h-4 w-4" />
                  <span className="text-xs font-medium">Highest — {metricLabel}</span>
                </div>
                <p className="text-2xl font-bold tabular-nums">
                  {top10.length > 0 ? formatMetric(metric, top10[0].metric_value) : "-"}
                </p>
                {top10.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{top10[0].full_name}</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6 pb-4 px-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <MapPin className="h-4 w-4" />
                  <span className="text-xs font-medium">Conferences</span>
                </div>
                <p className="text-2xl font-bold tabular-nums">
                  {conferenceOptions.length}
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* View Full Leaderboard link */}
        {!isLoading && players.length > 0 && (
          <div className="text-center">
            <Link
              to="/dashboard/returning"
              className="text-sm font-medium text-primary hover:underline"
            >
              View Full Leaderboard →
            </Link>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
