import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowUpDown, Search, X } from "lucide-react";
import { profileRouteFor } from "@/lib/profileRoutes";
import { cn } from "@/lib/utils";

const statFormat = (v: number | null | undefined, decimals = 3) => {
  if (v == null) return "—";
  return v.toFixed(decimals);
};

const ScoutMiniBox = ({ label, value }: { label: string; value: number | null }) => {
  if (value == null) return null;
  const tier =
    value >= 80
      ? "bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]"
      : value >= 50
        ? "bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))]"
        : "bg-destructive/15 text-destructive";
  return (
    <div
      className={`inline-flex min-w-[34px] flex-col items-center rounded px-1 py-0.5 leading-tight ${tier}`}
      title={`${label}: ${value}`}
    >
      <span className="text-[9px] font-semibold">{label}</span>
      <span className="text-[10px] font-bold">{Math.round(value)}</span>
    </div>
  );
};

type SortKey = "name" | "team" | "avg" | "obp" | "slg" | "ops" | "iso" | "wrc";

// wRC+ formula: linear weights from the projection engine
// wRC = (0.45 × OBP) + (0.30 × SLG) + (0.15 × AVG) + (0.10 × ISO)
const computeWrcPlus = (
  avg: number | null,
  obp: number | null,
  slg: number | null,
  iso: number | null,
  ncaaWrc: number | null,
): number | null => {
  if (avg == null || obp == null || slg == null || iso == null || ncaaWrc == null || ncaaWrc <= 0) return null;
  const wrc = (0.45 * obp) + (0.30 * slg) + (0.15 * avg) + (0.10 * iso);
  return Math.round((wrc / ncaaWrc) * 100);
};
type SortDir = "asc" | "desc";

const HITTER_POSITIONS = ["C", "1B", "2B", "SS", "3B", "LF", "CF", "RF", "DH", "OF", "IF", "UTIL"];

const positionMatches = (rowPos: string | null, filters: Set<string>): boolean => {
  if (filters.size === 0) return true;
  if (!rowPos) return false;
  const p = rowPos.toUpperCase().trim();
  for (const f of filters) {
    if (p === f) return true;
    if (f === "OF" && (p === "LF" || p === "CF" || p === "RF" || p === "OF")) return true;
    if (f === "IF" && (p === "1B" || p === "2B" || p === "SS" || p === "3B" || p === "IF")) return true;
  }
  return false;
};

