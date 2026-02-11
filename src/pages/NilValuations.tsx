import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DollarSign, ArrowUpDown, Search, TrendingUp, BarChart3, Users } from "lucide-react";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell } from "recharts";

type SortKey = "name" | "estimated_value" | "offensive_effectiveness" | "raa" | "rar" | "owar";
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
  model_version: string | null;
  component_breakdown: {
    model_type?: string;
    variant?: string;
    off_value?: number;
    raa?: number;
    rar?: number;
    replacement_runs?: number;
    ncaa_owar?: number;
  } | null;
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

export default function NilValuations() {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("estimated_value");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const { data: players = [], isLoading } = useQuery({
    queryKey: ["nil-valuations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nil_valuations")
        .select(`
          *,
          players!inner(id, first_name, last_name, team, conference, position, class_year)
        `);

      if (error) throw error;

      return (data || []).map((row: any) => ({
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
        model_version: row.model_version,
        component_breakdown: row.component_breakdown as NilPlayer["component_breakdown"],
      })) as NilPlayer[];
    },
  });

  const filtered = useMemo(() => {
    let list = players;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          `${p.first_name} ${p.last_name}`.toLowerCase().includes(q) ||
          (p.team || "").toLowerCase().includes(q) ||
          (p.model_version || "").toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => {
      if (sortKey === "name") {
        const aVal = `${a.last_name} ${a.first_name}`;
        const bVal = `${b.last_name} ${b.first_name}`;
        return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      let aVal: number;
      let bVal: number;
      if (sortKey === "raa") {
        aVal = a.component_breakdown?.raa ?? -999;
        bVal = b.component_breakdown?.raa ?? -999;
      } else if (sortKey === "rar") {
        aVal = a.component_breakdown?.rar ?? -999;
        bVal = b.component_breakdown?.rar ?? -999;
      } else if (sortKey === "owar") {
        aVal = a.component_breakdown?.ncaa_owar ?? -999;
        bVal = b.component_breakdown?.ncaa_owar ?? -999;
      } else {
        aVal = (a as any)[sortKey] ?? -999;
        bVal = (b as any)[sortKey] ?? -999;
      }
      return sortDir === "asc" ? aVal - bVal : bVal - aVal;
    });
    return list;
  }, [players, search, sortKey, sortDir]);

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
            <CardTitle className="text-base">Valuations</CardTitle>
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
                            <span className="cursor-help"><SortButton label="OE" sortKeyVal="offensive_effectiveness" /></span>
                          </TooltipTrigger>
                          <TooltipContent><p className="text-xs">Offensive Effectiveness — 100 = league avg</p></TooltipContent>
                        </Tooltip>
                      </TableHead>
                      <TableHead>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help"><SortButton label="RAA" sortKeyVal="raa" /></span>
                          </TooltipTrigger>
                          <TooltipContent><p className="text-xs">Runs Above Average</p></TooltipContent>
                        </Tooltip>
                      </TableHead>
                      <TableHead>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help"><SortButton label="RAR" sortKeyVal="rar" /></span>
                          </TooltipTrigger>
                          <TooltipContent><p className="text-xs">Runs Above Replacement</p></TooltipContent>
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
                      <TableHead>Model</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((p) => {
                      const cb = p.component_breakdown;
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
                            {p.offensive_effectiveness != null ? Math.round(p.offensive_effectiveness) : "—"}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {cb?.raa != null ? cb.raa.toFixed(1) : "—"}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {cb?.rar != null ? cb.rar.toFixed(1) : "—"}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {cb?.ncaa_owar != null ? cb.ncaa_owar.toFixed(2) : "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="text-[10px]">
                              {p.model_version || "—"}
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
