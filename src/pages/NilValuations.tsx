// TODO: Route is commented out in App.tsx — page is unreachable. Reconnect or remove.
import { useState, useMemo } from "react";
import { formatWithCommas, parseCommaNumber } from "@/lib/utils";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DollarSign, ArrowUpDown, Search, TrendingUp, BarChart3 } from "lucide-react";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell } from "recharts";
import {
  calcPlayerScore,
  calcProgramSpecificAllocation,
  DEFAULT_PROGRAM_TOTAL_PLAYER_SCORE,
  DEFAULT_NIL_TIER_MULTIPLIERS,
  getProgramTierMultiplierByConference,
} from "@/lib/nilProgramSpecific";

type SortKey = "name" | "estimated_value" | "p_avg" | "p_obp" | "p_slg" | "p_wrc_plus" | "owar";
type SortDir = "asc" | "desc";

interface NilPlayer {
  id: string;
  player_id: string;
  first_name: string;
  last_name: string;
  team: string | null;
  conference: string | null;
  position: string | null;
  class_year: string | null;
  estimated_value: number | null;
  offensive_effectiveness: number | null;
  component_breakdown: {
    ncaa_owar?: number;
  } | null;
  // prediction stats
  p_avg: number | null;
  p_obp: number | null;
  p_slg: number | null;
  p_wrc_plus: number | null;
}

const dollarFormat = (v: number | null | undefined) => {
  if (v == null) return "—";
  if (v < 0) return `-$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
};

const compactDollar = (v: number) => {
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(0)}k`;
  return `$${v.toFixed(0)}`;
};

const statFmt = (v: number | null | undefined, decimals = 3) => {
  if (v == null) return "—";
  return v.toFixed(decimals);
};

