/**
 * The War Room: DraftIQ
 *
 * Coach-facing view of every draft-eligible player carrying a slot value —
 * both D1/JUCO college players and HS prospects committed to D1 programs.
 * No projections, no stats: identity + draft rank + slot $ + click-through
 * to the player profile (college) or to a TBD HS prospect view.
 *
 * Visual + interaction parity with Player Dashboard (ReturningPlayers).
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpDown, Check, ChevronDown, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────

type SlotRow = {
  id: string;
  player_id: string | null;
  draft_year: number;
  rank: number | null;
  player_name: string;
  current_school: string | null;
  commitment_school: string | null;
  is_high_school: boolean;
  position: string | null;
  slot_value: number;
};

type EnrichedRow = SlotRow & {
  team: string | null;
  conference: string | null;
  division: string | null;
  portal_status: string | null;
  player_position: string | null;
};

type SortKey = "rank" | "name" | "school" | "commitment" | "slot_value";

// ─── Multi-select chip ────────────────────────────────────────────────────

function MultiSelectFilter<T extends string>({
  label,
  options,
  selected,
  onToggle,
  onClear,
  triggerWidth = "auto",
  searchable = false,
}: {
  label: string;
  options: { value: T; label: string }[];
  selected: Set<T>;
  onToggle: (v: T) => void;
  onClear: () => void;
  triggerWidth?: string;
  searchable?: boolean;
}) {
  const [query, setQuery] = useState("");
  const filteredOptions = useMemo(() => {
    if (!searchable || !query.trim()) return options;
    const needle = query.trim().toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(needle));
  }, [options, query, searchable]);
  const count = selected.size;
  const summary =
    count === 0 ? "All" :
    count === 1 ? options.find((o) => o.value === Array.from(selected)[0])?.label ?? `${count}` :
    `${count} selected`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          style={{ minWidth: triggerWidth }}
          className={cn(
            "h-8 inline-flex items-center justify-between gap-2 rounded-md border px-2.5 text-xs font-medium transition-colors duration-150 cursor-pointer",
            count > 0
              ? "border-[#D4AF37]/60 bg-[#D4AF37]/10 text-[#D4AF37] hover:bg-[#D4AF37]/15"
              : "border-border bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground",
          )}
        >
          <span className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.08em] opacity-80">{label}</span>
            <span className="font-semibold truncate max-w-[140px]">{summary}</span>
          </span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-64 p-2 max-h-[360px] overflow-y-auto">
        <div className="flex items-center justify-between mb-1.5 px-1">
          <span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{label}</span>
          {count > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="text-[10px] uppercase tracking-[0.08em] text-[#D4AF37] hover:text-[#c49e2e] transition-colors cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>
        {searchable && (
          <div className="relative mb-1.5 px-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search..."
              className="w-full h-7 pl-7 pr-2 text-xs rounded-sm border border-border bg-background focus:outline-none focus:ring-1 focus:ring-[#D4AF37]/60"
            />
          </div>
        )}
        <div className="flex flex-col">
          {filteredOptions.length === 0 && searchable && (
            <div className="px-2 py-2 text-[11px] text-muted-foreground text-center">No matches</div>
          )}
          {filteredOptions.map((opt) => {
            const checked = selected.has(opt.value);
            return (
              <button
                type="button"
                key={String(opt.value)}
                onClick={() => onToggle(opt.value)}
                className={cn(
                  "flex items-center gap-2 px-2 py-1.5 rounded-sm text-xs transition-colors duration-150 cursor-pointer text-left",
                  checked ? "bg-[#D4AF37]/10 text-foreground" : "text-foreground hover:bg-muted/60",
                )}
              >
                <span
                  className={cn(
                    "h-3.5 w-3.5 inline-flex items-center justify-center rounded-sm border",
                    checked
                      ? "bg-[#D4AF37] border-[#D4AF37] text-[#040810]"
                      : "border-border bg-background",
                  )}
                >
                  {checked && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                </span>
                <span className="font-medium">{opt.label}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Position bucketing ───────────────────────────────────────────────────

const POSITION_BUCKETS = {
  C:   ["C"],
  IF:  ["1B", "2B", "3B", "SS", "INF"],
  OF:  ["LF", "RF", "CF", "OF"],
  P:   ["SP", "RP", "P", "LHP", "RHP", "CL"],
} as const;
type PositionBucket = keyof typeof POSITION_BUCKETS;

function formatSlotCompact(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2).replace(/\.?0+$/, "")}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

function positionBucket(pos: string | null | undefined): PositionBucket | null {
  if (!pos) return null;
  const up = pos.toUpperCase().trim();
  for (const [bucket, list] of Object.entries(POSITION_BUCKETS)) {
    if ((list as readonly string[]).some((p) => up === p || up.includes(p))) return bucket as PositionBucket;
  }
  return null;
}

// ─── Page ─────────────────────────────────────────────────────────────────

export default function WarRoom() {
  const navigate = useNavigate();

  const { data: slotRows = [], isLoading: loadingSlots } = useQuery({
    queryKey: ["war-room-slot-values"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_slot_values" as any)
        .select("id, player_id, draft_year, rank, player_name, current_school, commitment_school, is_high_school, position, slot_value")
        .order("rank", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as unknown as SlotRow[];
    },
  });

  const matchedPlayerIds = useMemo(
    () => slotRows.filter((r) => !!r.player_id).map((r) => r.player_id!),
    [slotRows],
  );

  const { data: playersById = new Map<string, any>() } = useQuery({
    queryKey: ["war-room-players-enrichment", matchedPlayerIds.length],
    enabled: matchedPlayerIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("players")
        .select("id, team, conference, division, portal_status, position")
        .in("id", matchedPlayerIds);
      if (error) throw error;
      const map = new Map<string, any>();
      for (const p of data ?? []) map.set(p.id as string, p);
      return map;
    },
  });

  const enriched: EnrichedRow[] = useMemo(
    () => slotRows.map((r) => {
      const p = r.player_id ? playersById.get(r.player_id) : null;
      return {
        ...r,
        team: p?.team ?? null,
        conference: p?.conference ?? null,
        division: p?.division ?? null,
        portal_status: p?.portal_status ?? null,
        player_position: p?.position ?? null,
      };
    }),
    [slotRows, playersById],
  );

  // ─── Filter state ────────────────────────────────────────────────────

  const [search, setSearch] = useState("");

  const [schoolFilters, setSchoolFilters] = useState<Set<string>>(new Set());
  const toggleSchool = (v: string) =>
    setSchoolFilters((prev) => {
      const next = new Set(prev);
      next.has(v) ? next.delete(v) : next.add(v);
      return next;
    });

  type PortalKey = "IN PORTAL" | "COMMITTED";
  const [portalFilters, setPortalFilters] = useState<Set<PortalKey>>(new Set());
  const togglePortal = (v: PortalKey) =>
    setPortalFilters((prev) => {
      const next = new Set(prev);
      next.has(v) ? next.delete(v) : next.add(v);
      return next;
    });

  const [positionFilters, setPositionFilters] = useState<Set<PositionBucket>>(new Set());
  const togglePosition = (v: PositionBucket) =>
    setPositionFilters((prev) => {
      const next = new Set(prev);
      next.has(v) ? next.delete(v) : next.add(v);
      return next;
    });

  type LevelKey = "College" | "HS";
  const [levelFilters, setLevelFilters] = useState<Set<LevelKey>>(new Set());
  const toggleLevel = (v: LevelKey) =>
    setLevelFilters((prev) => {
      const next = new Set(prev);
      next.has(v) ? next.delete(v) : next.add(v);
      return next;
    });

  const schoolOptions = useMemo(() => {
    const set = new Set<string>();
    const isReal = (s: string | null) => {
      const t = (s ?? "").trim();
      return t.length > 0 && t !== "—" && t !== "-" && t !== "–";
    };
    for (const r of enriched) {
      if (isReal(r.current_school) && !r.is_high_school) set.add(r.current_school!);
      if (isReal(r.commitment_school)) set.add(r.commitment_school!);
    }
    return Array.from(set).sort().map((s) => ({ value: s, label: s }));
  }, [enriched]);

  // ─── Sort state ──────────────────────────────────────────────────────

  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "slot_value" ? "desc" : "asc"); }
  };

  // ─── Filter + sort ───────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = enriched.filter((r) => {
      if (needle) {
        const hay = [r.player_name, r.current_school, r.commitment_school].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      if (schoolFilters.size > 0) {
        const inCurrent = !r.is_high_school && r.current_school && schoolFilters.has(r.current_school);
        const inCommit = r.commitment_school && schoolFilters.has(r.commitment_school);
        if (!inCurrent && !inCommit) return false;
      }
      if (portalFilters.size > 0) {
        const s = (r.portal_status ?? "").toUpperCase();
        if (!portalFilters.has(s as PortalKey)) return false;
      }
      if (positionFilters.size > 0) {
        const bucket = positionBucket(r.player_position ?? r.position ?? null);
        if (!bucket || !positionFilters.has(bucket)) return false;
      }
      if (levelFilters.size > 0) {
        const level: LevelKey = r.is_high_school ? "HS" : "College";
        if (!levelFilters.has(level)) return false;
      }
      return true;
    });

    const get = (r: EnrichedRow, k: SortKey): string | number | null => {
      if (k === "rank") return r.rank ?? Number.MAX_SAFE_INTEGER;
      if (k === "name") return r.player_name.toLowerCase();
      if (k === "school") return (r.current_school ?? "").toLowerCase();
      if (k === "commitment") return r.is_high_school ? (r.commitment_school ?? "").toLowerCase() : "zzzz"; // college rows sort last
      if (k === "slot_value") return r.slot_value;
      return null;
    };

    return [...rows].sort((a, b) => {
      const av = get(a, sortKey);
      const bv = get(b, sortKey);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [enriched, search, schoolFilters, portalFilters, positionFilters, levelFilters, sortKey, sortDir]);

  // ─── Click-through ────────────────────────────────────────────────────

  const onRowClick = (r: EnrichedRow) => {
    if (r.is_high_school) return;        // HS profile route TBD
    if (!r.player_id) return;            // unmatched college — no profile
    const bucket = positionBucket(r.player_position ?? r.position ?? null);
    const route = bucket === "P" ? `/dashboard/pitcher/${r.player_id}` : `/dashboard/player/${r.player_id}`;
    navigate(route);
  };

  const isClickable = (r: EnrichedRow) => !r.is_high_school && !!r.player_id;

  // ─── Sort header button (mirrors ReturningPlayers SortButton) ─────────

  const SortButton = ({ label, k }: { label: string; k: SortKey }) => (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => toggleSort(k)}
      className="h-7 -ml-2 px-2 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground hover:text-foreground"
    >
      {label}
      <ArrowUpDown className="ml-1 h-3 w-3" />
    </Button>
  );

  return (
    <DashboardLayout>
      <div className="space-y-3 max-w-[1600px] mx-auto pb-20">
        {/* Header — matches Player Dashboard chrome */}
        <div className="rounded-lg border-l-[3px] border-l-[#D4AF37] border-t border-r border-b border-border/60 bg-muted/20 px-4 py-2.5">
          <h2
            className="text-2xl font-bold tracking-[0.04em] uppercase leading-none"
            style={{ fontFamily: "'Oswald', sans-serif", color: "#D4AF37" }}
          >
            The War Room
          </h2>
          <p className="text-muted-foreground text-xs mt-1.5 tracking-wide">
            Draft-eligible college players + HS commits · ranked by industry consensus with MLB slot value
          </p>
        </div>

        {/* Search + filters */}
        <div className="space-y-1.5">
          <div className="relative w-full max-w-md">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search player, school, commitment..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-8 h-9 text-sm rounded-lg border-border/60 focus-visible:ring-primary/30"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <MultiSelectFilter
              label="School"
              options={schoolOptions}
              selected={schoolFilters}
              onToggle={toggleSchool}
              onClear={() => setSchoolFilters(new Set())}
              triggerWidth="170px"
              searchable
            />
            <MultiSelectFilter<"IN PORTAL" | "COMMITTED">
              label="Portal"
              options={[
                { value: "IN PORTAL", label: "In Portal" },
                { value: "COMMITTED", label: "Committed" },
              ]}
              selected={portalFilters}
              onToggle={togglePortal}
              onClear={() => setPortalFilters(new Set())}
              triggerWidth="140px"
            />
            <MultiSelectFilter<PositionBucket>
              label="Position"
              options={[
                { value: "C", label: "Catcher" },
                { value: "IF", label: "Infield" },
                { value: "OF", label: "Outfield" },
                { value: "P", label: "Pitcher" },
              ]}
              selected={positionFilters}
              onToggle={togglePosition}
              onClear={() => setPositionFilters(new Set())}
              triggerWidth="140px"
            />
            <MultiSelectFilter<"College" | "HS">
              label="Level"
              options={[
                { value: "College", label: "College" },
                { value: "HS", label: "High School" },
              ]}
              selected={levelFilters}
              onToggle={toggleLevel}
              onClear={() => setLevelFilters(new Set())}
              triggerWidth="140px"
            />
          </div>
        </div>

        {/* Table — Card chrome matches the Player Projections card on Player Dashboard */}
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <CardTitle
                className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]"
                style={{ fontFamily: "'Oswald', sans-serif" }}
              >
                Draft IQ
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto overflow-y-auto max-h-[70vh]">
          <Table>
            <TableHeader className="sticky top-0 z-20 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
              <TableRow>
                <TableHead className="w-[50px] sticky left-0 z-30 bg-background"><SortButton label="Rank" k="rank" /></TableHead>
                <TableHead className="w-[140px] sticky left-[50px] z-30 bg-background"><SortButton label="Name" k="name" /></TableHead>
                <TableHead className="w-[250px]"><SortButton label="School" k="school" /></TableHead>
                <TableHead className="w-[115px]"><SortButton label="Commitment" k="commitment" /></TableHead>
                <TableHead className="w-[58px] text-center">
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Level</span>
                </TableHead>
                <TableHead className="w-[58px] text-right"><SortButton label="Slot Value" k="slot_value" /></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingSlots && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground text-sm">Loading draft board...</TableCell>
                </TableRow>
              )}
              {!loadingSlots && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground text-sm">No prospects match the current filters.</TableCell>
                </TableRow>
              )}
              {filtered.map((r) => {
                const clickable = isClickable(r);
                return (
                  <TableRow
                    key={r.id}
                    onClick={() => clickable && onRowClick(r)}
                    tabIndex={clickable ? 0 : -1}
                    onKeyDown={(e) => {
                      if (clickable && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        onRowClick(r);
                      }
                    }}
                    className={cn(
                      "group transition-colors duration-150 border-l-2 border-l-transparent even:bg-muted/15 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#D4AF37]/60",
                      clickable
                        ? "cursor-pointer hover:bg-[#D4AF37]/5 hover:border-l-[#D4AF37]"
                        : "cursor-default opacity-90",
                    )}
                  >
                    <TableCell className="sticky left-0 z-10 bg-background">
                      {r.rank != null ? (
                        <span className="inline-flex items-center justify-center min-w-[30px] px-1 py-0.5 rounded-md bg-[#D4AF37]/10 text-[#D4AF37] text-[11px] font-bold tracking-tight tabular-nums">
                          #{r.rank}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className={cn(
                      "font-medium whitespace-nowrap sticky left-[50px] z-10 bg-background",
                      clickable && "group-hover:text-[#D4AF37] transition-colors",
                    )}>{r.player_name}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.current_school ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.is_high_school ? (r.commitment_school ?? "—") : "—"}</TableCell>
                    <TableCell className="text-center">
                      <span
                        className={cn(
                          "inline-flex items-center justify-center min-w-[36px] px-1.5 py-[2px] rounded-sm text-[9px] uppercase tracking-[0.08em] font-semibold ring-1",
                          r.is_high_school
                            ? "bg-[#D4AF37]/15 text-[#D4AF37] ring-[#D4AF37]/40"
                            : "bg-muted text-muted-foreground/80 ring-border/60",
                        )}
                      >
                        {r.is_high_school ? "HS" : "College"}
                      </span>
                    </TableCell>
                    <TableCell
                      className="text-right font-bold text-[#D4AF37] tabular-nums"
                      title={`$${Math.round(r.slot_value).toLocaleString()}`}
                    >
                      {formatSlotCompact(r.slot_value)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
