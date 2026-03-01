import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Users,
  TrendingUp,
  TrendingDown,
  ArrowUpDown,
  Search,
  BarChart3,
  Activity,
  Pencil,
  Save,
  X,
} from "lucide-react";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell } from "recharts";
import { toast } from "sonner";

type SortKey =
  | "name"
  | "p_ops"
  | "p_avg"
  | "p_slg"
  | "p_obp"
  | "p_iso"
  | "p_wrc_plus"
  | "power_rating_plus"
  | "class_transition";
type SortDir = "asc" | "desc";

interface ReturnerPlayer {
  id: string;
  prediction_id: string;
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
    dev_aggressiveness: number | null;
    class_transition: string | null;
    power_rating_plus: number | null;
    ev_score: number | null;
    barrel_score: number | null;
    whiff_score: number | null;
    chase_score: number | null;
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

const classTransitionLabel: Record<string, string> = {
  FS: "FR → SO",
  SJ: "SO → JR",
  JS: "JR → SR",
  GR: "Graduate",
};

export default function ReturningPlayers() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [variant, setVariant] = useState<"regular" | "xstats">("regular");
  const [positionFilter, setPositionFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("p_ops");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [statusFilter, setStatusFilter] = useState<"active" | "departed" | "all">("active");
  const [bulkEditMode, setBulkEditMode] = useState(false);
  const [editedPlayers, setEditedPlayers] = useState<Record<string, { team?: string; position?: string }>>({});
  const [showMissingOnly, setShowMissingOnly] = useState(false);

  // Fixed scrollbar refs & sync
  const scrollbarRef = useRef<HTMLDivElement>(null);
  const scrollbarInnerRef = useRef<HTMLDivElement>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const isSyncing = useRef(false);
  const [showFixedScrollbar, setShowFixedScrollbar] = useState(false);
  const [scrollbarPos, setScrollbarPos] = useState({ left: 0, width: 0 });

  // Track table visibility and position
  useEffect(() => {
    const el = tableContainerRef.current;
    if (!el) return;
    const updatePos = () => {
      const rect = el.getBoundingClientRect();
      setScrollbarPos({ left: rect.left, width: rect.width });
    };
    const obs = new IntersectionObserver(
      ([entry]) => {
        setShowFixedScrollbar(entry.isIntersecting);
        if (entry.isIntersecting) updatePos();
      },
      { threshold: 0 },
    );
    obs.observe(el);
    window.addEventListener("resize", updatePos);
    updatePos();
    return () => {
      obs.disconnect();
      window.removeEventListener("resize", updatePos);
    };
  });

  // Sync scrollbar width
  useEffect(() => {
    const table = tableContainerRef.current;
    const inner = scrollbarInnerRef.current;
    if (!table || !inner) return;
    const sync = () => {
      inner.style.width = `${table.scrollWidth}px`;
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(table);
    return () => ro.disconnect();
  });

  const handleScrollbarScroll = useCallback(() => {
    if (isSyncing.current) return;
    isSyncing.current = true;
    if (tableContainerRef.current && scrollbarRef.current) {
      tableContainerRef.current.scrollLeft = scrollbarRef.current.scrollLeft;
    }
    requestAnimationFrame(() => {
      isSyncing.current = false;
    });
  }, []);

  const handleTableScroll = useCallback(() => {
    if (isSyncing.current) return;
    isSyncing.current = true;
    if (scrollbarRef.current && tableContainerRef.current) {
      scrollbarRef.current.scrollLeft = tableContainerRef.current.scrollLeft;
    }
    requestAnimationFrame(() => {
      isSyncing.current = false;
    });
  }, []);

  const { data: players = [], isLoading } = useQuery({
    queryKey: ["returning-players", variant, statusFilter],
    queryFn: async () => {
      // Fetch all rows using pagination to bypass the 1000-row default limit
      let allData: any[] = [];
      let from = 0;
      const PAGE_SIZE = 1000;

      while (true) {
        let query = supabase
          .from("player_predictions")
          .select(
            `
            *,
            players!inner(id, first_name, last_name, team, conference, position, class_year)
          `,
          )
          .eq("model_type", "returner")
          .eq("variant", variant)
          .range(from, from + PAGE_SIZE - 1);

        if (statusFilter !== "all") {
          query = query.eq("status", statusFilter);
        }

        const { data, error } = await query;
        if (error) throw error;

        allData = allData.concat(data || []);
        if (!data || data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }

      return (allData || []).map((row: any) => ({
        id: row.players.id,
        prediction_id: row.id,
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
          dev_aggressiveness: row.dev_aggressiveness,
          class_transition: row.class_transition,
          power_rating_plus: row.power_rating_plus,
          ev_score: row.ev_score,
          barrel_score: row.barrel_score,
          whiff_score: row.whiff_score,
          chase_score: row.chase_score,
        },
      })) as ReturnerPlayer[];
    },
  });

  const updateDevAgg = useMutation({
    mutationFn: async ({ predictionId, value }: { predictionId: string; value: number }) => {
      const { data, error } = await supabase.functions.invoke("recalculate-prediction", {
        body: { prediction_id: predictionId, dev_aggressiveness: value },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["returning-players"] });
      toast.success(
        `Recalculated — pOPS: ${data?.prediction?.p_ops?.toFixed(3) ?? "?"}, wRC+: ${data?.prediction?.p_wrc_plus ?? "?"}`,
      );
    },
    onError: (e) => toast.error(`Failed to recalculate: ${e.message}`),
  });

  const updateClassTransition = useMutation({
    mutationFn: async ({ predictionId, value }: { predictionId: string; value: string }) => {
      const { data, error } = await supabase.functions.invoke("recalculate-prediction", {
        body: { prediction_id: predictionId, class_transition: value },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["returning-players"] });
      toast.success(
        `Class updated — pOPS: ${data?.prediction?.p_ops?.toFixed(3) ?? "?"}, wRC+: ${data?.prediction?.p_wrc_plus ?? "?"}`,
      );
    },
    onError: (e) => toast.error(`Failed to update class: ${e.message}`),
  });

  const bulkSave = useMutation({
    mutationFn: async () => {
      const entries = Object.entries(editedPlayers);
      if (entries.length === 0) return;
      const results = await Promise.all(
        entries.map(([playerId, data]) => supabase.from("players").update(data).eq("id", playerId)),
      );
      const errors = results.filter((r) => r.error);
      if (errors.length > 0) throw new Error(`${errors.length} updates failed`);
      return entries.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["returning-players"] });
      setEditedPlayers({});
      setBulkEditMode(false);
      toast.success(`Updated ${count} player(s)`);
    },
    onError: (e) => toast.error(`Bulk save failed: ${e.message}`),
  });

