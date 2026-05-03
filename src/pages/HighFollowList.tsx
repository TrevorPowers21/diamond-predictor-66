import { useState, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, X, ArrowUpDown, Star } from "lucide-react";
import { CURRENT_SEASON } from "@/lib/seasonConstants";
import { cn } from "@/lib/utils";
import { useHighFollow, type HighFollowRow } from "@/hooks/useHighFollow";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { profileRouteFor } from "@/lib/profileRoutes";
import { useTeamsTable } from "@/hooks/useTeamsTable";
import { useParkFactors } from "@/hooks/useParkFactors";
import { usePitchingEquationWeights } from "@/hooks/usePitchingEquationWeights";
import { readPitchingWeights } from "@/lib/pitchingEquations";
import { computePitcherProjection, type PitcherProjectionResult } from "@/lib/pitcherProjection";
import {
  ScoutingReportProvider,
  PlayerSelectCheckbox,
  DownloadReportBar,
  type ReportPlayer,
} from "@/components/ScoutingReport";

// ── Helpers ─────────────────────────────────────────────────────────

const statFmt = (v: number | null | undefined, d = 3) => {
  if (v == null) return "—";
  return Number(v).toFixed(d);
};
const pctFmt = (v: number | null | undefined) => (v == null ? "—" : String(Math.round(Number(v))));
const moneyFmt = (v: number | null | undefined) => {
  if (v == null) return "—";
  return `$${Math.round(Number(v)).toLocaleString()}`;
};

type SortKey = "name" | "position" | "team" | "type" | "added_at" |
  "p_avg" | "p_obp" | "p_slg" | "p_ops" | "p_iso" | "p_wrc_plus" | "owar" | "nil" |
  "p_era" | "p_fip" | "p_whip" | "p_k9" | "p_bb9" | "p_hr9" | "p_rv_plus" | "p_war";
type SortDir = "asc" | "desc";

interface MergedRow {
  hf: HighFollowRow;
  hitter: any | null;
  pitcher: any | null;
  pred: any | null;
  pitcherProjection: PitcherProjectionResult | null;
}

// ── Scouting mini box ───────────────────────────────────────────────

function ScoutMini({ label, value }: { label: string; value: number | null | undefined }) {
  if (value == null) return null;
  const v = Number(value);
  const tier =
    v >= 80
      ? "bg-[hsl(142,71%,45%,0.12)] text-[hsl(142,71%,35%)] border-[hsl(142,71%,45%,0.25)]"
      : v >= 50
        ? "bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))] border-[hsl(var(--warning)/0.3)]"
        : "bg-[hsl(0,72%,51%,0.12)] text-[hsl(0,72%,41%)] border-[hsl(0,72%,51%,0.25)]";
  return (
    <div className={`inline-flex min-w-[32px] flex-col items-center rounded border px-1 py-0.5 leading-tight ${tier}`} title={`${label}: ${Math.round(v)}`}>
      <span className="text-[8px] font-semibold uppercase tracking-wider">{label}</span>
      <span className="text-[10px] font-bold tabular-nums">{Math.round(v)}</span>
    </div>
  );
}

// ── Component ───────────────────────────────────────────────────────