export function HistoricalPlayerTable({ season, onPlayerClick }: { season: number; onPlayerClick?: () => void }) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("avg");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [positionFilters, setPositionFilters] = useState<Set<string>>(new Set());

  const togglePosition = (pos: string) => {
    setPositionFilters((prev) => {
      const next = new Set(prev);
      if (next.has(pos)) next.delete(pos);
      else next.add(pos);
      return next;
    });
  };

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim().toLowerCase()), 220);
    return () => clearTimeout(t);
  }, [search]);

  // Reset page when filters/sort/season change
  useEffect(() => { setPage(1); }, [debouncedSearch, sortKey, sortDir, season, positionFilters]);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["historical-hitters", season],
    queryFn: async () => {
      // Supabase caps single queries at ~1000 rows by default — chunk with .range()
      const all: any[] = [];
      const pageSize = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("Hitter Master")
          .select(`source_player_id, playerFullName, Team, Conference, Pos, BatHand,
                   pa, ab, AVG, OBP, SLG, ISO,
                   contact_score, line_drive_score, avg_ev_score, bb_score,
                   chase_score, barrel_score, ev90_score, pull_score, la_score, gb_score`)
          .eq("Season", season)
          .gte("ab", 75)
          .order("pa", { ascending: false })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
      }
      return all;
    },
  });

  // Fetch the NCAA wRC mean for this season — used as the wRC+ denominator
  const { data: ncaaWrc } = useQuery({
    queryKey: ["ncaa-wrc-mean", season],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ncaa_averages" as any)
        .select("wrc")
        .eq("season", season)
        .maybeSingle();
      if (error) return null;
      return (data as any)?.wrc ?? null;
    },
  });

  // Decorate rows with computed OPS and wRC+
  const decorated = useMemo(() => {
    return (rows as any[]).map((r) => {
      const ops = r.OBP != null && r.SLG != null ? r.OBP + r.SLG : null;
      const wrc = computeWrcPlus(r.AVG, r.OBP, r.SLG, r.ISO, ncaaWrc);
      return { ...r, _ops: ops, _wrc: wrc };
    });
  }, [rows, ncaaWrc]);

  const filteredSorted = useMemo(() => {
    let r = decorated;
    if (positionFilters.size > 0) {
      r = r.filter((row) => positionMatches(row.Pos, positionFilters));
    }
    if (debouncedSearch) {
      r = r.filter((row) => {
        const name = (row.playerFullName || "").toLowerCase();
        const team = (row.Team || "").toLowerCase();
        const pos = (row.Pos || "").toLowerCase();
        return name.includes(debouncedSearch) || team.includes(debouncedSearch) || pos.includes(debouncedSearch);
      });
    }
    const dir = sortDir === "asc" ? 1 : -1;
    const get = (row: any) => {
      switch (sortKey) {
        case "name": return row.playerFullName || "";
        case "team": return row.Team || "";
        case "avg": return row.AVG ?? -1;
        case "obp": return row.OBP ?? -1;
        case "slg": return row.SLG ?? -1;
        case "ops": return row._ops ?? -1;
        case "iso": return row.ISO ?? -1;
        case "wrc": return row._wrc ?? -1;
        default: return 0;
      }
    };
    return [...r].sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      if (typeof av === "string") return dir * av.localeCompare(bv as string);
      return dir * ((av as number) - (bv as number));
    });
  }, [decorated, debouncedSearch, sortKey, sortDir, positionFilters]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir(k === "name" || k === "team" ? "asc" : "desc"); }
  };

  const SortButton = ({ label, k }: { label: string; k: SortKey }) => (
    <Button
      variant="ghost"
      size="sm"
      className="h-auto p-0 font-medium text-muted-foreground hover:text-foreground -ml-1"
      onClick={() => toggleSort(k)}
    >
      {label}
      <ArrowUpDown className="ml-1 h-3 w-3" />
    </Button>
  );

  return (
    <div className="space-y-2">
      <div className="space-y-2">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search players, teams, positions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-8 h-9 text-sm rounded-lg border-border/60 focus-visible:ring-primary/30"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 items-center">
          <button
            onClick={() => setPositionFilters(new Set())}
            className={cn(
              "px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer",
              positionFilters.size === 0
                ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
            )}
          >
            All
          </button>
          {HITTER_POSITIONS.map((pos) => (
            <button
              key={pos}
              onClick={() => togglePosition(pos)}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer",
                positionFilters.has(pos)
                  ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                  : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
              )}
            >
              {pos}
            </button>
          ))}
          {positionFilters.size > 1 && (
            <span className="text-[10px] text-muted-foreground ml-1">{positionFilters.size} selected</span>
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">Player Stats</CardTitle>
            <span className="text-[10px] font-semibold uppercase tracking-wider rounded-full px-2 py-0.5 bg-muted text-muted-foreground">
              {season} · Historical
            </span>
          </div>
          <PaginationControls
            total={filteredSorted.length}
            page={page}
            pageSize={pageSize}
            onPage={setPage}
          />
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">Loading {season} players…</div>
          ) : filteredSorted.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">No players found for {season}</div>
          ) : (
            <div className="overflow-x-auto [&::-webkit-scrollbar]:hidden overflow-y-auto max-h-[70vh]" style={{ scrollbarWidth: "none" }}>
              <Table>
                <TableHeader className="sticky top-0 z-20 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
                  <TableRow>
                    <TableHead className="min-w-[140px] sticky left-0 z-30 bg-background"><SortButton label="Player" k="name" /></TableHead>
                    <TableHead className="text-right text-xs"><SortButton label="AVG" k="avg" /></TableHead>
                    <TableHead className="text-right text-xs"><SortButton label="OBP" k="obp" /></TableHead>
                    <TableHead className="text-right text-xs"><SortButton label="SLG" k="slg" /></TableHead>
                    <TableHead className="text-right text-xs"><SortButton label="OPS" k="ops" /></TableHead>
                    <TableHead className="text-right text-xs"><SortButton label="ISO" k="iso" /></TableHead>
                    <TableHead className="text-right text-xs"><SortButton label="wRC+" k="wrc" /></TableHead>
                    <TableHead className="text-center min-w-[160px] text-xs">Scouting</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSorted.slice((page - 1) * pageSize, page * pageSize).map((r, i) => {
                    const id = r.source_player_id || `hm-${i}`;
                    return (
                      <TableRow key={`${id}-${i}`} className="cursor-pointer hover:bg-muted/50 transition-colors">
                        <TableCell className="font-medium whitespace-nowrap sticky left-0 z-10 bg-background">
                          <Link
                            to={profileRouteFor(id, r.Pos)}
                            onClick={onPlayerClick}
                            className="hover:text-primary hover:underline transition-colors"
                          >
                            {r.playerFullName}
                          </Link>
                          <div className="text-xs text-muted-foreground">
                            {[r.Pos, r.Team].filter(Boolean).join(" · ") || "—"}
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{statFormat(r.AVG)}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{statFormat(r.OBP)}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{statFormat(r.SLG)}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{statFormat(r._ops)}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{statFormat(r.ISO)}</TableCell>
                        <TableCell className="text-right text-sm font-semibold tabular-nums">{r._wrc ?? "—"}</TableCell>
                        <TableCell className="text-center p-1">
                          <div className="flex gap-0.5 justify-center">
                            <ScoutMiniBox label="Brl" value={r.barrel_score} />
                            <ScoutMiniBox label="EV" value={r.avg_ev_score} />
                            <ScoutMiniBox label="Con" value={r.contact_score} />
                            <ScoutMiniBox label="Chs" value={r.chase_score} />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          <BottomRowsBar
            total={filteredSorted.length}
            page={page}
            pageSize={pageSize}
            onPageSize={(s) => { setPageSize(s); setPage(1); }}
            label="players"
          />
        </CardContent>
      </Card>
    </div>
  );
}

// Top-right page number buttons (for use in CardHeader)
function PaginationControls({
  total, page, pageSize, onPage,
}: {
  total: number;
  page: number;
  pageSize: number;
  onPage: (p: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const visiblePages: number[] = [];
  const add = (n: number) => { if (!visiblePages.includes(n) && n >= 1 && n <= totalPages) visiblePages.push(n); };
  for (let i = 1; i <= Math.min(5, totalPages); i++) add(i);
  add(page - 1); add(page); add(page + 1);
  for (let i = totalPages - 1; i <= totalPages; i++) add(i);
  visiblePages.sort((a, b) => a - b);
  return (
    <div className="flex items-center gap-1 overflow-x-auto max-w-[360px]">
      {visiblePages.map((p, i) => {
        const prev = visiblePages[i - 1];
        const showGap = i > 0 && prev != null && p - prev > 1;
        return (
          <div key={p} className="flex items-center gap-1">
            {showGap ? <span className="px-1 text-muted-foreground text-xs">...</span> : null}
            <Button
              variant={p === page ? "default" : "outline"}
              size="sm"
              className="h-6 min-w-6 px-1.5 text-[10px]"
              onClick={() => onPage(p)}
            >
              {p}
            </Button>
          </div>
        );
      })}
    </div>
  );
}

// Bottom "Showing X-Y of N" + Rows selector (matches 2025 style)
function BottomRowsBar({
  total, page, pageSize, onPageSize, label,
}: {
  total: number;
  page: number;
  pageSize: number;
  onPageSize: (s: number) => void;
  label: string;
}) {
  if (total === 0) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return (
    <div className="flex flex-col gap-2 border-t px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="text-muted-foreground">
        Showing{" "}
        <span className="font-medium text-foreground">{start}</span>
        {" - "}
        <span className="font-medium text-foreground">{end}</span>
        {" of "}
        <span className="font-medium text-foreground">{total}</span>
        {" "}{label}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">Rows</span>
        <Select value={String(pageSize)} onValueChange={(v) => onPageSize(Number(v))}>
          <SelectTrigger className="h-8 w-[88px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="50">50</SelectItem>
            <SelectItem value="100">100</SelectItem>
            <SelectItem value="250">250</SelectItem>
            <SelectItem value="500">500</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

export function HistoricalPitcherTable({ season, onPlayerClick }: { season: number; onPlayerClick?: () => void }) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortKey, setSortKey] = useState<"name" | "era" | "fip" | "whip" | "k9" | "bb9" | "hr9" | "ip">("era");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [roleFilter, setRoleFilter] = useState<"all" | "SP" | "RP">("all");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim().toLowerCase()), 220);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => { setPage(1); }, [debouncedSearch, sortKey, sortDir, season, roleFilter]);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["historical-pitchers", season],
    queryFn: async () => {
      const all: any[] = [];
      const pageSize = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("Pitching Master")
          .select(`source_player_id, playerFullName, Team, Conference, ThrowHand,
                   IP, G, GS, ERA, FIP, WHIP, K9, BB9, HR9, stuff_plus,
                   whiff_score, bb_score, barrel_score, hh_score, Role`)
          .eq("Season", season)
          .gte("IP", 20)
          .not("Role", "in", "(C,1B,2B,3B,SS,OF,LF,CF,RF,DH,IF,UT)")
          .order("IP", { ascending: false })
          .range(from, from + pageSize - 1);
        if (error) {
          console.error("[HistoricalPitcherTable] Query error:", error);
          throw error;
        }
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
      }
      return all;
    },
  });

  const filteredSorted = useMemo(() => {
    let r = rows as any[];
    if (roleFilter === "SP") {
      r = r.filter((row) => Number(row.GS ?? 0) > 0);
    } else if (roleFilter === "RP") {
      r = r.filter((row) => Number(row.GS ?? 0) === 0);
    }
    if (debouncedSearch) {
      r = r.filter((row) => {
        const name = (row.playerFullName || "").toLowerCase();
        const team = (row.Team || "").toLowerCase();
        return name.includes(debouncedSearch) || team.includes(debouncedSearch);
      });
    }
    const dir = sortDir === "asc" ? 1 : -1;
    const get = (row: any) => {
      switch (sortKey) {
        case "name": return row.playerFullName || "";
        case "ip": return row.IP ?? -1;
        case "era": return row.ERA ?? 99;
        case "fip": return row.FIP ?? 99;
        case "whip": return row.WHIP ?? 99;
        case "k9": return row.K9 ?? -1;
        case "bb9": return row.BB9 ?? 99;
        case "hr9": return row.HR9 ?? 99;
        default: return 0;
      }
    };
    return [...r].sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      if (typeof av === "string") return dir * av.localeCompare(bv as string);
      return dir * ((av as number) - (bv as number));
    });
  }, [rows, debouncedSearch, sortKey, sortDir, roleFilter]);

  const toggleSort = (k: typeof sortKey) => {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(k);
      // Lower-is-better for ERA/FIP/WHIP/BB9/HR9
      setSortDir(k === "k9" || k === "ip" || k === "name" ? "desc" : "asc");
    }
  };

  const SortButton = ({ label, k }: { label: string; k: typeof sortKey }) => (
    <Button
      variant="ghost"
      size="sm"
      className="h-auto p-0 font-medium text-muted-foreground hover:text-foreground -ml-1"
      onClick={() => toggleSort(k)}
    >
      {label}
      <ArrowUpDown className="ml-1 h-3 w-3" />
    </Button>
  );

  return (
    <div className="space-y-2">
      <div className="space-y-2">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search pitchers, teams..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-8 h-9 text-sm rounded-lg border-border/60 focus-visible:ring-primary/30"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 items-center">
          {(["all", "SP", "RP"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRoleFilter(r)}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer",
                roleFilter === r
                  ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                  : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
              )}
            >
              {r === "all" ? "All" : r}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">Pitcher Stats</CardTitle>
            <span className="text-[10px] font-semibold uppercase tracking-wider rounded-full px-2 py-0.5 bg-muted text-muted-foreground">
              {season} · Historical
            </span>
          </div>
          <PaginationControls
            total={filteredSorted.length}
            page={page}
            pageSize={pageSize}
            onPage={setPage}
          />
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">Loading {season} pitchers…</div>
          ) : filteredSorted.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">No pitchers found for {season}</div>
          ) : (
            <div className="overflow-x-auto [&::-webkit-scrollbar]:hidden overflow-y-auto max-h-[70vh]" style={{ scrollbarWidth: "none" }}>
              <Table>
                <TableHeader className="sticky top-0 z-20 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
                  <TableRow>
                    <TableHead className="min-w-[160px] sticky left-0 z-30 bg-background"><SortButton label="Pitcher" k="name" /></TableHead>
                    <TableHead className="text-right text-xs"><SortButton label="ERA" k="era" /></TableHead>
                    <TableHead className="text-right text-xs"><SortButton label="FIP" k="fip" /></TableHead>
                    <TableHead className="text-right text-xs"><SortButton label="WHIP" k="whip" /></TableHead>
                    <TableHead className="text-right text-xs"><SortButton label="K/9" k="k9" /></TableHead>
                    <TableHead className="text-right text-xs"><SortButton label="BB/9" k="bb9" /></TableHead>
                    <TableHead className="text-right text-xs"><SortButton label="HR/9" k="hr9" /></TableHead>
                    <TableHead className="text-center min-w-[160px] text-xs">Scouting</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSorted.slice((page - 1) * pageSize, page * pageSize).map((r, i) => {
                    const id = r.source_player_id || `pm-${i}`;
                    return (
                      <TableRow key={`${id}-${i}`} className="cursor-pointer hover:bg-muted/50 transition-colors">
                        <TableCell className="font-medium whitespace-nowrap sticky left-0 z-10 bg-background">
                          <Link
                            to={`/dashboard/pitcher/${encodeURIComponent(id)}`}
                            onClick={onPlayerClick}
                            className="hover:text-primary hover:underline transition-colors"
                          >
                            {r.playerFullName}
                          </Link>
                          <div className="text-xs text-muted-foreground">
                            {(() => {
                              const hand = r.ThrowHand === "R" ? "RHP" : r.ThrowHand === "L" ? "LHP" : null;
                              return [hand, r.Team].filter(Boolean).join(" · ") || "—";
                            })()}
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{r.ERA == null ? "—" : Number(r.ERA).toFixed(2)}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{r.FIP == null ? "—" : Number(r.FIP).toFixed(2)}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{r.WHIP == null ? "—" : Number(r.WHIP).toFixed(2)}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{r.K9 == null ? "—" : Number(r.K9).toFixed(2)}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{r.BB9 == null ? "—" : Number(r.BB9).toFixed(2)}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{r.HR9 == null ? "—" : Number(r.HR9).toFixed(2)}</TableCell>
                        <TableCell className="text-center p-1">
                          <div className="flex gap-0.5 justify-center">
                            <ScoutMiniBox label="Whf" value={r.whiff_score} />
                            <ScoutMiniBox label="BB%" value={r.bb_score} />
                            <ScoutMiniBox label="Brl" value={r.barrel_score} />
                            <ScoutMiniBox label="HH" value={r.hh_score} />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          <BottomRowsBar
            total={filteredSorted.length}
            page={page}
            pageSize={pageSize}
            onPageSize={(s) => { setPageSize(s); setPage(1); }}
            label="pitchers"
          />
        </CardContent>
      </Card>
    </div>
  );
}