  const handleEditField = (playerId: string, field: "team" | "position", value: string) => {
    setEditedPlayers((prev) => ({
      ...prev,
      [playerId]: { ...prev[playerId], [field]: value || null },
    }));
  };

  const positions = useMemo(() => {
    const set = new Set(players.map((p) => p.position).filter(Boolean) as string[]);
    return Array.from(set).sort();
  }, [players]);

  const filtered = useMemo(() => {
    let list = players;
    if (positionFilter !== "all") {
      list = list.filter((p) => p.position === positionFilter);
    }
    if (showMissingOnly) {
      list = list.filter((p) => !p.team);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          `${p.first_name} ${p.last_name}`.toLowerCase().includes(q) ||
          (p.team || "").toLowerCase().includes(q) ||
          (p.conference || "").toLowerCase().includes(q) ||
          (p.prediction.class_transition || "").toLowerCase().includes(q),
      );
    }
    list.sort((a, b) => {
      let aVal: number | string | null;
      let bVal: number | string | null;
      if (sortKey === "name") {
        aVal = `${a.last_name} ${a.first_name}`;
        bVal = `${b.last_name} ${b.first_name}`;
        return sortDir === "asc"
          ? (aVal as string).localeCompare(bVal as string)
          : (bVal as string).localeCompare(aVal as string);
      }
      if (sortKey === "class_transition") {
        aVal = a.prediction.class_transition || "";
        bVal = b.prediction.class_transition || "";
        return sortDir === "asc"
          ? (aVal as string).localeCompare(bVal as string)
          : (bVal as string).localeCompare(aVal as string);
      }
      aVal = a.prediction[sortKey] ?? -999;
      bVal = b.prediction[sortKey] ?? -999;
      return sortDir === "asc" ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
    return list;
  }, [players, search, sortKey, sortDir, showMissingOnly, positionFilter]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  // Summary stats
  const avgOps = players.length ? players.reduce((s, p) => s + (p.prediction.p_ops ?? 0), 0) / players.length : 0;
  const avgWrcPlus = players.length
    ? players.reduce((s, p) => s + (p.prediction.p_wrc_plus ?? 0), 0) / players.length
    : 0;
  const topPlayer = players.length
    ? [...players].sort((a, b) => (b.prediction.p_wrc_plus ?? 0) - (a.prediction.p_wrc_plus ?? 0))[0]
    : null;

  // Chart data — top 10 by pWRC+
  const chartData = useMemo(() => {
    return [...players]
      .filter((p) => p.prediction.p_wrc_plus != null)
      .sort((a, b) => (b.prediction.p_wrc_plus ?? 0) - (a.prediction.p_wrc_plus ?? 0))
      .slice(0, 10)
      .map((p) => ({
        name: `${p.first_name[0]}. ${p.last_name}`,
        wrcPlus: p.prediction.p_wrc_plus ?? 0,
        transition: p.prediction.class_transition || "—",
      }));
  }, [players]);

  const chartConfig = {
    wrcPlus: { label: "Predicted wRC+", color: "hsl(var(--primary))" },
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
            <h2 className="text-2xl font-bold tracking-tight">Returning Players</h2>
            <p className="text-muted-foreground">Projected production for returning roster players</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm"
              variant={showMissingOnly ? "default" : "outline"}
              className="h-9 text-xs"
              onClick={() => setShowMissingOnly(!showMissingOnly)}
            >
              {showMissingOnly ? "Show All" : "Missing Teams"}
            </Button>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "active" | "departed" | "all")}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="departed">Departed</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
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
        </div>

        {/* Summary cards */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Returning Players</CardTitle>
              <Users className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{players.length}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {variant === "xstats" ? "xStats" : "Regular"} variant
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Avg Predicted wRC+</CardTitle>
              <BarChart3 className="h-4 w-4 text-accent" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{avgWrcPlus.toFixed(0)}</div>
              <p className="text-xs text-muted-foreground mt-1">Avg pOPS: {avgOps.toFixed(3)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Top Projected Player</CardTitle>
              <Activity className="h-4 w-4 text-[hsl(var(--success))]" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold truncate">
                {topPlayer ? `${topPlayer.first_name} ${topPlayer.last_name}` : "—"}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {topPlayer
                  ? `pWRC+: ${pctFormat(topPlayer.prediction.p_wrc_plus)} · ${classTransitionLabel[topPlayer.prediction.class_transition || ""] || topPlayer.prediction.class_transition || "—"}`
                  : "No data"}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Chart — Top 10 by pWRC+ */}
        {chartData.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top 10 Projected wRC+</CardTitle>
              <CardDescription>Predicted production for top returning players (100 = league average)</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={chartConfig} className="h-[280px]">
                <BarChart data={chartData} layout="vertical" margin={{ left: 80, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" domain={[0, "auto"]} />
                  <YAxis type="category" dataKey="name" width={75} tick={{ fontSize: 12 }} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="wrcPlus" radius={[0, 4, 4, 0]} fill="hsl(var(--primary))">
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
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">Player Projections</CardTitle>
              {bulkEditMode ? (
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="default"
                    className="h-7 text-xs"
                    onClick={() => bulkSave.mutate()}
                    disabled={Object.keys(editedPlayers).length === 0 || bulkSave.isPending}
                  >
                    <Save className="h-3 w-3 mr-1" />
                    Save {Object.keys(editedPlayers).length > 0 ? `(${Object.keys(editedPlayers).length})` : ""}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => {
                      setBulkEditMode(false);
                      setEditedPlayers({});
                    }}
                  >
                    <X className="h-3 w-3 mr-1" />
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setBulkEditMode(true)}>
                  <Pencil className="h-3 w-3 mr-1" />
                  Bulk Edit
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Select value={positionFilter} onValueChange={setPositionFilter}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="Position" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Positions</SelectItem>
                  {positions.map((pos) => (
                    <SelectItem key={pos} value={pos}>
                      {pos}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search players, teams..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">Loading projections…</div>
            ) : filtered.length === 0 ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">No players found</div>
            ) : (
              <>
                <div
                  ref={tableContainerRef}
                  onScroll={handleTableScroll}
                  className="overflow-x-auto [&::-webkit-scrollbar]:hidden overflow-y-auto max-h-[70vh]"
                  style={{ scrollbarWidth: "none" }}
                >
                  <Table>
                    <TableHeader className="sticky top-0 z-20 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
                      <TableRow>
                        <TableHead className="min-w-[160px] sticky left-0 z-30 bg-background">
                          <SortButton label="Player" sortKeyVal="name" />
                        </TableHead>
                        <TableHead className="min-w-[120px]">Team</TableHead>
                        <TableHead className="min-w-[80px]">Pos</TableHead>
                        <TableHead>
                          <SortButton label="Year" sortKeyVal="class_transition" />
                        </TableHead>
                        <TableHead className="min-w-[120px]">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-help font-medium text-muted-foreground">Dev Confidence</span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs">
                              <p className="text-xs">
                                Adjusts the developmental weight applied to projections. 0 = no growth, 0.5 = moderate,
                                1.0 = full confidence.
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TableHead>
                        <TableHead className="text-right">
                          <SortButton label="Prev AVG" sortKeyVal="p_avg" />
                        </TableHead>
                        <TableHead className="text-right">
                          <SortButton label="Prev OBP" sortKeyVal="p_obp" />
                        </TableHead>
                        <TableHead className="text-right">
                          <SortButton label="Prev SLG" sortKeyVal="p_slg" />
                        </TableHead>
                        <TableHead className="text-right">
                          <SortButton label="pAVG" sortKeyVal="p_avg" />
                        </TableHead>
                        <TableHead className="text-right">
                          <SortButton label="pOBP" sortKeyVal="p_obp" />
                        </TableHead>
                        <TableHead className="text-right">
                          <SortButton label="pSLG" sortKeyVal="p_slg" />
                        </TableHead>
                        <TableHead className="text-right">
                          <SortButton label="pOPS" sortKeyVal="p_ops" />
                        </TableHead>
                        <TableHead className="text-right">
                          <SortButton label="pISO" sortKeyVal="p_iso" />
                        </TableHead>
                        <TableHead className="text-right">
                          <SortButton label="pWRC+" sortKeyVal="p_wrc_plus" />
                        </TableHead>
                        <TableHead className="text-right">
                          <SortButton label="PWR+" sortKeyVal="power_rating_plus" />
                        </TableHead>
                        <TableHead className="text-center min-w-[180px]">Scout Grades</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((p) => {
                        const pred = p.prediction;
                        return (
                          <TableRow key={p.prediction_id}>
                            <TableCell className="font-medium whitespace-nowrap sticky left-0 z-10 bg-background">
                              <Link
                                to={`/dashboard/player/${p.id}`}
                                className="hover:text-primary hover:underline transition-colors"
                              >
                                {p.first_name} {p.last_name}
                              </Link>
                            </TableCell>
                            <TableCell>
                              {bulkEditMode ? (
                                <Input
                                  className="h-7 w-[130px] text-xs"
                                  defaultValue={editedPlayers[p.id]?.team ?? p.team ?? ""}
                                  placeholder="Team"
                                  onBlur={(e) => {
                                    const val = e.target.value.trim();
                                    if (val !== (p.team ?? "")) handleEditField(p.id, "team", val);
                                  }}
                                />
                              ) : (
                                <span className="text-xs text-muted-foreground">{p.team || "—"}</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {bulkEditMode ? (
                                <Input
                                  className="h-7 w-[70px] text-xs"
                                  defaultValue={editedPlayers[p.id]?.position ?? p.position ?? ""}
                                  placeholder="Pos"
                                  onBlur={(e) => {
                                    const val = e.target.value.trim();
                                    if (val !== (p.position ?? "")) handleEditField(p.id, "position", val);
                                  }}
                                />
                              ) : (
                                <span className="text-xs text-muted-foreground">{p.position || "—"}</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <ClassTransitionSelector
                                value={pred.class_transition || "FS"}
                                onChange={(v) =>
                                  updateClassTransition.mutate({ predictionId: p.prediction_id, value: v })
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <DevConfidenceSelector
                                value={pred.dev_aggressiveness ?? 1}
                                onChange={(v) => updateDevAgg.mutate({ predictionId: p.prediction_id, value: v })}
                              />
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs text-muted-foreground">
                              {statFormat(pred.from_avg)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs text-muted-foreground">
                              {statFormat(pred.from_obp)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs text-muted-foreground">
                              {statFormat(pred.from_slg)}
                            </TableCell>
                            <TableCell
                              className={`text-right font-mono text-sm font-semibold ${deltaColor(pred.from_avg, pred.p_avg)}`}
                            >
                              {statFormat(pred.p_avg)}
                              <DeltaIndicator from={pred.from_avg} to={pred.p_avg} />
                            </TableCell>
                            <TableCell
                              className={`text-right font-mono text-sm font-semibold ${deltaColor(pred.from_obp, pred.p_obp)}`}
                            >
                              {statFormat(pred.p_obp)}
                              <DeltaIndicator from={pred.from_obp} to={pred.p_obp} />
                            </TableCell>
                            <TableCell
                              className={`text-right font-mono text-sm font-semibold ${deltaColor(pred.from_slg, pred.p_slg)}`}
                            >
                              {statFormat(pred.p_slg)}
                              <DeltaIndicator from={pred.from_slg} to={pred.p_slg} />
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm font-bold">
                              {statFormat(pred.p_ops)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">{statFormat(pred.p_iso)}</TableCell>
                            <TableCell className="text-right font-mono text-sm font-bold">
                              {pctFormat(pred.p_wrc_plus)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {pctFormat(pred.power_rating_plus)}
                            </TableCell>
                            <TableCell className="text-center">
                              <div className="flex gap-1 justify-center flex-wrap">
                                {pred.ev_score != null && <ScoutBadge label="EV" value={pred.ev_score} />}
                                {pred.barrel_score != null && <ScoutBadge label="Brl" value={pred.barrel_score} />}
                                {pred.whiff_score != null && <ScoutBadge label="Whf" value={pred.whiff_score} />}
                                {pred.chase_score != null && <ScoutBadge label="Chs" value={pred.chase_score} />}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                {showFixedScrollbar && (
                  <div
                    ref={scrollbarRef}
                    onScroll={handleScrollbarScroll}
                    className="fixed bottom-0 z-50 overflow-x-auto overflow-y-hidden bg-background/95 backdrop-blur border-t border-border"
                    style={{
                      height: 18,
                      left: scrollbarPos.left,
                      width: scrollbarPos.width || "100%",
                    }}
                  >
                    <div ref={scrollbarInnerRef} style={{ height: 1 }} />
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

const CLASS_OPTIONS = [
  { value: "FS", label: "FR → SO" },
  { value: "SJ", label: "SO → JR" },
  { value: "JS", label: "JR → SR" },
  { value: "GR", label: "Graduate" },
] as const;

function ClassTransitionSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-7 w-[100px] text-xs font-mono px-2">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {CLASS_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value} className="text-xs font-mono">
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ScoutBadge({ label, value }: { label: string; value: number }) {
  const tier =
    value >= 80
      ? "bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]"
      : value >= 50
        ? "bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))]"
        : "bg-destructive/15 text-destructive";
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${tier}`}
      title={`${label}: ${value}`}
    >
      {label} {value}
    </span>
  );
}

const DEV_OPTIONS = [
  { value: 0, label: "0.0", desc: "No development expected" },
  { value: 0.5, label: "0.5", desc: "Moderate growth" },
  { value: 1, label: "1.0", desc: "Full confidence" },
] as const;

function DevConfidenceSelector({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-0.5">
      {DEV_OPTIONS.map((opt) => {
        const isActive = value === opt.value;
        return (
          <Tooltip key={opt.value}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onChange(opt.value)}
                className={`rounded px-2 py-1 text-xs font-mono font-semibold transition-colors ${
                  isActive
                    ? opt.value === 0
                      ? "bg-destructive/15 text-destructive"
                      : opt.value === 0.5
                        ? "bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))]"
                        : "bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {opt.label}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p className="text-xs">{opt.desc}</p>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
