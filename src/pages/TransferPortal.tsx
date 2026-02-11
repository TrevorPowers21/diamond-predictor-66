import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Users, TrendingUp, TrendingDown, ArrowUpDown, Search, BarChart3 } from "lucide-react";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Cell } from "recharts";

type SortKey = "name" | "p_ops" | "p_avg" | "p_slg" | "p_obp" | "p_iso" | "p_wrc_plus" | "power_rating_plus" | "ev_score" | "barrel_score";
type SortDir = "asc" | "desc";

interface TransferPlayer {
  id: string;
  first_name: string;
  last_name: string;
  team: string | null;
  conference: string | null;
  position: string | null;
  class_year: string | null;
  prediction: {
    variant: string;
    p_avg: number | null;
    p_obp: number | null;
    p_slg: number | null;
    p_ops: number | null;
    p_iso: number | null;
    p_wrc_plus: number | null;
    from_avg: number | null;
    from_obp: number | null;
    from_slg: number | null;
    from_park_factor: number | null;
    to_park_factor: number | null;
    from_stuff_plus: number | null;
    to_stuff_plus: number | null;
    power_rating_plus: number | null;
    ev_score: number | null;
    barrel_score: number | null;
    whiff_score: number | null;
    chase_score: number | null;
    class_transition: string | null;
  };
}

const statFormat = (v: number | null | undefined, decimals = 3) => {
  if (v == null) return "—";
  return v >= 1 && decimals === 3 ? v.toFixed(3) : v.toFixed(decimals);
};

const pctFormat = (v: number | null | undefined) => {
  if (v == null) return "—";
  return Math.round(v).toString();
};

const deltaColor = (from: number | null, to: number | null) => {
  if (from == null || to == null) return "";
  const diff = to - from;
  if (diff > 0.01) return "text-[hsl(var(--success))]";
  if (diff < -0.01) return "text-destructive";
  return "text-muted-foreground";
};

const DeltaIndicator = ({ from, to }: { from: number | null; to: number | null }) => {
  if (from == null || to == null) return null;
  const diff = to - from;
  if (Math.abs(diff) < 0.001) return null;
  return diff > 0 ? (
    <TrendingUp className="inline h-3 w-3 text-[hsl(var(--success))] ml-1" />
  ) : (
    <TrendingDown className="inline h-3 w-3 text-destructive ml-1" />
  );
};

