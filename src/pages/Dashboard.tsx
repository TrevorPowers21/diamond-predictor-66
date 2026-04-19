import { useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTargetBoard } from "@/hooks/useTargetBoard";
import { Link, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Eye, LogIn, X, CheckCircle } from "lucide-react";
import {
  DEFAULT_NIL_TIER_MULTIPLIERS,
  getProgramTierMultiplierByConference,
  getPositionValueMultiplier,
} from "@/lib/nilProgramSpecific";
import { profileRouteFor } from "@/lib/profileRoutes";
import SchoolBanner from "@/components/SchoolBanner";

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


const computeOWar = (wrcPlus: number | null | undefined, actualPa?: number | null): number | null => {
  if (wrcPlus == null) return null;
  const pa = actualPa ?? 260;
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
    staleTime: 0,
    queryFn: async () => {
      // Paginate predictions — Supabase caps single requests at 1000 rows
      // and there are ~10k+ rows in player_predictions, so without paging
      // we'd silently miss most players.
      const allPreds: any[] = [];
      let from = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("player_predictions")
          .select(
            "id, player_id, model_type, variant, status, p_avg, p_obp, p_slg, p_ops, p_iso, p_wrc_plus, players!inner(first_name, last_name, team, from_team, conference, position, pa, ip)",
          )
          .eq("variant", "regular")
          .in("status", ["active", "departed"])
          .in("model_type", ["returner", "transfer"])
          .gte("players.pa", 75)
          .not("players.position", "in", "(SP,RP,CL,P,LHP,RHP)")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const rows = data || [];
        allPreds.push(...rows);
        if (rows.length < PAGE) break;
        from += PAGE;
      }

      const nilRes = await supabase.from("nil_valuations").select("player_id, estimated_value, season");
      if (nilRes.error) throw nilRes.error;
      const predRes = { data: allPreds, error: null as any };

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

  const metricLabel = METRICS.find((m) => m.key === metric)?.label ?? metric;

  // Single source of truth: Supabase target_board table
  const { board: targetBoard, removePlayer: removeFromBoard } = useTargetBoard();

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

      <div className="space-y-4 max-w-[1400px] mx-auto">
        {/* ─── Banner ─── */}
        <SchoolBanner />

        {/* ─── Controls bar ─── */}
        <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs value={metric} onValueChange={(v) => setMetric(v as MetricKey)}>
            <TabsList className="flex-wrap h-auto gap-0.5 bg-background/60">
              {METRICS.map((m) => (
                <TabsTrigger key={m.key} value={m.key} className="text-xs px-2.5 py-1">
                  {m.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="min-w-[170px]">
            <Select value={pool} onValueChange={(v) => setPool(v as PoolKey)}>
              <SelectTrigger className="h-8 text-xs">
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

        {/* ─── Main content: Top 10 + Target Board ─── */}
        <div className="grid lg:grid-cols-[1.2fr_0.8fr] gap-4 items-start">
          {/* Top 10 Leaderboard */}
          <Card className="border-border/60">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Top 10 — {metricLabel}{pool !== "all" ? ` · ${pool}` : ""}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
              ) : top10.length === 0 ? (
                <div className="py-16 text-center text-sm text-muted-foreground">No data available for this metric / pool.</div>
              ) : (
                <div className="divide-y divide-border/30">
                  {top10.map((row, idx) => (
                    <Link
                      key={`${row.player_id}-${idx}`}
                      to={profileRouteFor(row.player_id, row.position)}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors group"
                    >
                      <span className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold tabular-nums",
                        idx === 0 ? "bg-primary/10 text-primary" : idx <= 2 ? "bg-muted text-foreground" : "text-muted-foreground"
                      )}>
                        {idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium group-hover:text-primary transition-colors">
                          {row.full_name}
                        </span>
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span className="truncate">{row.school}</span>
                          {row.position && <><span>·</span><span>{row.position}</span></>}
                          {row.model_type === "transfer" && (
                            <span className="text-amber-600 font-medium">Portal</span>
                          )}
                        </div>
                      </div>
                      <div className="ml-2 font-mono text-sm font-bold tabular-nums">
                        {formatMetric(metric, row.metric_value)}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Target Board — independent card */}
          <Card className="border-border/60">
            <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Target Board</CardTitle>
              <span className="text-[10px] text-muted-foreground/60">{targetBoard.length} players</span>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border/30">
                {targetBoard.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No players on your board yet. Add players from the Player Dashboard or player profiles.
                  </div>
                ) : (
                  targetBoard.map((row) => {
                    const initials = `${(row.first_name?.[0] || "").toUpperCase()}${(row.last_name?.[0] || "").toUpperCase()}`;
                    // Players on the board with NOT IN PORTAL status display as WATCHING
                    // (since they're on the board, they're being watched by the coach)
                    const displayStatus = row.portal_status === "NOT IN PORTAL" ? "WATCHING" : row.portal_status;
                    const statusConfig = {
                      "IN PORTAL": { bg: "bg-emerald-500/10", text: "text-emerald-600", icon: LogIn, label: "In Portal" },
                      "COMMITTED": { bg: "bg-blue-500/10", text: "text-blue-600", icon: CheckCircle, label: "Committed" },
                      "WATCHING": { bg: "bg-[#D4AF37]/10", text: "text-[#D4AF37]", icon: Eye, label: "Watching" },
                    }[displayStatus] || { bg: "bg-[#D4AF37]/10", text: "text-[#D4AF37]", icon: Eye, label: "Watching" };
                    const StatusIcon = statusConfig.icon;
                    return (
                      <div
                        key={row.player_id}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors group"
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#A08820]/15 text-[12px] font-bold text-[#D4AF37] ring-1 ring-[#D4AF37]/20">
                          {initials}
                        </div>
                        <Link
                          to={profileRouteFor(row.player_id, row.position)}
                          className="min-w-0 flex-1 cursor-pointer"
                        >
                          <span className="block truncate text-sm font-medium group-hover:text-primary transition-colors">
                            {row.first_name} {row.last_name}
                          </span>
                          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <span className="truncate">{row.team || "—"}</span>
                            {row.position && <><span>·</span><span>{row.position}</span></>}
                          </div>
                        </Link>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <span className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                            statusConfig.bg, statusConfig.text,
                          )}>
                            <StatusIcon className="h-2.5 w-2.5" />
                            {statusConfig.label}
                          </span>
                          <button
                            onClick={() => removeFromBoard(row.player_id)}
                            className="text-muted-foreground/40 hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                            title="Remove from board"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* View Full Leaderboard */}
        {!isLoading && players.length > 0 && (
          <div className="text-center pb-2">
            <Link to="/dashboard/returning" className="text-xs font-medium text-primary hover:underline">
              View Full Leaderboard →
            </Link>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