export default function NilValuations() {
  const [search, setSearch] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [consultationNilBudget, setConsultationNilBudget] = useState<number>(0);
  const [fallbackRosterTotalPlayerScore, setFallbackRosterTotalPlayerScore] = useState<number>(DEFAULT_PROGRAM_TOTAL_PLAYER_SCORE);
  const [sortKey, setSortKey] = useState<SortKey>("estimated_value");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const { data: players = [], isLoading } = useQuery({
    queryKey: ["nil-valuations"],
    queryFn: async () => {
      // Fetch NIL valuations
      const { data: nilData, error: nilError } = await supabase
        .from("nil_valuations")
        .select(`
          *,
          players!inner(id, first_name, last_name, team, conference, position, class_year)
        `);
      if (nilError) throw nilError;

      // Fetch predictions for these players (regular variant)
      const playerIds = (nilData || []).map((r: any) => r.player_id);
      const { data: predData } = await supabase
        .from("player_predictions")
        .select("player_id, p_avg, p_obp, p_slg, p_wrc_plus")
        .eq("variant", "regular")
        .in("player_id", playerIds);

      const predMap = new Map<string, { p_avg: number | null; p_obp: number | null; p_slg: number | null; p_wrc_plus: number | null }>();
      (predData || []).forEach((p: any) => {
        predMap.set(p.player_id, { p_avg: p.p_avg, p_obp: p.p_obp, p_slg: p.p_slg, p_wrc_plus: p.p_wrc_plus });
      });

      return (nilData || []).map((row: any) => {
        const pred = predMap.get(row.player_id);
        return {
          id: row.id,
          player_id: row.player_id,
          first_name: row.players.first_name,
          last_name: row.players.last_name,
          team: row.players.team,
          conference: row.players.conference,
          position: row.players.position,
          class_year: row.players.class_year,
          estimated_value: row.estimated_value,
          offensive_effectiveness: row.offensive_effectiveness,
          component_breakdown: row.component_breakdown as NilPlayer["component_breakdown"],
          p_avg: pred?.p_avg ?? null,
          p_obp: pred?.p_obp ?? null,
          p_slg: pred?.p_slg ?? null,
          p_wrc_plus: pred?.p_wrc_plus ?? null,
        };
      }) as NilPlayer[];
    },
  });

  const filtered = useMemo(() => {
    let list = players;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          `${p.first_name} ${p.last_name}`.toLowerCase().includes(q) ||
          (p.team || "").toLowerCase().includes(q)
      );
    }
    if (teamFilter) {
      list = list.filter((p) => (p.team || "") === teamFilter);
    }
    list.sort((a, b) => {
      if (sortKey === "name") {
        const aVal = `${a.last_name} ${a.first_name}`;
        const bVal = `${b.last_name} ${b.first_name}`;
        return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      let aVal: number;
      let bVal: number;
      if (sortKey === "owar") {
        aVal = a.component_breakdown?.ncaa_owar ?? -999;
        bVal = b.component_breakdown?.ncaa_owar ?? -999;
      } else {
        aVal = (a as any)[sortKey] ?? -999;
        bVal = (b as any)[sortKey] ?? -999;
      }
      return sortDir === "asc" ? aVal - bVal : bVal - aVal;
    });
    return list;
  }, [players, search, teamFilter, sortKey, sortDir]);

  const teams = useMemo(() => {
    return Array.from(new Set(players.map((p) => p.team).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b));
  }, [players]);

  const consultationRows = useMemo(() => {
    return filtered.map((p) => {
      const owar = p.component_breakdown?.ncaa_owar ?? 0;
      const programTierMultiplier = getProgramTierMultiplierByConference(
        p.conference,
        DEFAULT_NIL_TIER_MULTIPLIERS,
      );
      const playerScore = calcPlayerScore({ owar, programTierMultiplier, position: p.position });
      return {
        ...p,
        program_tier_multiplier: programTierMultiplier,
        consultation_player_score: playerScore,
      };
    });
  }, [filtered]);

  const totalRosterPlayerScore = useMemo(() => {
    return consultationRows.reduce((sum, p) => sum + p.consultation_player_score, 0);
  }, [consultationRows]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  // Summary stats
  const totalValue = players.reduce((s, p) => s + (p.estimated_value ?? 0), 0);
  const avgValue = players.length ? totalValue / players.length : 0;
  const topPlayer = players.length
    ? [...players].sort((a, b) => (b.estimated_value ?? 0) - (a.estimated_value ?? 0))[0]
    : null;
  const avgOE = players.length
    ? players.reduce((s, p) => s + (p.offensive_effectiveness ?? 0), 0) / players.length
    : 0;

  // Chart data — top 10 by estimated value
  const chartData = useMemo(() => {
    return [...players]
      .filter((p) => p.estimated_value != null)
      .sort((a, b) => (b.estimated_value ?? 0) - (a.estimated_value ?? 0))
      .slice(0, 10)
      .map((p) => ({
        name: `${p.first_name[0]}. ${p.last_name}`,
        value: Math.round(p.estimated_value ?? 0),
      }));
  }, [players]);

  const chartConfig = {
    value: { label: "Estimated Value", color: "hsl(var(--success))" },
  };

  const SortButton = ({ label, sortKeyVal }: { label: string; sortKeyVal: SortKey }) => (
    <Button
      variant="ghost"
      size="sm"
      className="h-auto p-0 font-medium text-muted-foreground hover:text-foreground -ml-1"
      onClick={() => toggleSort(sortKeyVal)}
    >
      {label}
      <ArrowUpDown className="ml-1 h-3 w-3" />
    </Button>
  );

  const valueTier = (v: number | null) => {
    if (v == null) return "secondary";
    if (v >= 80000) return "default";
    if (v >= 40000) return "secondary";
    return "outline";
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-2xl font-bold tracking-tight">NIL Valuations</h2>
          <p className="text-muted-foreground">Estimated dollar values based on offensive effectiveness</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Program-Specific NIL Equation</CardTitle>
            <CardDescription>
              Player Score = oWAR × PTM × PVF; Program NIL = (Player Score / Sum of Total Roster Player Score) × Team-Specific Total NIL Budget
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-4">
            <div>
              <Label className="text-xs mb-1 block">Team Filter</Label>
              <Input
                placeholder="Type team name..."
                value={teamFilter}
                onChange={(e) => setTeamFilter(e.target.value)}
                list="nil-teams"
              />
              <datalist id="nil-teams">
                {teams.map((team) => (
                  <option key={team} value={team} />
                ))}
              </datalist>
            </div>
            <div>
              <Label className="text-xs mb-1 block">Team-Specific Total NIL Budget ($)</Label>
              <Input
                type="text"
                inputMode="numeric"
                value={formatWithCommas(consultationNilBudget)}
                onChange={(e) => setConsultationNilBudget(parseCommaNumber(e.target.value))}
              />
            </div>
            <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
              <div className="font-medium text-foreground">PTM by Conference</div>
              <div>SEC: {DEFAULT_NIL_TIER_MULTIPLIERS.sec.toFixed(1)} | ACC/Big12: {DEFAULT_NIL_TIER_MULTIPLIERS.p4.toFixed(1)} | Big Ten: {DEFAULT_NIL_TIER_MULTIPLIERS.bigTen.toFixed(1)}</div>
              <div>Strong Mid: AAC, Sun Belt, Big West, Mountain West ({DEFAULT_NIL_TIER_MULTIPLIERS.strongMid.toFixed(1)})</div>
              <div>All other conferences: Low Tier ({DEFAULT_NIL_TIER_MULTIPLIERS.lowMajor.toFixed(1)})</div>
            </div>
            <div>
              <Label className="text-xs mb-1 block">Total Roster Player Score (68 for future projections)</Label>
              <Input
                type="number"
                step="0.01"
                value={fallbackRosterTotalPlayerScore || ""}
                onChange={(e) => setFallbackRosterTotalPlayerScore(Number(e.target.value) || 0)}
              />
            </div>
            <div className="md:col-span-4 text-xs text-muted-foreground">
              Sum of Total Roster Player Score: <span className="font-mono text-foreground">{totalRosterPlayerScore.toFixed(2)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Summary cards */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Portfolio</CardTitle>
              <DollarSign className="h-4 w-4 text-[hsl(var(--success))]" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{compactDollar(totalValue)}</div>
              <p className="text-xs text-muted-foreground mt-1">{players.length} players valued</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Avg Valuation</CardTitle>
              <BarChart3 className="h-4 w-4 text-accent" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{dollarFormat(Math.round(avgValue))}</div>
              <p className="text-xs text-muted-foreground mt-1">Avg OE: {avgOE.toFixed(0)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Highest Valued</CardTitle>
              <TrendingUp className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold truncate">
                {topPlayer ? `${topPlayer.first_name} ${topPlayer.last_name}` : "—"}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {topPlayer ? dollarFormat(topPlayer.estimated_value) : "No data"}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Chart */}
        {chartData.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top 10 NIL Valuations</CardTitle>
              <CardDescription>Estimated dollar value based on offensive production model</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={chartConfig} className="h-[280px]">
                <BarChart data={chartData} layout="vertical" margin={{ left: 80, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" domain={[0, "auto"]} tickFormatter={(v) => compactDollar(v)} />
                  <YAxis type="category" dataKey="name" width={75} tick={{ fontSize: 12 }} />
                  <ChartTooltip
                    content={<ChartTooltipContent formatter={(value) => dollarFormat(value as number)} />}
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {chartData.map((_, i) => (
                      <Cell key={i} fill={i === 0 ? "hsl(var(--accent))" : "hsl(var(--success))"} />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
        )}

        {/* Table */}
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">NIL Valuation</CardTitle>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search players..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">Loading valuations…</div>
            ) : filtered.length === 0 ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">No players found</div>
            ) : (
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[160px]"><SortButton label="Player" sortKeyVal="name" /></TableHead>
                      <TableHead><SortButton label="Value" sortKeyVal="estimated_value" /></TableHead>
                      <TableHead>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help"><SortButton label="pAVG" sortKeyVal="p_avg" /></span>
                          </TooltipTrigger>
                          <TooltipContent><p className="text-xs">Predicted Batting Average</p></TooltipContent>
                        </Tooltip>
                      </TableHead>
                      <TableHead>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help"><SortButton label="pOBP" sortKeyVal="p_obp" /></span>
                          </TooltipTrigger>
                          <TooltipContent><p className="text-xs">Predicted On-Base Percentage</p></TooltipContent>
                        </Tooltip>
                      </TableHead>
                      <TableHead>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help"><SortButton label="pSLG" sortKeyVal="p_slg" /></span>
                          </TooltipTrigger>
                          <TooltipContent><p className="text-xs">Predicted Slugging Percentage</p></TooltipContent>
                        </Tooltip>
                      </TableHead>
                      <TableHead>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help"><SortButton label="wRC+" sortKeyVal="p_wrc_plus" /></span>
                          </TooltipTrigger>
                          <TooltipContent><p className="text-xs">Weighted Runs Created Plus — 100 = league avg</p></TooltipContent>
                        </Tooltip>
                      </TableHead>
                      <TableHead>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help"><SortButton label="oWAR" sortKeyVal="owar" /></span>
                          </TooltipTrigger>
                          <TooltipContent><p className="text-xs">Offensive Wins Above Replacement (NCAA scale)</p></TooltipContent>
                        </Tooltip>
                      </TableHead>
                      <TableHead>Player Score</TableHead>
                      <TableHead>Program NIL ($)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {consultationRows.map((p) => {
                      const cb = p.component_breakdown;
                      const consultationValue = calcProgramSpecificAllocation({
                        playerScore: p.consultation_player_score,
                        rosterTotalPlayerScore: totalRosterPlayerScore,
                        nilBudget: consultationNilBudget,
                        fallbackTotalPlayerScore: fallbackRosterTotalPlayerScore,
                      });
                      return (
                        <TableRow key={p.id}>
                          <TableCell>
                            <div className="font-medium">{p.first_name} {p.last_name}</div>
                            <div className="text-xs text-muted-foreground">
                              {[p.position, p.team].filter(Boolean).join(" · ") || "—"}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={valueTier(p.estimated_value)} className="font-mono text-xs">
                              {dollarFormat(p.estimated_value)}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {statFmt(p.p_avg)}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {statFmt(p.p_obp)}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {statFmt(p.p_slg)}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {p.p_wrc_plus != null ? Math.round(p.p_wrc_plus).toString() : "—"}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {cb?.ncaa_owar != null ? cb.ncaa_owar.toFixed(2) : "—"}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {p.consultation_player_score.toFixed(2)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="font-mono text-xs">
                              {dollarFormat(Math.round(consultationValue))}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