export default function HighFollowList() {
  const { list, isLoading, removePlayer } = useHighFollow();
  const [search, setSearch] = useState("");
  const [positionFilters, setPositionFilters] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState<"hitter" | "pitcher">("hitter");
  const [sortKey, setSortKey] = useState<SortKey>("added_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const togglePosition = useCallback((pos: string) => {
    setPositionFilters((prev) => {
      const next = new Set(prev);
      if (next.has(pos)) next.delete(pos);
      else next.add(pos);
      return next;
    });
  }, []);

  const playerIds = useMemo(() => list.map((r) => r.player_id), [list]);
  const sourceIds = useMemo(() => list.map((r) => r.source_player_id).filter(Boolean) as string[], [list]);

  const { data: hitterRows = [] } = useQuery({
    queryKey: ["hf-hitter-master", sourceIds],
    enabled: sourceIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("Hitter Master").select("*").in("source_player_id", sourceIds).eq("Season", CURRENT_SEASON);
      return data || [];
    },
  });

  const { data: pitcherRows = [] } = useQuery({
    queryKey: ["hf-pitcher-master", sourceIds],
    enabled: sourceIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("Pitching Master").select("*").in("source_player_id", sourceIds).eq("Season", CURRENT_SEASON);
      return data || [];
    },
  });

  const { data: predictions = [] } = useQuery({
    queryKey: ["hf-predictions", playerIds],
    enabled: playerIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("player_predictions").select("*").in("player_id", playerIds).eq("status", "active");
      return data || [];
    },
  });

  const hitterMap = useMemo(() => { const m = new Map<string, any>(); for (const r of hitterRows) m.set(r.source_player_id, r); return m; }, [hitterRows]);
  const pitcherMap = useMemo(() => { const m = new Map<string, any>(); for (const r of pitcherRows) m.set(r.source_player_id, r); return m; }, [pitcherRows]);

  const { teamsByName } = useTeamsTable();
  const { parkMap } = useParkFactors();
  const pitchingPowerEq = usePitchingEquationWeights();

  // Build a map of source_player_id → projected pitching line using the same
  // math as Returning Players (shared lib at src/lib/pitcherProjection.ts).
  const pitcherProjectionMap = useMemo(() => {
    const m = new Map<string, PitcherProjectionResult>();
    if (!pitcherRows.length) return m;
    const eq = readPitchingWeights();
    for (const r of pitcherRows) {
      const sourceId = (r as any).source_player_id;
      if (!sourceId) continue;
      const teamName = ((r as any).Team as string | null) ?? null;
      const teamMatch = teamName ? teamsByName.get(teamName.toLowerCase().trim()) : undefined;
      const projection = computePitcherProjection(
        {
          era: (r as any).ERA ?? null,
          fip: (r as any).FIP ?? null,
          whip: (r as any).WHIP ?? null,
          k9: (r as any).K9 ?? null,
          bb9: (r as any).BB9 ?? null,
          hr9: (r as any).HR9 ?? null,
          stuffPlus: (r as any).stuff_plus ?? null,
          miss_pct: (r as any).miss_pct ?? null,
          bb_pct: (r as any).bb_pct ?? null,
          hard_hit_pct: (r as any).hard_hit_pct ?? null,
          in_zone_whiff_pct: (r as any).in_zone_whiff_pct ?? null,
          chase_pct: (r as any).chase_pct ?? null,
          barrel_pct: (r as any).barrel_pct ?? null,
          line_pct: (r as any).line_pct ?? null,
          exit_vel: (r as any).exit_vel ?? null,
          ground_pct: (r as any).ground_pct ?? null,
          in_zone_pct: (r as any).in_zone_pct ?? null,
          vel_90th: (r as any)["90th_vel"] ?? null,
          h_pull_pct: (r as any).h_pull_pct ?? null,
          la_10_30_pct: (r as any).la_10_30_pct ?? null,
          role: (r as any).Role ?? null,
          g: (r as any).G ?? null,
          gs: (r as any).GS ?? null,
          team: teamName,
          teamId: (r as any).TeamID ?? null,
          conference: teamMatch?.conference ?? (r as any).Conference ?? null,
        },
        {
          eq,
          powerEq: pitchingPowerEq as unknown as Record<string, number>,
          parkMap,
          teamMatch: teamMatch
            ? { id: teamMatch.id, name: teamMatch.name, park_factor: teamMatch.park_factor }
            : null,
          // Prefer pipeline-computed PR+ from Pitching Master — same hierarchy
          // PitcherProfile + the recalc engine use. This fills era/fip/whip
          // projections for pitchers missing full scouting (no Stuff+).
          storedPrPlus: {
            era: (r as any).era_pr_plus ?? null,
            fip: (r as any).fip_pr_plus ?? null,
            whip: (r as any).whip_pr_plus ?? null,
            k9: null,
            bb9: null,
            hr9: null,
          },
        },
      );
      m.set(sourceId, projection);
    }
    return m;
  }, [pitcherRows, teamsByName, parkMap, pitchingPowerEq]);
  const predMap = useMemo(() => { const m = new Map<string, any>(); for (const r of predictions) m.set(r.player_id, r); return m; }, [predictions]);

  const merged: MergedRow[] = useMemo(() => list.map((hf) => {
    const liveProjection = hf.source_player_id ? pitcherProjectionMap.get(hf.source_player_id) || null : null;
    const pred = predMap.get(hf.player_id) || null;
    // DB-stored pitcher projection wins over live compute — matches the
    // ReturningPlayers pattern and reflects the canonical values PitcherProfile
    // produces when coaches save class transition / dev / role changes.
    const pitcherProjection = liveProjection && pred?.p_era != null
      ? {
          ...liveProjection,
          p_era: pred.p_era,
          p_fip: pred.p_fip,
          p_whip: pred.p_whip,
          p_k9: pred.p_k9,
          p_bb9: pred.p_bb9,
          p_hr9: pred.p_hr9,
          p_rv_plus: pred.p_rv_plus,
          projected_role: (pred.pitcher_role as "SP" | "RP" | "SM" | null) || liveProjection.projected_role,
        }
      : liveProjection;
    return {
      hf,
      hitter: hf.source_player_id ? hitterMap.get(hf.source_player_id) || null : null,
      pitcher: hf.source_player_id ? pitcherMap.get(hf.source_player_id) || null : null,
      pred,
      pitcherProjection,
    };
  }), [list, hitterMap, pitcherMap, predMap, pitcherProjectionMap]);

  const filtered = useMemo(() => {
    let rows = merged;
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((r) => `${r.hf.first_name} ${r.hf.last_name}`.toLowerCase().includes(q) || (r.hf.team || "").toLowerCase().includes(q));
    }
    rows = rows.filter((r) => r.hf.player_type === typeFilter);
    if (positionFilters.size > 0) {
      rows = rows.filter((r) => {
        const p = (r.hf.position || "").toUpperCase();
        return positionFilters.has(p);
      });
    }
    return rows;
  }, [merged, search, typeFilter, positionFilters]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let av: any, bv: any;
      switch (sortKey) {
        case "name": av = `${a.hf.first_name} ${a.hf.last_name}`; bv = `${b.hf.first_name} ${b.hf.last_name}`; break;
        case "position": av = a.hf.position || ""; bv = b.hf.position || ""; break;
        case "team": av = a.hf.team || ""; bv = b.hf.team || ""; break;
        case "type": av = a.hf.player_type; bv = b.hf.player_type; break;
        case "added_at": av = a.hf.added_at; bv = b.hf.added_at; break;
        case "p_avg": av = a.pred?.p_avg ?? -999; bv = b.pred?.p_avg ?? -999; break;
        case "p_obp": av = a.pred?.p_obp ?? -999; bv = b.pred?.p_obp ?? -999; break;
        case "p_slg": av = a.pred?.p_slg ?? -999; bv = b.pred?.p_slg ?? -999; break;
        case "p_ops": av = (a.pred?.p_obp ?? 0) + (a.pred?.p_slg ?? 0); bv = (b.pred?.p_obp ?? 0) + (b.pred?.p_slg ?? 0); break;
        case "p_iso": av = (a.pred?.p_slg ?? 0) - (a.pred?.p_avg ?? 0); bv = (b.pred?.p_slg ?? 0) - (b.pred?.p_avg ?? 0); break;
        case "p_wrc_plus": av = a.pred?.p_wrc_plus ?? -999; bv = b.pred?.p_wrc_plus ?? -999; break;
        case "owar": av = a.pred?.p_wrc_plus ?? -999; bv = b.pred?.p_wrc_plus ?? -999; break;
        case "nil": av = a.pred?.nil_value ?? -999; bv = b.pred?.nil_value ?? -999; break;
        case "p_era": av = a.pitcherProjection?.p_era ?? 999; bv = b.pitcherProjection?.p_era ?? 999; break;
        case "p_fip": av = a.pitcherProjection?.p_fip ?? 999; bv = b.pitcherProjection?.p_fip ?? 999; break;
        case "p_whip": av = a.pitcherProjection?.p_whip ?? 999; bv = b.pitcherProjection?.p_whip ?? 999; break;
        case "p_k9": av = a.pitcherProjection?.p_k9 ?? -999; bv = b.pitcherProjection?.p_k9 ?? -999; break;
        case "p_bb9": av = a.pitcherProjection?.p_bb9 ?? 999; bv = b.pitcherProjection?.p_bb9 ?? 999; break;
        case "p_hr9": av = a.pitcherProjection?.p_hr9 ?? 999; bv = b.pitcherProjection?.p_hr9 ?? 999; break;
        case "p_rv_plus": av = a.pitcherProjection?.p_rv_plus ?? -999; bv = b.pitcherProjection?.p_rv_plus ?? -999; break;
        case "p_war": av = a.pitcherProjection?.p_war ?? -999; bv = b.pitcherProjection?.p_war ?? -999; break;
        default: av = a.hf.added_at; bv = b.hf.added_at;
      }
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const SortBtn = ({ label, sk }: { label: string; sk: SortKey }) => (
    <button onClick={() => toggleSort(sk)} className={cn("inline-flex items-center gap-0.5 text-[11px] font-semibold uppercase tracking-wider cursor-pointer transition-colors", sortKey === sk ? "text-[#D4AF37]" : "text-[#8a94a6] hover:text-slate-200")}>
      {label}<ArrowUpDown className="h-2.5 w-2.5" />
    </button>
  );

  // All unique positions across both types
  const positions = useMemo(() => {
    const s = new Set<string>();
    for (const r of merged) {
      const p = (r.hf.position || "").toUpperCase();
      if (p) s.add(p);
    }
    return Array.from(s).sort();
  }, [merged]);

  const toReportPlayer = (r: MergedRow): ReportPlayer => {
    const isP = r.hf.player_type === "pitcher";
    return {
      id: r.hf.player_id, player_type: r.hf.player_type,
      name: `${r.hf.first_name} ${r.hf.last_name}`, school: r.hf.team,
      position: r.hf.position, class_year: r.hf.class_year,
      ...(!isP && r.pred ? { p_avg: r.pred.p_avg, p_obp: r.pred.p_obp, p_slg: r.pred.p_slg, p_ops: r.pred.p_ops, p_iso: r.pred.p_iso, p_wrc_plus: r.pred.p_wrc_plus, barrel_score: r.pred.barrel_score, ev_score: r.pred.ev_score, contact_score: r.pred.contact_score, chase_score: r.pred.chase_score } : {}),
      ...(isP ? { p_era: r.pitcherProjection?.p_era, p_fip: r.pitcherProjection?.p_fip, p_whip: r.pitcherProjection?.p_whip, p_k9: r.pitcherProjection?.p_k9, p_bb9: r.pitcherProjection?.p_bb9, p_hr9: r.pitcherProjection?.p_hr9, stuff_score: r.pitcherProjection?.scores.stuff, whiff_score: r.pitcherProjection?.scores.whiff, bb_score: r.pitcherProjection?.scores.bb, barrel_score: r.pitcherProjection?.scores.barrel } : {}),
    };
  };

  const hitterCount = list.filter((r) => r.player_type === "hitter").length;
  const pitcherCount = list.filter((r) => r.player_type === "pitcher").length;

  return (
    <DashboardLayout>
      <ScoutingReportProvider>
        <div className="space-y-4 max-w-[1600px] mx-auto pb-20">
          {/* Header */}
          <div className="rounded-lg border border-[#162241] bg-[#0a1428] px-5 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-bold tracking-wide uppercase text-[#D4AF37] flex items-center gap-2" style={{ fontFamily: "Oswald, sans-serif" }}>
                <Star className="h-5 w-5" />
                High Follow List
              </h2>
              <p className="text-[#8a94a6] text-sm mt-0.5">
                {list.length} player{list.length !== 1 ? "s" : ""}
                {hitterCount > 0 && pitcherCount > 0 && (
                  <span className="ml-1">({hitterCount} hitter{hitterCount !== 1 ? "s" : ""}, {pitcherCount} pitcher{pitcherCount !== 1 ? "s" : ""})</span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex gap-0.5 rounded-lg border border-[#162241] bg-[#0d1a30] p-0.5">
                {(["hitter", "pitcher"] as const).map((t) => (
                  <button
                    key={t}
                    className={cn("px-3 py-1.5 text-xs rounded-md font-medium transition-colors duration-150 cursor-pointer", typeFilter === t ? "bg-[#162241] text-white shadow-sm" : "text-[#8a94a6] hover:text-slate-200")}
                    onClick={() => setTypeFilter(t)}
                  >
                    {t === "hitter" ? "Hitting" : "Pitching"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Search + Position Filters */}
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#5a6478]" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or team..."
                className="pl-9 h-9 text-sm border-[#162241] bg-[#0a1428] text-slate-200 placeholder:text-[#5a6478]"
              />
            </div>
            {positions.length > 0 && (
              <div className="flex flex-wrap gap-1.5 items-center">
                <button
                  onClick={() => setPositionFilters(new Set())}
                  className={cn(
                    "px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer",
                    positionFilters.size === 0
                      ? "bg-[#D4AF37]/15 text-[#D4AF37] ring-1 ring-[#D4AF37]/30"
                      : "bg-[#0d1a30] text-[#8a94a6] hover:text-slate-200"
                  )}
                >
                  All
                </button>
                {positions.map((pos) => (
                  <button
                    key={pos}
                    onClick={() => togglePosition(pos)}
                    className={cn(
                      "px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer",
                      positionFilters.has(pos)
                        ? "bg-[#D4AF37]/15 text-[#D4AF37] ring-1 ring-[#D4AF37]/30"
                        : "bg-[#0d1a30] text-[#8a94a6] hover:text-slate-200"
                    )}
                  >
                    {pos}
                  </button>
                ))}
                {positionFilters.size > 1 && (
                  <span className="text-[10px] text-[#5a6478] ml-1">{positionFilters.size} selected</span>
                )}
              </div>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-[#8a94a6]">Loading...</div>
          ) : sorted.length === 0 ? (
            <Card className="border-[#162241] bg-[#0a1428]">
              <CardContent className="py-16 text-center text-[#8a94a6]">
                {list.length === 0
                  ? "No players on your High Follow list yet. Select players from the Player Dashboard and click \"High Follow\"."
                  : "No players match your filters."}
              </CardContent>
            </Card>
          ) : (
            <Card className="border-[#162241] bg-[#0a1428] overflow-hidden">
              <CardContent className="p-0">
                <div className="overflow-x-auto [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: "none" }}>
                  <Table>
                    <TableHeader>
                      <TableRow className="border-b border-[#162241] hover:bg-transparent">
                        <TableHead className="w-[32px] p-1"></TableHead>
                        <TableHead className="min-w-[160px] sticky left-0 z-10 bg-[#0a1428]"><SortBtn label="Player" sk="name" /></TableHead>
                        {typeFilter === "pitcher" ? (
                          <>
                            <TableHead className="text-right"><SortBtn label="ERA" sk="p_era" /></TableHead>
                            <TableHead className="text-right"><SortBtn label="FIP" sk="p_fip" /></TableHead>
                            <TableHead className="text-right"><SortBtn label="WHIP" sk="p_whip" /></TableHead>
                            <TableHead className="text-right"><SortBtn label="K/9" sk="p_k9" /></TableHead>
                            <TableHead className="text-right"><SortBtn label="pRV+" sk="p_rv_plus" /></TableHead>
                          </>
                        ) : (
                          <>
                            <TableHead className="text-right"><SortBtn label="AVG" sk="p_avg" /></TableHead>
                            <TableHead className="text-right"><SortBtn label="OBP" sk="p_obp" /></TableHead>
                            <TableHead className="text-right"><SortBtn label="SLG" sk="p_slg" /></TableHead>
                            <TableHead className="text-right"><SortBtn label="OPS" sk="p_ops" /></TableHead>
                            <TableHead className="text-right"><SortBtn label="wRC+" sk="p_wrc_plus" /></TableHead>
                          </>
                        )}
                        <TableHead className="text-center min-w-[140px]"><span className="text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6]">Scouting</span></TableHead>
                        <TableHead className="w-[36px] p-0"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sorted.map((r, i) => {
                        const isP = r.hf.player_type === "pitcher";
                        const pred = r.pred;
                        const pm = r.pitcher;
                        const hm = r.hitter;
                        const profileRoute = isP
                          ? `/dashboard/pitcher/storage__${encodeURIComponent(r.hf.first_name + " " + r.hf.last_name)}__${encodeURIComponent(r.hf.team || "")}`
                          : profileRouteFor(r.hf.player_id, r.hf.position);

                        // Resolve stats: projected first, then actual from master tables
                        const avg = isP ? pm?.ERA : (pred?.p_avg ?? hm?.AVG);
                        const obp = isP ? pm?.FIP : (pred?.p_obp ?? hm?.OBP);
                        const slg = isP ? pm?.WHIP : (pred?.p_slg ?? hm?.SLG);
                        const ops = isP ? pm?.K9 : ((pred?.p_obp ?? hm?.OBP ?? 0) + (pred?.p_slg ?? hm?.SLG ?? 0)) || null;
                        const wrc = isP ? (pm?.overall_pr_plus) : (pred?.p_wrc_plus ?? hm?.wrc_plus);

                        // Labels change for pitchers in all mode
                        const fmtD = isP ? 2 : 3;
                        const fmtK = isP ? 1 : 3;

                        return (
                          <TableRow
                            key={r.hf.id}
                            className={cn("border-b border-[#162241]/60 transition-colors duration-150 hover:bg-[#162241]/40", i % 2 === 1 ? "bg-[#0d1a30]" : "")}
                          >
                            <TableCell className="p-1 text-center">
                              <PlayerSelectCheckbox player={toReportPlayer(r)} />
                            </TableCell>
                            <TableCell className="sticky left-0 z-10" style={{ backgroundColor: i % 2 === 1 ? "#0d1a30" : "#0a1428" }}>
                              <Link to={profileRoute} className="font-semibold text-slate-100 hover:text-[#D4AF37] transition-colors duration-150">
                                {r.hf.first_name} {r.hf.last_name}
                              </Link>
                              <div className="text-[11px] text-[#8a94a6]">
                                {[r.hf.position, r.hf.team].filter(Boolean).join(" · ")}
                              </div>
                            </TableCell>

                            {/* Stat cells — hitters: AVG/OBP/SLG/OPS/wRC+, pitchers: ERA/FIP/WHIP/K9/pRV+ */}
                            {isP ? (
                              <>
                                <TableCell className="text-right tabular-nums text-slate-200 text-sm">{statFmt(r.pitcherProjection?.p_era, 2)}</TableCell>
                                <TableCell className="text-right tabular-nums text-slate-200 text-sm">{statFmt(r.pitcherProjection?.p_fip, 2)}</TableCell>
                                <TableCell className="text-right tabular-nums text-slate-200 text-sm">{statFmt(r.pitcherProjection?.p_whip, 2)}</TableCell>
                                <TableCell className="text-right tabular-nums text-slate-200 text-sm">{statFmt(r.pitcherProjection?.p_k9, 1)}</TableCell>
                                <TableCell className="text-right tabular-nums text-white text-sm font-semibold">{pctFmt(r.pitcherProjection?.p_rv_plus)}</TableCell>
                              </>
                            ) : (
                              <>
                                <TableCell className="text-right tabular-nums text-slate-200 text-sm">{statFmt(pred?.p_avg ?? hm?.AVG)}</TableCell>
                                <TableCell className="text-right tabular-nums text-slate-200 text-sm">{statFmt(pred?.p_obp ?? hm?.OBP)}</TableCell>
                                <TableCell className="text-right tabular-nums text-slate-200 text-sm">{statFmt(pred?.p_slg ?? hm?.SLG)}</TableCell>
                                <TableCell className="text-right tabular-nums text-slate-200 text-sm">
                                  {(() => {
                                    const o = pred?.p_obp ?? hm?.OBP;
                                    const s = pred?.p_slg ?? hm?.SLG;
                                    return o != null && s != null ? statFmt(Number(o) + Number(s)) : "—";
                                  })()}
                                </TableCell>
                                <TableCell className="text-right tabular-nums text-white text-sm font-semibold">{pctFmt(pred?.p_wrc_plus ?? hm?.wrc_plus)}</TableCell>
                              </>
                            )}

                            {/* Scouting */}
                            <TableCell className="text-center">
                              <div className="flex gap-0.5 justify-center flex-wrap">
                                {isP ? (
                                  <>
                                    <ScoutMini label="Stf+" value={r.pitcherProjection?.scores.stuff} />
                                    <ScoutMini label="Whf" value={r.pitcherProjection?.scores.whiff} />
                                    <ScoutMini label="BB" value={r.pitcherProjection?.scores.bb} />
                                    <ScoutMini label="Brl" value={r.pitcherProjection?.scores.barrel} />
                                  </>
                                ) : (
                                  <>
                                    <ScoutMini label="Brl" value={pred?.barrel_score ?? hm?.barrel_score} />
                                    <ScoutMini label="EV" value={pred?.ev_score ?? hm?.avg_ev_score} />
                                    <ScoutMini label="Con" value={pred?.contact_score ?? hm?.contact_score} />
                                    <ScoutMini label="Chs" value={pred?.chase_score ?? hm?.chase_score} />
                                  </>
                                )}
                              </div>
                            </TableCell>

                            <TableCell className="p-1 text-center">
                              <button
                                onClick={() => removePlayer(r.hf.player_id)}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[#8a94a6] hover:bg-red-500/10 hover:text-red-400 transition-colors duration-150 cursor-pointer"
                                title="Remove from High Follow"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {sorted.length > 0 && (
            <div className="text-xs text-[#5a6478] text-right">
              Showing {sorted.length} of {list.length} player{list.length !== 1 ? "s" : ""}
            </div>
          )}
        </div>
        <DownloadReportBar />
      </ScoutingReportProvider>
    </DashboardLayout>
  );
}
