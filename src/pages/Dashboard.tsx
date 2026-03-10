import { useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell, LabelList } from "recharts";
import { useAuth } from "@/hooks/useAuth";
import { Link, useNavigate } from "react-router-dom";
import {
  DEFAULT_NIL_TIER_MULTIPLIERS,
  getProgramTierMultiplierByConference,
  getPositionValueMultiplier,
} from "@/lib/nilProgramSpecific";

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

const METRIC_LABELS: Record<MetricKey, string> = {
  p_avg: "pAVG",
  p_obp: "pOBP",
  p_slg: "pSLG",
  p_ops: "pOPS",
  p_iso: "pISO",
  p_wrc_plus: "pWRC+",
  owar: "oWAR",
  nil_value: "NIL",
};

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
  const [visualMetric, setVisualMetric] = useState<MetricKey>("p_avg");
  const [visualPool, setVisualPool] = useState<PoolKey>("all");
  const [rankingMetric, setRankingMetric] = useState<MetricKey>("p_obp");
  const [rankingPool, setRankingPool] = useState<PoolKey>("all");

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

  const top10For = (metric: MetricKey, pool: PoolKey) => {
    const source =
      pool === "all"
        ? players
        : players.filter((p) => (p.conference || "").trim() === pool);
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
  };

  const visualTop10 = useMemo(() => top10For(visualMetric, visualPool), [players, visualMetric, visualPool]);
  const rankingTop10 = useMemo(() => top10For(rankingMetric, rankingPool), [players, rankingMetric, rankingPool]);

  const chartData = visualTop10.map((p, idx) => ({
    name: `${idx + 1}. ${p.chart_name}`,
    value: p.metric_value ?? 0,
    valueLabel: formatMetric(visualMetric, p.metric_value ?? null),
    player_id: p.player_id,
  }));
  const chartConfig = {
    value: { label: METRIC_LABELS[visualMetric], color: "hsl(var(--primary))" },
  };

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
          <p className="text-muted-foreground">
            {isLoading ? "Loading top 10 explorer..." : "Use separate visual and ranking modules for Top 10 projected outcomes."}
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="min-w-0 overflow-hidden order-2">
            <CardHeader className="space-y-3">
              <CardTitle className="text-base">Visual Top 10</CardTitle>
              <CardDescription>Graph module (left).</CardDescription>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="min-w-0">
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Metric</div>
                  <Select value={visualMetric} onValueChange={(v) => setVisualMetric(v as MetricKey)}>
                    <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="p_avg">pAVG</SelectItem>
                      <SelectItem value="p_obp">pOBP</SelectItem>
                      <SelectItem value="p_slg">pSLG</SelectItem>
                      <SelectItem value="p_ops">pOPS</SelectItem>
                      <SelectItem value="p_iso">pISO</SelectItem>
                      <SelectItem value="p_wrc_plus">pWRC+</SelectItem>
                      <SelectItem value="owar">oWAR</SelectItem>
                      <SelectItem value="nil_value">NIL</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-0">
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Pool</div>
                  <Select value={visualPool} onValueChange={(v) => setVisualPool(v as PoolKey)}>
                    <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Conferences</SelectItem>
                      {conferenceOptions.map((conf) => (
                        <SelectItem key={`visual-${conf}`} value={conf}>{conf}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 overflow-hidden pl-3 pr-3">
              {visualTop10.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">No rows available for this metric/pool.</div>
              ) : (
                <div className="space-y-3 overflow-hidden">
                  <ChartContainer config={chartConfig} className="h-[340px] w-full overflow-hidden">
                    <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 64, top: 4, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" domain={[0, "auto"]} tickFormatter={(v) => tickFormat(visualMetric, Number(v))} />
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
                              onClick={() => row?.player_id && navigate(`/dashboard/player/${row.player_id}`)}
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
                          if (pid) navigate(`/dashboard/player/${pid}`);
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
              )}
            </CardContent>
          </Card>

          <Card className="min-w-0 overflow-hidden order-1">
            <CardHeader className="space-y-3">
              <CardTitle className="text-base">Ranking Top 10</CardTitle>
              <CardDescription>Single uninterrupted list with separate controls.</CardDescription>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="min-w-0">
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Metric</div>
                  <Select value={rankingMetric} onValueChange={(v) => setRankingMetric(v as MetricKey)}>
                    <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="p_avg">pAVG</SelectItem>
                      <SelectItem value="p_obp">pOBP</SelectItem>
                      <SelectItem value="p_slg">pSLG</SelectItem>
                      <SelectItem value="p_ops">pOPS</SelectItem>
                      <SelectItem value="p_iso">pISO</SelectItem>
                      <SelectItem value="p_wrc_plus">pWRC+</SelectItem>
                      <SelectItem value="owar">oWAR</SelectItem>
                      <SelectItem value="nil_value">NIL</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-0">
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Pool</div>
                  <Select value={rankingPool} onValueChange={(v) => setRankingPool(v as PoolKey)}>
                    <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Conferences</SelectItem>
                      {conferenceOptions.map((conf) => (
                        <SelectItem key={`ranking-${conf}`} value={conf}>{conf}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="overflow-hidden">
              {rankingTop10.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">No rows available for this metric/pool.</div>
              ) : (
                <div className="rounded-md border">
                  <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Ranking ({METRIC_LABELS[rankingMetric]})
                  </div>
                  {rankingTop10.map((row, idx) => (
                    <div key={`${row.player_id}-${idx}`} className="flex items-center justify-between border-b px-3 py-2 last:border-b-0">
                      <div className="min-w-0">
                        <Link to={`/dashboard/player/${row.player_id}`} className="block truncate text-sm font-medium text-primary hover:underline">
                          {idx + 1}. {row.full_name}
                        </Link>
                        <div className="truncate text-xs text-muted-foreground">{row.school}</div>
                      </div>
                      <div className="ml-3 font-mono text-sm font-semibold">{formatMetric(rankingMetric, row.metric_value)}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