export default function TransferPortal() {
  const [search, setSearch] = useState("");
  const [variant, setVariant] = useState<"regular" | "xstats">("regular");
  const [sortKey, setSortKey] = useState<SortKey>("p_ops");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const { data: players = [], isLoading } = useQuery({
    queryKey: ["transfer-portal", variant],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_predictions")
        .select(`
          *,
          players!inner(id, first_name, last_name, team, conference, position, class_year)
        `)
        .eq("model_type", "transfer")
        .eq("variant", variant);

      if (error) throw error;

      return (data || []).map((row: any) => ({
        id: row.players.id,
        first_name: row.players.first_name,
        last_name: row.players.last_name,
        team: row.players.team,
        conference: row.players.conference,
        position: row.players.position,
        class_year: row.players.class_year,
        prediction: {
          variant: row.variant,
          p_avg: row.p_avg,
          p_obp: row.p_obp,
          p_slg: row.p_slg,
          p_ops: row.p_ops,
          p_iso: row.p_iso,
          p_wrc_plus: row.p_wrc_plus,
          from_avg: row.from_avg,
          from_obp: row.from_obp,
          from_slg: row.from_slg,
          from_park_factor: row.from_park_factor,
          to_park_factor: row.to_park_factor,
          from_stuff_plus: row.from_stuff_plus,
          to_stuff_plus: row.to_stuff_plus,
          power_rating_plus: row.power_rating_plus,
          ev_score: row.ev_score,
          barrel_score: row.barrel_score,
          whiff_score: row.whiff_score,
          chase_score: row.chase_score,
          class_transition: row.class_transition,
        },
      })) as TransferPlayer[];
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
          (p.conference || "").toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => {
      let aVal: number | string | null;
      let bVal: number | string | null;
      if (sortKey === "name") {
        aVal = `${a.last_name} ${a.first_name}`;
        bVal = `${b.last_name} ${b.first_name}`;
        return sortDir === "asc" ? (aVal as string).localeCompare(bVal as string) : (bVal as string).localeCompare(aVal as string);
      }
      aVal = a.prediction[sortKey] ?? -999;
      bVal = b.prediction[sortKey] ?? -999;
      return sortDir === "asc" ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
    return list;
  }, [players, search, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  // Summary stats
  const avgOps = players.length ? players.reduce((s, p) => s + (p.prediction.p_ops ?? 0), 0) / players.length : 0;
  const topPlayer = players.length ? [...players].sort((a, b) => (b.prediction.p_ops ?? 0) - (a.prediction.p_ops ?? 0))[0] : null;

  // Chart data — top 10 by pOPS
  const chartData = useMemo(() => {
    return [...players]
      .sort((a, b) => (b.prediction.p_ops ?? 0) - (a.prediction.p_ops ?? 0))
      .slice(0, 10)
      .map((p) => ({
        name: `${p.first_name[0]}. ${p.last_name}`,
        pOPS: p.prediction.p_ops ?? 0,
        fromOPS: (p.prediction.from_avg ?? 0) + (p.prediction.from_slg ?? 0),
      }));
  }, [players]);

  const chartConfig = {
    pOPS: { label: "Predicted OPS", color: "hsl(var(--primary))" },
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

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Transfer Portal</h2>
            <p className="text-muted-foreground">Predicted post-transition performance for portal entrants</p>
          </div>
          <Select value={variant} onValueChange={(v) => setVariant(v as "regular" | "xstats")}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="regular">Regular Stats</SelectItem>
              <SelectItem value="xstats">xStats</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Summary cards */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Portal Players</CardTitle>
              <Users className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{players.length}</div>
              <p className="text-xs text-muted-foreground mt-1">{variant === "xstats" ? "xStats" : "Regular"} variant</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Avg Predicted OPS</CardTitle>
              <BarChart3 className="h-4 w-4 text-accent" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{avgOps.toFixed(3)}</div>
              <p className="text-xs text-muted-foreground mt-1">Across all tracked players</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Top Projected Player</CardTitle>
              <TrendingUp className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold truncate">
                {topPlayer ? `${topPlayer.first_name} ${topPlayer.last_name}` : "—"}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {topPlayer ? `pOPS: ${statFormat(topPlayer.prediction.p_ops)}` : "No data"}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Chart — Top 10 by pOPS */}
        {chartData.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top 10 Projected OPS</CardTitle>
              <CardDescription>Predicted post-transition OPS for top portal players</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={chartConfig} className="h-[280px]">
                <BarChart data={chartData} layout="vertical" margin={{ left: 80, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" domain={[0, "auto"]} tickFormatter={(v) => v.toFixed(3)} />
                  <YAxis type="category" dataKey="name" width={75} tick={{ fontSize: 12 }} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="pOPS" radius={[0, 4, 4, 0]} fill="hsl(var(--primary))">
                    {chartData.map((_, i) => (
                      <Cell key={i} fill={i === 0 ? "hsl(var(--accent))" : "hsl(var(--primary))"} />
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
            <CardTitle className="text-base">Player Predictions</CardTitle>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search players, teams..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">Loading predictions…</div>
            ) : filtered.length === 0 ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">No players found</div>
            ) : (
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[160px]"><SortButton label="Player" sortKeyVal="name" /></TableHead>
                      <TableHead>Prior</TableHead>
                      <TableHead><SortButton label="pAVG" sortKeyVal="p_avg" /></TableHead>
                      <TableHead><SortButton label="pOBP" sortKeyVal="p_obp" /></TableHead>
                      <TableHead><SortButton label="pSLG" sortKeyVal="p_slg" /></TableHead>
                      <TableHead><SortButton label="pOPS" sortKeyVal="p_ops" /></TableHead>
                      <TableHead><SortButton label="pISO" sortKeyVal="p_iso" /></TableHead>
                      <TableHead>Park Δ</TableHead>
                      <TableHead>Stuff Δ</TableHead>
                      <TableHead><SortButton label="PWR+" sortKeyVal="power_rating_plus" /></TableHead>
                      <TableHead>Scouting</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((p) => {
                      const pred = p.prediction;
                      const parkDelta = pred.to_park_factor != null && pred.from_park_factor != null
                        ? pred.to_park_factor - pred.from_park_factor
                        : null;
                      const stuffDelta = pred.to_stuff_plus != null && pred.from_stuff_plus != null
                        ? pred.to_stuff_plus - pred.from_stuff_plus
                        : null;

                      return (
                        <TableRow key={`${p.id}-${pred.variant}`}>
                          <TableCell>
                            <div className="font-medium">{p.first_name} {p.last_name}</div>
                            <div className="text-xs text-muted-foreground">
                              {[p.position, p.team, p.class_year].filter(Boolean).join(" · ") || "—"}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {statFormat(pred.from_avg)}/{statFormat(pred.from_obp)}/{statFormat(pred.from_slg)}
                          </TableCell>
                          <TableCell className={deltaColor(pred.from_avg, pred.p_avg)}>
                            {statFormat(pred.p_avg)}
                            <DeltaIndicator from={pred.from_avg} to={pred.p_avg} />
                          </TableCell>
                          <TableCell className={deltaColor(pred.from_obp, pred.p_obp)}>
                            {statFormat(pred.p_obp)}
                            <DeltaIndicator from={pred.from_obp} to={pred.p_obp} />
                          </TableCell>
                          <TableCell className={deltaColor(pred.from_slg, pred.p_slg)}>
                            {statFormat(pred.p_slg)}
                            <DeltaIndicator from={pred.from_slg} to={pred.p_slg} />
                          </TableCell>
                          <TableCell className="font-semibold">
                            {statFormat(pred.p_ops)}
                          </TableCell>
                          <TableCell>{statFormat(pred.p_iso)}</TableCell>
                          <TableCell>
                            {parkDelta != null ? (
                              <Badge variant={parkDelta > 0 ? "default" : parkDelta < 0 ? "destructive" : "secondary"} className="text-xs">
                                {parkDelta > 0 ? "+" : ""}{parkDelta}
                              </Badge>
                            ) : "—"}
                          </TableCell>
                          <TableCell>
                            {stuffDelta != null ? (
                              <Badge variant={stuffDelta > 0 ? "default" : stuffDelta < 0 ? "destructive" : "secondary"} className="text-xs">
                                {stuffDelta > 0 ? "+" : ""}{stuffDelta}
                              </Badge>
                            ) : "—"}
                          </TableCell>
                          <TableCell className="font-mono text-sm">{pctFormat(pred.power_rating_plus)}</TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              {pred.ev_score != null && <ScoutBadge label="EV" value={pred.ev_score} />}
                              {pred.barrel_score != null && <ScoutBadge label="BBL" value={pred.barrel_score} />}
                              {pred.whiff_score != null && <ScoutBadge label="WH" value={pred.whiff_score} />}
                              {pred.chase_score != null && <ScoutBadge label="CH" value={pred.chase_score} />}
                            </div>
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

function ScoutBadge({ label, value }: { label: string; value: number }) {
  const tier = value >= 80 ? "bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]" : value >= 50 ? "bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))]" : "bg-destructive/15 text-destructive";
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${tier}`} title={`${label}: ${value}`}>
      {label} {value}
    </span>
  );
}
